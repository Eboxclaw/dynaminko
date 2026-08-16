// Proof of Thesis Index — sentiment x actions / results.
// Every input is something the user actually wrote or the agent actually read.
// No synthetic data: with an empty journal every axis is null, not zero.

import type { Entry, Sentiment, Signal, Thesis } from "./store";

export type AxisId =
  "coverage" | "alignment" | "discipline" | "execution" | "payoff" | "steadiness";

export type AxisPart = { label: string; value: number; of: number };

export type Axis = {
  id: AxisId;
  label: string;
  hint: string;
  /** 0..1, or null when there is nothing to measure yet */
  score: number | null;
  detail: string;
  /** plain-language definition of the ratio */
  formula: string;
  /** this axis's share of the composite, renormalised over measured axes */
  weight: number;
  /** the two numbers behind the ratio */
  numerator: number;
  denominator: number;
  /** the buckets that make up the numerator, so a score can be argued with */
  parts: AxisPart[];
  /** same axis over the last 30 days, and the change against the 30 before it */
  recent: number | null;
  delta: number | null;
};

/** One motive row of the PnL-vs-sentiment table. */
export type MotivePnl = {
  motive: Sentiment | null;
  trades: number;
  wins: number;
  net: number;
  avg: number;
};

/** The money behind the Payoff axis: profit and loss per declared motive. */
export type PayoffSummary = {
  measured: number;
  wins: number;
  grossProfit: number;
  grossLoss: number;
  net: number;
  /** net PnL of intentional motives vs reactive ones; null when neither side has a close */
  intentPremium: { intentionalNet: number; reactiveNet: number } | null;
  byMotive: MotivePnl[];
};

export type PotIndex = {
  score: number | null;
  /** the same composite over the last 30 days */
  recentScore: number | null;
  delta: number | null;
  axes: Axis[];
  payoff: PayoffSummary;
  ghosts: Thesis[];
  executed: number;
  pending: number;
  measured: number;
};

const POSITIVE_SENTIMENT = new Set(["conviction", "hedge", "rebalance"]);
const ROUGH_EMOTION = new Set(["anxious", "uncertain"]);
const ROUGH_HEALTH = new Set(["tired", "stressed", "unwell"]);
const DAY = 86_400_000;

/** Composite weights: doing outweighs feeling. Renormalised over measured axes. */
const WEIGHTS: Record<AxisId, number> = {
  execution: 0.3,
  payoff: 0.2,
  alignment: 0.2,
  discipline: 0.15,
  coverage: 0.1,
  steadiness: 0.05,
};

type Raw = {
  score: number | null;
  numerator: number;
  denominator: number;
  parts: AxisPart[];
  /** replaces the default "x of y" detail when the ratio isn't a count */
  extra?: string;
};

function ratio(numerator: number, denominator: number, parts: AxisPart[] = []): Raw {
  return {
    score: denominator === 0 ? null : numerator / denominator,
    numerator,
    denominator,
    parts,
  };
}

/** Realized PnL of an entry's trade, when the venue reported one (Nado, Hyperliquid). */
export function entryPnl(entry: Entry, signalsById: Map<string, Signal>): number | null {
  if (!entry.tradeId) return null;
  return signalsById.get(entry.tradeId)?.meta?.pnl ?? null;
}

function money(v: number): string {
  const a = Math.abs(v);
  return `${v < 0 ? "-" : "+"}$${a < 100 ? a.toFixed(2) : Math.round(a)}`;
}

