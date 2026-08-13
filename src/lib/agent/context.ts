import { LIMITS } from "@/lib/commands/runner";
import type { CommandResult } from "@/lib/commands/types";
import { capabilityPrompt, type CapabilityDefinition } from "@/lib/capabilities/catalogue";

export type ToolObservation = {
  id: string;
  kind: "tool" | "command" | "skill" | "retrieval";
  source: string;
  status: string;
  summary?: string;
  data?: unknown;
  diagnostics?: Record<string, unknown>;
};

export type AgentProfile = {
  id: "inko";
  instructions: string;
  skillIds: string[];
  preferredCapabilityIds: string[];
};

export type AgentTurnContext = {
  userMessage: string;
  intent?: { id: string; confidence: number };
  capabilities: CapabilityDefinition[];
  observations: ToolObservation[];
  requestedActions: unknown[];
  conversation: string;
  model: { selectedModelId: string; loadedModelId: string | null; provider: "local" | "cloud" };
  budgets: { toolCalls: number; modelCalls: number; deadlineMs: number };
};

export const INKO_PROFILE: AgentProfile = {
  id: "inko",
  instructions:
    "You are Inko, the application assistant inside Proof of Thesis. Prefer local deterministic tools for facts. Treat tool and command results as ground truth. Never claim a download or mutation happened unless an explicit approved action did it. If facts are missing, say which capability would produce them instead of guessing.",
  skillIds: [],
  preferredCapabilityIds: [],
};

export function commandObservation(result: CommandResult): ToolObservation {
  return {
    id: result.command,
    kind: "command",
    source: result.command,
    status: result.status,
    summary: result.summary,
    data: result.data,
    diagnostics: result.diagnostics as Record<string, unknown> | undefined,
  };
}

export function observationsPrompt(observations: ToolObservation[]): string {
  if (!observations.length) return "TURN OBSERVATIONS\n(none)";
  return `TURN OBSERVATIONS\n${observations
    .map((o) => `${o.kind.toUpperCase()} RESULT\nsource: ${o.source}\nstatus: ${o.status}\nsummary: ${o.summary ?? ""}\ndata: ${JSON.stringify(o.data ?? {})}`)
    .join("\n\n")}`;
}

export function inkoSystemPrompt(ctx: Pick<AgentTurnContext, "capabilities" | "observations">): string {
  return `${INKO_PROFILE.instructions}\n\nAPP CONTEXT\nProof of Thesis is a local-first trading journal for theses, signals, positions, alerts, and POT scores.\n\nCAPABILITY CATALOGUE\n${capabilityPrompt(ctx.capabilities)}\n\n${observationsPrompt(ctx.observations)}`;
}

export function defaultBudgets() {
  return { toolCalls: LIMITS.maxToolHops, modelCalls: 2, deadlineMs: LIMITS.commandTimeoutMs };
}
