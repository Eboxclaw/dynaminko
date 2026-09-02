import {
  createLazyFileRoute,
  type LazyRouteOptions,
} from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { Panel, Shell } from "@/components/pot/Shell";
import { useDoc } from "@/hooks/useDoc";
import { useInjectedWallet } from "@/hooks/useInjectedWallet";
import {
  describeCampaign,
  encodeClaimRewards,
  fetchMetromCampaign,
  fetchMetromCampaigns,
  fetchMetromClaims,
  fetchMetromClaimed,
  METROM_CONTRACT_BY_CHAIN,
  METROM_INK_CHAIN_ID,
  metromAppUrl,
  type MetromCampaign,
  type MetromClaim,
} from "@/lib/metrom";
import { getInjected } from "@/lib/chain/injected";

// Lazy route: Metrom incentive campaigns (active + upcoming) and the wallet's
// claimable rewards. Reads the public Metrom REST API directly; the official
// React package drags wagmi/viem in, which this PWA does not carry.
export const Route = createLazyFileRoute("/earn")(
  {
    head: () => ({
      meta: [
        { title: "Earn · Proof of Thesis" },
        {
          name: "description",
          content:
            "Metrom incentive campaigns on Ink: live and upcoming pools, your claimable rewards and campaign leaderboards.",
        },
        { property: "og:title", content: "Earn · Proof of Thesis" },
        { property: "og:description", content: "Metrom campaigns and claimable rewards on Ink." },
      ],
    }),
    component: EarnPage,
  } as LazyRouteOptions,
);

function usd(n: number | null): string {
  if (n == null) return "";
  return n >= 1000 ? `$${Math.round(n).toLocaleString("en-US")}` : `$${n.toFixed(2)}`;
}

