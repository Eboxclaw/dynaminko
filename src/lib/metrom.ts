// Metrom incentives REST client.
//
// The official @metrom-xyz/react pulls wagmi + viem + a query provider; this
// app only needs to READ campaigns, claims and leaderboards, so it speaks to
// the same public API the SDK wraps (api.metrom.xyz, CORS-open) with plain
// fetch. Claim EXECUTION stays a wallet action in the Metrom app for now: a
// link per campaign replaces a signed contract write until the Earn tab
// grows its own claim flow.
//
// Shapes mirror packages/sdk/src/client/backend.ts in metrom-xyz/monorepo.

import { keccak_256 } from "@noble/hashes/sha3.js";

import { INK_MAINNET } from "@/chains/ink";

const BASE = "https://api.metrom.xyz";

export type MetromCampaignStatus = "active" | "upcoming" | "expired";

export type MetromRewardAsset = {
  address: string;
  decimals: number;
  symbol: string;
  name: string;
  /** raw on-chain amount as a string; format with decimals before display */
  amount: string;
  usdPrice?: number;
  remaining?: string;
};

export type MetromCampaign = {
  id: string;
  chainId: number;
  chainType: string;
  from: string;
  to: string;
  createdAt: string;
  target: {
    type: string;
    dex?: string;
    tokens?: { symbol: string; name: string }[];
    asset?: {
      address: string;
      decimals: number;
      symbol: string;
      name: string;
      details?: {
        type?: string;
        dex?: string;
        baseTokenSymbol?: string;
        quoteTokenSymbol?: string;
      };
    };
  };
  rewards: { assets: MetromRewardAsset[] };
};

export type MetromClaim = {
  id: string;
  campaignId: string;
  chainId: number;
  token: { symbol: string; decimals: number; address: string };
  amount: { raw: string; formatted: string };
  usd: number | null;
  /** merkle proof for the on-chain claimRewards call */
  proof: string[];
};

export type MetromLeaderboardRank = {
  account: string;
  position: number;
  weight: number;
  distributed?: { address: string; amount: string }[];
};

async function getJson<T>(path: string, timeoutMs = 20_000): Promise<T> {
  // AbortSignal.timeout is missing in some webviews; same hand-rolled
  // pattern as the wallet reader worker.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/${path}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Metrom ${res.status}: ${(await res.text()).slice(0, 140)}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function paginate(path: string, page: number, pageSize: number): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}page=${page}&pageSize=${pageSize}`;
}

/** One campaign by id (claims can reference campaigns that already scrolled
 * out of the listing, so their names resolve individually). */
export async function fetchMetromCampaign(
  campaignId: string,
  chainId: number,
): Promise<MetromCampaign | null> {
  return getJson<MetromCampaign>(`v2/campaigns/rewards/evm/${chainId}/${campaignId}`).catch(
    () => null,
  );
}

/** Rewards campaigns, optionally scoped to one chain and status set. */
export async function fetchMetromCampaigns(
  opts: { chainId?: number; statuses?: MetromCampaignStatus[]; page?: number; pageSize?: number } = {},
): Promise<MetromCampaign[]> {
  const page = opts.page ?? 1;
  // The API rejects pageSize above 20 ("can't be more than 20").
  const pageSize = Math.min(opts.pageSize ?? 20, 20);
  let path = `v2/campaigns/rewards?page=${page}&pageSize=${pageSize}`;
  if (opts.chainId != null) path += `&chainIds=${opts.chainId}`;
  if (opts.statuses?.length) path += `&statuses=${opts.statuses.join(",")}`;
  const out = await getJson<{ campaigns: MetromCampaign[]; totalItems: number }>(path);
  return out.campaigns ?? [];
}

/** Claimable rewards for one wallet, optionally scoped to one chain. The
 * backend returns `token` as a bare address resolved through a registry
 * nested by chainType and chainId, not as an object. */
export async function fetchMetromClaims(
  address: string,
  chainId?: number,
): Promise<MetromClaim[]> {
  let path = `v2/claims/${address.toLowerCase()}`;
  if (chainId != null) path += `?chainId=${chainId}`;
  const out = await getJson<{
    claims: {
      campaignId: string;
      chainType: string;
      chainId: number;
      token: string;
      amount: string;
    }[];
    resolvedPricedTokens: Record<
      string,
      Record<string, Record<string, { symbol?: string; decimals?: number; usdPrice?: number }>>
    >;
  }>(path);
  return (out.claims ?? []).map((c) => {
    const resolved =
      out.resolvedPricedTokens?.[c.chainType]?.[String(c.chainId)]?.[String(c.token).toLowerCase()];
    const decimals = resolved?.decimals ?? 18;
    const raw = BigInt(c.amount ?? "0");
    const formatted = (Number(raw) / 10 ** decimals).toFixed(4);
    return {
      id: `${c.campaignId}:${c.token}`,
      campaignId: c.campaignId,
      chainId: c.chainId,
      token: {
        symbol: resolved?.symbol ?? "tokens",
        decimals,
        address: String(c.token),
      },
      amount: { raw: c.amount ?? "0", formatted },
      usd: resolved?.usdPrice != null ? Number(formatted) * resolved.usdPrice : null,
      proof: (c as { proof?: string[] }).proof ?? [],
    };
  });
}

