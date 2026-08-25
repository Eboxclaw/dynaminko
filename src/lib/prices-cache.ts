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

/**
 * The rolling, symbol-agnostic price map under a single key. The per-symbol
 * caches above are keyed by the exact requested set (and expire in 60s), so a
 * reader that does not know the set in advance — the agent's portfolio and
 * FACTS paths — has no key to read. `quotes:latest` fixes that: every quote
 * the pipeline resolves is upserted here, so a later read always finds the
 * freshest known price per symbol, even one symbol at a time. This is the
 * source the deterministic portfolio commands and the FACTS enrichment price
 * against; without it those paths silently fell back to on-chain USD (which
 * is null for Ink-native tokens) and reported unpriced holdings.
 */
export async function mergeLatestQuotes(
  incoming: { symbol: string; usd: number; change24h: number | null }[],
): Promise<void> {
  const key = "quotes:latest";
  const existing = (await idbGet<{ symbol: string; usd: number; change24h: number | null }[]>(
    key,
  )) ?? [];
  const map = new Map(existing.map((q) => [q.symbol.toUpperCase(), q]));
  for (const q of incoming) {
    if (q.usd == null || !q.symbol) continue;
    map.set(q.symbol.toUpperCase(), q);
  }
  await idbSet(key, [...map.values()]);
}

/** Return cached quotes even if stale — better than nothing. */
export async function staleCachedQuotes(symbols: string[]): Promise<CachedQuotes | null> {
  return readQuotesCache(symbols);
}
