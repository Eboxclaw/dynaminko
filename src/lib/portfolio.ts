// Turns raw chain snapshots into the shapes the existing UI already speaks:
// a positions map (ticker -> qty) plus a list of real on-chain holdings that
// aren't in the curated ASSETS fixture.

import { ASSETS } from "./dynaminko-data";
import type { TokenBalance, WalletSnapshot } from "./chain/blockscout";

export type Holding = {
  symbol: string;
  name: string;
  amount: number;
  usd: number | null;
  address: string;
  walletIds: string[];
};

const TICKER_BY_SYMBOL = new Map(ASSETS.map((a) => [a.ticker.toUpperCase(), a.ticker]));

function matchTicker(symbol: string): string | null {
  return TICKER_BY_SYMBOL.get(symbol.trim().toUpperCase()) ?? null;
}

/** Aggregate every visible wallet's balances into one holdings list. */
export function holdingsFromSnapshots(snapshots: WalletSnapshot[]): Holding[] {
  const merged = new Map<string, Holding>();
  const add = (walletId: string, t: TokenBalance) => {
    if (t.amount <= 0) return;
    const key = t.address || t.symbol;
    const prev = merged.get(key);
    if (prev) {
      prev.amount += t.amount;
      if (!prev.walletIds.includes(walletId)) prev.walletIds.push(walletId);
      if (prev.usd == null) prev.usd = t.usd;
    } else {
      merged.set(key, {
        symbol: t.symbol,
        name: t.name,
        amount: t.amount,
        usd: t.usd,
        address: t.address,
        walletIds: [walletId],
      });
    }
  };
  for (const s of snapshots) {
    add(s.walletId, s.native);
    for (const t of s.tokens) add(s.walletId, t);
  }
  return Array.from(merged.values()).sort(
    (a, b) => (b.usd ?? 0) * b.amount - (a.usd ?? 0) * a.amount,
  );
}

/** Positions map for the curated asset universe. Returns null when empty. */
export function positionsFromSnapshots(
  snapshots: WalletSnapshot[],
): Record<string, number> | null {
  if (snapshots.length === 0) return null;
  const out: Record<string, number> = {};
  for (const a of ASSETS) out[a.ticker] = 0;
  let any = false;
  for (const h of holdingsFromSnapshots(snapshots)) {
    const ticker = matchTicker(h.symbol);
    if (!ticker) continue;
    out[ticker] = (out[ticker] ?? 0) + h.amount;
    any = true;
  }
  return any ? out : out; // an all-zero map is an honest "nothing held"
}

/** Explorer-reported spot prices keyed by ticker, for known assets. */
export function pricesFromSnapshots(snapshots: WalletSnapshot[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const h of holdingsFromSnapshots(snapshots)) {
    const ticker = matchTicker(h.symbol);
    if (ticker && h.usd != null && h.usd > 0) out[ticker] = h.usd;
  }
  return out;
}

/** Total USD across every holding the chain reported a price for. */
export function holdingsTotalUsd(holdings: Holding[]): number {
  return holdings.reduce((s, h) => s + (h.usd ?? 0) * h.amount, 0);
}
