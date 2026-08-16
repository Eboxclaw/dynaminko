import { useQuery } from "@tanstack/react-query";

import { idbGet, idbSet } from "@/lib/cache/idb";
import { walletKey } from "@/lib/store";
import { readVenues, reportValue, type VenueAction, type VenueReport } from "@/lib/venues";
import type { ReaderRequest, ReaderResponse } from "@/workers/wallet-reader.worker";

import { useActiveWallet } from "./usePortfolio";

type VenueData = { reports: VenueReport[]; actions: VenueAction[] };

/** Runs venue reads in the shared reader worker; falls back to the main thread. */
function readInWorker(address: string, chainId: number): Promise<VenueData> {
  if (typeof Worker === "undefined") {
    // main-thread fallback: positions only, actions stay the worker's job
    return readVenues(address, chainId).then((reports) => ({ reports, actions: [] }));
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/wallet-reader.worker.ts", import.meta.url), {
      type: "module",
    });
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("venue read timed out"));
    }, 45_000);
    const finish = (fn: () => void) => {
      clearTimeout(timeout);
      worker.terminate();
      fn();
    };
    worker.addEventListener("message", (event: MessageEvent<ReaderResponse>) => {
      const msg = event.data;
      if (msg.type === "venues")
        finish(() => resolve({ reports: msg.reports, actions: msg.actions }));
      else if (msg.type === "error") finish(() => reject(new Error(msg.message)));
    });
    worker.addEventListener("error", (e) =>
      finish(() => reject(new Error(e.message || "worker failed"))),
    );
    worker.postMessage({ type: "venues", chainId, address } satisfies ReaderRequest);
  });
}

/**
 * Reads LP and trading-account positions plus venue actions (trades, deposits,
 * withdrawals) for the active wallet. Successful reports are cached; a failed
 * venue falls back to its last good answer, flagged stale, instead of blanking
 * the row. Actions are not cached — the store dedupes them by id on ingest.
 */
export function useVenues() {
  const { active } = useActiveWallet();
  const key = active ? walletKey(active.chainId, active.address) : null;

  const query = useQuery({
    queryKey: ["venues", key],
    enabled: Boolean(active),
    staleTime: 60_000,
    refetchInterval: 180_000,
    queryFn: async (): Promise<VenueData> => {
      if (!active) return { reports: [], actions: [] };
      const cacheKey = `venues:${key}`;
      const cached = (await idbGet<VenueReport[]>(cacheKey).catch(() => null)) ?? [];
      let fresh: VenueData;
      try {
        fresh = await readInWorker(active.address, active.chainId);
      } catch {
        return { reports: cached.map((r) => ({ ...r, stale: true })), actions: [] };
      }
      const merged = fresh.reports.map((r) => {
        if (r.status !== "error") return r;
        const prev = cached.find((c) => c.venueId === r.venueId);
        if (!prev || prev.status === "error") return r;
        return { ...prev, stale: true, note: r.note };
      });
      void idbSet(
        cacheKey,
        merged.filter((r) => r.status === "ok"),
      );
      return { reports: merged, actions: fresh.actions };
    },
  });

  const reports = query.data?.reports ?? [];
  const actions = query.data?.actions ?? [];
  const total = reports.reduce((sum, r) => sum + reportValue(r), 0);
  const accounts = reports.flatMap((r) => r.accounts ?? []);
  const equity = accounts.reduce((sum, a) => sum + (a.equity ?? 0), 0);

  return { reports, accounts, total, equity, actions, isFetching: query.isFetching };
}
