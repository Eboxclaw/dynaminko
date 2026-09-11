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

/**
 * The search-input rule, shared by every search-like tool (any def whose
 * action is "search" and whose input carries a query). A query must be a
 * real search term: non-empty after trimming, at least 2 characters, and at
 * least one letter — pure punctuation or digit soup ("1.1", "???", "") is a
 * junk pick, not a query. Returns the rejection reason, or null when the
 * query is usable. The hop loop turns a rejection into a structured
 * observation (naming the right capability) and the rejected hop still
 * counts toward the same-tool cap, so junk picks burn budget visibly
 * instead of executing and returning empty results the model retries on.
 */
export function searchQueryProblem(query: unknown): string | null {
  if (typeof query !== "string") return "query must be a string";
  const trimmed = query.trim();
  if (trimmed.length === 0) return "query is empty";
  if (trimmed.length < 2) return `query "${trimmed}" is too short (need at least 2 characters)`;
  if (!/[a-zA-Z\u00C0-\u024F\u4E00-\u9FFF]/.test(trimmed))
    return `query "${trimmed}" has no search term (letters required, not just numbers or punctuation)`;
  return null;
}

/** Whether a tool definition is search-like: the shared query rule applies. */
export function isSearchTool(tool: { action: string; inputs: string }): boolean {
  return tool.action === "search" && /\bquery\b/.test(tool.inputs);
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
