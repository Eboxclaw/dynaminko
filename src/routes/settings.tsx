import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { Shell } from "@/components/pot/Shell";
import { WalletPanel } from "@/components/pot/WalletChip";
import { getInjected } from "@/lib/chain/injected";
import { usd } from "@/lib/format";
import type { TypedDataSigner } from "@/lib/referrals/hyperliquid";
import { buildNadoReferralDeepLink } from "@/lib/referrals/nado";
import { setReferrer } from "@/lib/referrals/hyperliquid";
import { exportDoc, patchReferralSettings, patchSettings, walletKey, wipe } from "@/lib/store";

import { useDoc } from "@/hooks/useDoc";
import { useHyperliquidReferral } from "@/hooks/useHyperliquidReferral";
import { useNadoReferral } from "@/hooks/useNadoReferral";
import { useActiveWallet } from "@/hooks/usePortfolio";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings · Proof of Thesis" },
      {
        name: "description",
        content: "Wallets, privacy, on-device assistant and your local data.",
      },
      { property: "og:title", content: "Settings · Proof of Thesis" },
      { property: "og:description", content: "Wallets, privacy and your local data." },
    ],
  }),
  component: SettingsPage,
});

function buildSigner(address: string): TypedDataSigner | null {
  const provider = getInjected();
  if (!provider) return null;
  return {
    address,
    async signTypedData(domain: unknown, types: unknown, message: unknown): Promise<string> {
      const result = await provider.request({
        method: "eth_signTypedData_v4",
        params: [address, JSON.stringify({ domain, types, primaryType: "Agent", message })],
      });
      return result as string;
    },
  };
}

