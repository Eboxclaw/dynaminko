// Runs a skill's deterministic half. The result is compact on purpose: it is
// what a model would receive, and it is also readable on its own when no model
// is loaded.

import { log, type Sentiment } from "@/lib/store";
import * as ind from "@/lib/tools/indicators";
import { filterCards } from "@/lib/tools/journal";
import { getDoc } from "@/lib/store";
import { TOOL_BY_ID } from "@/lib/tools/registry";
import { COMMAND_BY_ID } from "@/lib/commands/registry";
import { runCommand } from "@/lib/commands/runner";
import { SECTOR_BY_ID, type SectorId } from "@/lib/sectors";

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

/**
 * Composed read skills: no bespoke branch, the skill simply declares which
 * tools or commands it runs. Each one runs with no input; results that fail to
 * run are kept visible in the data, never silently dropped — the model is
 * grounded on what actually happened. A skill step may name a tool
 * (`portfolio.read`) or a semantic command (`journal.resolve_inbox`); both
 * resolve through their own registries.
 */
async function runStep(id: string): Promise<unknown> {
  const tool = TOOL_BY_ID[id];
  if (tool?.run != null) return tool.run({});
  const command = COMMAND_BY_ID[id];
  if (command) {
    try {
      return await runCommand(id, {});
    } catch (err) {
      return { status: "failed", message: err instanceof Error ? err.message : String(err) };
    }
  }
  return { status: "unavailable", message: `${id} is not wired on this device` };
}

