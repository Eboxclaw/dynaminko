import { useQuery } from "@tanstack/react-query";

import { idbGet, idbSet } from "@/lib/cache/idb";
import { walletKey } from "@/lib/store";
import { readVenues, reportValue, type VenueReport } from "@/lib/venues";
import type { ReaderRequest, ReaderResponse } from "@/workers/wallet-reader.worker";

import { useActiveWallet } from "./usePortfolio";

/** Runs venue reads in the shared reader worker; falls back to the main thread. */
function readInWorker(address: string, chainId: number): Promise<VenueReport[]> {
  if (typeof Worker === "undefined") return readVenues(address, chainId);
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
      if (msg.type === "venues") finish(() => resolve(msg.reports));
      else if (msg.type === "error") finish(() => reject(new Error(msg.message)));
    });
    worker.addEventListener("error", (e) =>
      finish(() => reject(new Error(e.message || "worker failed"))),
    );
    worker.postMessage({ type: "venues", chainId, address } satisfies ReaderRequest);
  });
}

/**
 * Reads LP and trading-account positions for the active wallet.
 * Successful reports are cached; a failed venue falls back to its last good
 * answer, flagged stale, instead of blanking the row.
 */
export function useVenues() {
  const { active } = useActiveWallet();
  const key = active ? walletKey(active.chainId, active.address) : null;

  const query = useQuery({
    queryKey: ["venues", key],
    enabled: Boolean(active),
    staleTime: 60_000,
    refetchInterval: 180_000,
    queryFn: async (): Promise<VenueReport[]> => {
      if (!active) return [];
      const cacheKey = `venues:${key}`;
      const cached = (await idbGet<VenueReport[]>(cacheKey).catch(() => null)) ?? [];
      let fresh: VenueReport[];
      try {
        fresh = await readInWorker(active.address, active.chainId);
      } catch {
        return cached.map((r) => ({ ...r, stale: true }));
      }
      const merged = fresh.map((r) => {
        if (r.status !== "error") return r;
        const prev = cached.find((c) => c.venueId === r.venueId);
        if (!prev || prev.status === "error") return r;
        return { ...prev, stale: true, note: r.note };
      });
      void idbSet(
        cacheKey,
        merged.filter((r) => r.status === "ok"),
      );
      return merged;
    },
  });

  const reports = query.data ?? [];
  const total = reports.reduce((sum, r) => sum + reportValue(r), 0);
  const accounts = reports.flatMap((r) => r.accounts ?? []);
  const equity = accounts.reduce((sum, a) => sum + (a.equity ?? 0), 0);

  return { reports, accounts, total, equity, isFetching: query.isFetching };
}
