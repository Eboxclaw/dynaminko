// Skills orchestrate tools. A skill declares which tools it drives and whether
// a model is required for the last step. Everything before that step is
// deterministic and works with no model downloaded.

export type SkillDef = {
  id: string;
  label: string;
  purpose: string;
  /** tool ids, in the order the skill runs them */
  tools: string[];
  /** phrases that deterministically route straight to this skill */
  aliases?: string[];
  /**
   * true = no bespoke branch in runSkill; the skill just runs its `tools` in
   * order and hands the structured results to the model. The bespoke
   * skills (journal review, thesis review, …) aggregate and phrase their own
   * facts and stay composed: false.
   */
  composed?: boolean;
  /** true when the useful answer needs reasoning, not just numbers */
  aiRequired: boolean;
  /** what the model gets, once tools have run */
  aiRole: string;
  /** the assistant can be pointed at this from an Ask box */
  askable: boolean;
};

export const SKILLS: SkillDef[] = [
  {
    id: "wallet.holdings",
    label: "Wallet holdings",
    purpose: "What the wallet holds: holdings, baskets, net worth and open positions.",
    tools: ["portfolio.read", "portfolio.netWorth", "portfolio.positions-perps"],
    aliases: [
      "what do you hold",
      "what's on my wallet",
      "what is on my wallet",
      "what do i hold on my wallet",
      "holdings on my wallet",
      "show my wallet",
    ],
    composed: true,
    aiRequired: true,
    aiRole:
      "Answer what the wallet holds: top holdings by value, the basket split, net worth and open positions. Use only the numbers in the structured result; call out any unpriced tokens.",
    askable: true,
  },
  {
    id: "inbox.review",
    label: "Inbox review",
    purpose: "What is waiting in the inbox, by venue and symbol.",
    tools: ["journal.resolve_inbox", "signal.coverage"],
    aliases: ["what is on the inbox", "what's in my inbox", "what is in my inbox", "show my inbox"],
    composed: true,
    aiRequired: true,
    aiRole:
      "List what is on the inbox: how many trades are pending, broken out by venue and symbol with side and amount where the data carries it. Use only the numbers in the structured result.",
    askable: true,
  },
  {
    id: "trades.open",
    label: "Open trades",
    purpose: "Open perpetuals across venues with every field the venue reports.",
    tools: ["portfolio.positions-perps", "portfolio.netWorth"],
    aliases: [
      "open trades",
      "open positions",
      "what am i trading",
      "my trades on nado",
      "my trades on hyperliquid",
      "trades on nado",
      "trades on hyperliquid",
    ],
    composed: true,
    aiRequired: true,
    aiRole:
      "Describe the open trades with the granularity the data allows: symbol, side, size, entry, notional, unrealized PnL, and leverage/margin/liquidation price where the venue reports them. Where a venue does not report a field, say so explicitly instead of guessing.",
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
    id: "research.web",
    label: "Research the web",
    purpose: "Search the web for a topic, read the top page, and synthesise findings with citations. Pass the question in the skill input.",
    tools: ["web.search", "web.read"],
    aliases: ["research", "search and read", "find online", "look up", "web research"],
    composed: false,
    aiRequired: true,
    aiRole:
      "Synthesise what you found: cite each fact to its source page title and url. Use only what the structured result says. If nothing was found, say so.",
    askable: true,
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