export type MetromLeaderboard = {
  updatedAt: number;
  ranks: MetromLeaderboardRank[];
};

/** Top rewarded accounts for one campaign. Null when none was published. */
export async function fetchMetromLeaderboard(
  campaignId: string,
  chainId: number,
): Promise<MetromLeaderboard | null> {
  const out = await getJson<{
    updatedAt: number;
    leaderboard?: {
      ranks: { account: string; position: number; weight: number; distributed?: { address: string; amount: string }[] }[];
    };
  }>(`v2/leaderboards/evm/${chainId}/${campaignId}`).catch(() => null);
  if (!out?.leaderboard) return null;
  return { updatedAt: out.updatedAt, ranks: out.leaderboard.ranks ?? [] };
}

/** One Metrom campaign narrowed to what the Earn cards render. Names cover
 * both target shapes: held LP/token assets and AMM pool campaigns. */
export function describeCampaign(c: MetromCampaign): {
  asset: string;
  dex: string | null;
  rewards: { symbol: string; amount: number; usd: number | null }[];
  from: number;
  to: number;
} {
  const asset = c.target.asset;
  const base = asset?.details?.baseTokenSymbol;
  const quote = asset?.details?.quoteTokenSymbol;
  const poolPair = (c.target.tokens ?? []).map((t) => t.symbol).join("-");
  const pair =
    base && quote
      ? `${base}-${quote}`
      : (asset?.symbol ?? asset?.name ?? (poolPair || "campaign"));
  const rewards = (c.rewards.assets ?? []).map((a) => {
    const amount = Number(a.amount) / 10 ** (a.decimals ?? 18);
    return {
      symbol: a.symbol,
      amount,
      usd: a.usdPrice != null ? amount * a.usdPrice : null,
    };
  });
  return {
    asset: pair,
    dex: asset?.details?.dex ?? c.target.dex ?? null,
    rewards,
    from: new Date(c.from).getTime(),
    to: new Date(c.to).getTime(),
  };
}

/** Rewards this address already claimed. Activities are not keyed by
 * campaign, so earned-per-campaign joins on reward token + the campaign's
 * window (claims can land after the end; the window opens at `from` and
 * runs to now). */
export async function fetchMetromClaimed(
  address: string,
  chainId: number,
  fromMs: number,
): Promise<{ token: string; amount: string; symbol: string; at: number }[]> {
  const path = `v2/activities/evm/${chainId}/${address.toLowerCase()}?from=${Math.floor(
    fromMs / 1000,
  )}&to=${Math.floor(Date.now() / 1000)}`;
  const out = await getJson<{
    tokens: Record<string, { symbol?: string; decimals?: number }>;
    activities: {
      transaction: { id: string; timestamp: number };
      payload: { type: string; token: string; amount: string; receiver: string };
    }[];
  }>(path).catch(() => null);
  if (!out) return [];
  return (out.activities ?? [])
    .filter((a) => a.payload.type === "claim-reward")
    .map((a) => {
      const meta = out.tokens[a.payload.token.toLowerCase()] ?? {};
      const decimals = meta.decimals ?? 18;
      return {
        token: meta.symbol ?? a.payload.token.slice(0, 8),
        amount: (Number(BigInt(a.payload.amount)) / 10 ** decimals).toFixed(4),
        symbol: meta.symbol ?? "?",
        at: a.transaction.timestamp * 1000,
      };
    });
}

// ── claiming ──────────────────────────────────────────────────────────

/** Metrom contract deployment per chain (metrom-xyz/contracts index.ts). */
export const METROM_CONTRACT_BY_CHAIN: Record<number, string> = {
  57073: "0xD4AC4AaFb81eC774E49AA755A66EfCe4574D6276",
};

function word(hex: string): string {
  return hex.replace(/^0x/, "").padStart(64, "0");
}

/** calldata for claimRewards(ClaimRewardBundle[]) with one bundle. */
export function encodeClaimRewards(bundle: {
  campaignId: string;
  proof: string[];
  token: string;
  amount: bigint;
  receiver: string;
}): string {
  // keccak256("claimRewards((bytes32,bytes32[],address,uint256,address)[])")[:4]
  const sig = "claimRewards((bytes32,bytes32[],address,uint256,address)[])";
  const digest = keccak_256(new TextEncoder().encode(sig));
  const selector = Array.from(digest.slice(0, 4))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // head: array offset | length | element offset, then the tuple
  const head = word("20") + word("1") + word("20");
  const tuple =
    word(bundle.campaignId) +
    word("a0") + // proof data starts 5 slots into the tuple
    word(bundle.token) +
    bundle.amount.toString(16).padStart(64, "0") +
    word(bundle.receiver) +
    word(String(bundle.proof.length)) +
    bundle.proof.map(word).join("");
  return `0x${selector}${head}${tuple}`;
}

/** Ink mainnet convenience: campaigns live on this chain today. */
export const METROM_INK_CHAIN_ID = INK_MAINNET.id;

/** Deep link when the web app exposes the campaign page; the tab links out
 * for claim execution until the Earn tab signs its own transactions. */
export function metromAppUrl(): string {
  return "https://app.metrom.xyz/";
}
