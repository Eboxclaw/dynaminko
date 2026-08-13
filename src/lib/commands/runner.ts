// One executor for every command. Validates arguments before running, retries
// only transient failures, honours cancellation and a wall-clock deadline, and
// always returns a compact CommandResult — never a raw row set.

import { log } from "@/lib/store";
import { needsApproval } from "@/lib/tools/types";

import { COMMAND_BY_ID } from "./registry";
import { failed, type CommandDefinition, type CommandResult } from "./types";

/** Local loop limits. Cloud drops the semantic cap but keeps the deadline. */
export const LIMITS = {
  /** normal agent loop */
  maxToolHops: 5,
  /** goal mode */
  maxCyclesLocal: 2,
  maxCallsPerCycle: 5,
  maxTotalSteps: 10,
  maxRetries: 1,
  /** wall clock — applies to cloud too */
  goalDeadlineMs: 120_000,
  commandTimeoutMs: 30_000,
} as const;

export type Trace = {
  command: string;
  status: CommandResult["status"];
  durationMs: number;
  toolsUsed: number;
  retried: boolean;
};

const TRANSIENT = /(network|timeout|temporar|fetch failed|aborted by runtime)/i;

function validate(def: CommandDefinition, args: Record<string, unknown>): string | null {
  for (const [name, type] of Object.entries(def.args)) {
    const optional = type.endsWith("?");
    const value = args[name];
    if (value == null || value === "") {
      if (!optional) return `${name} is required`;
      continue;
    }
    const base = type.replace("?", "");
    if (base === "number" && Number.isNaN(Number(value))) return `${name} must be a number`;
    if (base === "string" && typeof value !== "string") return `${name} must be text`;
  }
  return null;
}

export function commandNeedsApproval(id: string): boolean {
  const def = COMMAND_BY_ID[id];
  return def ? needsApproval(def.access) : true;
}

export async function runCommand(
  id: string,
  args: Record<string, unknown> = {},
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<CommandResult> {
  const def = COMMAND_BY_ID[id];
  if (!def) return failed(id, "unsupported", `unknown command: ${id}`);

  const invalid = validate(def, args);
  if (invalid) return failed(id, "invalid_arguments", invalid);

  const started = Date.now();
  let tools = 0;
  const ctx = { signal: opts.signal, count: (n = 1) => (tools += n) };

  const attempt = async (): Promise<CommandResult> => {
    if (opts.signal?.aborted) return failed(id, "cancelled", "cancelled");
    const timeout = new Promise<CommandResult>((_, reject) =>
      setTimeout(
        () => reject(new Error("timeout")),
        opts.timeoutMs ?? LIMITS.commandTimeoutMs,
      ),
    );
    return Promise.race([Promise.resolve(def.execute(args, ctx)), timeout]);
  };

  let retried = false;
  for (let i = 0; i <= LIMITS.maxRetries; i++) {
    try {
      const result = await attempt();
      const out: CommandResult = {
        ...result,
        diagnostics: { durationMs: Date.now() - started, toolsUsed: tools, retried },
      };
      log("skills", def.id, {
        level: out.status === "failed" ? "error" : "call",
        ms: Date.now() - started,
        detail: out.summary ?? out.status,
      });
      return out;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const transient = TRANSIENT.test(message);
      if (!transient || i === LIMITS.maxRetries || opts.signal?.aborted) {
        log("skills", def.id, { level: "error", detail: message, ms: Date.now() - started });
        return {
          ...failed(id, message === "timeout" ? "timeout" : "runtime_error", message),
          diagnostics: { durationMs: Date.now() - started, toolsUsed: tools, retried },
        };
      }
      retried = true;
    }
  }
  return failed(id, "runtime_error", "unreachable");
}

/**
 * Bounded multi-cycle execution. Same registry, same runner, same traces — a
 * mode, not a second agent. `unbounded` (cloud) drops the call cap but keeps
 * cancellation and the wall-clock deadline.
 */
export async function runGoal(
  plan: (state: CommandResult[]) => Promise<{ id: string; args?: Record<string, unknown> } | null>,
  opts: { signal?: AbortSignal; unbounded?: boolean; deadlineMs?: number } = {},
): Promise<{ results: CommandResult[]; stopped: "done" | "limit" | "deadline" | "cancelled" }> {
  const deadline = Date.now() + (opts.deadlineMs ?? LIMITS.goalDeadlineMs);
  const results: CommandResult[] = [];
  const maxSteps = opts.unbounded ? Number.POSITIVE_INFINITY : LIMITS.maxTotalSteps;

  while (results.length < maxSteps) {
    if (opts.signal?.aborted) return { results, stopped: "cancelled" };
    if (Date.now() > deadline) return { results, stopped: "deadline" };
    const next = await plan(results);
    if (!next) return { results, stopped: "done" };
    results.push(
      await runCommand(next.id, next.args ?? {}, {
        signal: opts.signal,
        timeoutMs: Math.max(1_000, deadline - Date.now()),
      }),
    );
  }
  return { results, stopped: "limit" };
}
