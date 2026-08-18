import { LIMITS } from "@/lib/commands/runner";
import type { CommandResult } from "@/lib/commands/types";
import { capabilityPrompt, type CapabilityDefinition } from "@/lib/capabilities/catalogue";
import { estimateTokens } from "@/lib/chat/context";
import type { ChatMessage } from "@/lib/chat/session";
import type { TurnMessage } from "@/lib/ai";

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
    "You are Inko, the application assistant inside Proof of Thesis. Prefer local deterministic tools for facts. Treat tool and command results as ground truth. Never claim a download or mutation happened unless an explicit approved action did it. If facts are missing, say which capability would produce them instead of guessing. You are running inside the user's own app; FACTS and TURN OBSERVATIONS are their real journal data. Never claim you lack access to it; if a number is missing, name the capability that would produce it.",
  skillIds: [],
  preferredCapabilityIds: [],
};

/**
 * Hard rules appended to CORE. They exist because small models break exactly
 * these: they invent counts that appear nowhere, and they pad. Grounded turns
 * still verify against observations, but the rule is stated, not implied.
 */
export const GROUND_RULES = [
  "Numbers may only come from FACTS lines or TURN OBSERVATIONS; never invent or derive new ones. If a number you need is absent, name the capability that would produce it.",
  "Stay conversational: greet back in one short line when greeted, then answer. Do not repeat the same sentence or idea.",
  "Answer in 2 to 4 sentences unless the user asks for more.",
].join(" ");

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

/** Same treatment for skill results so routed skill turns reach the model. */
export function skillObservation(result: {
  skill: { id: string; tools: string[] };
  facts: string[];
  data: unknown;
}): ToolObservation {
  return {
    id: result.skill.id,
    kind: "skill",
    source: result.skill.tools.join(" → ") || result.skill.id,
    status: "ok",
    summary: result.facts[0],
    data: { facts: result.facts, data: result.data },
  };
}

export function observationsPrompt(observations: ToolObservation[]): string {
  if (!observations.length) return "TURN OBSERVATIONS\n(none)";
  return `TURN OBSERVATIONS\n${observations
    .map(
      (o) =>
        `${o.kind.toUpperCase()} RESULT\nsource: ${o.source}\nstatus: ${o.status}\nsummary: ${o.summary ?? ""}\ndata: ${JSON.stringify(o.data ?? {})}`,
    )
    .join("\n\n")}`;
}

export function inkoSystemPrompt(
  ctx: Pick<AgentTurnContext, "capabilities" | "observations">,
): string {
  return `${INKO_PROFILE.instructions}\n\nAPP CONTEXT\nProof of Thesis is a local-first trading journal for theses, signals, positions, alerts, and POT scores.\n\nCAPABILITY CATALOGUE\n${capabilityPrompt(ctx.capabilities)}\n\n${observationsPrompt(ctx.observations)}`;
}

export function defaultBudgets() {
  return { toolCalls: LIMITS.maxToolHops, modelCalls: 2, deadlineMs: LIMITS.commandTimeoutMs };
}

// ── sectioned turn builder ──────────────────────────────────────────────────
//
// One budget-aware assembly point for everything a turn carries. Every section
// reports its cost; history gets whatever is left and compacts head+tail. The
// section table goes to the trace so a turn's context is always auditable.

export type ContextSection = {
  name: string;
  text: string;
  estTokens: number;
  truncated: boolean;
};

export type TurnBuild = {
  messages: TurnMessage[];
  sections: ContextSection[];
  estTokens: number;
};

export type BuildTurnInput = {
  /** per-call instruction line, e.g. the analyst prompt for a skill turn */
  instructions: string;
  /** labeled fact lines (`key: value`), see factLines() */
  state: string;
  /** one-line-per-capability book */
  capabilitiesDigest: string;
  /** full detail blocks for the turn's selected capabilities, may be "" */
  selectedCapabilities: CapabilityDefinition[];
  /** retrieved record lines */
  records: string[];
  observations: ToolObservation[];
  /** prior transcript, compacted to fit */
  history: ChatMessage[];
  user: string;
  budgetTokens: number;
};

