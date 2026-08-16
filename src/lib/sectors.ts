// Basket taxonomy. Classification only — no invented prices or balances.
// A token you hold gets a basket so the portfolio can be told as a story
// instead of a flat list.

export type SectorId =
  | "btc"
  | "eth"
  | "store-of-value"
  | "stables"
  | "defi"
  | "ai"
  | "l1"
  | "l2"
  | "gaming"
  | "memes"
  | "stocks"
  | "unsorted";

export type Sector = {
  id: SectorId;
  label: string;
  blurb: string;
  hue: number; // used for the doodle palette
};

export const SECTORS: Sector[] = [
  { id: "btc", label: "Bitcoin", blurb: "BTC and wrappers", hue: 65 },
  { id: "eth", label: "Ethereum", blurb: "ETH and liquid staking", hue: 250 },
  { id: "store-of-value", label: "Store of value", blurb: "Hard, scarce, boring", hue: 45 },
  { id: "stables", label: "Stables", blurb: "Dry powder", hue: 150 },
  { id: "defi", label: "DeFi", blurb: "Protocol equity and yield", hue: 265 },
  { id: "ai", label: "AI", blurb: "Compute and inference networks", hue: 190 },
  { id: "l1", label: "Layer 1", blurb: "Base chains", hue: 300 },
  { id: "l2", label: "Layer 2", blurb: "Rollups and scaling", hue: 220 },
  { id: "gaming", label: "Gaming", blurb: "Games and virtual worlds", hue: 20 },
  { id: "memes", label: "Memes", blurb: "Attention assets", hue: 340 },
  { id: "stocks", label: "Stocks", blurb: "Tokenized equities", hue: 205 },
  { id: "unsorted", label: "Unsorted", blurb: "Not classified yet", hue: 0 },
];

export const SECTOR_BY_ID = Object.fromEntries(SECTORS.map((s) => [s.id, s])) as Record<
  SectorId,
  Sector
>;

/** Order used whenever baskets are listed. */
export const SECTOR_ORDER: SectorId[] = SECTORS.map((s) => s.id);

/** Symbol → basket. Extend freely; unknown symbols fall into "unsorted". */
const SYMBOL_SECTOR: Record<string, SectorId> = {
  // stables
  USDC: "stables",
  USDT: "stables",
  DAI: "stables",
  USDCE: "stables",
  "USDC.E": "stables",
  USDGLO: "stables",
  USDE: "stables",
  SUSDE: "stables",
  FRAX: "stables",
  LUSD: "stables",
  GHO: "stables",
  // bitcoin
  BTC: "btc",
  WBTC: "btc",
  CBBTC: "btc",
  TBTC: "btc",
  // ethereum
  ETH: "eth",
  WETH: "eth",
  STETH: "eth",
  WSTETH: "eth",
  RETH: "eth",
  WEETH: "eth",
  // store of value
  PAXG: "store-of-value",
  XAUT: "store-of-value",
  // defi
  VELO: "defi",
  AERO: "defi",
  UNI: "defi",
  AAVE: "defi",
  CRV: "defi",
  CVX: "defi",
  LDO: "defi",
  PENDLE: "defi",
  SNX: "defi",
  COMP: "defi",
  MKR: "defi",
  SKY: "defi",
  OP: "defi",
  TYDRO: "defi",
  NADO: "defi",
  HYPE: "defi",
  KRK: "defi",
  // memes
  INKO: "memes",
  DOGE: "memes",
  SHIB: "memes",
  PEPE: "memes",
  WIF: "memes",
  BONK: "memes",
  BRETT: "memes",
  MOG: "memes",
  SQUID: "memes",
  // ai
  TAO: "ai",
  RENDER: "ai",
  RNDR: "ai",
  FET: "ai",
  AKT: "ai",
  GRASS: "ai",
  NEAR: "ai",
  IO: "ai",
  // layer 1
  SOL: "l1",
  AVAX: "l1",
  SUI: "l1",
  APT: "l1",
  TIA: "l1",
  ADA: "l1",
  DOT: "l1",
  ATOM: "l1",
  SEI: "l1",
  // layer 2
  INK: "l2",
  ARB: "l2",
  STRK: "l2",
  ZK: "l2",
  MNT: "l2",
  METIS: "l2",
  BLAST: "l2",
  // gaming
  IMX: "gaming",
  BEAM: "gaming",
  RON: "gaming",
  PRIME: "gaming",
  SAND: "gaming",
  MANA: "gaming",
  // tokenized stocks (xStocks and friends)
  TSM: "stocks",
  NVDA: "stocks",
  AMD: "stocks",
  ASML: "stocks",
  LLY: "stocks",
  NVO: "stocks",
  UNH: "stocks",
  LMT: "stocks",
  RTX: "stocks",
  NOC: "stocks",
  SWBI: "stocks",
  RGR: "stocks",
  POWW: "stocks",
  AAPL: "stocks",
  MSFT: "stocks",
  TSLA: "stocks",
  SPY: "stocks",
  QQQ: "stocks",
  COIN: "stocks",
  MSTR: "stocks",
};

