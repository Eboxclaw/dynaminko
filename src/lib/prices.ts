// Real price data. CoinGecko's public API for the assets we can identify by
// symbol; the Ink explorer already carries an exchange rate for most tokens it
// knows, so this only fills the gaps. No key, no fabricated numbers.

const GECKO = "https://api.coingecko.com/api/v3";

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

export async function fetchQuotes(symbols: string[], signal?: AbortSignal): Promise<Quote[]> {
  const wanted = Array.from(
    new Set(symbols.map((s) => s.toUpperCase()).filter((s) => GECKO_IDS[s])),
  );
  if (wanted.length === 0) return [];
  const ids = Array.from(new Set(wanted.map((s) => GECKO_IDS[s])));
  const url = `${GECKO}/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true`;
  const res = await fetch(url, { headers: { accept: "application/json" }, signal });
  if (!res.ok) throw new Error(`coingecko → ${res.status}`);
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
  const ids = Array.from(
    new Set(symbols.map((s) => GECKO_IDS[s.toUpperCase()]).filter(Boolean)),
  );
  if (ids.length === 0) return [];
  const url = `${GECKO}/coins/markets?vs_currency=usd&ids=${ids.join(",")}&order=market_cap_desc&sparkline=false`;
  const res = await fetch(url, { headers: { accept: "application/json" }, signal });
  if (!res.ok) throw new Error(`coingecko → ${res.status}`);
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
