// Semantic retrieval over the journal and theses.
//
// Deterministic filter → metadata narrowing → encoder similarity → top N.
// The full journal never reaches a model: only a compact set of records does,
// and only when a question actually needs them. Embeddings are computed lazily
// and cached in memory for the session; they are never the source of truth.

import { prewarmTargets, rank } from "@/lib/ai/encoder";
import { getDoc } from "@/lib/store";
import { filterCards, searchCards, type JournalCard } from "@/lib/tools/journal";

export type Reference =
  | { kind: "thesis"; id: string; title: string; text: string }
  | {
      kind: "card";
      id: string;
      title: string;
      text: string;
      /** the card's ticker, e.g. "HYPE-PERP"; null when it has none */
      ticker: string | null;
      /** venue id ("evm" | "nado" | "hyperliquid"); null for plain entries */
      venue: string | null;
      /** the card's timestamp, ms */
      date: number;
    };

/** Everything referenceable with `@`, cheap and deterministic. */
export function referenceIndex(query = "", limit = 12): Reference[] {
  const doc = getDoc();
  const q = query.toLowerCase().trim();
  const theses: Reference[] = doc.theses
    .filter((t) => !q || t.title.toLowerCase().includes(q))
    .slice(0, limit)
    .map((t) => ({
      kind: "thesis",
      id: t.id,
      title: t.title,
      text: `${t.title}. ${t.status}. ${t.symbols.join(" ")} ${t.body ?? ""}`.trim(),
    }));
  const cards: Reference[] = (q ? searchCards(q, limit) : filterCards({ limit }))
    .slice(0, limit)
    .map((c) => ({
      kind: "card",
      id: c.id,
      title: `${c.ticker ?? "—"} · ${new Date(c.date).toISOString().slice(0, 10)}`,
      text: cardText(c),
      ticker: c.ticker,
      venue: c.venue ?? null,
      date: c.date,
    }));
  return [...theses, ...cards].slice(0, limit);
}

function cardText(c: JournalCard): string {
  return [
    new Date(c.date).toISOString().slice(0, 10),
    c.ticker ?? "",
    c.motive ?? "",
    c.alignment ?? "",
    c.record,
  ]
    .filter(Boolean)
    .join(" · ");
}

// ── structured-field narrowing ─────────────────────────────────────────────
//
// The encoder ranks by semantic similarity over the whole card text. But the
// fields a user can name explicitly — a ticker, a venue, a recency window —
// are structured data on the card, and matching them is far more reliable
// than hoping the embedding "feels" them. So we pull those fields out of the
// question and use them to RE-RANK the encoder output, never to hard-filter:
// a pure-cosine result can still surface when nothing was named.

// Digit-first symbols exist (1INCH), so a token may start with a number — but
// it must contain at least one letter, or every number in a question becomes a
// token. Comparison is always on the uppercase form: tickers arrive in any
// case (wGOGLX, cbBTC) and so does the question.
const TICKER_TOKEN = /[A-Z0-9][A-Z0-9-]{1,11}/g;
const MAX_TICKER_HITS = 4;

/**
 * Which of the user's actual tickers the question mentions. Matching is
 * against the known set, so "How", "AI" or "OK" never read as a ticker: a
 * token only counts when it is (the base of) a ticker that exists on this
 * device. "HYPE" matches a "HYPE-PERP" card and vice versa, and case never
 * matters on either side.
 */
export function matchTickers(query: string, known: Iterable<string>): string[] {
  const tokens = new Set(
    (query.toUpperCase().match(TICKER_TOKEN) ?? []).filter((t) => /[A-Z]/.test(t)),
  );
  const hits: string[] = [];
  for (const ticker of new Set(known)) {
    const base = ticker.split("-")[0].toUpperCase();
    if (tokens.has(ticker.toUpperCase()) || tokens.has(base)) hits.push(ticker);
    if (hits.length >= MAX_TICKER_HITS) break;
  }
  return hits;
}

/** Whether a card's ticker is among the ones the question named. Both sides
 * arrive uppercase: the named set is built with toUpperCase() by the caller. */
function tickerNamed(named: Set<string>, ticker: string): boolean {
  const upper = ticker.toUpperCase();
  return named.has(upper) || named.has(upper.split("-")[0]);
}

/** Venue ids a question may name, matched as whole words. */
const VENUE_IDS = ["hyperliquid", "velodrome", "inkyswap", "nado", "tydro", "evm"] as const;
const VENUE_WORD: [string, string][] = VENUE_IDS.map((id) => [`\\b${id}\\b`, id]);

export function extractVenue(query: string): string | null {
  const q = query.toLowerCase();
  for (const [pattern, id] of VENUE_WORD) if (new RegExp(pattern).test(q)) return id;
  return null;
}

