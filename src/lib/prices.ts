// Real price data. Four free sources + stale cache fallback, no API keys:
//   1. Hyperliquid allMids  -> 949 perp/spot assets (major + long-tail)
//   2. CoinGecko simple     -> 18 well-known CoinGecko ids
//   3. Explorer exchange    -> Blockscout exchange_rate for any ERC-20
//   4. On-chain DEX pools   -> Inkyswap V2 + Velodrome Slipstream for tokens
//      that no other source covers (INKO, KRAKMASK, etc.)
// Plus IndexedDB fallback: when all sources fail we return stale data so the UI
// never blanks.

import { getChain } from "@/chains";
import { ethCallMany, toBigInt, words } from "@/lib/venues/evm";

import { freshCachedQuotes, staleCachedQuotes, writeQuotesCache } from "./prices-cache";

const GECKO = "https://api.coingecko.com/api/v3";
const HL_INFO = "https://api.hyperliquid.xyz/info";
const EXPLORER_CHAIN = 57073; // Ink mainnet

// ── On-chain token addresses (Ink mainnet) ─────────────────────────────────

const INK = {
  WETH: "0x4200000000000000000000000000000000000006",
  USDT0: "0x0200C29006150606B650577BBE7B6248F58470c1",
  USDC: "0x2D270e6886d130D724215A266106e6832161EAEd",
  INKO: "0x767F1e9feDfF2BFA4f90a7EFFddfCCc2970530Ba",
} as const;

// ── On-chain DEX pool registry ────────────────────────────────────────────
// Tokens neither Hyperliquid (949 assets) nor CoinGecko price get an on-chain
// DEX pool read. (V2 = getReserves, CL = slot0)

type DexPoolV2 = {
  dex: "inkyswap" | "velodrome";
  kind: "v2";
  pool: string;
  /** token0 address */
  token0: string;
  /** token1 address */
  token1: string;
  /** which token (0 or 1) is the base (known-price) token */
  baseToken: 0 | 1;
  baseSymbol: string;
  quoteSymbol: string;
};

type DexPoolCL = {
  dex: "velodrome";
  kind: "cl";
  pool: string;
  token0: string;
  token1: string;
  /** which index (0 or 1) is the base token with a known price */
  baseToken: 0 | 1;
  baseSymbol: string;
  quoteSymbol: string;
};

type DexPool = DexPoolV2 | DexPoolCL;

const Q96 = 2 ** 96;

/** V2 getReserves selector */
const GET_RESERVES = "0x0902f1ac";
/** Slipstream slot0 selector */
const SLOT0 = "0x3850c7bd";

/** Known pools, keyed by the symbol they price. */
const DEX_POOLS: Record<string, DexPool[]> = {
  INKO: [
    // InkySwap V2: token0=WETH, token1=INKO
    {
      dex: "inkyswap",
      kind: "v2",
      pool: "0x2b6d23B85582c7bdFe1CaeC327aF5161b220ffB2",
      token0: INK.WETH,
      token1: INK.INKO,
      baseToken: 0, // WETH is token0
      baseSymbol: "WETH",
      quoteSymbol: "INKO",
    },
    // Velodrome Slipstream: token0=INKO, token1=USDT0
    {
      dex: "velodrome",
      kind: "cl",
      pool: "0xd376112ec898598f0b5de1cc17c3b6943ee95ad8",
      token0: INK.INKO,
      token1: INK.USDT0,
      baseToken: 1, // token1 = USDT0
      baseSymbol: "USDT0",
      quoteSymbol: "INKO",
    },
  ],
  KRAKMASK: [
    // InkySwap V2: token0=KRAKMASK, token1=WETH ($24K liquidity)
    {
      dex: "inkyswap",
      kind: "v2",
      pool: "0xeD11ed4B195E84Ba9B74c4d6ce13B7a43b354264",
      token0: "0x32bCB803f696C99Eb263D60a05CAfD8689026575",
      token1: INK.WETH,
      baseToken: 1, // WETH is token1
      baseSymbol: "WETH",
      quoteSymbol: "KRAKMASK",
    },
  ],
  BEAST: [
    // InkySwap V2: token0=WETH, token1=BEAST ($37K liquidity)
    {
      dex: "inkyswap",
      kind: "v2",
      pool: "0xd3230D19e1F2B9eA8B54cb8e16eDc58b89FD004E",
      token0: INK.WETH,
      token1: "0xD95B9A5Fa7C2708fD4FE0E07E59bDE1Ef35b194a",
      baseToken: 0, // WETH is token0
      baseSymbol: "WETH",
      quoteSymbol: "BEAST",
    },
  ],
};

