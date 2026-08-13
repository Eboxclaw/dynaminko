// Journal commands. Collect → aggregate → compact result.
//
// The model never walks the journal card by card: one command aggregates
// everything and hands back counts plus a couple of examples.

import { addEntry, getDoc, type Alignment, type Sentiment } from "@/lib/store";
import { buildIndex, filterCards, searchCards } from "@/lib/tools/journal";
import * as ind from "@/lib/tools/indicators";

import { failed, needsInput, ok, type CommandContext, type CommandResult } from "./types";

const FIELDS = ["thesis", "motive", "alignment", "sizing", "emotion"] as const;
type Field = (typeof FIELDS)[number];

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Which of the five reconciliation answers a card is still missing. */
function missingFor(card: { thesisId: string | null; motive: unknown; alignment: unknown; size: unknown; type: string }): Field[] {
  const out: Field[] = [];
  if (!card.thesisId) out.push("thesis");
  if (!card.motive) out.push("motive");
  if (!card.alignment) out.push("alignment");
  if (!card.size) out.push("sizing");
  return out;
}

export function resolveInbox(args: Record<string, unknown>, ctx: CommandContext): CommandResult {
  const id = "journal.resolve_inbox";
  const ticker = str(args.ticker)?.toUpperCase() ?? null;
  const tradeId = str(args.tradeId);
  const limit = typeof args.limit === "number" ? args.limit : 200;

  const index = buildIndex();
  ctx.count();
  const doc = getDoc();
  const dismissed = new Set(doc.settings.dismissedTrades);

  let pending = index.cards.filter(
    (c) => c.type === "signal" && c.state !== "linked" && !dismissed.has(c.id),
  );
  ctx.count();
  if (ticker) pending = pending.filter((c) => c.ticker === ticker);
  if (tradeId) pending = pending.filter((c) => c.id === tradeId);
  pending = pending.slice(0, limit);

  // The answers the user could give apply to whole groups, so aggregate them.
  const entryFields = filterCards({ type: "entry", limit: 500 }, index);
  ctx.count();
  const missing: Record<string, number> = {};
  for (const card of entryFields) {
    if (card.state !== "ghost" && card.thesisId && card.motive && card.alignment) continue;
    for (const f of missingFor(card)) missing[f] = (missing[f] ?? 0) + 1;
  }

  const data = {
    ticker,
    matched: pending.length,
    pending: pending.length,
    missing,
    topExamples: pending.slice(0, 5).map((c) => ({
      id: c.id,
      ticker: c.ticker,
      date: new Date(c.date).toISOString().slice(0, 10),
      record: c.record,
    })),
  };

  if (pending.length === 0 && Object.keys(missing).length === 0) {
    return ok(id, data, "Nothing pending — the inbox is clear.");
  }
  return needsInput(
    id,
    data,
    `${pending.length} trades pending${ticker ? ` for ${ticker}` : ""}` +
      (Object.keys(missing).length
        ? `; missing ${Object.entries(missing)
            .map(([k, v]) => `${k} ×${v}`)
            .join(", ")}`
        : ""),
    { requiresUser: true, reason: "one grouped answer can resolve many records" },
  );
}

/**
 * Batch write: one answer applied to every matching pending trade. This is the
 * mutation path — the model proposes it, the executor performs it once.
 */
export function applyAnswer(args: Record<string, unknown>, ctx: CommandContext): CommandResult {
  const id = "journal.apply_answer";
  const reason = str(args.reason);
  if (!reason) return failed(id, "invalid_arguments", "reason is required");
  const ticker = str(args.ticker)?.toUpperCase() ?? null;
  const motive = str(args.motive) as Sentiment | null;
  const alignment = str(args.alignment) as Alignment | null;
  const thesisId = str(args.thesisId);
  const limit = typeof args.limit === "number" ? args.limit : 50;

  const index = buildIndex();
  ctx.count();
  const dismissed = new Set(getDoc().settings.dismissedTrades);
  const pending = index.cards
    .filter((c) => c.type === "signal" && c.state !== "linked" && !dismissed.has(c.id))
    .filter((c) => !ticker || c.ticker === ticker)
    .slice(0, limit);

  if (pending.length === 0) return ok(id, { written: 0 }, "No pending trade matched.");

  for (const card of pending) {
    addEntry({
      tradeId: card.id,
      thesisId,
      headline: `${card.ticker ?? "trade"} — ${reason}`,
      body: reason,
      sentiment: motive,
      alignment,
      ghost: false,
    });
    ctx.count();
  }
  return ok(
    id,
    { written: pending.length, ticker },
    `Resolved ${pending.length} trade${pending.length === 1 ? "" : "s"}.`,
  );
}

export function reviewTrade(args: Record<string, unknown>, ctx: CommandContext): CommandResult {
  const id = "journal.review_trade";
  const key = str(args.tradeId) ?? str(args.id);
  if (!key) return failed(id, "invalid_arguments", "tradeId is required");
  const card = buildIndex().cards.find((c) => c.id === key || c.tradeId === key);
  ctx.count();
  if (!card) return failed(id, "not_found", `no journal card for ${key}`);
  return ok(
    id,
    {
      id: card.id,
      ticker: card.ticker,
      date: new Date(card.date).toISOString().slice(0, 10),
      motive: card.motive,
      alignment: card.alignment,
      sizing: card.size,
      thesisId: card.thesisId,
      value: card.value,
      record: card.record,
      missing: missingFor(card),
    },
    `${card.ticker ?? "trade"} · ${card.state}`,
  );
}

export function reviewThesis(args: Record<string, unknown>, ctx: CommandContext): CommandResult {
  const id = "journal.review_thesis";
  const doc = getDoc();
  const query = str(args.thesisId) ?? str(args.title);
  const thesis =
    doc.theses.find((t) => t.id === query) ??
    (query ? doc.theses.find((t) => t.title.toLowerCase().includes(query.toLowerCase())) : doc.theses[0]);
  if (!thesis) return failed(id, "not_found", "no thesis matched");
  const stats = ind.thesisStats(thesis.id);
  ctx.count();
  const recent = filterCards({ thesisId: thesis.id, limit: 8 });
  ctx.count();
  return ok(
    id,
    {
      id: thesis.id,
      title: thesis.title,
      status: thesis.status,
      symbols: thesis.symbols,
      ...stats,
      recent: recent.map((c) => ({
        date: new Date(c.date).toISOString().slice(0, 10),
        ticker: c.ticker,
        alignment: c.alignment,
        record: c.record.slice(0, 120),
      })),
    },
    `"${thesis.title}" — ${stats.entries} entries, ${stats.trades} trades.`,
  );
}

export function searchJournal(args: Record<string, unknown>, ctx: CommandContext): CommandResult {
  const id = "journal.search";
  const query = str(args.query);
  if (!query) return failed(id, "invalid_arguments", "query is required");
  const limit = typeof args.limit === "number" ? args.limit : 8;
  const hits = searchCards(query, limit);
  ctx.count();
  return ok(
    id,
    {
      query,
      matched: hits.length,
      cards: hits.map((c) => ({
        id: c.id,
        ticker: c.ticker,
        date: new Date(c.date).toISOString().slice(0, 10),
        record: c.record.slice(0, 160),
      })),
    },
    `${hits.length} match${hits.length === 1 ? "" : "es"} for "${query}".`,
  );
}
