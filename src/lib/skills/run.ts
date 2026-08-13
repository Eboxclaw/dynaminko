// Runs a skill's deterministic half. The result is compact on purpose: it is
// what a model would receive, and it is also readable on its own when no model
// is loaded.

import { log, type Sentiment } from "@/lib/store";
import * as ind from "@/lib/tools/indicators";
import { filterCards } from "@/lib/tools/journal";
import { getDoc } from "@/lib/store";

import { SKILL_BY_ID, type SkillDef } from "./registry";

export type SkillResult = {
  skill: SkillDef;
  /** the compact structured payload — never the whole journal */
  data: Record<string, unknown>;
  /** plain-language lines the UI can show with no model at all */
  facts: string[];
  /** the prompt to hand a model, when the user has one loaded */
  prompt: string;
  aiRequired: boolean;
};

export type SkillInput = { motive?: Sentiment; thesisId?: string; note?: string };

export function runSkill(skillId: string, input: SkillInput = {}): SkillResult {
  const skill = SKILL_BY_ID[skillId];
  if (!skill) throw new Error(`unknown skill: ${skillId}`);
  const started = Date.now();

  let data: Record<string, unknown> = {};
  let facts: string[] = [];

  if (skill.id === "motive.performance") {
    const motive = input.motive ?? "conviction";
    const s = ind.motiveStats(motive);
    data = { ...s };
    facts = [
      `${s.entries} entries under "${motive}", ${s.trades} tied to a trade.`,
      s.disciplineScore != null
        ? `Discipline ${Math.round(s.disciplineScore * 100)}% (${s.aligned} aligned, ${s.partial} partial, ${s.deviated} deviated).`
        : "No alignment answered yet for this motive.",
      s.topTickers.length
        ? `Most traded: ${s.topTickers.map((t) => `${t.ticker} ×${t.count}`).join(", ")}.`
        : "No ticker attached yet.",
      s.totalValue != null ? `Priced value ${Math.round(s.totalValue)} USD.` : "No priced value.",
    ];
  } else if (skill.id === "journal.review") {
    const cov = ind.coverageStats();
    const mix = ind.alignmentStats();
    const idx = ind.potIndex();
    data = { coverage: cov, alignment: mix, potScore: idx.score, axes: idx.axes.map((a) => ({ id: a.id, score: a.score })) };
    facts = [
      `${cov.linked} of ${cov.signals} extracted trades answered, ${cov.inbox} waiting.`,
      `Alignment mix: ${Object.entries(mix.buckets).map(([k, v]) => `${k} ${v}`).join(", ") || "nothing answered"}.`,
      idx.score != null ? `POT index ${Math.round(idx.score * 100)}.` : "POT index not measurable yet.",
    ];
  } else if (skill.id === "thesis.review") {
    const id = input.thesisId ?? getDoc().theses[0]?.id;
    if (!id) {
      data = {};
      facts = ["No thesis written yet."];
    } else {
      const s = ind.thesisStats(id);
      const cards = filterCards({ thesisId: id, type: "entry", limit: 10 });
      data = { ...s, recent: cards.map((c) => ({ date: c.date, ticker: c.ticker, motive: c.motive, alignment: c.alignment, record: c.record })) };
      facts = [
        `"${s.title}": ${s.entries} entries, ${s.trades} trades.`,
        s.alignmentRate != null
          ? `Aligned on ${Math.round(s.alignmentRate * 100)}% of answered entries.`
          : "No alignment answered against this thesis.",
        s.staleDays != null ? `Last touched ${s.staleDays} days ago.` : "",
      ].filter(Boolean);
    }
  } else if (skill.id === "plan.create") {
    const cov = ind.coverageStats();
    const theses = getDoc().theses;
    const stale = theses
      .map((t) => ({ id: t.id, title: t.title, days: Math.floor((Date.now() - t.updatedAt) / 86_400_000) }))
      .filter((t) => t.days >= 30);
    data = { coverage: cov, stale, openTheses: theses.filter((t) => t.status === "open").length };
    facts = [
      `${cov.inbox} trades still unanswered.`,
      stale.length ? `${stale.length} theses untouched for 30+ days.` : "No stale theses.",
    ];
  } else if (skill.id === "capture.tidy") {
    data = { note: input.note ?? "" };
    facts = ["Needs a model: this is a rewrite, not a calculation."];
  }

  log("skills", skill.id, { level: "call", ms: Date.now() - started, detail: facts[0] ?? "" });

  return {
    skill,
    data,
    facts,
    aiRequired: skill.aiRequired,
    prompt: [
      skill.aiRole,
      "Use only the structured result below. Be concise.",
      JSON.stringify(data),
    ].join("\n\n"),
  };
}
