// Semantic command layer.
//
//   Intent → Command → (many) Tools → compact result → model
//
// A command is what the model chooses. A tool is how the application does it.
// The registry stays tiny and semantic on purpose: it must never become a
// second tool manifest. Executors reuse `src/lib/tools/*` underneath.

import type { Access } from "@/lib/tools/types";

export type ArgType = "string" | "string?" | "number" | "number?" | "boolean?";

export type CommandStatus = "ok" | "needs_input" | "failed" | "partial";

export type CommandResult = {
  command: string;
  status: CommandStatus;
  summary?: string;
  data?: unknown;
  nextAction?: { command?: string; reason?: string; requiresUser?: boolean };
  diagnostics?: { durationMs?: number; toolsUsed?: number; retried?: boolean };
  /** set when status is "failed" */
  reason?:
    | "invalid_arguments"
    | "not_found"
    | "unsupported"
    | "cancelled"
    | "timeout"
    | "runtime_error";
};

export type CommandContext = {
  signal?: AbortSignal;
  /** how many low-level tools the executor touched, for the trace */
  count: (n?: number) => void;
};

export type CommandExecutor = (
  args: Record<string, unknown>,
  ctx: CommandContext,
) => Promise<CommandResult> | CommandResult;

export type CommandDefinition = {
  id: string;
  /** one line — enough to choose it and fill the arguments, nothing more */
  description: string;
  args: Record<string, ArgType>;
  mode: "single" | "goal";
  batchMode: "single" | "batch" | "aggregate" | "workspace";
  capability: string[];
  access: Access;
  execute: CommandExecutor;
};

export function ok(
  command: string,
  data: unknown,
  summary?: string,
  extra: Partial<CommandResult> = {},
): CommandResult {
  return { command, status: "ok", data, summary, ...extra };
}

export function needsInput(
  command: string,
  data: unknown,
  summary: string,
  nextAction?: CommandResult["nextAction"],
): CommandResult {
  return {
    command,
    status: "needs_input",
    data,
    summary,
    nextAction: nextAction ?? { requiresUser: true },
  };
}

export function failed(
  command: string,
  reason: NonNullable<CommandResult["reason"]>,
  summary: string,
): CommandResult {
  return { command, status: "failed", reason, summary };
}
