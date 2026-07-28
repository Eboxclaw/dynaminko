export type InkStats = {
  chainId: number;
  rpcUrl: string;
  blockNumber: number | null;
  gasPriceWei: string | null;
  fetchedAt: string;
};

export type CryptoPrice = {
  id: string;
  ticker: string;
  name: string;
  usd: number | null;
  change24h: number | null;
  lastUpdatedAt: number | null;
};

export type ProtocolMetric = {
  slug: string;
  name: string;
  tvlUsd: number | null;
  apy: number | null;
};

export type PublicDataSnapshot = {
  ink: InkStats;
  prices: CryptoPrice[];
  protocols: ProtocolMetric[];
  stale: boolean;
};

const INK_RPC_URL = "https://rpc-gel.inkonchain.com";
const CACHE_MS = 3 * 60 * 1000;

const COINGECKO_ASSETS = [
  { id: "monero", ticker: "XMR", name: "Monero" },
  { id: "zcash", ticker: "ZEC", name: "Zcash" },
  { id: "threshold-bitcoin", ticker: "tBTC", name: "Threshold Bitcoin" },
  { id: "pax-gold", ticker: "PAXG", name: "PAX Gold" },
] as const;

const DEFILLAMA_PROTOCOLS = [
  { slug: "tydro", name: "Tydro" },
  { slug: "velodrome", name: "Velodrome" },
  { slug: "inkyswap", name: "InkySwap" },
  { slug: "inkypump", name: "InkyPump" },
] as const;

let cache: { at: number; data: PublicDataSnapshot } | undefined;

export async function getPublicDataSnapshot(): Promise<PublicDataSnapshot> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.data;

  const settled = await Promise.allSettled([
    fetchInkStats(),
    fetchCryptoPrices(),
    fetchProtocolMetrics(),
  ]);

  const previous = cache?.data;
  const data: PublicDataSnapshot = {
    ink: valueOr(settled[0], previous?.ink ?? emptyInkStats()),
    prices: valueOr(settled[1], previous?.prices ?? emptyPrices()),
    protocols: valueOr(settled[2], previous?.protocols ?? emptyProtocols()),
    stale: settled.some((result) => result.status === "rejected"),
  };

  cache = { at: now, data };
  return data;
}

function valueOr<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

async function fetchInkStats(): Promise<InkStats> {
  const [blockHex, gasPriceHex] = await Promise.all([rpc("eth_blockNumber"), rpc("eth_gasPrice")]);
  return {
    chainId: 57073,
    rpcUrl: INK_RPC_URL,
    blockNumber: hexToNumber(blockHex),
    gasPriceWei: typeof gasPriceHex === "string" ? BigInt(gasPriceHex).toString() : null,
    fetchedAt: new Date().toISOString(),
  };
}

async function rpc(method: string): Promise<unknown> {
  const response = await fetch(INK_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params: [] }),
  });
  if (!response.ok) throw new Error(`Ink RPC ${method} failed: ${response.status}`);
  const payload = (await response.json()) as { result?: unknown; error?: unknown };
  if (payload.error) throw new Error(`Ink RPC ${method} returned an error`);
  return payload.result;
}

async function fetchCryptoPrices(): Promise<CryptoPrice[]> {
  const ids = COINGECKO_ASSETS.map((asset) => asset.id).join(",");
  const url = new URL("https://api.coingecko.com/api/v3/simple/price");
  url.searchParams.set("ids", ids);
  url.searchParams.set("vs_currencies", "usd");
  url.searchParams.set("include_24hr_change", "true");
  url.searchParams.set("include_last_updated_at", "true");

  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`CoinGecko prices failed: ${response.status}`);
  const payload = (await response.json()) as Record<
    string,
    { usd?: number; usd_24h_change?: number; last_updated_at?: number }
  >;

  return COINGECKO_ASSETS.map((asset) => ({
    ...asset,
    usd: payload[asset.id]?.usd ?? null,
    change24h: payload[asset.id]?.usd_24h_change ?? null,
    lastUpdatedAt: payload[asset.id]?.last_updated_at ?? null,
  }));
}

async function fetchProtocolMetrics(): Promise<ProtocolMetric[]> {
  const rows = await Promise.all(
    DEFILLAMA_PROTOCOLS.map(async (protocol) => {
      const response = await fetch(`https://api.llama.fi/protocol/${protocol.slug}`, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) return { ...protocol, tvlUsd: null, apy: null };
      const payload = (await response.json()) as {
        tvl?: number;
        currentChainTvls?: Record<string, number>;
        metrics?: { apy?: number };
      };
      return {
        ...protocol,
        tvlUsd: payload.currentChainTvls?.Ink ?? payload.tvl ?? null,
        apy: typeof payload.metrics?.apy === "number" ? payload.metrics.apy : null,
      };
    }),
  );
  return rows;
}

function hexToNumber(hex: unknown): number | null {
  return typeof hex === "string" ? Number.parseInt(hex, 16) : null;
}

function emptyInkStats(): InkStats {
  return {
    chainId: 57073,
    rpcUrl: INK_RPC_URL,
    blockNumber: null,
    gasPriceWei: null,
    fetchedAt: new Date().toISOString(),
  };
}
function emptyPrices(): CryptoPrice[] {
  return COINGECKO_ASSETS.map((asset) => ({
    ...asset,
    usd: null,
    change24h: null,
    lastUpdatedAt: null,
  }));
}
function emptyProtocols(): ProtocolMetric[] {
  return DEFILLAMA_PROTOCOLS.map((protocol) => ({ ...protocol, tvlUsd: null, apy: null }));
}
