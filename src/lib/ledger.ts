// Persistent trade ledger: the append-only history the transfer feed reads
// from. The chain read returns a bounded transfer window (and, once
// sinceBlock wiring is active, only the transfers newer than the last sync),
// so a feed derived straight from the snapshot forgot everything past 120
// rows. Every fresh transfer is filed here exactly once, deduped by its
// stable id, and history reads back from this store no matter how the chain
// read was scoped.

import { metaGet, metaSet, storeByIndex, storePut } from "./cache/idb";
import type { ChainTransfer } from "./chain/blockscout";
import type { Quote } from "./prices";
import type { Trade } from "./portfolio";
import { sectorFor } from "./sectors";

export type LedgerTrade = Trade & {
  wallet: string;
  venue: "evm";
  block: number | null;
  filedAt: number;
};

/** One row per wallet in the meta store. */
export type SyncMeta = {
  /** highest block number the ledger has filed for this wallet */
  lastBlock: number | null;
  /** when the last full (sinceBlock-free) scan ran */
  fullAt: number;
};

const FULL_REFRESH_MS = 24 * 60 * 60 * 1000;

export function transferId(t: Pick<ChainTransfer, "txHash" | "logIndex">): string {
  return `${t.txHash}:${t.logIndex}`;
}

/** Same id format the derived feed has always used, so journal entries that
 * reference a tradeId keep reconciling against ledger rows. */
function ledgerRow(wallet: string, t: ChainTransfer): LedgerTrade {
  return {
    id: transferId(t),
    symbol: t.symbol,
    side: t.direction,
    amount: t.amount,
    value: null,
    ts: t.ts,
    txHash: t.txHash,
    counterparty: t.counterparty,
    sector: sectorFor(t.symbol),
    wallet,
    venue: "evm",
    block: t.blockNumber ?? null,
    filedAt: Date.now(),
  };
}

/** File fresh transfers, deduping against what this wallet already filed.
 * Returns how many rows were new and the highest block seen, for the sync
 * bookmark. */
export async function ingestTransfers(
  wallet: string,
  transfers: ChainTransfer[],
): Promise<{ added: number; maxBlock: number | null }> {
  if (!wallet || transfers.length === 0) return { added: 0, maxBlock: null };
  const known = new Set(
    (await storeByIndex<LedgerTrade>("trades", "wallet", wallet)).map((r) => r.id),
  );
  const fresh = transfers.filter((t) => !known.has(transferId(t)));
  if (fresh.length > 0)
    await storePut(
      "trades",
      fresh.map((t) => ledgerRow(wallet, t)),
    );
  const maxBlock = transfers.reduce((m, t) => Math.max(m, t.blockNumber ?? 0), 0);
  return { added: fresh.length, maxBlock: maxBlock > 0 ? maxBlock : null };
}

/** Newest-first history for one wallet, capped. Values are left null: they
 * depend on quotes, which change; withQuotes() prices rows at read time. */
export async function readLedgerTrades(wallet: string, limit = 500): Promise<LedgerTrade[]> {
  if (!wallet) return [];
  const rows = await storeByIndex<LedgerTrade>("trades", "wallet", wallet);
  return rows.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

/** Price ledger rows with the current quote set, matching the shape the
 * derived feed produces. */
export function withQuotes(rows: LedgerTrade[], quotes: Quote[]): Trade[] {
  const quoteBy = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));
  return rows.map((r) => {
    const price = quoteBy.get(r.symbol.toUpperCase())?.usd ?? null;
    return { ...r, value: price != null ? price * r.amount : null };
  });
}

/** Merge two trade lists on id, newest first: ledger history plus whatever
 * the current snapshot derived. */
export function mergeTrades(primary: Trade[], extra: Trade[]): Trade[] {
  const seen = new Set<string>();
  const out: Trade[] = [];
  for (const t of [...primary, ...extra]) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out.sort((a, b) => b.ts - a.ts);
}

// ── sync bookmarks ─────────────────────────────────────────────────────────

function metaKey(wallet: string): string {
  return `sync:${wallet}`;
}

export async function syncMetaFor(wallet: string): Promise<SyncMeta | null> {
  return (await metaGet<SyncMeta>(metaKey(wallet))) ?? null;
}

/** Record a completed scan. `full` true refreshes the full-scan timestamp;
 * maxBlock only ever moves forward. */
export async function recordSync(
  wallet: string,
  maxBlock: number | null,
  full: boolean,
): Promise<void> {
  if (!wallet) return;
  const prev = await syncMetaFor(wallet);
  const meta: SyncMeta = {
    lastBlock: maxBlock ?? prev?.lastBlock ?? null,
    fullAt: full ? Date.now() : (prev?.fullAt ?? 0),
  };
  await metaSet(metaKey(wallet), meta);
}

/**
 * The sinceBlock to pass to the next chain read, or null for a full scan.
 * Full scans happen on first contact and at least once a day, so the ledger
 * self-heals instead of drifting on a missed increment forever.
 */
export async function sinceBlockFor(wallet: string): Promise<number | null> {
  const meta = await syncMetaFor(wallet);
  if (!meta?.lastBlock) return null;
  if (!meta.fullAt || Date.now() - meta.fullAt > FULL_REFRESH_MS) return null;
  return meta.lastBlock;
}
