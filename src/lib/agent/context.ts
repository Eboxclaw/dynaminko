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
    "You are Inko, the application assistant inside Proof of Thesis. Prefer local deterministic tools for facts. Treat tool and command results as ground truth. Never claim a download or mutation happened unless an explicit approved action did it. If facts are missing, say which capability would produce them instead of guessing. You are running inside the user's own app; FACTS and TURN OBSERVATIONS are their real journal data. Never claim you lack access to it; if a number is missing, name the capability that would produce it. MEMORY holds your persistent notes about this user, bounded by the char budget shown in FACTS. Save durable preferences, corrections, and conventions with memory.save; if a write is rejected because memory is full, consolidate by updating or forgetting an entry in the same turn. Never store trades or numbers in MEMORY; FACTS computes those fresh every turn.",
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
    data: result.data == null ? result.data : clampDataText(result.data),
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
    data: clampDataText({ facts: result.facts, data: result.data }),
  };
}

/**
 * One observation's data payload, capped before it enters the prompt. Small
 * results pass through as native JSON; big ones keep head and tail with a
 * marker that says exactly what was dropped, so the model can ask for the
 * rest instead of drowning in it. The same cap is applied at capture time
 * (clampResult in agents.tsx); this is the assembly-level guarantee that no
 * caller can bypass.
 */
export const MAX_OBSERVATION_CHARS = 6000;

export function clampDataText(data: unknown): string {
  const json = JSON.stringify(data ?? {});
  if (json.length <= MAX_OBSERVATION_CHARS) return json;
  const half = Math.floor(MAX_OBSERVATION_CHARS / 2);
  return `${json.slice(0, half)}\n[truncated: first and last ${half} of ${json.length} chars]\n${json.slice(-half)}`;
}

export function observationsPrompt(observations: ToolObservation[]): string {
  if (!observations.length) return "TURN OBSERVATIONS\n(none)";
  return `TURN OBSERVATIONS\n${observations
    .map(
      (o) =>
        `${o.kind.toUpperCase()} RESULT\nsource: ${o.source}\nstatus: ${o.status}\nsummary: ${o.summary ?? ""}\ndata: ${clampDataText(o.data)}`,
    )
    .join("\n\n")}`;
}

/** Same observations, summaries only: the degraded form used when the full
 * data lines do not fit the budget. */