/**
 * Canonical base-symbol normalization, shared by every consumer: NFKC + ₮→T
 * folding, venue suffixes (-PERP / -SPOT), wrapped-equity spellings (wAAPLx →
 * AAPL) and the classic t/x wrapper prefixes/suffixes. Display-only cleaners
 * live elsewhere; this one decides classification and matching.
 */
export function baseSymbol(symbol: string): string {
  return (symbol ?? "")
    .normalize("NFKC")
    .replace(/₮/g, "T")
    .toUpperCase()
    .replace(/-(PERP|SPOT)$/, "")
    .replace(/^W(.+)X$/, "$1")
    .replace(/^[TX]/, "")
    .replace(/X$/, "")
    .trim();
}

export function sectorFor(symbol: string): SectorId {
  const upper = symbol.trim().toUpperCase();
  return SYMBOL_SECTOR[upper] ?? SYMBOL_SECTOR[baseSymbol(symbol)] ?? "unsorted";
}

/** User override first, then the registry. */
export function resolveSector(symbol: string, overrides?: Record<string, string> | null): SectorId {
  return classifyAsset(symbol, overrides).basket;
}

/** Canonical, auditable classification for one asset. */
export type AssetBasket = {
  assetId: string;
  basket: SectorId;
  source: "user" | "registry" | "heuristic" | "unknown";
  confidence: number;
  updatedAt: number;
};

const STOCK_SHAPE = /^[TX][A-Z]{2,5}$|^[A-Z]{2,5}X$/;

/**
 * Deterministic classification. User override wins, then the registry, then a
 * shape heuristic, then unsorted. No model is ever consulted.
 */
export function classifyAsset(
  symbol: string,
  overrides?: Record<string, string> | null,
): AssetBasket {
  const assetId = symbol.trim().toUpperCase();
  const now = Date.now();
  const chosen = overrides?.[assetId];
  if (chosen && SECTOR_BY_ID[chosen as SectorId])
    return { assetId, basket: chosen as SectorId, source: "user", confidence: 1, updatedAt: now };

  const stripped = assetId.replace(/^[TX]/, "").replace(/X$/, "");
  const base = baseSymbol(assetId);
  if (SYMBOL_SECTOR[assetId])
    return {
      assetId,
      basket: SYMBOL_SECTOR[assetId],
      source: "registry",
      confidence: 0.95,
      updatedAt: now,
    };
  if (SYMBOL_SECTOR[stripped])
    return {
      assetId,
      basket: SYMBOL_SECTOR[stripped],
      source: "registry",
      confidence: 0.8,
      updatedAt: now,
    };
  if (SYMBOL_SECTOR[base])
    return {
      assetId,
      basket: SYMBOL_SECTOR[base],
      source: "registry",
      confidence: 0.8,
      updatedAt: now,
    };
  if (/^(USD|EUR)[A-Z0-9]{0,3}$/.test(assetId) || assetId.endsWith("USD"))
    return { assetId, basket: "stables", source: "heuristic", confidence: 0.6, updatedAt: now };
  if (STOCK_SHAPE.test(assetId))
    return { assetId, basket: "stocks", source: "heuristic", confidence: 0.5, updatedAt: now };
  return { assetId, basket: "unsorted", source: "unknown", confidence: 0, updatedAt: now };
}

export const SOURCE_LABEL: Record<AssetBasket["source"], string> = {
  user: "your override",
  registry: "registry match",
  heuristic: "symbol shape",
  unknown: "unclassified",
};

export function sectorColor(id: SectorId, dark = false): string {
  const s = SECTOR_BY_ID[id] ?? SECTOR_BY_ID.unsorted;
  if (id === "unsorted") return dark ? "oklch(0.5 0.01 60)" : "oklch(0.72 0.01 60)";
  return dark ? `oklch(0.72 0.13 ${s.hue})` : `oklch(0.66 0.14 ${s.hue})`;
}
