import { rankWithStats, type RankStats } from "@/lib/ai/encoder";
import { COMMAND_DEFS } from "@/lib/commands/registry";
import type { Access } from "@/lib/tools/types";
import { SKILLS } from "@/lib/skills/registry";
import { TOOLS } from "@/lib/tools/registry";

export type CapabilityKind =
  "tool" | "skill" | "command" | "batch_command" | "agent_capability" | "concept";
export type BatchMode = "single" | "batch" | "aggregate" | "workspace";
/** The book: what area of the app a capability serves. */
export type CapabilityCategory =
  "journal" | "portfolio" | "theses" | "venues" | "alerts" | "assistant" | "models";
/** The book: how a capability executes and what it costs to run. */
export type CapabilityExec = "read" | "compute" | "write-approval" | "model";

export type CapabilityDefinition = {
  id: string;
  kind: CapabilityKind;
  label: string;
  purpose: string;
  aliases: string[];
  examples: string[];
  inputs: string;
  output: string;
  access: Access | "NONE";
  modelRequired: boolean;
  batchMode: BatchMode;
  category: CapabilityCategory;
  exec: CapabilityExec;
};

/** id or group prefix to book category. Derived, never hand-set per entry. */
function categoryOf(id: string): CapabilityCategory {
  if (/^(journal|signal|motive|capture|indicators|log)[.:]/.test(id) || id === "motive.performance")
    return "journal";
  if (/^(thesis)[.:]/.test(id)) return "theses";
  if (/^(portfolio|market|positions|basket|price)[.:]/.test(id)) return "portfolio";
  if (/^(chain|venue|nado|hyperliquid|positions-venue)[.:]/.test(id)) return "venues";
  if (/^(alert|notify)[.:]/.test(id)) return "alerts";
  if (/^(model|settings|assistant)[.:]/.test(id)) return "models";
  return "assistant";
}

/** access to execution type. Approval policy already derives from access. */
function execOf(
  kind: CapabilityKind,
  access: Access | "NONE",
  modelRequired: boolean,
): CapabilityExec {
  if (kind === "skill" || kind === "agent_capability") return modelRequired ? "model" : "compute";
  if (access === "READ") return "read";
  if (access === "COMPUTE" || access === "NONE") return "compute";
  return "write-approval";
}

const CONCEPTS = [
  "wallet",
  "portfolio",
  "position",
  "trade",
  "signal",
  "journal",
  "entry",
  "thesis",
  "POT",
  "alert",
  "session",
  "agent",
  "skill",
  "tool",
  "command",
  "model",
];

const COMMAND_ALIASES: Record<string, string[]> = {
  "portfolio.snapshot": [
    "show my exposure",
    "what do i hold",
    "holdings",
    "allocation",
    "portfolio composition",
  ],
  "portfolio.positions": ["positions", "position lines", "tokens held"],
  "journal.resolve_inbox": [
    "what is waiting in my inbox",
    "resolve inbox",
    "pending trades",
    "unanswered trades",
  ],
  "journal.apply_answer": ["resolve all pending trades", "bulk answer inbox", "apply answer"],
  "journal.review_thesis": [
    "review my thesis",
    "what changed in my thesis",
    "compare thesis and trades",
  ],
  "journal.search": ["search journal", "find trades", "look up entries"],
};

const COMMAND_EXAMPLES: Record<string, string[]> = {
  "portfolio.snapshot": ["show my exposure", "what do I hold"],
  "journal.review_thesis": ["review my BTC thesis", "what changed in my thesis"],
  "journal.resolve_inbox": ["what is waiting in my inbox", "resolve my ETH inbox"],
  "journal.apply_answer": ["resolve all pending trades"],
};

