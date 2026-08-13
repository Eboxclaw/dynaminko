import { COMMAND_DEFS } from "@/lib/commands/registry";
import type { Access } from "@/lib/tools/types";
import { SKILLS } from "@/lib/skills/registry";
import { TOOLS } from "@/lib/tools/registry";

export type CapabilityKind = "tool" | "skill" | "command" | "batch_command" | "agent_capability" | "concept";
export type BatchMode = "single" | "batch" | "aggregate" | "workspace";

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
};

const CONCEPTS = ["wallet", "portfolio", "position", "trade", "signal", "journal", "entry", "thesis", "POT", "alert", "session", "agent", "skill", "tool", "command", "model"];

const COMMAND_ALIASES: Record<string, string[]> = {
  "portfolio.snapshot": ["show my exposure", "what do i hold", "holdings", "allocation", "portfolio composition"],
  "portfolio.positions": ["positions", "position lines", "tokens held"],
  "journal.resolve_inbox": ["what is waiting in my inbox", "resolve inbox", "pending trades", "unanswered trades"],
  "journal.apply_answer": ["resolve all pending trades", "bulk answer inbox", "apply answer"],
  "journal.review_thesis": ["review my thesis", "what changed in my thesis", "compare thesis and trades"],
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
  }));

  const commands = COMMAND_DEFS.map((c): CapabilityDefinition => ({
    id: c.id,
    kind: c.batchMode === "batch" || c.batchMode === "aggregate" || c.batchMode === "workspace" ? "batch_command" : "command",
    label: c.id,
    purpose: c.description,
    aliases: COMMAND_ALIASES[c.id] ?? c.capability,
    examples: COMMAND_EXAMPLES[c.id] ?? [],
    inputs: Object.keys(c.args).join(", ") || "none",
    output: "CommandResult",
    access: c.access,
    modelRequired: false,
    batchMode: c.batchMode,
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
  };

  return [agent, ...commands, ...skills, ...tools, ...concepts];
}

export function capabilityPrompt(defs = capabilityCatalogue()): string {
  return defs.map((d) => `CAPABILITY\nid: ${d.id}\nkind: ${d.kind}\npurpose: ${d.purpose}\ninputs: ${d.inputs}\noutput: ${d.output}\naccess: ${d.access}\nmode: ${d.batchMode}`).join("\n\n");
}

export function capabilitySearchText(def: CapabilityDefinition): string {
  return [def.label, def.purpose, ...def.aliases, ...def.examples].join(". ");
}
