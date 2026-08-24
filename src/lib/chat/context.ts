// A compact digest of the journal, handed to the model instead of the journal.
// Everything deeper is fetched on demand by a tool call.

import { getDoc, memoryStats } from "@/lib/store";
import * as ind from "@/lib/tools/indicators";
import { SECTOR_BY_ID } from "@/lib/sectors";

export type Digest = {
  wallet: string | null;
  signals: number;
  inbox: number;
  entries: number;
  theses: number;
  potScore: number | null;
  openTheses: string[];
  /** top tickers by extracted trade count */
  topTickers: { ticker: string; count: number }[];
  /** extracted trades per venue; "ink" is how the app labels the plain EVM venue */
  venueTrades: { venue: string; count: number }[];
  /** signals whose venue reported a realized pnl */
  tradesWithVenuePnl: number;
  /** sum of venue-reported realized pnl, plus how many were winners */
  realizedPnl: { net: number | null; wins: number; measured: number };
  /** entry counts per investment motive */
  sentiments: { motive: string; count: number }[];
  /** agent memory capacity, so the model sees how full it is before writing */
  memory: { chars: number; limit: number; entries: number };
};

export function digest(): Digest {
  const doc = getDoc();
  const cov = ind.coverageStats();
  const idx = ind.potIndex();
  // One pass over the signals: per-ticker counts, per-venue counts (a signal
  // with no venue is a plain wallet transfer, bucketed with ink), and how many
  // carry a venue-measured pnl. These feed FACTS so "most traded ticker"
  // answers with zero tool hops.
  const byTicker = new Map<string, number>();
  const byVenue = new Map<string, number>();
  let withPnl = 0;
  let pnlNet = 0;
  let pnlWins = 0;
  let pnlMeasured = 0;
  for (const s of doc.signals) {
    const ticker = s.symbol.toUpperCase();
    byTicker.set(ticker, (byTicker.get(ticker) ?? 0) + 1);
    const venue = s.venue === "nado" || s.venue === "hyperliquid" ? s.venue : "ink";
    byVenue.set(venue, (byVenue.get(venue) ?? 0) + 1);
    const pnl = s.meta?.pnl;
    if (pnl != null) {
      withPnl += 1;
      pnlMeasured += 1;
      pnlNet += pnl;
      if (pnl > 0) pnlWins += 1;
    }
  }
  // One pass over entries: motive (investment-sentiment) counts so
  // "how often do I trade on conviction" answers without a tool hop.
  const byMotive = new Map<string, number>();
  for (const e of doc.entries) {
    if (e.sentiment) byMotive.set(e.sentiment, (byMotive.get(e.sentiment) ?? 0) + 1);
  }
  const rank = (m: Map<string, number>) =>
    [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  return {
    wallet: doc.activeWallet,
    signals: doc.signals.length,
    inbox: cov.inbox,
    entries: doc.entries.length,
    theses: doc.theses.length,
    potScore: idx.score != null ? Math.round(idx.score * 100) : null,
    openTheses: doc.theses
      .filter((t) => t.status === "open")
      .slice(0, 8)
      .map((t) => t.title),
    topTickers: rank(byTicker)
      .slice(0, 3)
      .map(({ key, count }) => ({ ticker: key, count })),
    venueTrades: rank(byVenue).map(({ key, count }) => ({ venue: key, count })),
    tradesWithVenuePnl: withPnl,
    realizedPnl: {
      net: pnlMeasured > 0 ? pnlNet : null,
      wins: pnlWins,
      measured: pnlMeasured,
    },
    sentiments: rank(byMotive)
      .slice(0, 5)
      .map(({ key, count }) => ({ motive: key, count })),
    memory: memoryStats(),
  };
}

export function digestLine(d = digest()): string {
  return [
    d.wallet ? `wallet ${d.wallet}` : "no wallet watched",
    `${d.entries} entries`,
    `${d.signals} extracted trades (${d.inbox} unanswered)`,
    `${d.theses} theses`,
    d.potScore != null ? `POT ${d.potScore}` : "POT not measurable",
    d.openTheses.length ? `open: ${d.openTheses.join("; ")}` : "no open thesis",
  ].join(" · ");
}

/** ~4 characters per token is close enough for a budget check. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * The state as labeled fact lines. Small models invent numbers when counts
 * float unlabeled inside prose; one `key: value` line per fact, nothing else,
 * plus a hard rule in CORE that numbers may only come from these lines.
 */
export function factLines(d = digest()): string {
  return [
    `wallet: ${d.wallet ?? "none watched"}`,
    `entries: ${d.entries}`,
    `extracted_trades: ${d.signals}`,
    `unanswered_trades: ${d.inbox}`,
    `theses: ${d.theses}`,
    `open_theses: ${d.openTheses.length ? d.openTheses.join("; ") : "none"}`,
    `pot_score: ${d.potScore != null ? d.potScore : "not measurable yet"}`,
    `top_tickers: ${
      d.topTickers.length ? d.topTickers.map((t) => `${t.ticker} x${t.count}`).join(", ") : "none"
    }`,
    `venue_trades: ${
      d.venueTrades.length ? d.venueTrades.map((v) => `${v.venue} ${v.count}`).join(", ") : "none"
    }`,
    d.realizedPnl.measured > 0
      ? `realized_pnl: ${d.realizedPnl.net! >= 0 ? "+" : "-"}$${Math.round(
          Math.abs(d.realizedPnl.net!),
        )} over ${d.realizedPnl.measured} measured trades (${d.realizedPnl.wins} winners)`
      : `realized_pnl: not measured yet (no venue-reported pnl)`,
    `sentiments: ${
      d.sentiments.length ? d.sentiments.map((s) => `${s.motive} ${s.count}`).join(" · ") : "none"
    }`,
    `trades_with_venue_pnl: ${d.tradesWithVenuePnl}`,
    `memory: ${d.memory.entries ? `${d.memory.chars}/${d.memory.limit} chars · ${d.memory.entries} notes` : `empty (0/${d.memory.limit} chars)`}`,
  ].join("\n");
}

/**
 * Async enrichment of FACTS with live portfolio data from the IDB cache.
 * Called once per turn before buildTurn; the lines merge straight into the
 * `state` field so the model sees wallet holdings, net worth and open perps
 * without needing a tool hop. When cache is cold the lines are absent
 * (the FACTS numbers from factLines() still describe signal-history data).
 */
export async function portfolioFactLines(): Promise<string> {
  try {
    const { readCachedSnapshot, readCachedVenueReports } = await import("@/lib/store");
    const { buildPortfolio } = await import("@/lib/portfolio");
    const { composeNetWorth, perpExposure } = await import("@/lib/exposure");

    const snapshot = await readCachedSnapshot();
    const reports = await readCachedVenueReports();

    if (!snapshot) return "";

    const portfolio = buildPortfolio(snapshot, []);
    const netWorth = composeNetWorth(portfolio, reports);
    const perps = perpExposure(reports);

    const lines: string[] = [];

    if (portfolio.holdings.length > 0) {
      lines.push(`wallet_holdings: ${portfolio.holdings.length} tokens · $${Math.round(portfolio.total)}`);
      // Per-token value so "how much BTC do I hold" answers without a tool hop.
      // Top 5 by value, 24h change only when a quote reported one.
      lines.push(
        `top_holdings: ${portfolio.holdings
          .slice(0, 5)
          .map((h) =>
            h.value != null
              ? `${h.symbol} $${Math.round(h.value)}${h.change24h != null ? ` (${h.change24h >= 0 ? "+" : ""}${h.change24h.toFixed(1)}%)` : ""}`
              : `${h.symbol} ${h.amount}`,
          )
          .join(" · ")}`,
      );
      lines.push(
        `baskets: ${portfolio.slices
          .slice(0, 4)
          .map((s) => `${SECTOR_BY_ID[s.sector].label} ${Math.round(s.share * 100)}%`)
          .join(" · ") || "unsorted"}`,
      );
    }

    if (netWorth.net > 0) {
      lines.push(`net_worth: $${Math.round(netWorth.net)} (wallet $${Math.round(netWorth.wallet)} + venues $${Math.round(netWorth.venueEquity)})`);
    }

    if (perps.length > 0) {
      lines.push(`open_positions: ${perps.length} open perps across ${new Set(perps.map((p) => p.venue)).size} venues`);
      // PnL per position rides along so "which position is down" needs no hop.
      lines.push(
        `top_positions: ${perps
          .slice(0, 3)
          .map((p) => `${p.displaySymbol} ${p.side} $${Math.round(p.notional ?? 0)}${p.unrealizedPnl != null ? ` (${p.unrealizedPnl >= 0 ? "+" : "-"}$${Math.round(Math.abs(p.unrealizedPnl))})` : ""}`)
          .join(" · ")}`,
      );
      const known = perps.filter((p) => p.unrealizedPnl != null);
      if (known.length > 0) {
        const total = known.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);
        lines.push(`unrealized_pnl: ${total >= 0 ? "+" : "-"}$${Math.round(Math.abs(total))} on ${known.length} measured perps`);
      }
    }

    const venueSpots = reports
      .flatMap((r) => r.positions ?? [])
      .filter((p) => p.kind === "spot");
    if (venueSpots.length > 0) {
      const totalSpot = venueSpots.reduce((s, p) => s + ((p.markPrice ?? 0) * (p.size ?? 0)), 0);
      lines.push(`venue_spots: ${venueSpots.length} spot positions · $${Math.round(totalSpot)}`);
    }

    return lines.join("\n");
  } catch {
    return "";
  }
}