/** Profit-and-loss per declared motive over whatever slice is handed in. */
function payoffOf(entries: Entry[], signalsById: Map<string, Signal>) {
  const seen = new Set<string>();
  const rows: { motive: Sentiment | null; pnl: number }[] = [];
  for (const e of entries) {
    if (!e.tradeId || seen.has(e.tradeId)) continue;
    const pnl = entryPnl(e, signalsById);
    if (pnl == null) continue;
    seen.add(e.tradeId);
    rows.push({ motive: e.sentiment, pnl });
  }

  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;
  for (const r of rows) {
    if (r.pnl > 0) {
      wins++;
      grossProfit += r.pnl;
    } else {
      grossLoss += -r.pnl;
    }
  }

  const motives: Array<Sentiment | null> = [
    "conviction",
    "rebalance",
    "hedge",
    "reactive",
    "fomo",
    null,
  ];
  const byMotive: MotivePnl[] = [];
  for (const motive of motives) {
    const pnls = rows.filter((r) => r.motive === motive).map((r) => r.pnl);
    if (pnls.length === 0) continue;
    const net = pnls.reduce((a, b) => a + b, 0);
    byMotive.push({
      motive,
      trades: pnls.length,
      wins: pnls.filter((p) => p > 0).length,
      net,
      avg: net / pnls.length,
    });
  }

  const intentionalNet = rows
    .filter((r) => r.motive != null && POSITIVE_SENTIMENT.has(r.motive))
    .reduce((a, r) => a + r.pnl, 0);
  const reactiveNet = rows
    .filter((r) => r.motive === "fomo" || r.motive === "reactive")
    .reduce((a, r) => a + r.pnl, 0);
  const intentionalMeasured = rows.some(
    (r) => r.motive != null && POSITIVE_SENTIMENT.has(r.motive),
  );
  const reactiveMeasured = rows.some((r) => r.motive === "fomo" || r.motive === "reactive");

  return {
    measured: rows.length,
    wins,
    grossProfit,
    grossLoss,
    net: grossProfit - grossLoss,
    intentPremium: intentionalMeasured || reactiveMeasured ? { intentionalNet, reactiveNet } : null,
    byMotive,
  };
}

/** The six raw ratios over whatever slice of the journal is handed in. */
function rawAxes(entries: Entry[], theses: Thesis[], signals: Signal[]): Record<AxisId, Raw> {
  const linked = signals.filter((s) => s.state === "linked").length;
  const signalsById = new Map(signals.map((s) => [s.id, s]));

  const withAlignment = entries.filter((e) => e.alignment);
  const aligned = withAlignment.filter((e) => e.alignment === "aligned").length;
  const partial = withAlignment.filter((e) => e.alignment === "partial").length;
  const drifted = withAlignment.length - aligned - partial;

  const withSentiment = entries.filter((e) => e.sentiment);
  const intentional = withSentiment.filter((e) =>
    POSITIVE_SENTIMENT.has(e.sentiment as string),
  ).length;

  const executedThesisIds = new Set(
    entries.filter((e) => e.tradeId && e.thesisId).map((e) => e.thesisId as string),
  );

  const pnl = payoffOf(entries, signalsById);
  const movement = pnl.grossProfit + pnl.grossLoss;
  const round2 = (v: number) => Math.round(v * 100) / 100;

  // Steadiness: a rough state of mind only counts against you when nothing
  // came of it. Tired and still green is execution, not a failure of nerve.
  const withState = entries.filter((e) => e.emotion || e.health);
  const rough = withState.filter(
    (e) => ROUGH_EMOTION.has(e.emotion ?? "") || ROUGH_HEALTH.has(e.health ?? ""),
  );
  const roughPaid = rough.filter((e) => (entryPnl(e, signalsById) ?? 0) > 0).length;
  const clearHeaded = withState.length - rough.length;
  const composed = clearHeaded + roughPaid;

  return {
    coverage: ratio(linked, signals.length, [
      { label: "reconciled", value: linked, of: signals.length },
      {
        label: "still in inbox",
        value: signals.filter((s) => s.state === "inbox").length,
        of: signals.length,
      },
    ]),
    alignment: ratio(aligned + partial * 0.5, withAlignment.length, [
      { label: "aligned", value: aligned, of: withAlignment.length },
      { label: "partial", value: partial, of: withAlignment.length },
      { label: "drifted", value: drifted, of: withAlignment.length },
    ]),
    discipline: ratio(intentional, withSentiment.length, [
      { label: "intentional", value: intentional, of: withSentiment.length },
      {
        label: "reactive",
        value: withSentiment.length - intentional,
        of: withSentiment.length,
      },
    ]),
    execution: ratio(executedThesisIds.size, theses.length, [
      { label: "executed", value: executedThesisIds.size, of: theses.length },
      {
        label: "ghosts",
        value: theses.filter((t) => !executedThesisIds.has(t.id) && t.status === "open").length,
        of: theses.length,
      },
    ]),
    payoff: {
      ...ratio(pnl.grossProfit, movement, [
        { label: "profit taken", value: round2(pnl.grossProfit), of: round2(movement) },
        { label: "given back", value: round2(pnl.grossLoss), of: round2(movement) },
      ]),
      extra: `${money(pnl.net)} net · ${pnl.measured} ${
        pnl.measured === 1 ? "close" : "closes"
      } with a reported PnL`,
    },
    steadiness: ratio(composed, withState.length, [
      { label: "clear-headed", value: clearHeaded, of: withState.length },
      { label: "rough but paid", value: roughPaid, of: withState.length },
      {
        label: "rough and it cost",
        value: rough.length - roughPaid,
        of: withState.length,
      },
    ]),
  };
}

