// Basket taxonomy is two-tier and open-set: top-level category is a small
// closed union ("Crypto" | "xStocks"), sub-category is a string so new
// sub-baskets can be added at token-listing time without a schema change.

export type Category = "Crypto" | "xStocks";
export type SubCategory = string;

export const CATEGORIES: Category[] = ["Crypto", "xStocks"];

// Curated seed of sub-categories in canonical display order. New sub-categories
// added via token listings should simply be appended; SUBCATEGORY_COLORS
// returns a fallback tonal ash so unknown keys still render.
export const SUB_CATEGORIES: SubCategory[] = [
  "privacy",
  "cash",
  "metals",
  "ai",
  "memes",
  "rwa",
  "defense",
  "chips",
  "health",
  "goods",
  "etfs",
];

export type Asset = {
  ticker: string;
  name: string;
  category: Category;
  subCategory: SubCategory;
  price: number;
  change24h: number;
  allocationUsd: number;
};

export const ASSETS: Asset[] = [
  // Crypto
  { ticker: "XMR", name: "Monero", category: "Crypto", subCategory: "privacy", price: 161.8, change24h: -0.4, allocationUsd: 232400 },
  { ticker: "ZEC", name: "Zcash", category: "Crypto", subCategory: "privacy", price: 42.11, change24h: 1.9, allocationUsd: 88100 },
  { ticker: "tBTC", name: "Threshold Bitcoin", category: "Crypto", subCategory: "cash", price: 63820.0, change24h: 1.1, allocationUsd: 96200 },
  { ticker: "PAXG", name: "PAX Gold", category: "Crypto", subCategory: "metals", price: 2341.5, change24h: 0.04, allocationUsd: 184500 },
  { ticker: "FET", name: "Fetch.ai", category: "Crypto", subCategory: "ai", price: 1.42, change24h: -2.4, allocationUsd: 28200 },
  // xStocks
  { ticker: "tPFE", name: "Pfizer (Tokenized)", category: "xStocks", subCategory: "health", price: 28.44, change24h: -1.1, allocationUsd: 24200 },
  { ticker: "tMRNA", name: "Moderna (Tokenized)", category: "xStocks", subCategory: "health", price: 78.2, change24h: 3.4, allocationUsd: 33100 },
  { ticker: "tLMT", name: "Lockheed Martin (Tokenized)", category: "xStocks", subCategory: "defense", price: 492.44, change24h: 1.2, allocationUsd: 148200 },
  { ticker: "tRTX", name: "Raytheon (Tokenized)", category: "xStocks", subCategory: "defense", price: 138.9, change24h: 0.6, allocationUsd: 92100 },
  { ticker: "tSWBI", name: "Smith & Wesson (Tokenized)", category: "xStocks", subCategory: "defense", price: 14.22, change24h: 0.9, allocationUsd: 22400 },
  { ticker: "tSIG", name: "SIG Sauer Holdings (Tokenized)", category: "xStocks", subCategory: "defense", price: 74.2, change24h: 2.8, allocationUsd: 41200 },
  { ticker: "tTSM", name: "TSMC (Tokenized)", category: "xStocks", subCategory: "chips", price: 188.02, change24h: 4.8, allocationUsd: 121400 },
  { ticker: "tNVDA", name: "NVIDIA (Tokenized)", category: "xStocks", subCategory: "chips", price: 942.1, change24h: 2.1, allocationUsd: 210800 },
  { ticker: "tPLTR", name: "Palantir (Tokenized)", category: "xStocks", subCategory: "ai", price: 41.9, change24h: 6.2, allocationUsd: 71400 },
];

// Tonal palette only — sub-category dots never compete with signal color
// (mint = gain, rose = loss, lavender = accent).
const SUBCATEGORY_PALETTE: Record<string, string> = {
  privacy: "#B6A5F0",       // lavender-tinted (privacy = signature)
  cash: "#F5F4F7",          // paper white
  metals: "#D8CBA0",         // muted gold-ash
  ai: "#D8D3E8",             // near-lavender tint
  memes: "#C97C74",          // rose (memes acknowledged as volatile)
  rwa: "#A8A3B8",            // mid ash
  defense: "#6E6A7A",        // dim ash
  chips: "#8B8894",          // ash
  health: "#B7C9B3",          // muted mint-ash
  goods: "#9AA8A0",          // muted sage
  etfs: "#4A4753",           // deep ash
};

export const SUBCATEGORY_COLORS: Record<string, string> = new Proxy(SUBCATEGORY_PALETTE, {
  get(target, key: string) {
    return target[key] ?? "#6E6A7A"; // fallback ash for unknown sub-cats
  },
});

// Category-level tint (used for grouping headers on exposure + positions panels)
export const CATEGORY_COLORS: Record<Category, string> = {
  Crypto: "#B6A5F0",
  xStocks: "#D8CBA0",
};

export function subCategoryTotals(positions?: Record<string, number>) {
  const totals = new Map<string, { category: Category; usd: number }>();
  for (const a of ASSETS) {
    const usd = positions ? (positions[a.ticker] ?? 0) * a.price : a.allocationUsd;
    if (usd <= 0) continue;
    const prev = totals.get(a.subCategory);
    totals.set(a.subCategory, {
      category: a.category,
      usd: (prev?.usd ?? 0) + usd,
    });
  }
  return Array.from(totals.entries())
    .map(([subCategory, { category, usd }]) => ({ subCategory, category, usd }))
    .sort((a, b) => b.usd - a.usd);
}

export function totalBalance(positions?: Record<string, number>) {
  if (!positions) return ASSETS.reduce((s, a) => s + a.allocationUsd, 0);
  return ASSETS.reduce((s, a) => s + (positions[a.ticker] ?? 0) * a.price, 0);
}

export function generateOrderBook(price: number) {
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
