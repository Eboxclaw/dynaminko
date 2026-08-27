import { useQuery } from "@tanstack/react-query";

import { idbGet, idbSet } from "@/lib/cache/idb";
import {
  getReferralState,
  referralVolumeProgress,
  type HyperliquidReferralState,
} from "@/lib/referrals/hyperliquid";
import { walletKey } from "@/lib/store";

import { useActiveWallet } from "./usePortfolio";

const REFERRAL_VOLUME_THRESHOLD = 10_000;

type ReferralQueryResult = {
  state: HyperliquidReferralState;
  cumVolumePct: number; // 0..1 toward $10k threshold
  canGenerateCode: boolean; // true when volume >= 10k
  totalEarnedUsd: number;
};

/**
 * Fetches Hyperliquid referral state for the active wallet address.
 * Lightweight single POST — runs on main thread, no worker needed.
 * Cached in IndexedDB for stale-while-revalidate.
 */
export function useHyperliquidReferral() {
  const { active } = useActiveWallet();
  const key = active ? walletKey(active.chainId, active.address) : null;
  const isHyperliquidUser = active?.address !== undefined;

  const query = useQuery({
    queryKey: ["hl-referral", key],
    enabled: Boolean(isHyperliquidUser),
    staleTime: 60_000,
    refetchInterval: 180_000,
    queryFn: async (): Promise<ReferralQueryResult | null> => {
      if (!active?.address) return null;
      const cacheKey = `hl-referral:${key}`;

      // Try cache first for instant render
      const cached = await idbGet<HyperliquidReferralState>(cacheKey).catch(() => null);

      try {
        const state = await getReferralState(active.address);
        void idbSet(cacheKey, state);
        return buildResult(state);
      } catch {
        if (cached) return { ...buildResult(cached), state: cached };
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

function buildResult(state: HyperliquidReferralState): ReferralQueryResult {
  const pct = referralVolumeProgress(state);
  return {
    state,
    cumVolumePct: pct,
    canGenerateCode: state.cumVolumeUsd >= REFERRAL_VOLUME_THRESHOLD,
    totalEarnedUsd:
      state.unclaimedReferralRewardsUsd + state.claimedReferralRewardsUsd + state.builderRewardsUsd,
  };
}