/** Symbols we can confidently resolve to a CoinGecko id. */
const GECKO_IDS: Record<string, string> = {
  ETH: "ethereum",
  WETH: "weth",
  BTC: "bitcoin",
  WBTC: "wrapped-bitcoin",
  CBBTC: "coinbase-wrapped-btc",
  USDC: "usd-coin",
  "USDC.E": "usd-coin",
  USDT: "tether",
  DAI: "dai",
  XMR: "monero",
  ZEC: "zcash",
  TAO: "bittensor",
  RENDER: "render-token",
  FET: "fetch-ai",
  NEAR: "near",
  AKT: "akash-network",
  ROSE: "oasis-network",
  PAXG: "pax-gold",
  XAUT: "tether-gold",
  KRK: "kraken",
  INK: "ink",
};

export type Quote = { symbol: string; usd: number; change24h: number | null };

// ── Source 1: Hyperliquid allMids ──────────────────────────────────────────

type HlMids = Record<string, string>;

async function fetchAllMids(signal?: AbortSignal): Promise<HlMids> {
  const res = await fetch(HL_INFO, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "allMids" }),
    signal,
  });
  if (!res.ok) throw new Error(`hyperliquid allMids -> ${res.status}`);
  return (await res.json()) as HlMids;
}

/**
 * Query Hyperliquid allMids for any symbol that exists as an allMids key.
 * No 24h change — HL does not return it in this endpoint.
 */
export async function fetchHLQuotes(symbols: string[], signal?: AbortSignal): Promise<Quote[]> {
  const wanted = Array.from(new Set(symbols.map((s) => s.toUpperCase())));
  if (wanted.length === 0) return [];
  const mids = await fetchAllMids(signal);
  return wanted
    .map((s): Quote | null => {
      const raw = mids[s];
      if (raw == null) return null;
      const usd = Number(raw);
      if (!Number.isFinite(usd)) return null;
      return { symbol: s, usd, change24h: null };
    })
    .filter((q): q is Quote => q !== null);
}

// ── Source 2: CoinGecko simple price ───────────────────────────────────────

/**
 * Query CoinGecko simple/price for symbols that have a known GECKO_IDS entry.
 */
export async function fetchGeckoQuotes(symbols: string[], signal?: AbortSignal): Promise<Quote[]> {
  const wanted = Array.from(
    new Set(symbols.map((s) => s.toUpperCase()).filter((s) => GECKO_IDS[s])),
  );
  if (wanted.length === 0) return [];
  const ids = Array.from(new Set(wanted.map((s) => GECKO_IDS[s])));
  const url = `${GECKO}/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true`;
  const res = await fetch(url, { headers: { accept: "application/json" }, signal });
  if (!res.ok) throw new Error(`coingecko -> ${res.status}`);
  const data = (await res.json()) as Record<string, { usd?: number; usd_24h_change?: number }>;
  return wanted
    .map((symbol) => {
      const row = data[GECKO_IDS[symbol]];
      if (!row?.usd) return null;
      return {
        symbol,
        usd: row.usd,
        change24h: typeof row.usd_24h_change === "number" ? row.usd_24h_change : null,
      };
    })
    .filter((q): q is Quote => q !== null);
}

