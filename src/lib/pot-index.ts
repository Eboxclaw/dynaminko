// Proof of Thesis Index — sentiment x actions / results.
// Every input is something the user actually wrote or the agent actually read.
// No synthetic data: with an empty journal every axis is null, not zero.

import type { Entry, Signal, Thesis } from "./store";

export type Axis = {
  id: "coverage" | "alignment" | "discipline" | "execution" | "steadiness";
  label: string;
  hint: string;
  /** 0..1, or null when there is nothing to measure yet */
  score: number | null;
  detail: string;
};

export type PotIndex = {
  score: number | null;
  axes: Axis[];
  ghosts: Thesis[];
  executed: number;
  pending: number;
};

const POSITIVE_SENTIMENT = new Set(["conviction", "hedge", "rebalance"]);
const CALM = new Set(["calm", "excited"]);

export function computeIndex(
  entries: Entry[],
  theses: Thesis[],
  signals: Signal[],
): PotIndex {
  const linked = signals.filter((s) => s.state === "linked").length;
  const total = signals.length;
  const pending = signals.filter((s) => s.state === "inbox").length;

  const withAlignment = entries.filter((e) => e.alignment);
  const alignmentScore =
    withAlignment.length === 0
      ? null
      : withAlignment.reduce(
          (sum, e) =>
            sum + (e.alignment === "aligned" ? 1 : e.alignment === "partial" ? 0.5 : 0),
          0,
        ) / withAlignment.length;

  const withSentiment = entries.filter((e) => e.sentiment);
  const disciplineScore =
    withSentiment.length === 0
      ? null
      : withSentiment.filter((e) => POSITIVE_SENTIMENT.has(e.sentiment as string)).length /
        withSentiment.length;

  const executedThesisIds = new Set(
    entries.filter((e) => e.tradeId && e.thesisId).map((e) => e.thesisId as string),
  );
  const ghosts = theses.filter((t) => !executedThesisIds.has(t.id) && t.status === "open");
  const executionScore =
    theses.length === 0 ? null : executedThesisIds.size / theses.length;

  const withEmotion = entries.filter((e) => e.emotion);
  const steadiness =
    withEmotion.length === 0
      ? null
      : withEmotion.filter((e) => CALM.has(e.emotion as string)).length / withEmotion.length;

  const axes: Axis[] = [
    {
      id: "coverage",
      label: "Coverage",
      hint: "on-chain moments you actually answered",
      score: total === 0 ? null : linked / total,
      detail: total === 0 ? "no trades read yet" : `${linked} of ${total} reconciled`,
    },
    {
      id: "alignment",
      label: "Alignment",
      hint: "trades that matched a written thesis",
      score: alignmentScore,
      detail: withAlignment.length === 0 ? "no answers yet" : `${withAlignment.length} answered`,
    },
    {
      id: "discipline",
      label: "Discipline",
      hint: "intent over impulse",
      score: disciplineScore,
      detail:
        withSentiment.length === 0
          ? "no sentiment logged"
          : `${withSentiment.filter((e) => !POSITIVE_SENTIMENT.has(e.sentiment as string)).length} reactive`,
    },
    {
      id: "execution",
      label: "Execution",
      hint: "theses that became trades",
      score: executionScore,
      detail: theses.length === 0 ? "no theses yet" : `${ghosts.length} still ghosts`,
    },
    {
      id: "steadiness",
      label: "Steadiness",
      hint: "state of mind while trading",
      score: steadiness,
      detail: withEmotion.length === 0 ? "no state logged" : `${withEmotion.length} logged`,
    },
  ];

  const measured = axes.filter((a) => a.score != null);
  const score =
    measured.length === 0
      ? null
      : Math.round(
          (measured.reduce((sum, a) => sum + (a.score as number), 0) / measured.length) * 100,
        );

  return { score, axes, ghosts, executed: executedThesisIds.size, pending };
}
