// Exposure composition — merges the wallet picture with the venue layer.
//
// Three different things stay different things:
//   spot margin balances are holdings (they join the baskets),
//   perp positions are exposure (they never enter net worth or baskets),
//   account equity is money (it enters net worth exactly once).
// Nothing invents a price: venue oracle → quote → null.

import type { Portfolio } from "./portfolio";
import type { Quote } from "./prices";
import { baseSymbol, resolveSector, type SectorId } from "./sectors";
import type { VenueReport } from "./venues/types";

export type HoldingSource = "wallet" | "nado" | "hyperliquid";

export type MergedHolding = {
  /** base symbol, the merge key */
  key: string;
  /** display spelling (wallet spelling wins when both exist) */
  symbol: string;
  name: string;
  amount: number;
  price: number | null;
  value: number | null;
  change24h: number | null;
  sector: SectorId;
  sources: HoldingSource[];
};

export type MergedSlice = {
  sector: SectorId;
  value: number;
  share: number;
  symbols: string[];
};

export type ComposedBaskets = {
  holdings: MergedHolding[];
  slices: MergedSlice[];
  /** wallet + venue spot value */
  total: number;
  walletTotal: number;
  venueSpotTotal: number;
  priced: boolean;
};

/** Wallet holdings + venue spot margin balances, merged per base symbol. */
export function composeBaskets(
  portfolio: Portfolio,
  reports: VenueReport[],
  quotes: Quote[],
  overrides?: Record<string, string> | null,
): ComposedBaskets {
  const quoteBy = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));
  const byKey = new Map<string, MergedHolding>();

  for (const h of portfolio.holdings) {
    const key = baseSymbol(h.symbol);
    byKey.set(key, {
      key,
      symbol: h.symbol,
      name: h.name,
      amount: h.amount,
      price: h.price,
      value: h.value,
      change24h: h.change24h,
      sector: h.sector,
      sources: ["wallet"],
    });
  }

  for (const report of reports) {
    if (report.venueId !== "nado" && report.venueId !== "hyperliquid") continue;
    for (const p of report.positions) {
      if (p.kind !== "spot") continue;
      const amount = p.size ?? 0;
      if (amount === 0) continue;
      const key = baseSymbol(p.symbol);
      const quote = quoteBy.get(key);
      const price = p.markPrice ?? quote?.usd ?? null;
      const value = price != null ? price * amount : null;
      const row = byKey.get(key);
      if (row) {
        row.amount += amount;
        if (value != null) row.value = (row.value ?? 0) + value;
        if (row.price == null && price != null) row.price = price;
        if (row.change24h == null && quote?.change24h != null) row.change24h = quote.change24h;
        if (!row.sources.includes(report.venueId as HoldingSource))
          row.sources.push(report.venueId as HoldingSource);
      } else {
        byKey.set(key, {
          key,
          symbol: p.symbol,
          name: p.label || p.symbol,
          amount,
          price,
          value,
          change24h: quote?.change24h ?? null,
          sector: resolveSector(key, overrides),
          sources: [report.venueId as HoldingSource],
        });
      }
    }
  }

  const holdings = [...byKey.values()].sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  const total = holdings.reduce((sum, h) => sum + (h.value ?? 0), 0);
  const walletTotal = holdings
    .filter((h) => h.sources.includes("wallet"))
    .reduce((sum, h) => sum + (h.value ?? 0), 0);

  const bySector = new Map<SectorId, MergedSlice>();
  for (const h of holdings) {
    if (!h.value) continue;
    const slice = bySector.get(h.sector) ?? { sector: h.sector, value: 0, share: 0, symbols: [] };
    slice.value += h.value;
    if (!slice.symbols.includes(h.symbol)) slice.symbols.push(h.symbol);
    bySector.set(h.sector, slice);
  }
  const slices = Array.from(bySector.values())
    .map((s) => ({ ...s, share: total > 0 ? s.value / total : 0 }))
    .sort((a, b) => b.value - a.value);

  return {
    holdings,
    slices,
    total,
    walletTotal,
    venueSpotTotal: total - walletTotal,
    priced: holdings.some((h) => h.value != null),
  };
}

export type NetWorth = {
  wallet: number;
  /** sum of trading-account equity across venues */
  venueEquity: number;
  net: number;
};

/** Wallet balances + venue account equity. Perp notional is never added. */
export function composeNetWorth(portfolio: Portfolio, reports: VenueReport[]): NetWorth {
  const venueEquity = reports.reduce(
    (sum, r) => sum + (r.accounts ?? []).reduce((s, a) => s + (a.equity ?? 0), 0),
    0,
  );
  return { wallet: portfolio.total, venueEquity, net: portfolio.total + venueEquity };
}

export type ActiveTrade = {
  id: string;
  venue: "nado" | "hyperliquid";
  displaySymbol: string;
  /** base symbol, the fill-history match key */
  base: string;
  side: "long" | "short";
  size: number;
  entryPrice: number | null;
  markPrice: number | null;
  notional: number | null;
  unrealizedPnl: number | null;
  liquidationPrice: number | null;
  leverage: number | null;
  /** margin allocated to the position, when the venue reports one */
  margin: number | null;
  accountLabel: string | null;
};

/** Open perp positions across venues, newest-magnitude first. */
export function perpExposure(reports: VenueReport[]): ActiveTrade[] {
  const trades: ActiveTrade[] = [];
  for (const report of reports) {
    if (report.venueId !== "nado" && report.venueId !== "hyperliquid") continue;
    for (const p of report.positions) {
      if (p.kind !== "perp") continue;
      trades.push({
        id: p.id,
        venue: report.venueId as "nado" | "hyperliquid",
        displaySymbol: p.symbol,
        base: baseSymbol(p.symbol),
        side: p.side === "short" ? "short" : "long",
        size: p.size ?? 0,
        entryPrice: p.entryPrice ?? null,
        markPrice: p.markPrice ?? null,
        notional: p.notionalValue ?? null,
        unrealizedPnl: p.unrealizedPnl ?? null,
        liquidationPrice: p.liquidationPrice ?? null,
        leverage: p.leverage ?? null,
        margin: p.marginUsed ?? null,
        accountLabel: (p.metadata?.account as string) || (p.metadata?.subaccount as string) || null,
      });
    }
  }
  return trades.sort((a, b) => (b.notional ?? 0) - (a.notional ?? 0));
}

/** Venue symbols a spot read could not price and the wallet quotes don't cover. */
export function unpricedVenueSymbols(reports: VenueReport[], quotes: Quote[]): string[] {
  const have = new Set(quotes.map((q) => q.symbol.toUpperCase()));
  const out = new Set<string>();
  for (const r of reports) {
    for (const p of r.positions) {
      if (p.kind !== "spot" || p.markPrice != null) continue;
      const key = baseSymbol(p.symbol);
      if (!have.has(key)) out.add(key);
    }
  }
  return [...out];
}
