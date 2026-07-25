export type Sector =
  | "Privacy"
  | "Store of Value"
  | "Health"
  | "Defense"
  | "Firearms"
  | "Semiconductors"
  | "AI";

export const SECTORS: Sector[] = [
  "Privacy",
  "Store of Value",
  "Health",
  "Defense",
  "Firearms",
  "Semiconductors",
  "AI",
];

export type Asset = {
  ticker: string;
  name: string;
  sector: Sector;
  price: number;
  change24h: number;
  allocationUsd: number;
};

export const ASSETS: Asset[] = [
  // Privacy
  { ticker: "XMR", name: "Monero", sector: "Privacy", price: 161.8, change24h: -0.4, allocationUsd: 232400 },
  { ticker: "ZEC", name: "Zcash", sector: "Privacy", price: 42.11, change24h: 1.9, allocationUsd: 88100 },
  // Store of Value
  { ticker: "PAXG", name: "PAX Gold", sector: "Store of Value", price: 2341.5, change24h: 0.04, allocationUsd: 184500 },
  { ticker: "tBTC", name: "Threshold Bitcoin", sector: "Store of Value", price: 63820.0, change24h: 1.1, allocationUsd: 96200 },
  // Health
  { ticker: "tPFE", name: "Pfizer (Tokenized)", sector: "Health", price: 28.44, change24h: -1.1, allocationUsd: 24200 },
  { ticker: "tMRNA", name: "Moderna (Tokenized)", sector: "Health", price: 78.2, change24h: 3.4, allocationUsd: 33100 },
  // Defense
  { ticker: "tLMT", name: "Lockheed Martin (Tokenized)", sector: "Defense", price: 492.44, change24h: 1.2, allocationUsd: 148200 },
  { ticker: "tRTX", name: "Raytheon (Tokenized)", sector: "Defense", price: 138.9, change24h: 0.6, allocationUsd: 92100 },
  // Firearms
  { ticker: "tSWBI", name: "Smith & Wesson (Tokenized)", sector: "Firearms", price: 14.22, change24h: 0.9, allocationUsd: 22400 },
  { ticker: "tSIG", name: "SIG Sauer Holdings (Tokenized)", sector: "Firearms", price: 74.2, change24h: 2.8, allocationUsd: 41200 },
  // Semiconductors
  { ticker: "tTSM", name: "TSMC (Tokenized)", sector: "Semiconductors", price: 188.02, change24h: 4.8, allocationUsd: 121400 },
  { ticker: "tNVDA", name: "NVIDIA (Tokenized)", sector: "Semiconductors", price: 942.1, change24h: 2.1, allocationUsd: 210800 },
  // AI
  { ticker: "tPLTR", name: "Palantir (Tokenized)", sector: "AI", price: 41.9, change24h: 6.2, allocationUsd: 71400 },
  { ticker: "FET", name: "Fetch.ai", sector: "AI", price: 1.42, change24h: -2.4, allocationUsd: 28200 },
];

// Only Lavender for accent, Mint for gains, Rose for losses — sector colors are
// tonal ash/paper variations so category color never competes with signal color.
export const SECTOR_COLORS: Record<Sector, string> = {
  Privacy: "#B6A5F0",           // lavender (privacy = signature accent)
  "Store of Value": "#F5F4F7",  // paper white
  Health: "#8B8894",            // ash
  Defense: "#6E6A7A",           // dim ash
  Firearms: "#4A4753",          // deep ash
  Semiconductors: "#A8A3B8",    // mid ash
  AI: "#D8D3E8",                // near-lavender tint
};

export function sectorTotals() {
  const totals = new Map<Sector, number>();
  for (const s of SECTORS) totals.set(s, 0);
  for (const a of ASSETS) totals.set(a.sector, (totals.get(a.sector) ?? 0) + a.allocationUsd);
  return SECTORS.map((sector) => ({ sector, usd: totals.get(sector) ?? 0 }));
}

export function totalBalance() {
  return ASSETS.reduce((s, a) => s + a.allocationUsd, 0);
}

export function generateOrderBook(price: number) {
  // Deterministic-ish per price so it doesn't jitter on every render
  const seed = Math.floor(price * 1000);
  const rand = (i: number) => {
    const x = Math.sin(seed + i * 31.7) * 10000;
    return x - Math.floor(x);
  };
  const asks = Array.from({ length: 8 }, (_, i) => ({
    price: +(price + (i + 1) * price * 0.0008).toFixed(2),
    size: +(rand(i * 2 + 1) * 20 + 1).toFixed(2),
  }));
  const bids = Array.from({ length: 8 }, (_, i) => ({
    price: +(price - (i + 1) * price * 0.0008).toFixed(2),
    size: +(rand(i * 2 + 2) * 20 + 1).toFixed(2),
  }));
  return { asks, bids };
}

// Tydro lending markets — separate visual language from Markets/CLOB.
export type VaultMarket = {
  asset: string;
  name: string;
  supplyApy: number;
  borrowApy: number;
  supplied: number;
  borrowed: number;
  userSupplied: number;
  userBorrowed: number;
};

export const VAULT_MARKETS: VaultMarket[] = [
  { asset: "USDC", name: "USD Coin", supplyApy: 4.82, borrowApy: 6.14, supplied: 18.4e6, borrowed: 11.2e6, userSupplied: 42000, userBorrowed: 0 },
  { asset: "ETH", name: "Ether", supplyApy: 2.14, borrowApy: 3.02, supplied: 4200, borrowed: 1840, userSupplied: 3.4, userBorrowed: 0 },
  { asset: "tBTC", name: "Threshold BTC", supplyApy: 1.44, borrowApy: 2.88, supplied: 88, borrowed: 22, userSupplied: 0, userBorrowed: 0 },
  { asset: "XMR", name: "Monero (wrapped)", supplyApy: 3.42, borrowApy: 5.6, supplied: 12400, borrowed: 3120, userSupplied: 0, userBorrowed: 0 },
  { asset: "PAXG", name: "PAX Gold", supplyApy: 1.02, borrowApy: 2.44, supplied: 622, borrowed: 88, userSupplied: 0, userBorrowed: 0 },
];

// Concierge feed — fetched trades waiting to be reconciled against a thesis
export type Concierge = {
  id: string;
  ticker: string;
  side: "BUY" | "SELL" | "LONG" | "CLOSE";
  qty: number;
  price: number;
  minutesAgo: number;
  suggestedThesis?: string;
};

export const CONCIERGE_SEED: Concierge[] = [
  {
    id: "c1",
    ticker: "tTSM",
    side: "BUY",
    qty: 42,
    price: 188.02,
    minutesAgo: 18,
    suggestedThesis: "Chips super-cycle — TSMC as node-leadership monopoly through 2027.",
  },
  {
    id: "c2",
    ticker: "XMR",
    side: "BUY",
    qty: 12.4,
    price: 161.8,
    minutesAgo: 62,
    suggestedThesis: "Privacy premium re-accumulation on regulatory pressure dips.",
  },
  {
    id: "c3",
    ticker: "tPLTR",
    side: "LONG",
    qty: 250,
    price: 41.9,
    minutesAgo: 240,
    suggestedThesis: "AI + defense contract stack — asymmetric long into Q4 earnings.",
  },
];
