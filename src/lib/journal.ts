// Journal model. Every executed trade (from a read or live wallet) is a
// TradeEvent. Journaling links a TradeEvent to a thesis + sentiment + emotion
// via a JournalEntry. Storage is local-only; this module never talks to a
// chain — trade "detection" is a deterministic mock derived from the wallet
// address so the UI can drive the wizard flow end-to-end today. When a real
// indexer lands, only syncTradesFromWallets() gets swapped.

import { ASSETS } from "./dynaminko-data";
import type { Wallet } from "./wallets";

export type TradeEvent = {
  id: string;              // `${walletId}:${idx}` — stable so we never duplicate
  walletId: string;
  walletAddress: string;
  ticker: string;
  side: "BUY" | "SELL";
  qty: number;
  price: number;
  ts: number;              // ms epoch
  txHash: string;          // mock
};

export type Sentiment =
  | "conviction"
  | "reactive"
  | "hedge"
  | "fomo"
  | "rebalance";

export type Emotion = "calm" | "anxious" | "excited" | "uncertain";

export type JournalEntry = {
  tradeId: string;
  thesisId: string | null;      // null = "no thesis" (still journaled)
  newThesisDraft?: string;      // when the user wrote a fresh thesis in-wizard
  sentiment: Sentiment;
  emotion: Emotion;
  confidence: number;           // 1..5
  notes: string;
  createdAt: number;
};

export type JournaledTrade = TradeEvent & {
  status: "pending" | "journaled" | "skipped";
  entry?: JournalEntry;
};

export const SENTIMENT_LABELS: Record<Sentiment, string> = {
  conviction: "Conviction",
  reactive: "Reactive",
  hedge: "Hedge",
  fomo: "FOMO",
  rebalance: "Rebalance",
};

export const EMOTION_LABELS: Record<Emotion, string> = {
  calm: "Calm",
  anxious: "Anxious",
  excited: "Excited",
  uncertain: "Uncertain",
};

// ── deterministic seeding ──────────────────────────────────────────────────
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

/** Merge in any wallet-derived trades that aren't already tracked. Idempotent. */
export function syncTradesFromWallets(
  existing: JournaledTrade[],
  wallets: Wallet[],
): JournaledTrade[] {
  const known = new Set(existing.map((t) => t.id));
  const out = [...existing];
  for (const w of wallets) {
    if (!w.visible) continue;
    const seed = seed32(w.address);
    const n = 2 + (seed % 3); // 2..4 trades per wallet
    for (let i = 0; i < n; i++) {
      const id = `${w.id}:${i}`;
      if (known.has(id)) continue;
      const r = (k: number) => rng(seed, i * 11 + k);
      const asset = ASSETS[Math.floor(r(1) * ASSETS.length)];
      const side: "BUY" | "SELL" = r(2) > 0.35 ? "BUY" : "SELL";
      const qty = +(1 + r(3) * 20).toFixed(2);
      const price = +(asset.price * (1 + (r(4) - 0.5) * 0.06)).toFixed(2);
      const ts = Date.now() - Math.floor(r(5) * 12 * 86400_000);
      const hashSeed = (seed ^ (i * 2654435761)) >>> 0;
      const txHash =
        "0x" +
        hashSeed.toString(16).padStart(8, "0").repeat(8).slice(0, 64);
      out.push({
        id,
        walletId: w.id,
        walletAddress: w.address,
        ticker: asset.ticker,
        side,
        qty,
        price,
        ts,
        txHash,
        status: "pending",
      });
    }
  }
  return out.sort((a, b) => b.ts - a.ts);
}

/** Trades still awaiting a journal entry. */
export function pendingTrades(trades: JournaledTrade[]) {
  return trades.filter((t) => t.status === "pending");
}
