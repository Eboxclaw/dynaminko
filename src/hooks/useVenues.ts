import { useQuery } from "@tanstack/react-query";

import { readVenues, type VenueReport } from "@/lib/venues";
import { walletKey } from "@/lib/store";

import { useActiveWallet } from "./usePortfolio";

/** Reads LP and trading-account positions for the active wallet. */
export function useVenues() {
  const { active } = useActiveWallet();
  const key = active ? walletKey(active.chainId, active.address) : null;

  const query = useQuery({
    queryKey: ["venues", key],
    enabled: Boolean(active),
    staleTime: 60_000,
    refetchInterval: 180_000,
    queryFn: async ({ signal }): Promise<VenueReport[]> => {
      if (!active) return [];
      return readVenues(active.address, active.chainId, signal);
    },
  });

  const reports = query.data ?? [];
  const total = reports.reduce(
    (sum, r) => sum + r.positions.reduce((s, p) => s + (p.value ?? 0), 0),
    0,
  );

  return { reports, total, isFetching: query.isFetching };
}
