// Live price overlay. The curated ASSETS fixture ships with indicative
// prices; whenever a real quote arrives (CoinGecko via /api/public-data, or
// the Ink explorer's own exchange rate) we overwrite the fixture value in
// place so every consumer — diamond, exposure bars, balances, CLOB ticket —
// reads live numbers without threading a price prop through the whole tree.

import { ASSETS } from "./dynaminko-data";

export type Quote = { usd: number | null; change24h?: number | null };

const live = new Set<string>();

export function applyLivePrices(quotes: Record<string, Quote>): number {
  let applied = 0;
  for (const asset of ASSETS) {
    const q = quotes[asset.ticker];
    if (!q || q.usd == null || !Number.isFinite(q.usd) || q.usd <= 0) continue;
    asset.price = q.usd;
    if (q.change24h != null && Number.isFinite(q.change24h)) asset.change24h = q.change24h;
    live.add(asset.ticker);
    applied++;
  }
  return applied;
}

/** True when this ticker's price came from a real feed this session. */
export function isLivePrice(ticker: string): boolean {
  return live.has(ticker);
}

export function livePriceCount(): number {
  return live.size;
}
