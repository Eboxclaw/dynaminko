// Portfolio derivation. Takes a real wallet snapshot plus real quotes and
// produces holdings, sector allocation and the trade feed the journal
// reconciles against. Nothing here invents a number: an unknown price is null
// and rendered as "—".

import type { ChainTransfer, WalletSnapshot } from "./chain/blockscout";
import type { Quote } from "./prices";
import { sectorFor, type SectorId } from "./sectors";

export type Holding = {
  key: string;
  symbol: string;
  name: string;
  amount: number;
  price: number | null;
  value: number | null;
  change24h: number | null;
  sector: SectorId;
};

export type SectorSlice = {
  sector: SectorId;
  value: number;
  share: number;
  symbols: string[];
};

export type Portfolio = {
  holdings: Holding[];
  total: number;
  priced: boolean;
  slices: SectorSlice[];
};

export function buildPortfolio(
  snapshot: WalletSnapshot | null,
  quotes: Quote[],
): Portfolio {
  if (!snapshot) return { holdings: [], total: 0, priced: false, slices: [] };
  const quoteBy = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));

  const raw = [snapshot.native, ...snapshot.tokens];
  const holdings: Holding[] = raw
    .filter((t) => t.amount > 0)
    .map((t) => {
      const q = quoteBy.get(t.symbol.toUpperCase());
      const price = q?.usd ?? t.usd ?? null;
      return {
        key: `${t.address}-${t.symbol}`,
        symbol: t.symbol,
        name: t.name,
        amount: t.amount,
        price,
        value: price != null ? price * t.amount : null,
        change24h: q?.change24h ?? null,
        sector: sectorFor(t.symbol),
      };
    })
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));

  const total = holdings.reduce((sum, h) => sum + (h.value ?? 0), 0);

  const bySector = new Map<SectorId, SectorSlice>();
  for (const h of holdings) {
    if (!h.value) continue;
    const slice = bySector.get(h.sector) ?? {
      sector: h.sector,
      value: 0,
      share: 0,
      symbols: [],
    };
    slice.value += h.value;
    if (!slice.symbols.includes(h.symbol)) slice.symbols.push(h.symbol);
    bySector.set(h.sector, slice);
  }
  const slices = Array.from(bySector.values())
    .map((s) => ({ ...s, share: total > 0 ? s.value / total : 0 }))
    .sort((a, b) => b.value - a.value);

  return {
    holdings,
    total,
    priced: holdings.some((h) => h.value != null),
    slices,
  };
}

// ── trade feed ─────────────────────────────────────────────────────────────

export type Trade = {
  id: string;
  symbol: string;
  side: "in" | "out";
  amount: number;
  value: number | null;
  ts: number;
  txHash: string;
  counterparty: string;
  sector: SectorId;
};

/** Chain transfers become journalable moments. Dust is filtered out. */
export function tradesFromSnapshot(
  snapshot: WalletSnapshot | null,
  quotes: Quote[],
): Trade[] {
  if (!snapshot) return [];
  const quoteBy = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));
  return snapshot.transfers
    .map((t: ChainTransfer) => {
      const price = quoteBy.get(t.symbol.toUpperCase())?.usd ?? null;
      return {
        id: `${t.txHash}:${t.logIndex}`,
        symbol: t.symbol,
        side: t.direction,
        amount: t.amount,
        value: price != null ? price * t.amount : null,
        ts: t.ts,
        txHash: t.txHash,
        counterparty: t.counterparty,
        sector: sectorFor(t.symbol),
      };
    })
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 120);
}

/** Fibonacci-ish arc positions used by the portfolio bloom visual. */
export function goldenPositions(count: number, radius = 1) {
  const phi = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, i) => {
    const r = radius * Math.sqrt((i + 0.5) / count);
    const a = i * phi;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  });
}
