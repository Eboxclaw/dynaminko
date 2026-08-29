import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { CHAINS, getChain } from "@/chains";
import type { WalletSnapshot } from "@/lib/chain/blockscout";
import { idbGet, idbSet } from "@/lib/cache/idb";
import {
  ingestTransfers,
  mergeTrades,
  readLedgerTrades,
  recordSync,
  sinceBlockFor,
  withQuotes,
} from "@/lib/ledger";
import { buildPortfolio, tradesFromSnapshot, type Trade } from "@/lib/portfolio";
import { fetchQuotes, type Quote } from "@/lib/prices";
import { walletKey, type WalletRef } from "@/lib/store";
import type { ReaderResponse } from "@/workers/wallet-reader.worker";

import { useDoc } from "./useDoc";

/** Runs the chain read inside a worker so parsing never blocks the UI.
 * `sinceBlock` scopes the transfer leg to an incremental re-sync; balances
 * are always read in full. */
function readInWorker(
  address: string,
  chainId: number,
  sinceBlock: number | null = null,
): Promise<WalletSnapshot> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/wallet-reader.worker.ts", import.meta.url), {
      type: "module",
    });
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("wallet read timed out"));
    }, 30_000);

    worker.addEventListener("message", (event: MessageEvent<ReaderResponse>) => {
      const msg = event.data;
      if (msg.type === "snapshot") {
        clearTimeout(timeout);
        worker.terminate();
        resolve(msg.snapshot);
      } else if (msg.type === "error") {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error(msg.message));
      }
    });
    worker.addEventListener("error", (e) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(e.message || "worker failed"));
    });

    worker.postMessage({
      type: "scan",
      chainId,
      wallets: [{ id: address, address, sinceBlock }],
    });
  });
}

export function useActiveWallet() {
  const doc = useDoc();
  const active: WalletRef | null = useMemo(() => {
    // A paused wallet is deactivated: never resolved as active, and skipped
    // by the fallback. Rows stay listed via `wallets` for the toggle.
    const firstEligible = doc.wallets.find((w) => !w.paused) ?? null;
    if (!doc.activeWallet) return firstEligible;
    return (
      doc.wallets.find((w) => walletKey(w.chainId, w.address) === doc.activeWallet && !w.paused) ??
      firstEligible
    );
  }, [doc.activeWallet, doc.wallets]);
  return { active, wallets: doc.wallets, chains: CHAINS };
}

export function usePortfolio() {
  const doc = useDoc();
  const overrides = doc.settings.basketOverrides;
  const { active, wallets } = useActiveWallet();
  const key = active ? walletKey(active.chainId, active.address) : null;

  const snapshotQuery = useQuery({
    queryKey: ["snapshot", key],
    enabled: Boolean(active),
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: async () => {
      if (!active) return null;
      const wallet = walletKey(active.chainId, active.address);
      const cacheKey = `snapshot:${wallet}`;
      try {
        // Incremental when the ledger has a fresh bookmark, full on first
        // contact and at least daily so the ledger self-heals.
        const since = await sinceBlockFor(wallet);
        const fresh = await readInWorker(active.address, active.chainId, since);
        void idbSet(cacheKey, fresh);
        // File the transfers into the persistent ledger, then bookmark how
        // far the read reached. The snapshot only carries the recent window;
        // the ledger is the history.
        const filed = await ingestTransfers(wallet, fresh.transfers);
        await recordSync(wallet, filed.maxBlock, since == null);
        return fresh;
      } catch (err) {
        const cached = await idbGet<WalletSnapshot>(cacheKey);
        if (cached) return cached;
        throw err;
      }
    },
  });

  const snapshot = snapshotQuery.data ?? null;

  const symbols = useMemo(() => {
    if (!snapshot) return [];
    return Array.from(
      new Set([
        snapshot.native.symbol,
        ...snapshot.tokens.map((t) => t.symbol),
        ...snapshot.transfers.map((t) => t.symbol),
      ]),
    );
  }, [snapshot]);

  const quotesQuery = useQuery({
    queryKey: ["quotes", symbols.join(",")],
    enabled: symbols.length > 0,
    staleTime: 60_000,
    refetchInterval: 180_000,
    queryFn: async ({ signal }): Promise<Quote[]> => {
      try {
        return await fetchQuotes(symbols, signal);
      } catch {
        return [];
      }
    },
  });

  const quotes = useMemo(() => quotesQuery.data ?? [], [quotesQuery.data]);
  const portfolio = useMemo(
    () => buildPortfolio(snapshot, quotes, overrides),
    [snapshot, quotes, overrides],
  );
  // History beyond the current transfer window comes from the persistent
  // ledger; the snapshot-derived feed only contributes rows the ledger has
  // not filed yet (it is filed during the snapshot query, so this is usually
  // a superset read plus a safety net).
  const tradesKey = `${symbols.join(",")}:${snapshot?.fetchedAt ?? 0}`;
  const tradesQuery = useQuery({
    queryKey: ["ledger-trades", key, tradesKey],
    enabled: Boolean(active && snapshot),
    staleTime: 60_000,
    queryFn: async (): Promise<Trade[]> => {
      if (!active) return [];
      const wallet = walletKey(active.chainId, active.address);
      const rows = withQuotes(await readLedgerTrades(wallet, 500), quotes);
      return mergeTrades(rows, tradesFromSnapshot(snapshot, quotes));
    },
  });
  const trades = tradesQuery.data ?? [];

  const refresh = useCallback(() => {
    void snapshotQuery.refetch();
    void quotesQuery.refetch();
  }, [snapshotQuery, quotesQuery]);

  return {
    active,
    hasWallet: wallets.length > 0,
    chain: active ? getChain(active.chainId) : null,
    snapshot,
    portfolio,
    trades,
    quotes,
    status: snapshotQuery.status,
    isFetching: snapshotQuery.isFetching,
    error: snapshotQuery.error as Error | null,
    fetchedAt: snapshot?.fetchedAt ?? null,
    refresh,
  };
}
