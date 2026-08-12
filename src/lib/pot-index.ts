// Proof of Thesis Index — sentiment x actions / results.
// Every input is something the user actually wrote or the agent actually read.
// No synthetic data: with an empty journal every axis is null, not zero.

import type { Entry, Signal, Thesis } from "./store";

export type AxisId = "coverage" | "alignment" | "discipline" | "execution" | "steadiness";

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
  /** the two numbers behind the ratio */
  numerator: number;
  denominator: number;
  /** the buckets that make up the numerator, so a score can be argued with */
  parts: AxisPart[];
  /** same axis over the last 30 days, and the change against the 30 before it */
  recent: number | null;
  delta: number | null;
};

export type PotIndex = {
  score: number | null;
  /** the same composite over the last 30 days */
  recentScore: number | null;
  delta: number | null;
  axes: Axis[];
  ghosts: Thesis[];
  executed: number;
  pending: number;
  measured: number;
};

const POSITIVE_SENTIMENT = new Set(["conviction", "hedge", "rebalance"]);
const CALM = new Set(["calm", "excited"]);
const DAY = 86_400_000;

type Raw = { score: number | null; numerator: number; denominator: number; parts: AxisPart[] };

function ratio(numerator: number, denominator: number, parts: AxisPart[] = []): Raw {
  return {
    score: denominator === 0 ? null : numerator / denominator,
    numerator,
    denominator,
    parts,
  };
}

/** The five raw ratios over whatever slice of the journal is handed in. */
function rawAxes(entries: Entry[], theses: Thesis[], signals: Signal[]): Record<AxisId, Raw> {
  const linked = signals.filter((s) => s.state === "linked").length;

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

  const withEmotion = entries.filter((e) => e.emotion);
  const calm = withEmotion.filter((e) => CALM.has(e.emotion as string)).length;

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
    steadiness: ratio(calm, withEmotion.length, [
      { label: "steady", value: calm, of: withEmotion.length },
      { label: "charged", value: withEmotion.length - calm, of: withEmotion.length },
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
  steadiness: {
    label: "Steadiness",
    hint: "state of mind while trading",
    formula: "calm or excited ÷ entries with a state logged",
  },
};

function composite(axes: Array<{ score: number | null }>): number | null {
  const measured = axes.filter((a) => a.score != null);
  if (measured.length === 0) return null;
  return Math.round(
    (measured.reduce((sum, a) => sum + (a.score as number), 0) / measured.length) * 100,
  );
}

function detailFor(id: AxisId, raw: Raw): string {
  if (raw.denominator === 0) {
    return id === "coverage"
      ? "no trades read yet"
      : id === "execution"
        ? "no theses yet"
        : "nothing logged yet";
  }
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

  const recentScore = composite(axes.map((a) => ({ score: a.recent })));
  const score = composite(axes);

  return {
    score,
    recentScore,
    delta: score != null && recentScore != null ? recentScore - score : null,
    axes,
    ghosts,
    executed: executedThesisIds.size,
    pending: signals.filter((s) => s.state === "inbox").length,
    measured: axes.filter((a) => a.score != null).length,
  };
}
