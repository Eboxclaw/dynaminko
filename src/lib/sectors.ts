// Basket taxonomy. Classification only — no invented prices or balances.
// A token you hold gets a basket so the portfolio can be told as a story
// instead of a flat list.

export type SectorId =
  | "memes"
  | "store-of-value"
  | "defi"
  | "stables"
  | "stocks"
  | "unsorted";

export type Sector = {
  id: SectorId;
  label: string;
  blurb: string;
  hue: number; // used for the doodle palette
};

export const SECTORS: Sector[] = [
  { id: "store-of-value", label: "Store of value", blurb: "Hard, scarce, boring", hue: 45 },
  { id: "stocks", label: "Stocks", blurb: "Tokenized equities", hue: 205 },
  { id: "defi", label: "DeFi", blurb: "Protocol equity and yield", hue: 265 },
  { id: "memes", label: "Memes", blurb: "Attention assets", hue: 340 },
  { id: "stables", label: "Stables", blurb: "Dry powder", hue: 150 },
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
  // store of value
  ETH: "store-of-value",
  WETH: "store-of-value",
  STETH: "store-of-value",
  WSTETH: "store-of-value",
  BTC: "store-of-value",
  WBTC: "store-of-value",
  CBBTC: "store-of-value",
  TBTC: "store-of-value",
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

export function sectorFor(symbol: string): SectorId {
  const upper = symbol.trim().toUpperCase();
  // tokenized equities are commonly prefixed (tLMT, xTSM, TSMx)
  const stripped = upper.replace(/^[TX]/, "").replace(/X$/, "");
  return SYMBOL_SECTOR[upper] ?? SYMBOL_SECTOR[stripped] ?? "unsorted";
}

export function sectorColor(id: SectorId, dark = false): string {
  const s = SECTOR_BY_ID[id] ?? SECTOR_BY_ID.unsorted;
  if (id === "unsorted") return dark ? "oklch(0.5 0.01 60)" : "oklch(0.72 0.01 60)";
  return dark ? `oklch(0.72 0.13 ${s.hue})` : `oklch(0.66 0.14 ${s.hue})`;
}
