// The agent roster. Two kinds:
//   • automation — fixed job, never talks to the user, talks to tools and data.
//   • assistant  — the single agent the user configures (model, skills, tools).
// Nothing here executes yet; the console describes what will run and logs it.

export type AgentKind = "automation" | "assistant";

export type AgentDef = {
  id: string;
  name: string;
  kind: AgentKind;
  job: string;
  trigger: string;
  tools: string[];
  skills: string[];
  /** already running in the app today, or waiting to be wired */
  live: boolean;
};

export const AGENTS: AgentDef[] = [
  {
    id: "extractor",
    name: "Extractor",
    kind: "automation",
    job: "Turns raw wallet transfers into inbox signals: tx, asset, amount, value, gas.",
    trigger: "every fresh wallet read",
    tools: ["read-portfolio", "read-signals", "write-signal"],
    skills: ["parse-transfer"],
    live: true,
  },
  {
    id: "tagger",
    name: "Tagger",
    kind: "automation",
    job: "Assigns a basket to every symbol it sees so the portfolio can be grouped.",
    trigger: "on new holding or signal",
    tools: ["read-portfolio"],
    skills: ["tag-basket"],
    live: true,
  },
  {
    id: "reconciler",
    name: "Reconciler",
    kind: "automation",
    job: "Suggests which written thesis a new trade belongs to. The user still decides.",
    trigger: "on new inbox signal",
    tools: ["read-signals", "propose-thesis-link"],
    skills: ["match-thesis"],
    live: true,
  },
  {
    id: "watcher",
    name: "Alert watcher",
    kind: "automation",
    job: "Evaluates price, on-chain and thesis-review alerts and raises notifications.",
    trigger: "each price refresh, and every 5 minutes",
    tools: ["read-portfolio", "read-signals", "notify"],
    skills: ["evaluate-alert"],
    live: true,
  },
  {
    id: "assistant",
    name: "Assistant",
    kind: "assistant",
    job: "Helps you write: tidies a note, reasons about a trade, stress-tests a thesis.",
    trigger: "only when you ask",
    tools: ["read-portfolio", "read-signals", "write-draft-entry"],
    skills: ["tidy", "reason", "review"],
    live: false,
  },
];

export type SkillDef = { id: string; label: string; blurb: string; agents: string[] };

export const SKILLS: SkillDef[] = [
  {
    id: "parse-transfer",
    label: "Parse transfer",
    blurb: "Deterministic decode of ERC-20 and native transfers into a signal.",
    agents: ["extractor"],
  },
  {
    id: "tag-basket",
    label: "Tag basket",
    blurb: "Symbol → basket classification (store of value, stocks, DeFi, memes, stables).",
    agents: ["tagger"],
  },
  {
    id: "match-thesis",
    label: "Match thesis",
    blurb: "Scores open theses against a trade's symbol and timing.",
    agents: ["reconciler"],
  },
  {
    id: "evaluate-alert",
    label: "Evaluate alert",
    blurb: "Checks alert conditions against live quotes and fresh signals.",
    agents: ["watcher"],
  },
  {
    id: "tidy",
    label: "Tidy a note",
    blurb: "Rewrites a rough journal note into two clear sentences.",
    agents: ["assistant"],
  },
  {
    id: "reason",
    label: "Reason about a trade",
    blurb: "Explains what likely happened and which thesis it maps to.",
    agents: ["assistant"],
  },
  {
    id: "review",
    label: "Review a thesis",
    blurb: "Strongest point, and what would break it.",
    agents: ["assistant"],
  },
];

export type ToolDef = {
  id: string;
  label: string;
  access: "read" | "write";
  blurb: string;
  /** wired to real data today */
  live: boolean;
};

export const TOOLS: ToolDef[] = [
  {
    id: "read-portfolio",
    label: "Read portfolio",
    access: "read",
    blurb: "Holdings, baskets and live quotes for the watched wallet.",
    live: true,
  },
  {
    id: "read-signals",
    label: "Read signals",
    access: "read",
    blurb: "The extracted trades sitting in the inbox.",
    live: true,
  },
  {
    id: "write-signal",
    label: "Write signal",
    access: "write",
    blurb: "Files a new extracted trade into the inbox.",
    live: true,
  },
  {
    id: "write-draft-entry",
    label: "Draft an entry",
    access: "write",
    blurb: "Prepares journal text for you to approve. Never saves silently.",
    live: false,
  },
  {
    id: "propose-thesis-link",
    label: "Propose thesis link",
    access: "write",
    blurb: "Suggests a trade↔thesis relationship for you to confirm.",
    live: true,
  },
  {
    id: "notify",
    label: "Notify",
    access: "write",
    blurb: "Raises an in-app toast and a browser notification when allowed.",
    live: true,
  },
  {
    id: "create-alert",
    label: "Create alert",
    access: "write",
    blurb: "Adds a price or review alert on your behalf.",
    live: false,
  },
];

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t]));
export const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

/** Automation agents default to on. */
export function automationOn(state: Record<string, boolean>, id: string): boolean {
  return state[id] ?? true;
}
