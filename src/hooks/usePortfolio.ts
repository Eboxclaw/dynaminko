import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { CHAINS, getChain } from "@/chains";
import type { WalletSnapshot } from "@/lib/chain/blockscout";
import { idbGet, idbSet } from "@/lib/cache/idb";
import { buildPortfolio, tradesFromSnapshot } from "@/lib/portfolio";
import { fetchQuotes, type Quote } from "@/lib/prices";
import { walletKey, type WalletRef } from "@/lib/store";
import type { ReaderResponse } from "@/workers/wallet-reader.worker";

import { useDoc } from "./useDoc";

/** Runs the chain read inside a worker so parsing never blocks the UI. */
function readInWorker(address: string, chainId: number): Promise<WalletSnapshot> {
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
      wallets: [{ id: address, address }],
    });
  });
}

export function useActiveWallet() {
  const doc = useDoc();
  const active: WalletRef | null = useMemo(() => {
    if (!doc.activeWallet) return doc.wallets[0] ?? null;
    return (
      doc.wallets.find((w) => walletKey(w.chainId, w.address) === doc.activeWallet) ??
      doc.wallets[0] ??
      null
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
      const cacheKey = `snapshot:${key}`;
      try {
        const fresh = await readInWorker(active.address, active.chainId);
        void idbSet(cacheKey, fresh);
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

  const quotes = quotesQuery.data ?? [];
  const portfolio = useMemo(
    () => buildPortfolio(snapshot, quotes, overrides),
    [snapshot, quotes, overrides],
  );
  const trades = useMemo(() => tradesFromSnapshot(snapshot, quotes), [snapshot, quotes]);

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
