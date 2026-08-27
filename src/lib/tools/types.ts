// Tool layer contract.
//
// Principle (see AGENTS.md): Extract → Parse → Index → Calculate → Retrieve →
// Reason only when necessary. A tool is deterministic code. It never calls a
// model. Skills orchestrate tools and may ask a model for the last step only.

import { log } from "@/lib/store";

export type Access = "READ" | "COMPUTE" | "WRITE" | "EDIT" | "DELETE" | "EXECUTE" | "EXTERNAL";

/** Approval + logging policy is derived from access, never hand-set per tool. */
export const POLICY: Record<
  Access,
  { approval: "none" | "when-appropriate" | "explicit"; logged: boolean }
> = {
  READ: { approval: "none", logged: false },
  COMPUTE: { approval: "none", logged: false },
  WRITE: { approval: "when-appropriate", logged: true },
  EDIT: { approval: "when-appropriate", logged: true },
  DELETE: { approval: "explicit", logged: true },
  EXECUTE: { approval: "explicit", logged: true },
  EXTERNAL: { approval: "explicit", logged: true },
};

export type ToolDef<I = unknown, O = unknown> = {
  /** `group.action` */
  id: string;
  group: string;
  action: string;
  label: string;
  purpose: string;
  access: Access;
  /** inputs as `name: type` pairs, kept short on purpose */
  inputs: string;
  /** output shape, kept short on purpose */
  output: string;
  /** implemented against real data today */
  live: boolean;
  run?: (input: I) => O | Promise<O>;
};

export function needsApproval(access: Access): boolean {
  return POLICY[access].approval !== "none";
}

export function isLogged(access: Access): boolean {
  return POLICY[access].logged;
}

export type ToolCall = { tool: ToolDef; input: unknown };

/**
 * Runs a tool and logs it when policy says so. Approval is the caller's job:
 * the UI presents the intent, this only executes.
 */
export async function runTool<I, O>(tool: ToolDef<I, O>, input: I): Promise<O> {
  if (!tool.run) throw new Error(`${tool.id} is not wired yet`);
  const started = Date.now();
  try {
    const out = await tool.run(input);
    if (isLogged(tool.access)) {
      log("tools", tool.id, { level: "call", ms: Date.now() - started });
    }
    return out;
  } catch (err) {
    log("tools", tool.id, {
      level: "error",
      detail: err instanceof Error ? err.message : String(err),
      ms: Date.now() - started,
    });
    throw err;
  }
}
