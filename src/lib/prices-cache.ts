// Stale-price cache — IndexedDB wrapper so the UI never sees a blank price.
// Same store / pattern as src/lib/cache/idb.ts, but with a TTL so cache-only
// prices don't grow indefinitely stale.

import { idbGet, idbSet } from "./cache/idb";

// Prices refresh every ~3 min; 60s only dedupes simultaneous queries
// (portfolio + baskets) while keeping alert checks on fresh data.
const CACHE_TTL = 60_000;

export type CachedQuotes = {
  quotes: { symbol: string; usd: number; change24h: number | null }[];
  cachedAt: number;
  version: "explorer" | "hyperliquid" | "coingecko" | "fallback";
};

function cacheKey(symbols: string[]): string {
  return `quotes:${symbols.sort().join(",")}`;
}

export async function readQuotesCache(symbols: string[]): Promise<CachedQuotes | null> {
  const key = cacheKey(symbols);
  const data = await idbGet<CachedQuotes>(key);
  if (!data) return null;
  return data;
}

export async function writeQuotesCache(
  symbols: string[],
  quotes: CachedQuotes["quotes"],
  version: CachedQuotes["version"],
): Promise<void> {
  const key = cacheKey(symbols);
  await idbSet(key, { quotes, cachedAt: Date.now(), version });
}

/** Return cached quotes if they exist and are fresh (within TTL). */
export async function freshCachedQuotes(symbols: string[]): Promise<CachedQuotes | null> {
  const cached = await readQuotesCache(symbols);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > CACHE_TTL) return null;
  return cached;
}

/** Return cached quotes even if stale — better than nothing. */
export async function staleCachedQuotes(symbols: string[]): Promise<CachedQuotes | null> {
  return readQuotesCache(symbols);
}
