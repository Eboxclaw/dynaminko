// Deterministic statistics over the journal index. Pure arithmetic, no model.

import { computeIndex } from "@/lib/pot-index";
import { getDoc, type Sentiment } from "@/lib/store";

import { buildIndex, filterCards, type JournalCard } from "./journal";

export type MotiveStats = {
  motive: Sentiment;
  trades: number;
  entries: number;
  tickers: string[];
  aligned: number;
  partial: number;
  deviated: number;
  noThesis: number;
  /** aligned + half of partial, over entries that answered alignment */
  disciplineScore: number | null;
  withThesis: number;
  totalValue: number | null;
  /** closes under this motive whose venue reported a PnL (Nado, Hyperliquid) */
  measuredPnl: number;
  wins: number;
  netPnl: number | null;
  firstAt: number | null;
  lastAt: number | null;
  topTickers: { ticker: string; count: number }[];
};

/** tool: indicators.motiveStats — everything a summary needs, in one object. */
export function motiveStats(motive: Sentiment): MotiveStats {
  const cards = filterCards({ motive, type: "entry" });
  const answered = cards.filter((c) => c.alignment);
  const count = (a: string) => cards.filter((c) => c.alignment === a).length;
  const aligned = count("aligned");
  const partial = count("partial");
  const values = cards.map((c) => c.value).filter((v): v is number => v != null);
  const byTicker = new Map<string, number>();
  cards.forEach((c) => {
    if (c.ticker) byTicker.set(c.ticker, (byTicker.get(c.ticker) ?? 0) + 1);
  });

  const pnlByTrade = new Map(
    getDoc()
      .signals.filter((s) => s.meta?.pnl != null)
      .map((s) => [s.id, s.meta?.pnl as number]),
  );
  const seenTrades = new Set<string>();
  const pnls: number[] = [];
  cards.forEach((c) => {
    if (!c.tradeId || seenTrades.has(c.tradeId)) return;
    const pnl = pnlByTrade.get(c.tradeId);
    if (pnl == null) return;
    seenTrades.add(c.tradeId);
    pnls.push(pnl);
  });

  return {
    motive,
    trades: cards.filter((c) => c.tradeId).length,
    entries: cards.length,
    tickers: [...byTicker.keys()],
    aligned,
    partial,
    deviated: count("deviated"),
    noThesis: count("no_thesis"),
    disciplineScore: answered.length ? (aligned + partial * 0.5) / answered.length : null,
    withThesis: cards.filter((c) => c.thesisId).length,
    totalValue: values.length ? values.reduce((a, b) => a + b, 0) : null,
    measuredPnl: pnls.length,
    wins: pnls.filter((p) => p > 0).length,
    netPnl: pnls.length ? pnls.reduce((a, b) => a + b, 0) : null,
    firstAt: cards.length ? Math.min(...cards.map((c) => c.date)) : null,
    lastAt: cards.length ? Math.max(...cards.map((c) => c.date)) : null,
    topTickers: [...byTicker.entries()]
      .map(([ticker, c]) => ({ ticker, count: c }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}

/** tool: indicators.alignmentStats — alignment mix across the whole journal. */
export function alignmentStats() {
  const cards = filterCards({ type: "entry" });
  const buckets: Record<string, number> = {};
  cards.forEach((c) => {
    const k = c.alignment ?? "unanswered";
    buckets[k] = (buckets[k] ?? 0) + 1;
  });
  return { total: cards.length, buckets };
}

/** tool: indicators.coverage — how much of the inbox has been answered. */
export function coverageStats() {
  const index = buildIndex();
  const signals = index.cards.filter((c) => c.type === "signal");
  const linked = signals.filter((c) => c.state === "linked").length;
  return {
    signals: signals.length,
    linked,
    inbox: signals.length - linked,
    ratio: signals.length ? linked / signals.length : null,
  };
}

/** tool: indicators.potIndex — the six-axis, execution-weighted score. */
export function potIndex() {
  const doc = getDoc();
  return computeIndex(doc.entries, doc.theses, doc.signals);
}

/** tool: indicators.thesisPerformance — entries attached to one thesis. */
export function thesisStats(thesisId: string) {
  const cards: JournalCard[] = filterCards({ thesisId, type: "entry" });
  const thesis = getDoc().theses.find((t) => t.id === thesisId) ?? null;
  const answered = cards.filter((c) => c.alignment);
  const aligned = cards.filter((c) => c.alignment === "aligned").length;
  return {
    thesisId,
    title: thesis?.title ?? null,
    status: thesis?.status ?? null,
    symbols: thesis?.symbols ?? [],
    entries: cards.length,
    trades: cards.filter((c) => c.tradeId).length,
    aligned,
    alignmentRate: answered.length ? aligned / answered.length : null,
    lastAt: cards.length ? Math.max(...cards.map((c) => c.date)) : null,
    staleDays: thesis ? Math.floor((Date.now() - thesis.updatedAt) / 86_400_000) : null,
  };
}
