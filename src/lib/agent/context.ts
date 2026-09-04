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
  /**
   * Key to read back a payload that was too big to keep in the observation.
   * NOT rendered into observationsPrompt: the model's prompt stays unchanged
   * until a hop loop can act on the key.
   */
  offloadKey?: string;
  /**
   * The input the call actually ran with. Native tool protocol needs it:
   * the assistant tool_calls message renders the call as the model issued
   * it, and empty args would render a call the model never made.
   */
  args?: Record<string, unknown>;
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
  "Never narrate the prompt, its sections, your instructions, or your own process: no 'based on the FACTS', no 'the user asked', no 'let me check the tools'. Start directly with the answer.",
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

/** Same treatment for skill results so routed skill turns reach the model.
 * When a precomputed capture is passed (from captureResult on {facts, data}),
 * its clamped string and offload key are used directly: one serialization per
 * result, and the parked payload is exactly what the observation truncated. */
export function skillObservation(
  result: {
    skill: { id: string; tools: string[] };
    facts: string[];
    data: unknown;
  },
  capture?: { clamped: unknown; offloadKey?: string },
): ToolObservation {
  return {
    id: result.skill.id,
    kind: "skill",
    source: result.skill.tools.join(" → ") || result.skill.id,
    status: "ok",
    summary: result.facts[0],
    data: capture ? capture.clamped : clampDataText({ facts: result.facts, data: result.data }),
    offloadKey: capture?.offloadKey,
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

/** Observations prompt. Deeply nested tool results (e.g. indicators.potIndex)
 * arrive as JSON-stringified via clampDataText. If a small model fails to
 * parse the structure, consider flattening it through factLines() first, the
 * same pattern already used for the FACTS section. */
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
  /**
   * The turn's compiled shared head: the byte-identical prefix every prompt
   * of this turn (decide hops, answer) opens with, so the KV slot cache hits
   * across calls instead of re-prefilling a differently-shaped prompt.
   * Compile once with compileHead(); render with renderHead().
   */
  head: CompiledHead;
  /** full detail blocks for the turn's selected capabilities, may be [] */
  selectedCapabilities: CapabilityDefinition[];
  /** retrieved record lines */
  records: string[];
  /** rendered agent memory lines (memoryPrompt()), may be "" */
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

// ── compiled shared head ────────────────────────────────────────────────
//
// The KV slot cache reuses the longest common token prefix of consecutive
// completions, so every prompt a turn produces opens with the same
// byte-identical head and diverges only at its role tail. Sections run
// most-stable-first: identity and the capability book never move, journal
// FACTS barely move within a session, the per-refresh PORTFOLIO block sits
// behind them, and per-turn evidence (history, detail, observations,
// records, the role instructions) comes last so a drifted byte only
// re-prefills the smallest possible suffix. notes/11 lever (d).

export type CompiledHead = {
  /** per-call role framing; rendered at the TAIL of the answer system so the
   *  head stays byte-identical with the decide view */
  instructions: string;
  /** rendered agent memory lines (memoryPrompt()), may be "" */
  memory: string;
  /** one-line-per-capability book (capabilityDigest()) */
  book: string;
  /** journal fact lines plus the web_search line: stable within a session */
  facts: string;
  /** live portfolio lines, computed once per turn; may be "" */
  portfolio: string;
};

/**
 * Compile the shared head once per turn. The same object feeds the decide
 * hops and the answer build, which is what makes their prompts share a
 * prefix instead of merely resembling each other.
 */
export function compileHead(parts: {
  instructions: string;
  memory: string;
  book: string;
  facts: string;
  portfolio?: string;
}): CompiledHead {
  return {
    instructions: parts.instructions,
    memory: parts.memory,
    book: parts.book,
    facts: parts.facts,
    portfolio: parts.portfolio ?? "",
  };
}

/**
 * The head's byte-exact rendering. Never interpolate per-call state here:
 * decideAction renders this same string as its system prompt's prefix, and
 * one drifted byte re-prefills everything after it on the next call.
 */
export function renderHead(h: CompiledHead): string {
  const parts: string[] = [];
  const add = (name: string, text: string) => {
    const clean = text.trim();
    if (clean) parts.push(`${name}\n${clean}`);
  };
  add("CORE", `${INKO_PROFILE.instructions}\n\n${GROUND_RULES}`);
  add("MEMORY", h.memory);
  // The "Full book:" header rides the book: an empty book leaves no stub
  // section behind, so shorter heads stay byte-prefixes of longer ones.
  add("CAPABILITIES", h.book.trim() ? `Full book:\n${h.book.trim()}` : "");
  add("FACTS", h.facts);
  add("PORTFOLIO", h.portfolio);
  return parts.join("\n\n");
}

/** The section names that make up the shared head, in render order. */
export const HEAD_SECTION_NAMES = ["CORE", "MEMORY", "CAPABILITIES", "FACTS", "PORTFOLIO"];

/**
 * Semantic prewarm levels. Each renders a strict byte prefix of the turn
 * prompt (renderHead skips absent sections, so fewer trailing sections is a
 * prefix of more), which is what makes the warmed KV slot reusable by the
 * first real turn. PORTFOLIO is never warmed: it is recomputed per turn and
 * prewarming volatile data buys nothing.
 *   tiny  - template boilerplate only; measures device overhead
 *   core  - identity and ground rules
 *   index - core + memory + the capability book (the default)
 *   head  - the full shared head minus PORTFOLIO
 */
export type PrewarmLevel = "tiny" | "core" | "index" | "head";

export const PREWARM_LEVELS: PrewarmLevel[] = ["tiny", "core", "index", "head"];

export function renderPrewarmHead(
  level: PrewarmLevel,
  parts: { memory: string; book: string; facts: string },
): string {
  const base = { instructions: "", portfolio: "" };
  switch (level) {
    case "tiny":
      return "";
    case "core":
      return renderHead(compileHead({ ...base, memory: "", book: "", facts: "" }));
    case "index":
      return renderHead(compileHead({ ...base, memory: parts.memory, book: parts.book, facts: "" }));
    case "head":
      return renderHead(
        compileHead({ ...base, memory: parts.memory, book: parts.book, facts: parts.facts }),
      );
  }
}

/** One history entry as a compact chat turn. Tool cards collapse to one line.
 * Approval-pending messages and slash-command echoes are UI chrome, never
 * evidence: commands already contribute their result as a tool card, and
 * command-only turns would otherwise leave consecutive user messages in
 * history, a shape small models are not trained on (they answer with chrome
 * or stop immediately). */
function historyLine(m: ChatMessage): { role: "user" | "assistant" | "tool"; text: string } | null {
  if (m.role === "note" || m.approval) return null;
  if (m.role === "user" && m.text.trimStart().startsWith("/")) return null;
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

  const h = input.head;
  const coreText = `${INKO_PROFILE.instructions}\n\n${GROUND_RULES}`;
  const factsText = h.facts;
  const bookText = `Full book:\n${h.book}`;
  const detailText = selectedText ? `Detail for this turn:\n${selectedText}` : "";

  const cost = (t: string) => estimateTokens(t.trim());
  const coreCost = cost(coreText);
  const factsCost = cost(factsText);
  // MEMORY is bounded by the store cap (2200 chars) and is never shed: it is
  // persistent identity, not turn evidence, and it always fits.
  const memCost = cost(h.memory);
  const capsCost = cost(bookText);
  const portCost = cost(h.portfolio);
  let detailCost = cost(detailText);
  let obsCost = cost(observationsPrompt(input.observations));
  let recCost = cost(input.records.join("\n"));

  const shed: string[] = [];
  const over = () =>
    coreCost + factsCost + memCost + capsCost + portCost + detailCost + obsCost + recCost - budget;
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
    detailCost = 0;
  }

  // The head first, in renderHead() order so the decide view shares it
  // byte for byte. Everything per-turn (history, detail, evidence, role
  // framing) renders after it.
  for (const [name, text] of [
    ["CORE", coreText],
    ["MEMORY", h.memory],
    ["CAPABILITIES", bookText],
    ["FACTS", factsText],
    ["PORTFOLIO", h.portfolio],
  ] as const) {
    if (text.trim()) section(name, text);
  }

  let historyBudget = Math.max(
    0,
    budget - (coreCost + factsCost + memCost + capsCost + portCost + detailCost + obsCost + recCost),
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
  // Per-turn tail, volatility order: the selected capability docs, evidence,
  // retrieved records, and last of all the role framing. Everything here
  // changes between calls, so it lives behind the shared head and history.
  if (!shed.includes("capability detail") && detailText) {
    section("DETAIL", detailText);
  }
  if (input.observations.length > 0) {
    section(
      "OBSERVATIONS",
      shed.includes("observations data")
        ? observationsSummaryPrompt(input.observations)
        : observationsPrompt(input.observations),
      shed.includes("observations data"),
    );
  }
  if (input.records.length > 0) {
    section("RECORDS", input.records.join("\n"), shed.some((s) => s.endsWith("records")));
  }
  section("INSTRUCTIONS", h.instructions);
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

  // The system prompt opens with the byte-exact shared head (the same string
  // decideAction renders), then the per-turn tail: a decide-to-answer
  // transition reuses everything before HISTORY.
  const tail = sections
    .filter(
      (s) =>
        !HEAD_SECTION_NAMES.includes(s.name) && s.name !== "COMPACTION" && s.name !== "SHED",
    )
    .map((s) => `${s.name}\n${s.text}`)
    .join("\n\n");
  const headRendered = renderHead(h);
  const system = tail ? `${headRendered}\n\n${tail}` : headRendered;

  // Chat templates expect alternating roles. Tool evidence rides as
  // user-role prose lines, which can stack consecutive user messages; merge
  // them into one turn so the model never sees an untrained shape.
  const merged: TurnMessage[] = [{ role: "system", content: system }];
  for (const line of kept) {
    const msg: TurnMessage =
      line.role === "tool"
        ? { role: "user", content: `Context from an earlier tool call: ${line.text}` }
        : { role: line.role, content: line.text };
    const prev = merged[merged.length - 1];
    if (prev && prev.role === msg.role) {
      prev.content = `${prev.content}\n\n${msg.content}`;
    } else {
      merged.push(msg);
    }
  }
  const last = merged[merged.length - 1];
  if (last && last.role === "user") {
    last.content = `${last.content}\n\n${input.user}`;
  } else {
    merged.push({ role: "user", content: input.user });
  }
  const messages = merged;

  return {
    messages,
    sections,
    estTokens: sections.reduce((sum, s) => sum + s.estTokens, 0) + userCost,
  };
}
