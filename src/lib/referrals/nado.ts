// Nado referral binding reader + deep-link builder.
//
// Unlike Hyperliquid, Nado has NO programmatic setReferrer — binding is
// dashboard-only at app.nado.xyz/referrals. This adapter:
//   1. Reads current binding via the Gateway indexer (read-only, no auth)
//   2. Builds a deep-link for manual binding
//   3. Orchestrates the check-then-deep-link-then-repoll pattern
//
// Reference: https://docs.nado.xyz/incentives-and-rewards/referrals
//            https://docs.nado.xyz/developer-resources/api/gateway/signing

const NADO_REFERRALS_APP_URL = "https://app.nado.xyz/referrals";
const GATEWAY = "https://gateway.prod.nado.xyz/v1/query";

export type NadoReferralBinding = {
  bound: boolean;
  code: string | null;
};

/** getReferralCode is read-only against the indexer. No signature, no auth. */
export async function getNadoReferralBinding(
  subaccountOwner: string,
  subaccountName: string,
  signal?: AbortSignal,
): Promise<NadoReferralBinding> {
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "referral_code",
      subaccount_owner: subaccountOwner.toLowerCase(),
      subaccount_name: subaccountName,
    }),
    signal,
  });
  if (!res.ok) throw new Error(`Nado referral query failed: ${res.status}`);
  const data = (await res.json()) as { code?: string | null };
  const code: string | null = data?.code ?? null;
  return { bound: code !== null, code };
}

/**
 * Builds the deep-link out to Nado's dashboard for manual referral binding.
 * Whether the `code` query param actually pre-fills the field is unconfirmed
 * against the live page — pass the bare URL as fallback.
 */
export function buildNadoReferralDeepLink(affiliateCode?: string): string {
  if (!affiliateCode) return NADO_REFERRALS_APP_URL;
  const url = new URL(NADO_REFERRALS_APP_URL);
  url.searchParams.set("code", affiliateCode);
  return url.toString();
}

/**
 * Check binding and return the action: already_bound with the code, or
 * prompt_bind with a deep-link. The caller opens the link and later calls
 * getNadoReferralBinding again to confirm.
 */
export async function checkNadoReferralOrPromptBind(
  subaccountOwner: string,
  subaccountName: string,
  affiliateCode?: string,
): Promise<
  | { action: "already_bound"; code: string }
  | { action: "prompt_bind"; deepLink: string }
> {
  const current = await getNadoReferralBinding(subaccountOwner, subaccountName);
  if (current.bound && current.code) {
    return { action: "already_bound", code: current.code };
  }
  return { action: "prompt_bind", deepLink: buildNadoReferralDeepLink(affiliateCode) };
}