/** Round a dollar value to a readable integer; pass through non-numbers. */
function money(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

/** Compact a price to at most 4 significant figures so it is readable. */
function px(v: unknown): number | string | null {
  if (v == null || !Number.isFinite(v)) return null;
  const n = v as number;
  return n >= 1000 ? Math.round(n).toLocaleString("en-US") : Number(n.toPrecision(4));
}

/**
 * Turn a composed skill's raw tool results into flat, rounded, model-readable
 * lines. This is what a 350M/1.2B actually answers from: the raw tool JSON
 * (20-digit floats, nested arrays) is what they give up on. The digest keeps
 * the exact fields the venue reports and labels the ones it does not.
 */
export function digestStep(stepId: string, out: unknown): { lines: string[] } {
  const o = out as Record<string, unknown> | null;
  const lines: string[] = [];
  if (!o || typeof o !== "object") return { lines: [`${stepId}: no data`] };

  switch (stepId) {
    case "portfolio.read": {
      const holdings = o.holdings as
        | Array<{ symbol: string; value: number | null; sector: string }>
        | undefined;
      if (!holdings?.length) {
        lines.push(
          `wallet: ${o.message ?? "no holdings cached yet (sync the wallet on the home page)"}`,
        );
        break;
      }
      const total = money(o.total);
      lines.push(`wallet: ~$${total ?? 0} across ${holdings.length} tokens`);
      for (const h of holdings.slice(0, 8)) {
        lines.push(
          `  ${h.symbol}: ${h.value != null ? `$${money(h.value) ?? 0}` : `${h.sector} (unpriced)`}`,
        );
      }
      const slices = o.slices as Array<{ sector: string; share: number }> | undefined;
      if (slices?.length)
        lines.push(
          `baskets: ${slices
            .slice(0, 6)
            .map(
              (s) =>
                `${SECTOR_BY_ID[s.sector as SectorId]?.label ?? s.sector} ${Math.round((s.share ?? 0) * 100)}%`,
            )
            .join(", ")}`,
        );
      break;
    }
    case "portfolio.netWorth": {
      if (o.message) {
        lines.push(`net worth: ${o.message}`);
        break;
      }
      lines.push(
        `net worth: $${money(o.net) ?? 0} (wallet $${money(o.wallet) ?? 0} + venue account equity $${money(o.venueEquity) ?? 0}, incl. uPnL)`,
      );
      break;
    }
    case "portfolio.positions-perps": {
      const trades = (o.trades as Array<Record<string, unknown>> | undefined) ?? [];
      if (!trades.length) {
        lines.push("open perps: none");
      } else {
        lines.push(`open perps: ${trades.length}`);
        // One numbered line per position, every field repeated with either a
        // value or an explicit "not reported by <venue>". Omitting a field is
        // what makes a small model invent it or pull it off the wrong row.
        for (const t of trades.slice(0, 12)) {
          const venue = String(t.venue ?? "?");
          const upnl = money(t.unrealizedPnl);
          const lev = t.leverage != null ? `${t.leverage}x` : `leverage not reported by ${venue}`;
          const margin =
            t.margin != null
              ? `margin $${money(t.margin) ?? 0}`
              : `margin not reported by ${venue}`;
          const liq =
            t.liquidationPrice != null
              ? `liq ${px(t.liquidationPrice)}`
              : `liq not reported by ${venue}`;
          lines.push(
            `  - ${String(t.displaySymbol)} (${venue}) side ${String(t.side)} | size ${px(t.size)} | entry ${px(
              t.entryPrice,
            )} | notional $${money(t.notional) ?? 0} | uPnL ${
              upnl != null ? `${upnl >= 0 ? "+" : "-"}$${Math.abs(upnl)}` : "not reported"
            } | ${lev} | ${margin} | ${liq}`,
          );
        }
      }
      const accounts = (o.accounts as Array<Record<string, unknown>> | undefined) ?? [];
      for (const a of accounts) {
        const eq = money(a.equity);
        const mu = money(a.marginUsed);
        if (eq == null && mu == null) continue;
        lines.push(
          `  ${a.venue} ${a.label}: ${eq != null ? `equity $${eq}` : ""}${mu != null ? ` margin used $${mu}` : ""}`.trim(),
        );
      }
      const gaps = (o.gaps as string[] | undefined) ?? [];
      for (const g of gaps) lines.push(`  note: ${g}`);
      break;
    }
    case "journal.resolve_inbox": {
      // command result: { status, summary, data: { pending, pendingList, ... } }
      const d = (o.data as Record<string, unknown> | undefined) ?? o;
      lines.push(`inbox: ${o.summary ?? `${d.pending ?? 0} pending`}`);
      const list = (d.pendingList as Array<Record<string, unknown>> | undefined) ?? [];
      for (const s of list.slice(0, 6)) {
        lines.push(
          `  ${s.ticker} ${s.side} ${px(s.amount)}${s.venue ? ` on ${s.venue}` : ""}${s.valueUsd != null ? ` ~$${money(s.valueUsd)}` : ""} (${s.date})`,
        );
      }
      break;
    }
    case "signal.coverage": {
      lines.push(`signals: ${o.inbox ?? 0} in inbox, ${o.linked ?? 0} linked of ${o.signals ?? 0}`);
      break;
    }
    default: {
      // generic: keep the raw result but mark it unreadable for the small model
      lines.push(`${stepId}: ${JSON.stringify(out).slice(0, 200)}`);
    }
  }
  return { lines };
}

/**
 * A composed skill's structured result is the flat digest itself: each step's
 * readable lines, keyed by step. The model answers from this (and the card
 * shows it), so raw tool JSON is deliberately not carried — it is the thing
 * small models give up on, and it would bloat the observation.
 */
async function runComposedSkill(
  skill: SkillDef,
): Promise<{ data: Record<string, unknown>; facts: string[] }> {
  const data: Record<string, unknown> = {};
  const facts: string[] = [];
  for (const stepId of skill.tools) {
    const out = await runStep(stepId);
    const { lines } = digestStep(stepId, out);
    data[stepId] = lines;
    facts.push(...lines);
  }
  return { data, facts };
}

export async function runSkill(skillId: string, input: SkillInput = {}): Promise<SkillResult> {
  const skill = SKILL_BY_ID[skillId];
  if (!skill) throw new Error(`unknown skill: ${skillId}`);
  const started = Date.now();

  let data: Record<string, unknown> = {};
  let facts: string[] = [];

  if (skill.composed) {
    const composed = await runComposedSkill(skill);
    data = composed.data;
    facts = composed.facts;
  } else if (skill.id === "motive.performance") {
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
      s.netPnl != null
        ? `Net PnL ${s.netPnl < 0 ? "-" : "+"}$${Math.abs(Math.round(s.netPnl))} across ${s.measuredPnl} venue closes (${s.wins} wins).`
        : "No venue-reported PnL under this motive yet.",
    ];
  } else if (skill.id === "journal.review") {
    const cov = ind.coverageStats();
    const mix = ind.alignmentStats();
    const idx = ind.potIndex();
    data = {
      coverage: cov,
      alignment: mix,
      potScore: idx.score,
      axes: idx.axes.map((a) => ({ id: a.id, score: a.score, weight: a.weight })),
      payoff: idx.payoff,
    };
    const payoffAxis = idx.axes.find((a) => a.id === "payoff");
    facts = [
      `${cov.linked} of ${cov.signals} extracted trades answered, ${cov.inbox} waiting.`,
      `Alignment mix: ${
        Object.entries(mix.buckets)
          .map(([k, v]) => `${k} ${v}`)
          .join(", ") || "nothing answered"
      }.`,
      idx.score != null
        ? `POT index ${idx.score}, execution-weighted.`
        : "POT index not measurable yet.",
      idx.payoff.measured > 0 && payoffAxis?.score != null
        ? `Payoff ${Math.round(payoffAxis.score * 100)}% (50% is break-even) · net ${idx.payoff.net < 0 ? "-" : "+"}$${Math.abs(Math.round(idx.payoff.net))} on ${idx.payoff.measured} closes${
            idx.payoff.intentPremium != null
              ? `, intent premium ${idx.payoff.intentPremium.intentionalNet < 0 ? "-" : "+"}$${Math.abs(Math.round(idx.payoff.intentPremium.intentionalNet))} vs reactive ${idx.payoff.intentPremium.reactiveNet < 0 ? "-" : "+"}$${Math.abs(Math.round(idx.payoff.intentPremium.reactiveNet))}`
              : ""
          }.`
        : "No venue-reported PnL to score payoff yet.",
    ];
  } else if (skill.id === "thesis.review") {
    const id = input.thesisId ?? getDoc().theses[0]?.id;
    if (!id) {
      data = {};
      facts = ["No thesis written yet."];
    } else {
      const s = ind.thesisStats(id);
      const cards = filterCards({ thesisId: id, type: "entry", limit: 10 });
      data = {
        ...s,
        recent: cards.map((c) => ({
          date: c.date,
          ticker: c.ticker,
          motive: c.motive,
          alignment: c.alignment,
          record: c.record,
        })),
      };
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
      .map((t) => ({
        id: t.id,
        title: t.title,
        days: Math.floor((Date.now() - t.updatedAt) / 86_400_000),
      }))
      .filter((t) => t.days >= 30);
    data = { coverage: cov, stale, openTheses: theses.filter((t) => t.status === "open").length };
    facts = [
      `${cov.inbox} trades still unanswered.`,
      stale.length ? `${stale.length} theses untouched for 30+ days.` : "No stale theses.",
    ];
  } else if (skill.id === "capture.tidy") {
    data = { note: input.note ?? "" };
    facts = ["Needs a model: this is a rewrite, not a calculation."];
  } else if (skill.id === "research.web") {
    const query = input.note?.trim() ?? "";
    if (!query) {
      data = { search: [], pages: [] };
      facts = ["No query provided: pass a question to research."];
    } else {
      const searchOut = await TOOL_BY_ID["web.search"]?.run?.({ query, limit: 3 });
      const searchResults =
        (searchOut as { results?: { title: string; url: string; snippet: string }[] })?.results ??
        [];
      let pages: { url: string; title: string; outline: string[]; paragraphs: string[] }[] = [];
      if (searchResults.length > 0) {
        facts = [
          `Searched for "${query}"`,
          `${searchResults.length} results, reading up to 2 pages.`,
        ];
        for (const r of searchResults.slice(0, 2)) {
          try {
            const page = (await TOOL_BY_ID["web.read"]?.run?.({ url: r.url })) as
              | {
                  url: string;
                  title: string;
                  outline?: string[];
                  paragraphs?: string[];
                }
              | undefined;
            if (page) {
              pages.push({
                url: page.url,
                title: page.title,
                outline: page.outline ?? [],
                paragraphs: page.paragraphs ?? [],
              });
              facts.push(
                `Read ${page.title} (${r.url}): ${(page.paragraphs?.[0] ?? "").slice(0, 120)}…`,
              );
            }
          } catch {
            facts.push(`Could not read ${r.url}`);
          }
        }
      } else {
        facts = [`Searched for "${query}" but found no results.`];
      }
      data = { query, search: searchResults, pages };
    }
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
