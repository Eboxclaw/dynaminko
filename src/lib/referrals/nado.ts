// Nado referral binding reader + deep-link builder.
//
// Unlike Hyperliquid, Nado has NO programmatic setReferrer — binding is
// dashboard-only at app.nado.xyz/referrals. This adapter:
//   1. Reads current binding via the Archive indexer (read-only, no auth)
//   2. Builds a deep-link for manual binding
//   3. Orchestrates the check-then-deep-link-then-repoll pattern
//
// Wire format mirrors nadohq/nado-typescript-sdk (IndexerBaseClient):
// POST https://archive.prod.nado.xyz/v1 with {"referral_code": {"subaccount":
// "<packed bytes32 hex>"}} → {"referral_code": string | null}. The packed
// subaccount is the same value readSubaccounts() already returns.
//
// LIVE STATUS (2026-08-25): the `referral_code` variant is NOT deployed on
// any public Nado service yet — prod archive v1/v2, prod gateway /v1/query,
// and /rewards/v1 all reject it as an unknown variant (422), testnet too.
// The SDK ships the method ahead of the backend. The envelope here is kept
// SDK-exact so the reader starts working unchanged the day Nado deploys it;
// until then callers see a thrown error and the UI shows its unavailable
// state rather than a wrong "not bound".
//
// Reference: https://docs.nado.xyz/incentives-and-rewards/referrals
//            https://docs.nado.xyz/developer-resources/api/gateway/signing

const NADO_REFERRALS_APP_URL = "https://app.nado.xyz/referrals";
const ARCHIVE = "https://archive.prod.nado.xyz/v1";

export type NadoReferralBinding = {
  bound: boolean;
  code: string | null;
};

/** getReferralCode is read-only against the Archive indexer. No signature, no
 * auth. Takes the PACKED subaccount hex (subs[n].subaccount), not an address. */
export async function getNadoReferralBinding(
  packedSubaccount: string,
  signal?: AbortSignal,
): Promise<NadoReferralBinding> {
  const res = await fetch(ARCHIVE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ referral_code: { subaccount: packedSubaccount } }),
    signal,
  });
  if (!res.ok) throw new Error(`Nado referral query failed: ${res.status}`);
  const data = (await res.json()) as { referral_code?: string | null };
  const code: string | null = data?.referral_code ?? null;
  return { bound: code !== null, code };
}

/**
 * Builds the deep-link out to Nado's dashboard for manual referral binding.
 * The `code` query param is not a documented prefill on their page — treat
 * the link as "open the referrals dashboard" and show the code for manual
 * entry; keep passing it since an undocumented prefill can only help.
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
  packedSubaccount: string,
  affiliateCode?: string,
): Promise<
  { action: "already_bound"; code: string } | { action: "prompt_bind"; deepLink: string }
> {
  const current = await getNadoReferralBinding(packedSubaccount);
  if (current.bound && current.code) {
    return { action: "already_bound", code: current.code };
  }
  return { action: "prompt_bind", deepLink: buildNadoReferralDeepLink(affiliateCode) };
}
