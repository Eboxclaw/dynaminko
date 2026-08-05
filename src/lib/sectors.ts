// Sector taxonomy. Classification only — no invented prices or balances.
// A token you hold gets a sector so the portfolio can be told as a story
// instead of a flat list.

export type SectorId =
  | "privacy"
  | "store-of-value"
  | "health"
  | "defense"
  | "firearms"
  | "semis"
  | "ai"
  | "stables"
  | "unsorted";

export type Sector = {
  id: SectorId;
  label: string;
  blurb: string;
  hue: number; // used for the doodle palette
};

export const SECTORS: Sector[] = [
  { id: "ai", label: "AI", blurb: "Compute, agents, inference", hue: 265 },
  { id: "semis", label: "Semiconductors", blurb: "Chips and fabrication", hue: 205 },
  { id: "privacy", label: "Privacy", blurb: "Untraceable money and comms", hue: 160 },
  { id: "store-of-value", label: "Store of value", blurb: "Hard, scarce, boring", hue: 45 },
  { id: "health", label: "Health", blurb: "Bio, longevity, care", hue: 340 },
  { id: "defense", label: "Defense", blurb: "Sovereignty and deterrence", hue: 20 },
  { id: "firearms", label: "Firearms", blurb: "Small arms and optics", hue: 5 },
  { id: "stables", label: "Cash", blurb: "Stablecoins and dry powder", hue: 120 },
  { id: "unsorted", label: "Unsorted", blurb: "Not classified yet", hue: 0 },
];

export const SECTOR_BY_ID = Object.fromEntries(SECTORS.map((s) => [s.id, s])) as Record<
  SectorId,
  Sector
>;

/** Symbol → sector. Extend freely; unknown symbols fall into "unsorted". */
const SYMBOL_SECTOR: Record<string, SectorId> = {
  // cash
  USDC: "stables",
  USDT: "stables",
  DAI: "stables",
  USDCE: "stables",
  "USDC.E": "stables",
  USDGLO: "stables",
  // store of value
  ETH: "store-of-value",
  WETH: "store-of-value",
  BTC: "store-of-value",
  WBTC: "store-of-value",
  CBBTC: "store-of-value",
  PAXG: "store-of-value",
  XAUT: "store-of-value",
  // privacy
  XMR: "privacy",
  ZEC: "privacy",
  SCRT: "privacy",
  ROSE: "privacy",
  // ai
  TAO: "ai",
  RNDR: "ai",
  RENDER: "ai",
  FET: "ai",
  AKT: "ai",
  NEAR: "ai",
  TNSR: "ai",
  // semis
  TSM: "semis",
  NVDA: "semis",
  AMD: "semis",
  ASML: "semis",
  TTSM: "semis",
  TNVDA: "semis",
  // health
  LLY: "health",
  NVO: "health",
  UNH: "health",
  TLLY: "health",
  // defense
  LMT: "defense",
  RTX: "defense",
  NOC: "defense",
  TLMT: "defense",
  // firearms
  SWBI: "firearms",
  RGR: "firearms",
  POWW: "firearms",
};

export function sectorFor(symbol: string): SectorId {
  const key = symbol.trim().toUpperCase().replace(/^X/, "");
  return SYMBOL_SECTOR[symbol.trim().toUpperCase()] ?? SYMBOL_SECTOR[key] ?? "unsorted";
}

export function sectorColor(id: SectorId, dark = false): string {
  const s = SECTOR_BY_ID[id] ?? SECTOR_BY_ID.unsorted;
  if (id === "unsorted") return dark ? "oklch(0.5 0.01 60)" : "oklch(0.72 0.01 60)";
  return dark ? `oklch(0.72 0.13 ${s.hue})` : `oklch(0.66 0.14 ${s.hue})`;
}
