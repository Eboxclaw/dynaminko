// Evidence digest for multi-hop tool selection.
//
// The decide call is deliberately small (96 tokens out, grammar-constrained),
// but it must SEE what earlier hops observed, or hop 2 cannot build on hop 1.
// This digest keeps that context tight: one line per observation plus the
// latest observation's data, capped, so five hops cannot drown the pick.

export type HopObservation = {
  id: string;
  status: string;
  summary?: string;
  data?: unknown;
};

const MAX_LAST_DATA_CHARS = 1200;

/** Compact evidence block for the next decide call. Empty when nothing has
 * run yet, so the prompt stays identical to the single-hop shape. */
export function hopEvidence(observations: HopObservation[]): string {
  if (observations.length === 0) return "";
  const lines = observations.map((o) => `${o.id} (${o.status}): ${o.summary ?? "no summary"}`);
  const last = observations[observations.length - 1];
  const data = typeof last.data === "string" ? last.data : JSON.stringify(last.data ?? {});
  const clipped =
    data.length > MAX_LAST_DATA_CHARS ? `${data.slice(0, MAX_LAST_DATA_CHARS)}…[clipped]` : data;
  return [...lines, `latest result data: ${clipped}`].join("\n");
}

/**
 * Whether a hop repeats one that already ran this turn (same tool, same
 * input). Repeats are how a loop spins: the pick is declined and the loop
 * ends instead of burning the budget on identical work.
 */
export function isRepeatHop(pickKey: string, executedKeys: string[]): boolean {
  return executedKeys.includes(pickKey);
}

/**
 * Stable identity of one hop: tool id plus the arguments it would run with.
 * The `|` delimiter is shared with hopToolId() — the single parser the
 * orchestrator's same-tool run cap counts through — so keying and counting
 * can never drift apart again (the 09-04 journal.search loop ran to the
 * hop budget exactly because the cap once parsed a different separator).
 */
export function hopKey(id: string, input: Record<string, unknown>): string {
  return `${id}|${JSON.stringify(input)}`;
}

/** The tool-id half of a hopKey. Tool ids never contain "|", so the first
 * pipe is always the join point. Parse hopKeys through this function only:
 * a hand-rolled split with any other separator silently returns the whole
 * key and disarms the same-tool cap. */
export function hopToolId(key: string): string {
  return key.slice(0, key.indexOf("|"));
}

/**
 * The decide role body, appended after the turn's compiled shared head
 * (renderHead() from agent/context). The head carries CORE, MEMORY, the
 * capability book and FACTS byte-identically with the answer turn, so a
 * decide-to-answer transition only prefills the tail. This body is a
 * constant, never interpolated with per-hop state: any byte that moves
 * between completions (a remaining count, a timestamp) invalidates the
 * cached prefix at that point and the next call re-prefills from there.
 */
export const DECIDE_SYSTEM =
  "You select one tool to answer the user's question, or none. Answer with the JSON the schema allows. The query is the search term for the tool, at most 6 words, or empty; pass limit only when the tool paginates. Only pick a tool when you can fill its required inputs; otherwise pick another tool or none. Pick none when the answer is already in FACTS, PORTFOLIO, or in earlier results. Entries marked [write] change the journal: when QUESTION explicitly asks for that action, pick the matching [write] entry on this hop instead of asking in prose. Proposing is safe: the app always shows an approval card and the user confirms before anything runs.";

export type DecidePromptParts = {
  question: string;
  /** Plain-text capability book; undefined when the menu rides the template's
   *  native tools render instead. */
  menuText?: string;
  /** LEAN VIEW ONLY (decide A/B): FACTS+PORTFOLIO lines riding the user turn
   *  right beside the menu, the pre-e6c1ff3 placement. The head view leaves
   *  this undefined: facts live in the system head there. */
  facts?: string;
  evidence?: string;
  /** Hops left this turn. Appended LAST: hop 1's user content then stays a
   *  strict prefix of hop 2's, which is what makes the slot cache hit. */
  remaining?: number;
};

/**
 * The decide user turn. In the HEAD view facts live in the shared system
 * head, so every variable block here appends at the tail in a fixed order
 * (evidence, then the remaining count): prompt_n is prompt_1 plus suffixes
 * and consecutive decide hops only prefill their new evidence. In the LEAN
 * view (A/B arm) facts ride the user turn between the menu and the
 * evidence, exactly where they sat before e6c1ff3.
 */
export function decideUserContent(parts: DecidePromptParts): string {
  return `QUESTION
${parts.question}${parts.menuText ? `

TOOLS
${parts.menuText}` : ""}${parts.facts ? `

FACTS
${parts.facts}` : ""}${parts.evidence ? `

EARLIER RESULTS THIS TURN
${parts.evidence}` : ""}${parts.remaining != null ? `

At most ${parts.remaining} more tool picks this turn.` : ""}`;
}