function period(from: number, to: number): string {
  const fmt = (t: number) =>
    new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(from)} to ${fmt(to)}`;
}

function CampaignCard({
  c,
  now,
  earned,
  pending,
}: {
  c: MetromCampaign;
  now: number;
  /** already-claimed reward formatting for this campaign, when known */
  earned?: { text: string; usd: number | null } | null;
  /** pending claim for this exact campaign, when known */
  pending?: MetromClaim | null;
}) {
  const d = describeCampaign(c);
  const live = now >= d.from && now <= d.to;
  const upcoming = now < d.from;
  const total = c.rewards.assets.reduce(
    (acc, a) => acc + Number(a.amount) / 10 ** (a.decimals ?? 18),
    0,
  );
  const usdTotal = c.rewards.assets.reduce((acc, a) => {
    const amount = Number(a.amount) / 10 ** (a.decimals ?? 18);
    return acc + (a.usdPrice != null ? amount * a.usdPrice : 0);
  }, 0);
  const span = Math.max(1, d.to - d.from);
  const progress = live ? Math.min(100, Math.max(0, ((now - d.from) / span) * 100)) : upcoming ? 0 : 100;

  return (
    <div className="doodle-inset px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[13px] font-medium">{d.asset}</span>
        {d.dex && <span className="eyebrow">{d.dex}</span>}
        <span className={cnBadge(live ? "live" : upcoming ? "soon" : "done")}>
          {live ? "live" : upcoming ? "upcoming" : "ended"}
        </span>
        <a
          href={metromAppUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="doodle-pill ml-auto px-2.5 py-0.5 text-[11px]"
        >
          open in metrom ↗
        </a>
      </div>
      <p className="mt-1 text-[12px] text-ink-soft">
        {period(d.from, d.to)}
        {total > 0 && (
          <>
            {" · pool paid "}
            {usd(usdTotal) || `${total.toLocaleString("en-US", { maximumFractionDigits: 2 })} tokens`}
          </>
        )}
      </p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {c.rewards.assets.map((a) => (
          <li key={a.address} className="doodle-pill num px-2 py-0.5 text-[11px]">
            pool: {a.symbol} {(Number(a.amount) / 10 ** (a.decimals ?? 18)).toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </li>
        ))}
      </ul>
      {(earned || pending) && (
        <p className="mt-1.5 text-[12px] font-medium">
          you: {earned ? `claimed ${earned.text}${earned.usd != null ? ` (${usd(earned.usd)})` : ""}` : ""}
          {earned && pending ? " · " : ""}
          {pending ? `pending claim ${pending.amount.formatted} ${pending.token.symbol}${pending.usd != null ? ` (${usd(pending.usd)})` : ""}` : ""}
        </p>
      )}
      {live && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded bg-stroke" role="presentation">
          <div className="h-full bg-ink" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}

function cnBadge(kind: "live" | "soon" | "done"): string {
  return `doodle-pill px-2 py-0.5 text-[11px] ${kind === "live" ? "bg-ink text-paper" : ""}`;
}

function EarnPage() {
  const doc = useDoc();
  const wallet = doc.wallets[0];
  const [campaigns, setCampaigns] = useState<MetromCampaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claims, setClaims] = useState<MetromClaim[] | null>(null);
  /** claimed reward formatting per campaign id (from the wallet's activity history) */
  const [claimed, setClaimed] = useState<Record<string, { text: string; usd: number | null }>>({});
  const [claiming, setClaiming] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  /** campaign names for claim rows (claims can outlive their listing) */
  const [campaignNames, setCampaignNames] = useState<Record<string, string>>({});
  const injected = useInjectedWallet();

  useEffect(() => {
    const missing = [...new Set((claims ?? []).map((cl) => cl.campaignId))].filter(
      (id) => !(id in campaignNames),
    );
    if (missing.length === 0) return;
    let alive = true;
    void (async () => {
      for (const id of missing) {
        const c = await fetchMetromCampaign(id, METROM_INK_CHAIN_ID);
        // Expired campaigns can fall out of the details endpoint: the short
        // id still tells the user which one paid them.
        const name = c ? describeCampaign(c).asset : `${id.slice(0, 6)}…${id.slice(-4)}`;
        if (alive) setCampaignNames((prev) => ({ ...prev, [id]: name }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [claims, campaignNames]);

  useEffect(() => {
    let alive = true;
    fetchMetromCampaigns({ chainId: METROM_INK_CHAIN_ID })
      .then((cs) => alive && setCampaigns(cs))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "fetch failed"));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!wallet) return;
    let alive = true;
    fetchMetromClaims(wallet.address, METROM_INK_CHAIN_ID)
      .then((cs) => alive && setClaims(cs))
      .catch(() => alive && setClaims([]));
    return () => {
      alive = false;
    };
  }, [wallet]);

  // Per-campaign "you earned": the wallet's claim-reward activities since the
  // campaign opened, joined on reward symbol. One fetch per ended campaign is
  // fine at Ink's campaign counts.
  useEffect(() => {
    if (!wallet || campaigns === null) return;
    let alive = true;
    void (async () => {
      const nowMs = Date.now();
      const next: Record<string, { text: string; usd: number | null }> = {};
      for (const c of campaigns) {
        const d = describeCampaign(c);
        if (nowMs < d.to) continue;
        const acts = await fetchMetromClaimed(wallet.address, METROM_INK_CHAIN_ID, d.from);
        const wanted = new Set(c.rewards.assets.map((a) => a.symbol));
        const mine = acts.filter((a) => wanted.has(a.token));
        if (mine.length === 0) continue;
        const text = mine
          .map((a) => `${a.amount} ${a.token}`)
          .join(" + ");
        const usdSum = mine.reduce((acc, a) => {
          const asset = c.rewards.assets.find((x) => x.symbol === a.token);
          return acc + (asset?.usdPrice != null ? Number(a.amount) * asset.usdPrice : 0);
        }, 0);
        next[c.id] = { text, usd: usdSum || null };
      }
      if (alive) setClaimed(next);
    })();
    return () => {
      alive = false;
    };
  }, [wallet, campaigns]);

  /** Sign and broadcast the claim with the injected wallet. */
  const claimNow = async (cl: MetromClaim) => {
    setClaimError(null);
    const provider = getInjected();
    const account = injected.accounts[0];
    if (!provider || !account) {
      setClaimError("Connect a wallet first: claiming signs a transaction.");
      return;
    }
    if (injected.chainId !== METROM_INK_CHAIN_ID) {
      try {
        await injected.switchTo(METROM_INK_CHAIN_ID);
      } catch {
        setClaimError("Switch your wallet to Ink to claim.");
        return;
      }
    }
    const contract = METROM_CONTRACT_BY_CHAIN[METROM_INK_CHAIN_ID];
    if (!contract) {
      setClaimError("No Metrom contract known for this chain.");
      return;
    }
    setClaiming(cl.id);
    try {
      const data = encodeClaimRewards({
        campaignId: cl.campaignId,
        proof: cl.proof,
        token: cl.token.address,
        amount: BigInt(cl.amount.raw),
        receiver: account,
      });
      const hash = (await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: account, to: contract, data }],
      })) as string;
      setClaims((prev) => (prev ?? []).filter((x) => x.id !== cl.id));
      setClaimError(null);
      window.open(`https://explorer.inkonchain.com/tx/${hash}`, "_blank", "noopener");
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : "claim rejected");
    } finally {
      setClaiming(null);
    }
  };

  const now = Date.now();
  const { live, upcoming, ended } = useMemo(() => {
    const sorted = [...(campaigns ?? [])].sort((a, b) => new Date(b.to).getTime() - new Date(a.to).getTime());
    return {
      live: sorted.filter((c) => now >= new Date(c.from).getTime() && now <= new Date(c.to).getTime()),
      upcoming: sorted.filter((c) => now < new Date(c.from).getTime()),
      ended: sorted.filter((c) => now > new Date(c.to).getTime()).slice(0, 6),
    };
  }, [campaigns, now]);

  const pendingFor = (campaignId: string) =>
    (claims ?? []).find((cl) => cl.campaignId === campaignId) ?? null;

  return (
    <Shell title="Earn" subtitle="metrom incentive campaigns on ink · hold or provide, get rewarded">
      <Panel>
        {error && (
          <p className="border-b border-stroke px-4 py-2.5 text-[12px] text-loss">
            Campaign fetch failed: {error}
          </p>
        )}

        <Section title="Live on Ink" empty={live.length === 0 ? "No live campaigns right now." : null}>
          {live.map((c) => (
            <CampaignCard key={c.id} c={c} now={now} pending={pendingFor(c.id)} earned={claimed[c.id]} />
          ))}
        </Section>

        <Section
          title="Upcoming"
          empty={
            upcoming.length === 0
              ? "Nothing scheduled yet. New campaigns land here the moment Metrom publishes them."
              : null
          }
        >
          {upcoming.map((c) => (
            <CampaignCard key={c.id} c={c} now={now} />
          ))}
        </Section>

        <Section
          title="Your claims"
          empty={
            !wallet
              ? "Add a wallet first: claims are per address."
              : claims?.length === 0
                ? "Nothing claimable for this wallet yet."
                : null
          }
        >
          {(claims ?? []).map((cl) => (
            <div key={cl.id} className="doodle-inset flex items-center gap-2 px-3 py-2">
              <span className="num text-[13px]">{cl.token.symbol}</span>
              <span className="num text-[13px]">{cl.amount.formatted}</span>
              {cl.usd != null && <span className="eyebrow">{usd(cl.usd)}</span>}
              {campaignNames[cl.campaignId] && (
                <span className="eyebrow">from {campaignNames[cl.campaignId]}</span>
              )}
              <button
                type="button"
                disabled={claiming != null || !injected.available}
                onClick={() => void claimNow(cl)}
                className="doodle-pill ml-auto bg-ink px-3 py-1 text-[11px] text-paper disabled:opacity-40"
              >
                {claiming === cl.id ? "claiming…" : injected.available ? "claim" : "wallet needed"}
              </button>
              <a
                href={metromAppUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="doodle-pill px-2 py-1 text-[11px]"
              >
                ↗
              </a>
            </div>
          ))}
          {claimError && <p className="px-4 pb-2 text-[12px] text-loss">{claimError}</p>}
        </Section>

        {ended.length > 0 && (
          <Section title="Recently ended" empty={null}>
            {ended.map((c) => (
              <CampaignCard key={c.id} c={c} now={now} />
            ))}
          </Section>
        )}

        <p className="px-4 py-3 text-[12px] text-ink-soft">
          Campaign data comes straight from Metrom's public API. Claiming sends a transaction from
          your connected wallet (you sign it in your wallet); the ↗ link opens the campaign in the
          Metrom app instead.
        </p>
      </Panel>
    </Shell>
  );
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-stroke last:border-b-0">
      <p className="eyebrow px-4 pt-3">{title}</p>
      {empty ? (
        <p className="px-4 py-3 text-[12px] text-ink-soft">{empty}</p>
      ) : (
        <ul className="grid gap-2 px-4 py-2">{children}</ul>
      )}
    </div>
  );
}
