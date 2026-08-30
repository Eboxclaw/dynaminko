import { useQuery } from "@tanstack/react-query";

import { idbGet, idbSet, storeByIndex, storePut } from "@/lib/cache/idb";
import { track } from "@/lib/stats/client";
import { walletKey } from "@/lib/store";
import { reportValue, readVenues, type VenueAction, type VenueReport } from "@/lib/venues";
import { readVenuesInWorker } from "@/lib/wallet-reader-service";

import { useActiveWallet } from "./usePortfolio";

type VenueData = { reports: VenueReport[]; actions: VenueAction[] };

type CachedAction = VenueAction & { wallet: string };

/** Venue actions survive failed reads: the store dedupes signals by id, so
 * re-serving the cached list only re-files what is already there. */
function cachedActionsFor(key: string): Promise<VenueAction[]> {
  return storeByIndex<CachedAction>("actions", "wallet", key);
}

/** Runs venue reads through the persistent reader service; falls back to the
 * main thread where Worker is unavailable. */
function readInWorker(address: string, chainId: number): Promise<VenueData> {
  if (typeof Worker === "undefined") {
    // main-thread fallback: positions only, actions stay the worker's job
    return readVenues(address, chainId).then((reports) => ({ reports, actions: [] }));
  }
  return readVenuesInWorker(address, chainId).then((r) => r as VenueData);
}

/**
 * Reads LP and trading-account positions plus venue actions (trades, deposits,
 * withdrawals) for the active wallet. Successful reports and actions are
 * cached; a failed read falls back to the last good answer, flagged stale,
 * instead of blanking the row or losing the inbox's pending list.
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
      const wallet = walletKey(active.chainId, active.address);
      const cacheKey = `venues:${wallet}`;
      const cached = (await idbGet<VenueReport[]>(cacheKey).catch(() => null)) ?? [];
      let fresh: VenueData;
      try {
        fresh = await readInWorker(active.address, active.chainId);
        for (const r of fresh.reports) {
          if (r.status === "ok") track(`venue_read_${r.venueId}`);
        }
      } catch {
        return {
          reports: cached.map((r) => ({ ...r, stale: true })),
          actions: await cachedActionsFor(wallet),
        };
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
      void storePut(
        "actions",
        fresh.actions.map((a) => ({ ...a, wallet })),
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