function SettingsPage() {
  const doc = useDoc();
  const { wallets, active } = useActiveWallet();
  const {
    referral: hlReferral,
    isFetching: hlFetching,
    refetch: hlRefetch,
  } = useHyperliquidReferral();
  const {
    referral: nadoReferral,
    isFetching: nadoFetching,
    refetch: nadoRefetch,
  } = useNadoReferral();

  // Hyperliquid state
  const [hlCode, setHlCode] = useState(doc.settings.referrals.hyperliquid?.referralCode ?? "");
  const [settingHl, setSettingHl] = useState(false);
  const [hlError, setHlError] = useState<string | null>(null);
  const [hlOk, setHlOk] = useState(false);

  // Nado state
  const [nadoCode, setNadoCode] = useState("");
  const [settingNado, setSettingNado] = useState(false);
  const [nadoError, setNadoError] = useState<string | null>(null);
  const [nadoOk, setNadoOk] = useState(false);

  const isConnected = active?.kind === "connected";

  async function handleSetHlCode() {
    if (!hlCode.trim() || !active) return;
    setSettingHl(true);
    setHlError(null);
    setHlOk(false);

    if (isConnected) {
      const signer = buildSigner(active.address);
      if (!signer) {
        setHlError("No injected wallet detected.");
        setSettingHl(false);
        return;
      }
      try {
        const result = await setReferrer(signer, hlCode.trim());
        if (!result.ok) {
          setHlError(result.error ?? "setReferrer rejected by Hyperliquid.");
          setSettingHl(false);
          return;
        }
      } catch (err) {
        setHlError(err instanceof Error ? err.message : "Signing failed.");
        setSettingHl(false);
        return;
      }
    }

    patchReferralSettings("hyperliquid", { referralCode: hlCode.trim() });
    setHlOk(true);
    setSettingHl(false);
    setTimeout(() => hlRefetch(), 3000);
  }

  async function handleSetNadoCode() {
    const code = nadoCode.trim();
    if (!code || !active) return;
    setSettingNado(true);
    setNadoError(null);
    setNadoOk(false);

    // Nado has no programmatic setReferrer — save the code and open deep-link
    patchReferralSettings("nado", { referralCode: code });
    setNadoOk(true);
    setSettingNado(false);
  }

  const onInk = active?.chainId === 57073;
  const hlCodeFromStore = doc.settings.referrals.hyperliquid?.referralCode;

  return (
    <Shell title="Settings">
      <section className="doodle-card animate-rise mb-5">
        <WalletPanel
          wallets={wallets}
          activeKey={active ? walletKey(active.chainId, active.address) : null}
        />
      </section>

      <section className="doodle-card animate-rise mb-5 p-4">
        <p className="text-[15px] font-semibold">Privacy</p>
        <label className="mt-3 flex items-center gap-3 text-[14px]">
          <input
            type="checkbox"
            checked={doc.settings.hideBalances}
            onChange={(e) => patchSettings({ hideBalances: e.target.checked })}
          />
          Hide balances by default
        </label>
      </section>

      {/* ── Referrals ──────────────────────────────────────────────────────── */}
      <section className="doodle-card animate-rise mb-5 p-4">
        <p className="text-[15px] font-semibold">Referrals</p>
        <p className="mt-1 text-[13px] text-ink-soft">
          Track your referral progress, set codes, and see rewards earned on each venue.
        </p>

        {!active && (
          <p className="mt-3 text-[13px] text-ink-soft">Add a wallet to see referral state.</p>
        )}

        {/* Hyperliquid */}
        {active && (
          <div className="mt-4 rounded-[3px] border border-stroke p-3">
            <p className="text-[14px] font-medium">Hyperliquid</p>

            {hlReferral ? (
              <>
                {/* Progress toward 10k */}
                <div className="mt-2.5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12px] text-ink-soft">Volume toward your own code</span>
                    <span className="num text-[12px]">
                      {usd(hlReferral.state.cumVolumeUsd, doc.settings.hideBalances)} / $10,000
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
                    <div
                      className="h-full rounded-full bg-ink transition-all"
                      style={{ width: `${Math.round(hlReferral.cumVolumePct * 100)}%` }}
                    />
                  </div>
                  {hlReferral.canGenerateCode && (
                    <p className="mt-1 text-[11px] text-gain">
                      You qualify. Visit{" "}
                      <a
                        href="https://app.hyperliquid.xyz/referrals"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        app.hyperliquid.xyz/referrals
                      </a>{" "}
                      to generate your code.
                    </p>
                  )}
                </div>

                {/* Referred by */}
                {hlReferral.state.referredBy && (
                  <p className="mt-2 text-[12px] text-ink-soft">
                    Referred by <span className="text-ink">{hlReferral.state.referredBy.code}</span>
                  </p>
                )}

                {/* Rewards */}
                <div className="mt-2.5 grid grid-cols-3 gap-1.5">
                  <div className="rounded-[2px] border border-stroke p-1.5 text-center">
                    <p className="eyebrow text-[10px]">Unclaimed</p>
                    <p className="num mt-0.5 text-[12px]">
                      {usd(hlReferral.state.unclaimedReferralRewardsUsd, doc.settings.hideBalances)}
                    </p>
                  </div>
                  <div className="rounded-[2px] border border-stroke p-1.5 text-center">
                    <p className="eyebrow text-[10px]">Claimed</p>
                    <p className="num mt-0.5 text-[12px]">
                      {usd(hlReferral.state.claimedReferralRewardsUsd, doc.settings.hideBalances)}
                    </p>
                  </div>
                  <div className="rounded-[2px] border border-stroke p-1.5 text-center">
                    <p className="eyebrow text-[10px]">Builder</p>
                    <p className="num mt-0.5 text-[12px]">
                      {usd(hlReferral.state.builderRewardsUsd, doc.settings.hideBalances)}
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <p className="mt-2 text-[12px] text-ink-soft">
                {hlFetching ? "Reading referral state…" : "No referral data yet."}
              </p>
            )}

            {/* Set referral code */}
            <div className="mt-3">
              <p className="text-[12px] font-medium">Referral code</p>
              <div className="mt-1 flex gap-2">
                <input
                  type="text"
                  value={hlCode}
                  onChange={(e) => {
                    setHlCode(e.target.value);
                    setHlOk(false);
                    setHlError(null);
                  }}
                  placeholder={hlCodeFromStore ?? "e.g. FRIENDCODE"}
                  className="min-w-0 flex-1 rounded-[2px] border border-stroke bg-paper px-2.5 py-1 text-[12px] outline-none focus:border-ink"
                />
                <button
                  type="button"
                  disabled={settingHl || !hlCode.trim()}
                  onClick={handleSetHlCode}
                  className="doodle-pill shrink-0 px-3 py-1 text-[12px] hover:bg-accent-soft disabled:opacity-40"
                >
                  {settingHl ? "Setting…" : "Set"}
                </button>
              </div>
              {!isConnected && (
                <p className="mt-1 text-[11px] text-ink-faint">
                  Connect a wallet to sign the action. Without it, the code is saved locally.
                </p>
              )}
              {hlError && <p className="mt-1 text-[11px] text-loss">{hlError}</p>}
              {hlOk && <p className="mt-1 text-[11px] text-gain">Code saved.</p>}
            </div>
          </div>
        )}

        {/* Nado */}
        {active && onInk && (
          <div className="mt-3 rounded-[3px] border border-stroke p-3">
            <p className="text-[14px] font-medium">Nado</p>

            {nadoReferral ? (
              <>
                <p className="mt-2 text-[12px] text-ink-soft">
                  {nadoReferral.binding.bound
                    ? `Bound to code: ${nadoReferral.binding.code}`
                    : "Not bound to any referral code."}
                </p>

                {!nadoReferral.binding.bound && (
                  <div className="mt-2">
                    <p className="text-[12px] text-ink-soft">
                      Nado requires binding via their dashboard. Open the link, enter your code,
                      then come back and confirm.
                    </p>
                    <div className="mt-1.5 flex gap-2">
                      <a
                        href={buildNadoReferralDeepLink(hlCodeFromStore)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="doodle-pill px-3 py-1 text-[12px] hover:bg-accent-soft"
                      >
                        Open Nado Referrals
                      </a>
                      <button
                        type="button"
                        onClick={() => void nadoRefetch()}
                        disabled={nadoFetching}
                        className="doodle-pill px-3 py-1 text-[12px] hover:bg-accent-soft disabled:opacity-40"
                      >
                        {nadoFetching ? "Checking…" : "Re-check"}
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="mt-2 text-[12px] text-ink-soft">
                {nadoFetching ? "Checking binding…" : "No referral data yet."}
              </p>
            )}

            {/* Set referral code preference (saved locally only) */}
            <div className="mt-3">
              <p className="text-[12px] font-medium">Affiliate code</p>
              <div className="mt-1 flex gap-2">
                <input
                  type="text"
                  value={nadoCode}
                  onChange={(e) => {
                    setNadoCode(e.target.value);
                    setNadoOk(false);
                    setNadoError(null);
                  }}
                  placeholder={doc.settings.referrals.nado?.referralCode ?? "e.g. FRIENDCODE"}
                  className="min-w-0 flex-1 rounded-[2px] border border-stroke bg-paper px-2.5 py-1 text-[12px] outline-none focus:border-ink"
                />
                <button
                  type="button"
                  disabled={settingNado || !nadoCode.trim()}
                  onClick={handleSetNadoCode}
                  className="doodle-pill shrink-0 px-3 py-1 text-[12px] hover:bg-accent-soft disabled:opacity-40"
                >
                  {settingNado ? "Saving…" : "Save"}
                </button>
              </div>
              {nadoError && <p className="mt-1 text-[11px] text-loss">{nadoError}</p>}
              {nadoOk && (
                <p className="mt-1 text-[11px] text-gain">
                  Code saved. Open Nado Referrals above and enter it on their site to bind.
                </p>
              )}
            </div>
          </div>
        )}

        {active && !onInk && (
          <p className="mt-3 text-[12px] text-ink-faint">
            Nado referral tracking requires Ink mainnet.
          </p>
        )}
      </section>

      <section className="doodle-card animate-rise mb-5 p-4">
        <p className="text-[15px] font-semibold">Assistant &amp; agents</p>
        <p className="mt-1 text-[13px] text-ink-soft">
          Models, skills, tools and the activity log now live in their own console.
        </p>
        <Link
          to="/agents"
          search={{ tab: "agents" as const }}
          className="doodle-pill mt-3 inline-flex px-4 py-1.5 text-[13px] hover:bg-accent-soft"
        >
          Open Agents
        </Link>
      </section>

      <section className="doodle-card animate-rise p-4">
        <p className="text-[15px] font-semibold">Your data</p>
        <p className="mt-1 text-[13px] text-ink-soft">
          Everything lives in this browser. Export it before clearing your site data.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => {
              const blob = new Blob([exportDoc()], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "proof-of-thesis.json";
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="doodle-pill px-4 py-1.5 text-[13px] hover:bg-accent-soft"
          >
            Export
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm("Delete every thesis, entry and alert on this device?")) wipe();
            }}
            className="doodle-pill px-4 py-1.5 text-[13px] text-loss hover:bg-accent-soft"
          >
            Delete everything
          </button>
        </div>
      </section>
    </Shell>
  );
}