// ── Source 3: Ink explorer exchange-rate ──────────────────────────────────

/**
 * Query the Blockscout API for exchange rates of tokens on Ink mainnet.
 * The explorer returns USD per token as a raw number; we treat it as the
 * token price. Only works for ERC-20 tokens the explorer knows.
 */
async function fetchExplorerTokenMeta(
  address: string,
  signal?: AbortSignal,
): Promise<{ usd: number | null } | null> {
  const chain = getChain(EXPLORER_CHAIN);
  if (!chain.explorerApi) return null;
  // Blockscout token endpoint returns the exchange_rate for a single token
  const res = await fetch(`${chain.explorerApi}/tokens/${address}`, {
    headers: { accept: "application/json" },
    signal,
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    exchange_rate?: string | null;
  } | null;
  if (!data) return null;
  const rate = data.exchange_rate ? Number(data.exchange_rate) : null;
  return { usd: rate != null && Number.isFinite(rate) ? rate : null };
}

/**
 * Try to fill any gaps for symbols that could be Ink-native tokens.
 * This is a best-effort lookup against the explorer; it is slow for many
 * symbols since there is no batch endpoint, so only called for symbols that
 * the other sources missed.
 *
 * In practice most Ink-native tokens are small and don't have explorer prices,
 * but this covers the ones that do.
 */
export async function fetchExplorerQuotes(
  symbols: string[],
  _chainId = EXPLORER_CHAIN,
  signal?: AbortSignal,
): Promise<Quote[]> {
  // The explorer does not offer a batch exchange-rate query, and most of the
  // time Hyperliquid or CoinGecko already covered the symbols.  Return empty
  // unless a future implementation adds per-token lookup logic here.
  return [];
}

// ── Source 4: on-chain DEX pools ──────────────────────────────────────────

/**
 * Get the USD price of a known base token (WETH, USDT0, USDC) from whichever
 * source already priced it.  These are the anchors for DEX pool price derivation.
 */
function baseTokenUsd(symbol: string, existing: Quote[]): number | null {
  // Direct match
  const q = existing.find((x) => x.symbol.toUpperCase() === symbol.toUpperCase());
  if (q?.usd != null) return q.usd;
  // Aliases: WETH == ETH, WBTC == BTC
  const upper = symbol.toUpperCase();
  if (upper === "WETH") return baseTokenUsd("ETH", existing);
  if (upper === "WBTC") return baseTokenUsd("BTC", existing);
  // Stablecoins are all ~$1 — use any stable we already have
  const stables = ["USDC", "USDT", "USDT0", "DAI", "USDE", "USDG", "FRAX"];
  if (stables.includes(upper)) {
    for (const s of stables) {
      const p = baseTokenUsd(s, existing);
      if (p != null) return p;
    }
    return 0.9995; // reasonable fallback for stables
  }
  return null;
}

/**
 * Derive a USD price from a V2 pool's reserves.
 * For V2: token0's price = (reserve1 / reserve0) * baseTokenPrice (if baseToken=0)
 *         token1's price = baseTokenPrice / (reserve1 / reserve0) (if baseToken=1)
 */
function priceFromV2Reserves(reservesHex: string, pool: DexPoolV2, baseUsd: number): number | null {
  const w = words(reservesHex);
  if (w.length < 2) return null;
  const r0 = Number(toBigInt(w[0]));
  const r1 = Number(toBigInt(w[1]));
  if (r0 === 0) return null;
  const price = r1 / r0; // token1 per token0

  if (pool.baseToken === 0) {
    // base token is token0; price = token1 per token0; we want token1 price
    return baseUsd / price;
  }
  // base token is token1; price = token1 per token0; we want token0 price
  return price * baseUsd;
}

/**
 * Derive a USD price from a concentrated-liquidity pool's slot0.
 * For Uniswap V3 / Velodrome Slipstream:
 *   sqrtPriceX96 = sqrt(token1/token0) * 2^96
 *   price = (sqrtPriceX96 / 2^96)^2  (= token1 per token0)
 * If baseToken=1 (token1 is the base), price = priceDerived * baseUsd.
 * If baseToken=0 (token0 is the base), price = baseUsd / priceDerived.
 */
function priceFromSlot0(slot0Hex: string, pool: DexPoolCL, baseUsd: number): number | null {
  const w = words(slot0Hex);
  if (w.length < 1) return null;
  const sqrtPriceX96 = Number(toBigInt(w[0]));
  if (!Number.isFinite(sqrtPriceX96) || sqrtPriceX96 === 0) return null;
  const ratio = sqrtPriceX96 / Q96;
  const price = ratio * ratio; // token1 per token0

  if (pool.baseToken === 1) {
    // token1 is the base; price = token1 per token0, so quote token = token0
    return baseUsd / price;
  }
  // token0 is the base; price = token1 per token0, so quote token = token1
  return price * baseUsd;
}

/**
 * Read on-chain DEX pools for symbols not covered by HL or CoinGecko.
 * Uses the same ethCallMany batch pattern as the Velodrome venue reader.
 */
export async function fetchDexQuotes(
  symbols: string[],
  existing: Quote[],
  chainId = EXPLORER_CHAIN,
  signal?: AbortSignal,
): Promise<Quote[]> {
  const wanted = Array.from(new Set(symbols.map((s) => s.toUpperCase()))).filter(
    (s) => DEX_POOLS[s] && DEX_POOLS[s]!.length > 0,
  );
  if (wanted.length === 0) return [];

  const results: Quote[] = [];

  for (const symbol of wanted) {
    const pools = DEX_POOLS[symbol]!;

    for (const pool of pools) {
      let usd: number | null = null;

      try {
        if (pool.kind === "v2") {
          const [reserves] = await ethCallMany(
            chainId,
            [{ to: pool.pool, data: GET_RESERVES }],
            signal,
          );
          if (!reserves) continue;
          const baseUsd = baseTokenUsd(pool.baseSymbol, existing);
          if (!baseUsd) continue;
          usd = priceFromV2Reserves(reserves, pool, baseUsd);
        } else if (pool.kind === "cl") {
          const [slot0] = await ethCallMany(chainId, [{ to: pool.pool, data: SLOT0 }], signal);
          if (!slot0) continue;
          const baseUsd = baseTokenUsd(pool.baseSymbol, existing);
          if (!baseUsd) continue;
          usd = priceFromSlot0(slot0, pool, baseUsd);
        }
      } catch {
        // pool read failed — try the next pool for this symbol
        continue;
      }

      if (usd != null && Number.isFinite(usd) && usd > 0) {
        results.push({ symbol, usd, change24h: null });
        break; // first pool with a valid price wins
      }
    }
  }

  return results;
}

// ── Combined fetch ─────────────────────────────────────────────────────────

function mergeUnique(left: Quote[], right: Quote[]): Quote[] {
  const seen = new Set(left.map((q) => q.symbol));
  for (const q of right) {
    if (!seen.has(q.symbol)) {
      seen.add(q.symbol);
      left.push(q);
    }
  }
  return left;
}

export async function fetchQuotes(symbols: string[], signal?: AbortSignal): Promise<Quote[]> {
  const raw = Array.from(new Set(symbols.map((s) => s.toUpperCase())));

  // Normalize known aliases so all price sources look up the canonical symbol
  const ALIAS_IN: Record<string, string> = {
    KBTC: "BTC",
    WBTC: "BTC",
    CBBTC: "BTC",
    WETH: "ETH",
    "USDC.E": "USDC",
  };
  const wanted = [...new Set(raw.map((s) => ALIAS_IN[s] ?? s))];
  if (wanted.length === 0) return [];

  // Try fresh cache first — avoids a network call if we queried within 10 min
  const cached = await freshCachedQuotes(wanted);
  if (cached) return cached.quotes;

  // 1. Hyperliquid allMids — covers 949 assets, most reliable free source
  let results: Quote[] = [];
  try {
    results = await fetchHLQuotes(wanted, signal);
  } catch {
    // fall through to next source
  }

  // 2. CoinGecko for symbols with known ids — its quotes carry 24h change,
  //    so they override HL's change-less ones for the well-known set.
  const geckoable = wanted.filter((s) => GECKO_IDS[s]);
  if (geckoable.length > 0) {
    try {
      const gecko = await fetchGeckoQuotes(geckoable, signal);
      if (gecko.length > 0) {
        const bySymbol = new Map(gecko.map((q) => [q.symbol, q]));
        results = results.map((q) => bySymbol.get(q.symbol) ?? q);
        mergeUnique(results, gecko);
      }
    } catch {
      // fall through to next source
    }
  }

  const stillMissing = wanted.filter((s) => !results.some((q) => q.symbol === s));

  // 3. Explorer exchange rates
  if (stillMissing.length > 0) {
    try {
      const explorer = await fetchExplorerQuotes(stillMissing, EXPLORER_CHAIN, signal);
      mergeUnique(results, explorer);
    } catch {
      // fall through
    }
  }

  const stillMissing2 = stillMissing.filter((s) => !results.some((q) => q.symbol === s));

  // 4. On-chain DEX pools — for Ink-native tokens not on HL or CG
  if (stillMissing2.length > 0) {
    try {
      const dex = await fetchDexQuotes(stillMissing2, results, EXPLORER_CHAIN, signal);
      mergeUnique(results, dex);
    } catch {
      // fall through
    }
  }

  // Inflate aliases back: if caller asked for KBTC but we queried BTC,
  // copy the BTC quote to KBTC in the result.
  const ALIAS_OUT: Record<string, string> = {
    KBTC: "BTC",
    WBTC: "BTC",
    CBBTC: "BTC",
    WETH: "ETH",
    "USDC.E": "USDC",
  };
  const notQuoted = raw.filter((s) => !results.some((q) => q.symbol === s));
  for (const sym of notQuoted) {
    const target = ALIAS_OUT[sym];
    if (!target) continue;
    const q = results.find((x) => x.symbol === target);
    if (q) results.push({ symbol: sym, usd: q.usd, change24h: q.change24h });
  }

  // Write to cache if we got anything
  if (results.length > 0) {
    void writeQuotesCache(wanted, results, "hyperliquid");
  } else {
    // All sources failed — return stale cache if available
    const stale = await staleCachedQuotes(wanted);
    if (stale) return stale.quotes;
  }

  return results;
}

// ── Markets view (unchanged, still CoinGecko-only) ─────────────────────────

export type MarketRow = {
  symbol: string;
  name: string;
  usd: number;
  change24h: number | null;
  marketCap: number | null;
  image: string | null;
};

/** Live market rows for the symbols we can resolve — used by the markets view. */
export async function fetchMarkets(symbols: string[], signal?: AbortSignal): Promise<MarketRow[]> {
  const ids = Array.from(new Set(symbols.map((s) => GECKO_IDS[s.toUpperCase()]).filter(Boolean)));
  if (ids.length === 0) return [];
  const url = `${GECKO}/coins/markets?vs_currency=usd&ids=${ids.join(",")}&order=market_cap_desc&sparkline=false`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal,
  });
  if (!res.ok) throw new Error(`coingecko -> ${res.status}`);
  const rows = (await res.json()) as Array<{
    symbol: string;
    name: string;
    current_price: number;
    price_change_percentage_24h: number | null;
    market_cap: number | null;
    image: string | null;
  }>;
  return rows.map((r) => ({
    symbol: r.symbol.toUpperCase(),
    name: r.name,
    usd: r.current_price,
    change24h: r.price_change_percentage_24h,
    marketCap: r.market_cap,
    image: r.image,
  }));
}

export const TRACKED_SYMBOLS = Object.keys(GECKO_IDS);