const DAY = 86_400_000;

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function startOfWeek(ms: number): number {
  const day = startOfLocalDay(ms);
  const weekday = new Date(ms).getDay(); // 0=Sun
  return day - ((weekday + 6) % 7) * DAY; // Monday 00:00
}
function startOfMonth(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/**
 * Recency window named by the question, in ms. `now` is a parameter so the
 * mapping is testable. Only the first recognized phrasing wins.
 */
export function extractDateWindow(
  query: string,
  now = Date.now(),
): { from?: number; to?: number } | null {
  const q = query.toLowerCase();
  const m = /\b(\d+)\s+(day|days|week|weeks|month|months)\s+ago\b/.exec(q);
  if (m) {
    const n = Number(m[1]);
    if (m[2].startsWith("month")) {
      // Calendar months, not 30-day multiples: "2 months ago" from Aug 25 is
      // Jun 25, and month lengths vary.
      const d = new Date(now);
      d.setMonth(d.getMonth() - n);
      return { from: d.getTime(), to: now };
    }
    const span = m[2].startsWith("week") ? n * 7 * DAY : n * DAY;
    return { from: now - span, to: now };
  }
  if (/\blast\s+week\b/.test(q)) return { from: startOfWeek(now) - 7 * DAY, to: startOfWeek(now) };
  if (/\bthis\s+week\b/.test(q)) return { from: startOfWeek(now), to: now };
  if (/\blast\s+month\b/.test(q)) {
    const d = new Date(now);
    return { from: new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(), to: startOfMonth(now) };
  }
  if (/\bthis\s+month\b/.test(q)) return { from: startOfMonth(now), to: now };
  if (/\byesterday\b/.test(q)) {
    const y = startOfLocalDay(now) - DAY;
    return { from: y, to: y + DAY };
  }
  if (/\btoday\b/.test(q)) return { from: startOfLocalDay(now), to: now };
  return null;
}

function inWindow(date: number, win: { from?: number; to?: number }): boolean {
  if (win.from != null && date < win.from) return false;
  if (win.to != null && date > win.to) return false;
  return true;
}

export type Retrieved = {
  /** compact lines, safe to hand to a model */
  lines: string[];
  /** how the candidates were narrowed */
  how: "deterministic" | "encoder" | "encoder+structured";
  count: number;
};

/** Everything a question could be ranked against: theses plus recent cards. */
function referencePool(): Reference[] {
  const doc = getDoc();
  return [
    ...doc.theses.map<Reference>((t) => ({
      kind: "thesis",
      id: t.id,
      title: t.title,
      text: `thesis "${t.title}" · ${t.status} · ${t.symbols.join(" ")} · ${(t.body ?? "").slice(0, 200)}`,
    })),
    ...filterCards({ limit: 200 }).map<Reference>((c) => ({
      kind: "card",
      id: c.id,
      title: c.ticker ?? "entry",
      text: cardText(c),
      ticker: c.ticker,
      venue: c.venue ?? null,
      date: c.date,
    })),
  ];
}

/**
 * Warm the vector cache in idle time so the first question of a session ranks
 * against ready vectors. No-op when no encoder is resident; never downloads.
 */
export function prewarmRetrieval(): Promise<number> {
  return prewarmTargets(referencePool().map((r) => r.text));
}

/**
 * Records relevant to one question. Falls back to the deterministic search when
 * the encoder is not on the device — retrieval must never require a download.
 */
export async function retrieveContext(query: string, limit = 8): Promise<Retrieved> {
  const pool = referencePool();
  if (pool.length === 0) return { lines: [], how: "deterministic", count: 0 };

  const ranked = await rank(
    query,
    pool.map((r) => ({ id: `${r.kind}:${r.id}`, text: r.text })),
    { opportunistic: true },
  );

  if (!ranked) {
    const cards = searchCards(query, limit);
    return {
      lines: cards.map((c) => cardText(c)),
      how: "deterministic",
      count: cards.length,
    };
  }

  const byId = new Map(pool.map((r) => [`${r.kind}:${r.id}`, r]));

  // Structured signals pulled from the question. The pool's tickers drive the
  // ticker match, so only real, on-device tickers can fire it.
  const cardRefs = pool.filter((r): r is Extract<Reference, { kind: "card" }> => r.kind === "card");
  const namedTickers = new Set(
    matchTickers(
      query,
      cardRefs.map((r) => r.ticker).filter((t): t is string => t != null),
    ).map((t) => t.toUpperCase()),
  );
  const venue = extractVenue(query);
  const window = extractDateWindow(query);

  // Rerank: cosine plus a deterministic boost for each named field the card
  // actually carries. The floor applies to the boosted score, so a card that
  // the embedding ranked low but that names the exact ticker still surfaces.
  const scored = ranked.map((r) => {
    const ref = byId.get(r.id);
    let boost = 0;
    if (ref && ref.kind === "card") {
      if (namedTickers.size && ref.ticker && tickerNamed(namedTickers, ref.ticker)) {
        boost += 0.5;
      }
      if (venue && ref.venue === venue) {
        boost += 0.3;
      }
      if (window && inWindow(ref.date, window)) {
        boost += 0.25;
      }
    }
    return { ref, score: r.score + boost, boost };
  });

  const top = scored
    .filter((s) => s.score > 0.25 && s.ref)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  // The label claims narrowing only when a boosted card actually made the
  // cut; a boost that never reached the top N changed nothing.
  const structured = top.some((s) => s.boost > 0);

  return {
    lines: top.map((s) => s.ref as Reference).map((r) => r.text),
    how: structured ? "encoder+structured" : "encoder",
    count: top.length,
  };
}
