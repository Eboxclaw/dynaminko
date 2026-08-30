// Per-model wire fixtures: raw model outputs captured live on 8081 through
// window.__lastRaw / __lastDecide (08-29/08-30 evaluation runs). Each record
// documents what the model actually emitted so parser and protocol changes
// regress against reality, not invented strings. Some long answers are kept
// as marked excerpts (the exact head captured at run time).

export type WireFixture = {
  id: string;
  model: string;
  phase: "decide" | "answer";
  question: string;
  capturedAt: string;
  raw: string;
  /** What the harness must produce from this raw. */
  expect: {
    kind: "native-call" | "grammar-json" | "prose" | "empty";
    tool?: string;
    args?: Record<string, string | number | boolean>;
  };
};

export const WIRE_FIXTURES: WireFixture[] = [
  {
    id: "26b-leak-websearch-args",
    model: "LFM 2.5 2.6B",
    phase: "answer",
    question: "research the latest news about the ink chain",
    capturedAt: "2026-08-29T13:21:33.132Z",
    raw: "<|tool_call_start|>[web.search(query='ink chain latest news', limit=5)]<|tool_call_end|>",
    expect: { kind: "native-call", tool: "web.search", args: { query: "ink chain latest news", limit: 5 } },
  },
  {
    id: "26b-leak-portfolio-read-repeat",
    model: "LFM 2.5 2.6B",
    phase: "answer",
    question: "hey agent whats in my wallet and how is my performance doing ?",
    capturedAt: "2026-08-30T08:35:25.393Z",
    raw: "<|tool_call_start|>[portfolio.read()]<|tool_call_end|>",
    expect: { kind: "native-call", tool: "portfolio.read", args: {} },
  },
  {
    id: "26b-leak-portfolio-positions",
    model: "LFM 2.5 2.6B",
    phase: "answer",
    question: "What is my net worth and where are my positions?",
    capturedAt: "2026-08-29T18:09:17.462Z",
    raw: "<|tool_call_start|>[portfolio.positions()]<|tool_call_end|>",
    expect: { kind: "native-call", tool: "portfolio.positions", args: {} },
  },
  {
    id: "26b-leak-chain-transfers",
    model: "LFM 2.5 2.6B",
    phase: "answer",
    question: "how many token transfers did my wallet have and what are the three most recent?",
    capturedAt: "2026-08-30T09:26:35.936Z",
    raw: "<|tool_call_start|>[chain.transfers()]<|tool_call_end|>",
    expect: { kind: "native-call", tool: "chain.transfers", args: {} },
  },
  {
    id: "26b-prose-after-promoted-call",
    model: "LFM 2.5 2.6B",
    phase: "answer",
    question: "how many token transfers did my wallet have and what are the three most recent?",
    capturedAt: "2026-08-30T09:48:42.941Z",
    // Excerpt: exact head of the 534-char retry answer.
    raw: "Your wallet has **66 token transfers** recorded. The three most recent are:\n\n1. **XVELO** \u2013 354.61 BTC (in) \u2013 2026-08-23 17:00:48 UTC (tx: 0xd36e000061a9d76a9783ca8ecb353ff2d40c1acc5ea7551f09210465982cefb3)\n2. **XVELO** \u2013 213.76 BTC (in) \u2013 ",
    expect: { kind: "prose" },
  },
  {
    id: "26b-empty-decide-with-tools-param",
    model: "LFM 2.5 2.6B",
    phase: "decide",
    question: "how many token transfers did my wallet have and what are the three most recent?",
    capturedAt: "2026-08-30T09:34:58.215Z",
    // The shelved decideMenu "native" knob: tools param + GBNF grammar
    // produced zero tokens. Harness must fail closed (no pick).
    raw: "",
    expect: { kind: "empty" },
  },
  {
    id: "350m-grammar-json-decide",
    model: "LFM 2.5 350M",
    phase: "decide",
    question: "count my wallet transfers and list the newest three",
    capturedAt: "2026-08-30T10:03:19.232Z",
    raw: '{\n  "tool": "chain.transfers",\n  "query": "newest three",\n  "why": "persistent local transfer history for the active wallet",\n  "limit": 1\n}',
    expect: { kind: "grammar-json", tool: "chain.transfers" },
  },
  {
    id: "350m-misattributed-answer",
    model: "LFM 2.5 350M",
    phase: "answer",
    question: "how many token transfers did my wallet have and what are the three most recent?",
    capturedAt: "2026-08-30T09:57:29.523Z",
    // Failure-mode fixture (F6): a row VALUE read as the transfer count and
    // timestamps swapped into the amount slot. The harness must surface this
    // text unchanged (it did) so grounding/typed observations can flag it.
    raw: "Your wallet had **354.606239113415 XVELO** token transfers. The three most recent transfers are:\n\n1. **XVELO** (in, 354.606239113415, 1788034158000)  \n2. **XVELO** (in, 354.606239113415, 1788037297388)  \n3. **XVELO** (in, 1788037297388, 54535747)  ",
    expect: { kind: "prose" },
  },
];
