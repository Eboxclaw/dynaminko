// Skills orchestrate tools. A skill declares which tools it drives and whether
// a model is required for the last step. Everything before that step is
// deterministic and works with no model downloaded.

export type SkillDef = {
  id: string;
  label: string;
  purpose: string;
  /** tool ids, in the order the skill runs them */
  tools: string[];
  /** true when the useful answer needs reasoning, not just numbers */
  aiRequired: boolean;
  /** what the model gets, once tools have run */
  aiRole: string;
  /** the assistant can be pointed at this from an Ask box */
  askable: boolean;
};

export const SKILLS: SkillDef[] = [
  {
    id: "meta.help",
    label: "Assistant help",
    purpose: "List what Inko can do without calling a model.",
    tools: [],
    aiRequired: false,
    aiRole: "No model needed; render the structured app manifest.",
    askable: true,
  },
  {
    id: "motive.performance",
    label: "Performance by motive",
    purpose: "Every trade logged under one motive, with a discipline score.",
    tools: ["journal.index", "journal.filter", "indicators.motiveStats"],
    aiRequired: false,
    aiRole: "Optional: interpret the numbers and name recurring patterns.",
    askable: true,
  },
  {
    id: "journal.review",
    label: "Review the journal",
    purpose: "Coverage, alignment mix and the current POT index in one pass.",
    tools: ["signal.coverage", "indicators.alignmentStats", "indicators.potIndex"],
    aiRequired: false,
    aiRole: "Optional: summarise the state in two sentences.",
    askable: true,
  },
  {
    id: "thesis.review",
    label: "Review a thesis",
    purpose: "A thesis against everything traded under it.",
    tools: ["thesis.read", "thesis.stats", "journal.filter"],
    aiRequired: true,
    aiRole: "Judge the strongest point and what would invalidate it.",
    askable: true,
  },
  {
    id: "capture.tidy",
    label: "Tidy a note",
    purpose: "Turn a rough note into two clear sentences.",
    tools: [],
    aiRequired: true,
    aiRole: "Rewrite only. No data access.",
    askable: false,
  },
  {
    id: "plan.create",
    label: "Draft an action plan",
    purpose: "Next steps from stale theses and unanswered signals.",
    tools: ["thesis.read", "signal.coverage", "indicators.potIndex"],
    aiRequired: true,
    aiRole: "Propose steps; the user approves before anything is written.",
    askable: true,
  },
];

export const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));
