import { useQuery } from "@tanstack/react-query";

import { idbGet, idbSet } from "@/lib/cache/idb";
import { getNadoReferralBinding, type NadoReferralBinding } from "@/lib/referrals/nado";
import { readSubaccounts } from "@/lib/venues/nado";
import { walletKey } from "@/lib/store";

import { useActiveWallet } from "./usePortfolio";

const NADO_CHAIN_ID = 57073;

type NadoReferralResult = {
  binding: NadoReferralBinding;
  subaccountName: string;
};

/**
 * Fetches Nado referral binding for the active wallet's first subaccount.
 * Cached in IndexedDB for stale-while-revalidate.
 * Nado referral binding does NOT change without a dashboard visit, so
 * there is no refetchInterval — only the manual re-check trigger matters.
 */
export function useNadoReferral() {
  const { active } = useActiveWallet();
  const key = active ? walletKey(active.chainId, active.address) : null;
  const onNado = active?.chainId === NADO_CHAIN_ID;

  const query = useQuery({
    queryKey: ["nado-referral", key],
    enabled: Boolean(onNado && active?.address),
    staleTime: 5 * 60_000, // 5 min — binding doesn't change often
    // No refetchInterval — Nado binding only changes via the dashboard
    queryFn: async (): Promise<NadoReferralResult | null> => {
      if (!active?.address) return null;
      const cacheKey = `nado-referral:${key}`;

      // Discover first subaccount name
      let subName = "default";
      try {
        const subs = await readSubaccounts(active.address);
        subName = subs[0]?.subaccount_name ?? "default";
      } catch {
        // fall through with "default"
      }

      const cached = await idbGet<NadoReferralResult>(cacheKey).catch(() => null);

      try {
        const binding = await getNadoReferralBinding(active.address, subName);
        const result: NadoReferralResult = { binding, subaccountName: subName };
        void idbSet(cacheKey, result);
        return result;
      } catch {
        if (cached) return cached;
        return null;
      }
    },
  });

  return {
    referral: query.data ?? null,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}