/** One history entry as a compact chat turn. Tool cards collapse to one line. */
function historyLine(m: ChatMessage): { role: "user" | "assistant" | "tool"; text: string } | null {
  if (m.role === "note") return null;
  if (m.role === "tool") {
    const first =
      m.card?.facts?.[0] ?? (m.card ? JSON.stringify(m.card.data ?? {}).slice(0, 120) : m.text);
    return {
      role: "tool",
      text: `tool ${m.card?.source ?? "result"}: ${String(first).slice(0, 160)}`,
    };
  }
  const text = m.text.length > 800 ? `${m.text.slice(0, 800)}…` : m.text;
  return { role: m.role, text };
}

export function buildTurn(input: BuildTurnInput): TurnBuild {
  const sections: ContextSection[] = [];
  const section = (name: string, text: string, truncated = false) => {
    const clean = text.trim();
    if (!clean) return;
    sections.push({ name, text: clean, estTokens: estimateTokens(clean), truncated });
  };

  const selectedText = input.selectedCapabilities.length
    ? capabilityPrompt(input.selectedCapabilities)
    : "";

  const fixed: Array<[string, string]> = [
    ["CORE", `${INKO_PROFILE.instructions}\n\n${GROUND_RULES}\n\n${input.instructions}`],
    ["FACTS", input.state],
    [
      "CAPABILITIES",
      `Full book:\n${input.capabilitiesDigest}${selectedText ? `\n\nDetail for this turn:\n${selectedText}` : ""}`,
    ],
    ["OBSERVATIONS", observationsPrompt(input.observations)],
    ["RECORDS", input.records.length ? input.records.join("\n") : ""],
  ];
  for (const [name, text] of fixed) {
    if (text.trim()) section(name, text);
  }

  const used = sections.reduce((sum, s) => sum + s.estTokens, 0);
  const userCost = estimateTokens(input.user);
  let historyBudget = Math.max(0, input.budgetTokens - used - userCost);

  const lines = input.history
    .map(historyLine)
    .filter((l): l is NonNullable<ReturnType<typeof historyLine>> => l !== null);

  // Head+tail compaction: the first user turn anchors the topic, the newest
  // turns carry it; the middle collapses to a one-line marker.
  const kept: typeof lines = [];
  let middleDropped = 0;
  if (lines.length > 0) {
    const head = lines[0];
    const headCost = estimateTokens(`user: ${head.text}`);
    if (headCost <= historyBudget && lines.length > 1) {
      kept.push(head);
      historyBudget -= headCost;
    }
    const tail: typeof lines = [];
    for (let i = lines.length - 1; i > 0; i--) {
      const line = lines[i];
      const cost = estimateTokens(`${line.role}: ${line.text}`);
      if (cost > historyBudget) break;
      historyBudget -= cost;
      tail.unshift(line);
    }
    middleDropped = lines.length - kept.length - tail.length - (kept.length ? 0 : 1);
    kept.push(...tail);
    if (kept.length === 0 && lines.length > 0) {
      // not even the newest turn fits; carry a marker so the model knows a
      // transcript exists but was too large
      kept.push({
        role: "tool",
        text: `transcript too large for the budget (${lines.length} turns)`,
      });
      middleDropped = lines.length - 1;
    }
  }

  const historyText = kept.map((l) => `${l.role}: ${l.text}`).join("\n");
  if (historyText) {
    section("HISTORY", historyText, middleDropped > 0);
  }
  if (middleDropped > 0) {
    sections.push({
      name: "COMPACTION",
      text: `${middleDropped} middle turns dropped`,
      estTokens: 0,
      truncated: true,
    });
  }

  const system = sections
    .filter((s) => s.name !== "COMPACTION")
    .map((s) => `${s.name}\n${s.text}`)
    .join("\n\n");

  const messages: TurnMessage[] = [{ role: "system", content: system }];
  for (const line of kept) {
    messages.push(
      line.role === "tool"
        ? { role: "user", content: `[${line.text}]` }
        : { role: line.role, content: line.text },
    );
  }
  messages.push({ role: "user", content: input.user });

  return {
    messages,
    sections,
    estTokens: sections.reduce((sum, s) => sum + s.estTokens, 0) + userCost,
  };
}
