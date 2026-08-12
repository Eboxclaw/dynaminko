// Deterministic journal query engine. No model touches this file.
// Everything the assistant needs to answer "how do I trade on this motive?"
// is computed here and handed over as a compact structured result.

import {
  addEntry,
  getDoc,
  patchThesis,
  removeEntry,
  type Alignment,
  type Entry,
  type Sentiment,
  type Signal,
  type Thesis,
} from "@/lib/store";

/** One flattened, searchable journal record. */
export type JournalCard = {
  id: string;
  type: "entry" | "signal";
  ticker: string | null;
  date: number;
  motive: Sentiment | null;
  alignment: Alignment | null;
  size: string | null;
  state: string;
  thesisId: string | null;
  tradeId: string | null;
  value: number | null;
  record: string;
};

export type JournalIndex = {
  cards: JournalCard[];
  tickers: string[];
  motives: Sentiment[];
  theses: { id: string; title: string; symbols: string[]; status: Thesis["status"] }[];
  builtAt: number;
};

function tickerOf(entry: Entry, signals: Signal[]): string | null {
  const sig = entry.tradeId ? signals.find((s) => s.id === entry.tradeId) : null;
  if (sig) return sig.symbol.toUpperCase();
  const m = /\b([A-Z]{2,6})\b/.exec(entry.headline);
  return m ? m[1] : null;
}

/** tool: journal.index — flatten entries + signals into one addressable set. */
export function buildIndex(): JournalIndex {
  const doc = getDoc();
  const cards: JournalCard[] = [
    ...doc.entries.map((e) => ({
      id: e.id,
      type: "entry" as const,
      ticker: tickerOf(e, doc.signals),
      date: e.createdAt,
      motive: e.sentiment,
      alignment: e.alignment,
      size: e.sizing,
      state: e.ghost ? "ghost" : "logged",
      thesisId: e.thesisId,
      tradeId: e.tradeId,
      value: e.tradeId
        ? (doc.signals.find((s) => s.id === e.tradeId)?.value ?? null)
        : null,
      record: [e.headline, e.body].filter(Boolean).join(" — "),
    })),
    ...doc.signals.map((s) => ({
      id: s.id,
      type: "signal" as const,
      ticker: s.symbol.toUpperCase(),
      date: s.ts,
      motive: null,
      alignment: null,
      size: null,
      state: s.state,
      thesisId: null,
      tradeId: s.id,
      value: s.value,
      record: `${s.side === "in" ? "Received" : "Sent"} ${s.amount} ${s.symbol}`,
    })),
  ].sort((a, b) => b.date - a.date);

  return {
    cards,
    tickers: [...new Set(cards.map((c) => c.ticker).filter(Boolean) as string[])].sort(),
    motives: [...new Set(cards.map((c) => c.motive).filter(Boolean) as Sentiment[])],
    theses: doc.theses.map((t) => ({
      id: t.id,
      title: t.title,
      symbols: t.symbols,
      status: t.status,
    })),
    builtAt: Date.now(),
  };
}

export type JournalFilter = {
  motive?: Sentiment | null;
  ticker?: string | null;
  alignment?: Alignment | null;
  state?: string | null;
  thesisId?: string | null;
  type?: JournalCard["type"] | null;
  from?: number | null;
  to?: number | null;
  query?: string | null;
  limit?: number;
};

/** tool: journal.filter — narrow the index without loading anything else. */
export function filterCards(filter: JournalFilter, index = buildIndex()): JournalCard[] {
  const q = filter.query?.trim().toLowerCase();
  const out = index.cards.filter((c) => {
    if (filter.motive && c.motive !== filter.motive) return false;
    if (filter.ticker && c.ticker !== filter.ticker.toUpperCase()) return false;
    if (filter.alignment && c.alignment !== filter.alignment) return false;
    if (filter.state && c.state !== filter.state) return false;
    if (filter.thesisId && c.thesisId !== filter.thesisId) return false;
    if (filter.type && c.type !== filter.type) return false;
    if (filter.from && c.date < filter.from) return false;
    if (filter.to && c.date > filter.to) return false;
    if (q && !(c.record.toLowerCase().includes(q) || (c.ticker ?? "").toLowerCase().includes(q)))
      return false;
    return true;
  });
  return filter.limit ? out.slice(0, filter.limit) : out;
}

/** tool: journal.search — free text over the index. */
export function searchCards(query: string, limit = 20): JournalCard[] {
  return filterCards({ query, limit });
}

/** tool: journal.read — one card, full record. */
export function readCard(id: string): JournalCard | null {
  return buildIndex().cards.find((c) => c.id === id) ?? null;
}

/** tool: journal.write — append an entry. Approval required upstream. */
export function writeEntry(input: Partial<Entry>): Entry {
  return addEntry(input);
}

/** tool: journal.delete — remove an entry. Explicit approval required upstream. */
export function deleteEntry(id: string) {
  removeEntry(id);
}

/** tool: thesis.edit — patch a thesis. Approval required upstream. */
export function editThesis(id: string, patch: Partial<Thesis>) {
  patchThesis(id, patch);
}

/** tool: journal.compare — two filtered sets, side by side. */
export function compareSets(a: JournalFilter, b: JournalFilter) {
  const index = buildIndex();
  return { a: filterCards(a, index), b: filterCards(b, index) };
}