const META: Record<AxisId, { label: string; hint: string; formula: string }> = {
  coverage: {
    label: "Coverage",
    hint: "on-chain moments you actually answered",
    formula: "reconciled signals ÷ all signals the agent read",
  },
  alignment: {
    label: "Alignment",
    hint: "trades that matched a written thesis",
    formula: "(aligned + half of partial) ÷ answered entries",
  },
  discipline: {
    label: "Discipline",
    hint: "intent over impulse",
    formula: "intentional entries ÷ entries with a sentiment",
  },
  execution: {
    label: "Execution",
    hint: "theses that became trades",
    formula: "theses with a linked trade ÷ all theses",
  },
  payoff: {
    label: "Payoff",
    hint: "money vs the motive you declared",
    formula: "gross profit ÷ gross movement · 50% is break-even",
  },
  steadiness: {
    label: "Steadiness",
    hint: "state of mind while trading · a paid trade excuses a rough one",
    formula: "clear-headed or paid anyway ÷ entries with a state logged",
  },
};

function composite(axes: Array<{ id: AxisId; score: number | null }>): number | null {
  const measured = axes.filter((a) => a.score != null);
  if (measured.length === 0) return null;
  const totalWeight = measured.reduce((sum, a) => sum + WEIGHTS[a.id], 0);
  const weighted = measured.reduce((sum, a) => sum + WEIGHTS[a.id] * (a.score as number), 0);
  return Math.round((weighted / totalWeight) * 100);
}

function detailFor(id: AxisId, raw: Raw): string {
  if (raw.denominator === 0) {
    return id === "coverage"
      ? "no trades read yet"
      : id === "execution"
        ? "no theses yet"
        : id === "payoff"
          ? "no closes with a reported PnL yet"
          : "nothing logged yet";
  }
  if (raw.extra) return raw.extra;
  return `${Math.round(raw.numerator * 10) / 10} of ${raw.denominator}`;
}

export function computeIndex(
  entries: Entry[],
  theses: Thesis[],
  signals: Signal[],
  now = Date.now(),
): PotIndex {
  const all = rawAxes(entries, theses, signals);

  const within = (from: number, to: number) =>
    rawAxes(
      entries.filter((e) => e.createdAt >= from && e.createdAt < to),
      theses.filter((t) => t.createdAt >= from && t.createdAt < to),
      signals.filter((s) => s.ts >= from && s.ts < to),
    );

  const last30 = within(now - 30 * DAY, now + 1);
  const prev30 = within(now - 60 * DAY, now - 30 * DAY);

  const axes: Axis[] = (Object.keys(META) as AxisId[]).map((id) => {
    const raw = all[id];
    const recent = last30[id].score;
    const prior = prev30[id].score;
    return {
      id,
      ...META[id],
      score: raw.score,
      detail: detailFor(id, raw),
      weight: WEIGHTS[id],
      numerator: raw.numerator,
      denominator: raw.denominator,
      parts: raw.parts.filter((p) => p.of > 0),
      recent,
      delta: recent != null && prior != null ? recent - prior : null,
    };
  });

  const executedThesisIds = new Set(
    entries.filter((e) => e.tradeId && e.thesisId).map((e) => e.thesisId as string),
  );
  const ghosts = theses.filter((t) => !executedThesisIds.has(t.id) && t.status === "open");

  const recentScore = composite(axes.map((a) => ({ id: a.id, score: a.recent })));
  const score = composite(axes);

  return {
    score,
    recentScore,
    delta: score != null && recentScore != null ? recentScore - score : null,
    axes,
    payoff: payoffOf(entries, new Map(signals.map((s) => [s.id, s]))),
    ghosts,
    executed: executedThesisIds.size,
    pending: signals.filter((s) => s.state === "inbox").length,
    measured: axes.filter((a) => a.score != null).length,
  };
}