export function observationsSummaryPrompt(observations: ToolObservation[]): string {
  if (!observations.length) return "TURN OBSERVATIONS\n(none)";
  return `TURN OBSERVATIONS (summaries only; data trimmed to fit the context budget)\n${observations
    .map(
      (o) =>
        `${o.kind.toUpperCase()} RESULT\nsource: ${o.source}\nstatus: ${o.status}\nsummary: ${o.summary ?? ""}`,
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
  /** rendered agent memory lines (memoryPrompt()), may be "" */
  memory: string;
  observations: ToolObservation[];
  /** prior transcript, compacted to fit */
  history: ChatMessage[];
  user: string;
  budgetTokens: number;
  /**
   * Forced degradation for overflow recovery. 0 = shed only as the budget
   * requires. 1 = summary-only observations, records dropped, capability
   * detail dropped. 2 = all of that plus history dropped entirely; the turn
   * still answers from CORE/FACTS/MEMORY and the one-line capability book.
   */
  shedLevel?: 0 | 1 | 2;
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

  // The budget covers the whole prompt, not just history: budgetTokens is the
  // window minus the reply reserve (the caller passes 0.75 * ctx), and every
  // section sheds in a fixed order until the total fits. Nothing reaches the
  // model over budget; every cut is marked on its section so the trace shows
  // what was dropped.
  const userCost = estimateTokens(input.user);
  const budget = Math.max(0, input.budgetTokens - userCost);

  const coreText = `${INKO_PROFILE.instructions}\n\n${GROUND_RULES}\n\n${input.instructions}`;
  const factsText = input.state;
  const bookText = `Full book:\n${input.capabilitiesDigest}`;
  const detailText = selectedText ? `\n\nDetail for this turn:\n${selectedText}` : "";

  const cost = (t: string) => estimateTokens(t.trim());
  const coreCost = cost(coreText);
  const factsCost = cost(factsText);
  // MEMORY is bounded by the store cap (2200 chars) and is never shed: it is
  // persistent identity, not turn evidence, and it always fits.
  const memCost = cost(input.memory);
  let capsCost = cost(bookText + detailText);
  let obsCost = cost(observationsPrompt(input.observations));
  let recCost = cost(input.records.join("\n"));

  const shed: string[] = [];
  const over = () => coreCost + factsCost + memCost + capsCost + obsCost + recCost - budget;
  // Forced degradation for overflow recovery: deterministic levels instead of
  // guessing a smaller budget number.
  const forced = input.shedLevel ?? 0;

  // 1. observations degrade to summaries only
  if ((over() > 0 || forced >= 1) && obsCost > 0) {
    const slim = cost(observationsSummaryPrompt(input.observations));
    if (slim < obsCost) {
      shed.push("observations data");
      obsCost = slim;
    }
  }
  // 2. records: forced level drops them entirely, otherwise trim to fit
  if (forced >= 1 && input.records.length > 0) {
    shed.push(`${input.records.length} records`);
    input = { ...input, records: [] };
    recCost = 0;
  } else if (over() > 0 && recCost > 0) {
    const kept: string[] = [];
    let used = 0;
    for (const line of input.records) {
      const c = estimateTokens(line);
      if (used + c > recCost - over()) break;
      kept.push(line);
      used += c;
    }
    if (kept.length < input.records.length) {
      shed.push(`${input.records.length - kept.length} records`);
      input = { ...input, records: kept };
      recCost = used;
    }
  }
  // 3. capability detail block drops; the one-line book always stays
  if ((over() > 0 || forced >= 1) && detailText) {
    shed.push("capability detail");
    capsCost = cost(bookText);
  }

  const fixed: Array<[string, string, boolean]> = [
    ["CORE", coreText, false],
    ["FACTS", factsText, false],
    ["MEMORY", input.memory, false],
    [
      "CAPABILITIES",
      shed.includes("capability detail") ? bookText : `${bookText}${detailText}`,
      shed.includes("capability detail"),
    ],
    [
      "OBSERVATIONS",
      shed.includes("observations data")
        ? observationsSummaryPrompt(input.observations)
        : observationsPrompt(input.observations),
      shed.includes("observations data"),
    ],
    ["RECORDS", input.records.join("\n"), shed.some((s) => s.endsWith("records"))],
  ];
  for (const [name, text, truncated] of fixed) {
    if (text.trim()) section(name, text, truncated);
  }

  let historyBudget = Math.max(
    0,
    budget - (coreCost + factsCost + memCost + capsCost + obsCost + recCost),
  );

  const lines =
    forced >= 2
      ? []
      : input.history
          .map(historyLine)
          .filter((l): l is NonNullable<ReturnType<typeof historyLine>> => l !== null);

  // Head+tail compaction: the first user turn anchors the topic, the newest
  // turns carry it; the middle collapses to a one-line marker.
  const kept: typeof lines = [];
  let middleDropped = 0;
  if (forced >= 2 && input.history.length > 0) {
    shed.push("history");
    sections.push({
      name: "COMPACTION",
      text: `history dropped for this turn (${input.history.length} messages)`,
      estTokens: 0,
      truncated: true,
    });
  }
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
  if (shed.length > 0) {
    sections.push({
      name: "SHED",
      text: `dropped: ${shed.join(", ")}`,
      estTokens: 0,
      truncated: true,
    });
  }

  const system = sections
    .filter((s) => s.name !== "COMPACTION" && s.name !== "SHED")
    .map((s) => `${s.name}\n${s.text}`)
    .join("\n\n");

  const messages: TurnMessage[] = [{ role: "system", content: system }];
  for (const line of kept) {
    messages.push(
      line.role === "tool"
        ? { role: "user", content: `Context from an earlier tool call: ${line.text}` }
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
