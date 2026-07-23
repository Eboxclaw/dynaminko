export type Sector =
  | "Privacy"
  | "Store of Value"
  | "Health"
  | "Defense"
  | "Firearms"
  | "Chips"
  | "AI";

export type Asset = {
  ticker: string;
  name: string;
  sector: Sector;
  price: number;
  change24h: number;
  allocationUsd: number;
};

export const ASSETS: Asset[] = [
  { ticker: "tLMT", name: "Lockheed Martin (Tokenized)", sector: "Defense", price: 492.44, change24h: 1.2, allocationUsd: 148200 },
  { ticker: "tRTX", name: "Raytheon (Tokenized)", sector: "Defense", price: 138.9, change24h: 0.6, allocationUsd: 92100 },
  { ticker: "tSIG", name: "SIG Sauer Holdings (Tokenized)", sector: "Firearms", price: 74.2, change24h: 2.8, allocationUsd: 41200 },
  { ticker: "XMR", name: "Monero", sector: "Privacy", price: 161.8, change24h: -0.4, allocationUsd: 232400 },
  { ticker: "ZEC", name: "Zcash", sector: "Privacy", price: 42.11, change24h: 1.9, allocationUsd: 88100 },
  { ticker: "PAXG", name: "PAX Gold", sector: "Store of Value", price: 2341.5, change24h: 0.04, allocationUsd: 184500 },
  { ticker: "tGLD", name: "Gold Bullion (Tokenized)", sector: "Store of Value", price: 2338.2, change24h: 0.02, allocationUsd: 62100 },
  { ticker: "tPFE", name: "Pfizer (Tokenized)", sector: "Health", price: 28.44, change24h: -1.1, allocationUsd: 24200 },
  { ticker: "tMRNA", name: "Moderna (Tokenized)", sector: "Health", price: 78.2, change24h: 3.4, allocationUsd: 33100 },
  { ticker: "tTSM", name: "TSMC (Tokenized)", sector: "Chips", price: 188.02, change24h: 4.8, allocationUsd: 121400 },
  { ticker: "tNVDA", name: "NVIDIA (Tokenized)", sector: "Chips", price: 942.1, change24h: 2.1, allocationUsd: 210800 },
  { ticker: "tPLTR", name: "Palantir (Tokenized)", sector: "AI", price: 41.9, change24h: 6.2, allocationUsd: 71400 },
  { ticker: "FET", name: "Fetch.ai", sector: "AI", price: 1.42, change24h: -2.4, allocationUsd: 28200 },
];

export const SECTOR_COLORS: Record<Sector, string> = {
  Privacy: "#00ff9d",
  "Store of Value": "#f5d569",
  Health: "#00e0ff",
  Defense: "#5e17eb",
  Firearms: "#ff6b6b",
  Chips: "#c084fc",
  AI: "#7dd3fc",
};

export function sectorTotals() {
  const totals = new Map<Sector, number>();
  for (const a of ASSETS) totals.set(a.sector, (totals.get(a.sector) ?? 0) + a.allocationUsd);
  return Array.from(totals.entries()).map(([sector, usd]) => ({ sector, usd }));
}

export function totalBalance() {
  return ASSETS.reduce((s, a) => s + a.allocationUsd, 0);
}

export function generateOrderBook(price: number) {
  const asks = Array.from({ length: 8 }, (_, i) => ({
    price: +(price + (i + 1) * price * 0.0008).toFixed(2),
    size: +(Math.random() * 20 + 1).toFixed(2),
  }));
  const bids = Array.from({ length: 8 }, (_, i) => ({
    price: +(price - (i + 1) * price * 0.0008).toFixed(2),
    size: +(Math.random() * 20 + 1).toFixed(2),
  }));
  return { asks, bids };
}
