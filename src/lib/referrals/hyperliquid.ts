// Hyperliquid referral state reader + setReferrer L1 action.
//
// Single info endpoint surfaces referrer, volume, rewards, and builder fees in
// one payload. setReferrer binds a code programmatically via signed L1 action
// (no dashboard round-trip required, unlike Nado).
//
// Reference: https://hyperliquid.gitbook.io/hyperliquid-docs/referrals
//            https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint

export type HyperliquidReferralState = {
  /** Who referred this user, if anyone. */
  referredBy: { referrer: string; code: string } | null;
  /** Cumulative trading volume in USD. */
  cumVolumeUsd: number;
  unclaimedReferralRewardsUsd: number;
  claimedReferralRewardsUsd: number;
  /** Builder rewards are a separate stream returned in the same payload. */
  builderRewardsUsd: number;
};

const HL_INFO_URL = "https://api.hyperliquid.xyz/info";
const HL_EXCHANGE_URL = "https://api.hyperliquid.xyz/exchange";
const L1_ACTION_CHAIN_ID = 1337;
const REFERRAL_VOLUME_THRESHOLD = 10_000; // $10k to unlock your own code

/**
 * Queries referral + builder reward state for a Hyperliquid user address.
 * Single payload covers both streams; do not build separate polling for
 * referral vs builder rewards.
 */
export async function getReferralState(
  userAddress: string,
  signal?: AbortSignal,
): Promise<HyperliquidReferralState> {
  const res = await fetch(HL_INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "referral", user: userAddress }),
    signal,
  });
  if (!res.ok) throw new Error(`Hyperliquid referral query failed: ${res.status}`);
  const data = (await res.json()) as {
    referredBy?: { referrer: string; code: string } | null;
    cumVlm?: string;
    unclaimedRewards?: string;
    claimedRewards?: string;
    builderRewards?: string;
  };
  return {
    referredBy: data.referredBy ?? null,
    cumVolumeUsd: Number(data.cumVlm ?? 0),
    unclaimedReferralRewardsUsd: Number(data.unclaimedRewards ?? 0),
    claimedReferralRewardsUsd: Number(data.claimedRewards ?? 0),
    builderRewardsUsd: Number(data.builderRewards ?? 0),
  };
}

/**
 * Returns how far the user is toward unlocking their own referral code, as a
 * fraction of the $10k volume threshold (0..1).
 */
export function referralVolumeProgress(state: HyperliquidReferralState): number {
  return Math.min(state.cumVolumeUsd / REFERRAL_VOLUME_THRESHOLD, 1);
}

/**
 * A signer interface. In practice, pass `window.ethereum`-based typed-data
 * signing; types are kept abstract so this adapter has no wallet dependency.
 */
export interface TypedDataSigner {
  readonly address: string;
  signTypedData(domain: unknown, types: unknown, message: unknown): Promise<string>;
}

/**
 * Binds this user's account to a referral code via a signed L1 action.
 *
 * This does NOT require a dashboard visit. It is a programmatic signed action
 * that Hyperliquid processes on-chain.
 *
 * The signing path uses the Agent phantom-agent scheme (sign_l1_action), same
 * as most L1 actions. This is distinct from ApproveBuilderFee which uses
 * sign_user_signed_action.
 *
 * Returns { ok: true } on success, or { ok: false, error: string } on failure.
 */
export async function setReferrer(
  signer: TypedDataSigner,
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const timestamp = Date.now();
  const action = { type: "setReferrer" as const, code };

  const domain = {
    name: "Exchange",
    version: "1",
    chainId: L1_ACTION_CHAIN_ID,
    verifyingContract: "0x0000000000000000000000000000000000000000",
  };
  const types = {
    Agent: [
      { name: "source", type: "string" },
      { name: "connectionId", type: "bytes32" },
    ],
  };

  const signature = await signer.signTypedData(domain, types, action);

  const res = await fetch(HL_EXCHANGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, signature, nonce: timestamp }),
  });
  const body = (await res.json()) as { status?: string; response?: string };
  if (body.status !== "ok") {
    return { ok: false, error: body.response ?? "setReferrer rejected" };
  }
  return { ok: true };
}