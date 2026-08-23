// A compact digest of the journal, handed to the model instead of the journal.
// Everything deeper is fetched on demand by a tool call.

import { getDoc, memoryStats } from "@/lib/store";
import * as ind from "@/lib/tools/indicators";

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
  for (const s of doc.signals) {
    const ticker = s.symbol.toUpperCase();
    byTicker.set(ticker, (byTicker.get(ticker) ?? 0) + 1);
    const venue = s.venue === "nado" || s.venue === "hyperliquid" ? s.venue : "ink";
    byVenue.set(venue, (byVenue.get(venue) ?? 0) + 1);
    if (s.meta?.pnl != null) withPnl += 1;
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
      lines.push(`sectors: ${portfolio.slices.length} baskets`);
    }

    if (netWorth.net > 0) {
      lines.push(`net_worth: $${Math.round(netWorth.net)} (wallet $${Math.round(netWorth.wallet)} + venues $${Math.round(netWorth.venueEquity)})`);
    }

    if (perps.length > 0) {
      lines.push(`open_positions: ${perps.length} open perps across ${new Set(perps.map((p) => p.venue)).size} venues`);
      lines.push(`top_positions: ${perps.slice(0, 3).map((p) => `${p.displaySymbol} ${p.side} $${Math.round(p.notional ?? 0)}`).join(" · ")}`);
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
