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

// ── DeBank-style protocol positions ────────────────────────────────────────
// Deterministic per address: LP positions on Ink-native venues + memecoin
// bags + locked LP on InkyPump. Mock only — no chain calls.

export type Protocol =
  | "Nado"
  | "Velodrome"
  | "InkySwap"
  | "InkyPump"
  | "InkyPump Lock";

export type ProtocolKind = "pool" | "perp" | "margin" | "position" | "lock";

export type ProtocolPosition = {
  id: string;
  protocol: Protocol;
  kind: ProtocolKind;
  label: string;      // "USDC/ETH LP" or "tNVDA-PERP LONG"
  detail?: string;    // e.g. "5x · liq $812"
  usd: number;
  apy?: number;
  pnl?: number;
  unlockAt?: number;
};

function seed32(addr: string): number {
  let h = 0x811c9dc5;
  const s = addr.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function rng(seed: number, i: number) {
  const x = Math.sin(seed + i * 129.31) * 10000;
  return x - Math.floor(x);
}

const NADO_PAIRS = ["tNVDA-PERP", "tLMT-PERP", "XMR-PERP", "ETH-PERP", "tTSM-PERP"];
const VELO_PAIRS = ["ETH/USDC", "USDC/USDT", "tBTC/ETH"];
const INKY_PAIRS = ["INK/USDC", "ETH/INK", "PAXG/USDC"];
const PUMP_MEMES = ["$DARPA", "$SIGNAL", "$ONYX", "$CIPHER", "$NADO"];

export function protocolPositionsForAddress(addr: string): ProtocolPosition[] {
  const s = seed32(addr);
  const out: ProtocolPosition[] = [];

  // Nado — one open perp
  if (rng(s, 1) > 0.25) {
    const pair = NADO_PAIRS[Math.floor(rng(s, 2) * NADO_PAIRS.length)];
    const size = 2000 + rng(s, 3) * 24000;
    const pnl = (rng(s, 4) - 0.4) * size * 0.3;
    const lev = 1 + Math.floor(rng(s, 5) * 9);
    out.push({
      id: `nado-${addr}-1`,
      protocol: "Nado",
      kind: "perp",
      label: pair + (pnl >= 0 ? " LONG" : " SHORT"),
      detail: `${lev}x · unified margin`,
      usd: +size.toFixed(0),
      pnl: +pnl.toFixed(0),
    });
  }
  // Nado — margin idle balance
  out.push({
    id: `nado-${addr}-m`,
    protocol: "Nado",
    kind: "margin",
    label: "Unified Margin (USDC)",
    usd: +(1200 + rng(s, 6) * 18000).toFixed(0),
  });

  // Velodrome LPs
  const veloN = 1 + Math.floor(rng(s, 7) * 2);
  for (let i = 0; i < veloN; i++) {
    out.push({
      id: `velo-${addr}-${i}`,
      protocol: "Velodrome",
      kind: "pool",
      label: VELO_PAIRS[(Math.floor(rng(s, 10 + i) * VELO_PAIRS.length))] + " LP",
      detail: "staked · vAMM",
      usd: +(800 + rng(s, 20 + i) * 12000).toFixed(0),
      apy: +(4 + rng(s, 30 + i) * 22).toFixed(2),
    });
  }

  // InkySwap LP
  if (rng(s, 40) > 0.35) {
    out.push({
      id: `inky-${addr}-1`,
      protocol: "InkySwap",
      kind: "pool",
      label: INKY_PAIRS[Math.floor(rng(s, 41) * INKY_PAIRS.length)] + " LP",
      detail: "concentrated · full range",
      usd: +(400 + rng(s, 42) * 7000).toFixed(0),
      apy: +(6 + rng(s, 43) * 30).toFixed(2),
    });
  }

  // InkyPump — up to two meme positions
  const pumpN = Math.floor(rng(s, 50) * 3);
  for (let i = 0; i < pumpN; i++) {
    const meme = PUMP_MEMES[Math.floor(rng(s, 51 + i) * PUMP_MEMES.length)];
    const usd = 100 + rng(s, 60 + i) * 5000;
    const pnl = (rng(s, 70 + i) - 0.35) * usd * 1.8;
    out.push({
      id: `pump-${addr}-${i}`,
      protocol: "InkyPump",
      kind: "position",
      label: `${meme} bag`,
      detail: rng(s, 80 + i) > 0.5 ? "bonded · migrated" : "pre-bond",
      usd: +usd.toFixed(0),
      pnl: +pnl.toFixed(0),
    });
  }

  // InkyPump — LP lock contract (dev-locked)
  if (rng(s, 90) > 0.55) {
    const meme = PUMP_MEMES[Math.floor(rng(s, 91) * PUMP_MEMES.length)];
    const days = 30 + Math.floor(rng(s, 92) * 300);
    out.push({
      id: `pumplock-${addr}-1`,
      protocol: "InkyPump Lock",
      kind: "lock",
      label: `${meme}/ETH LP (locked)`,
      detail: `unlocks in ${days}d`,
      usd: +(1200 + rng(s, 93) * 22000).toFixed(0),
      unlockAt: Date.now() + days * 86400_000,
    });
  }

  return out;
}