export function capabilityCatalogue(): CapabilityDefinition[] {
  const tools = TOOLS.filter((t) => t.live).map((t): CapabilityDefinition => ({
    id: t.id,
    kind: "tool",
    label: t.label,
    purpose: t.purpose,
    aliases: [t.group, t.action, t.label],
    examples: [],
    inputs: t.inputs,
    output: t.output,
    access: t.access,
    modelRequired: false,
    batchMode: "single",
    category: categoryOf(t.id),
    exec: execOf("tool", t.access, false),
  }));

  const skills = SKILLS.map((s): CapabilityDefinition => ({
    id: s.id,
    kind: "skill",
    label: s.label,
    purpose: s.purpose,
    aliases: [s.label, ...s.tools],
    examples: [],
    inputs: s.tools.length ? `Runs tools: ${s.tools.join(", ")}` : "user text",
    output: s.aiRole,
    access: "COMPUTE",
    modelRequired: s.aiRequired,
    batchMode: s.tools.length > 1 ? "aggregate" : "single",
    category: categoryOf(s.id),
    exec: execOf("skill", "COMPUTE", s.aiRequired),
  }));

  const commands = COMMAND_DEFS.map((c): CapabilityDefinition => ({
    id: c.id,
    kind:
      c.batchMode === "batch" || c.batchMode === "aggregate" || c.batchMode === "workspace"
        ? "batch_command"
        : "command",
    label: c.id,
    purpose: c.description,
    aliases: COMMAND_ALIASES[c.id] ?? c.capability,
    examples: COMMAND_EXAMPLES[c.id] ?? [],
    inputs: Object.keys(c.args).join(", ") || "none",
    output: "CommandResult",
    access: c.access,
    modelRequired: false,
    batchMode: c.batchMode,
    category: categoryOf(c.id),
    exec: execOf("command", c.access, false),
  }));

  const concepts = CONCEPTS.map((name): CapabilityDefinition => ({
    id: `concept.${name.toLowerCase()}`,
    kind: "concept",
    label: name,
    purpose: `Application concept: ${name}.`,
    aliases: [name.toLowerCase()],
    examples: [],
    inputs: "none",
    output: "context",
    access: "NONE",
    modelRequired: false,
    batchMode: "single",
    category: "assistant",
    exec: "read",
  }));

  const agent: CapabilityDefinition = {
    id: "agent.inko",
    kind: "agent_capability",
    label: "Inko assistant",
    purpose: "Always-active conversational assistant context inside Proof of Thesis.",
    aliases: ["Inko", "inko", "assistant", "agent", "the agent", "the assistant"],
    examples: ["ask Inko to review this", "use the agent to compare my thesis and exposure"],
    inputs: "current user turn",
    output: "grounded assistant answer",
    access: "NONE",
    modelRequired: true,
    batchMode: "workspace",
    category: "assistant",
    exec: "model",
  };

  return [agent, ...commands, ...skills, ...tools, ...concepts];
}

export function capabilityPrompt(defs = capabilityCatalogue()): string {
  return defs
    .map(
      (d) =>
        `CAPABILITY\nid: ${d.id}\nkind: ${d.kind}\npurpose: ${d.purpose}\ninputs: ${d.inputs}\noutput: ${d.output}\naccess: ${d.access}\nmode: ${d.batchMode}`,
    )
    .join("\n\n");
}

/**
 * The book, one line per capability. Always cheap enough to carry in full;
 * detail blocks are reserved for the few capabilities selected for the turn.
 */
export function capabilityDigest(defs = capabilityCatalogue()): string {
  return defs
    .filter((d) => d.kind !== "concept")
    .map((d) => `${d.id} | ${d.kind} | ${d.category} | ${d.exec} | ${d.purpose}`)
    .join("\n");
}

export function capabilitySearchText(def: CapabilityDefinition): string {
  return [def.label, def.purpose, ...def.aliases, ...def.examples].join(". ");
}

export type CapabilitySelection = {
  selected: CapabilityDefinition[];
  how: "keyword" | "semantic" | "none";
  reason: string;
  stats: RankStats | null;
};

/**
 * Top-K capabilities for one turn: deterministic keyword match first, then the
 * cached encoder. Advisory only, like every semantic path here.
 */
export async function selectCapabilities(query: string, limit = 5): Promise<CapabilitySelection> {
  const defs = capabilityCatalogue().filter((d) => d.kind !== "concept");
  const q = query.toLowerCase();

  const keywordHits = defs.filter((d) =>
    [d.id, d.label, ...d.aliases].some((a) => a && q.includes(a.toLowerCase())),
  );
  if (keywordHits.length > 0) {
    return {
      selected: keywordHits.slice(0, limit),
      how: "keyword",
      reason: `matched ${keywordHits
        .slice(0, limit)
        .map((d) => d.id)
        .join(", ")}`,
      stats: null,
    };
  }

  const { ranked, stats } = await rankWithStats(
    query,
    defs.map((d) => ({ id: d.id, text: capabilitySearchText(d) })),
    { opportunistic: true },
  );
  const top = (ranked ?? [])
    .filter((r) => r.score > 0.35)
    .slice(0, limit)
    .map((r) => defs.find((d) => d.id === r.id))
    .filter((d): d is CapabilityDefinition => Boolean(d));
  if (top.length === 0) {
    return {
      selected: [],
      how: ranked ? "semantic" : "none",
      reason: "no capability above threshold",
      stats,
    };
  }
  const scoreOf = (id: string) => ((ranked ?? []).find((r) => r.id === id)?.score ?? 0).toFixed(2);
  return {
    selected: top,
    how: "semantic",
    reason: top.map((d) => `${d.id} ${scoreOf(d.id)}`).join(", "),
    stats,
  };
}
