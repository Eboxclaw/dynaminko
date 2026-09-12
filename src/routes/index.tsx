import { createFileRoute, Link } from "@tanstack/react-router";
import { Eye, EyeOff, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";

import { Reconcile } from "@/components/pot/Reconcile";
import { Panel, Shell } from "@/components/pot/Shell";
import { VenueIcon } from "@/components/pot/VenueIcon";
import { WalletPanel } from "@/components/pot/WalletChip";
import { Ext, NullMark } from "@/components/pot/symbols";
import { useAgent } from "@/hooks/useAgent";
import { useBaskets } from "@/hooks/useBaskets";
import { useDoc } from "@/hooks/useDoc";
import { useActiveWallet, usePortfolio } from "@/hooks/usePortfolio";
import { useVenues } from "@/hooks/useVenues";
import { relativeTime, usd } from "@/lib/format";
import { SECTOR_BY_ID } from "@/lib/sectors";
import { patchSettings } from "@/lib/store";
import { VENUE_BY_ID } from "@/lib/venues";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard · Proof of Thesis" },
      {
        name: "description",
        content:
          "Your wallet split into conviction baskets, with every on-chain move the agent has extracted and queued for you to explain.",
      },
      { property: "og:title", content: "Dashboard · Proof of Thesis" },
      {
        property: "og:description",
        content: "Wallet baskets, extracted trades, and the theses behind them.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const doc = useDoc();
  const { wallets } = useActiveWallet();
  const { portfolio, isFetching, fetchedAt, refresh } = usePortfolio();
  const { baskets, netWorth } = useBaskets();
  const { reports } = useVenues();
  const { inbox } = useAgent();
  const [composing, setComposing] = useState(false);
  const hidden = doc.settings.hideBalances;

  // Per-venue account totals: "on Ink · on Nado · on Hyperliquid", only the
  // venues that hold anything.
  const venueTotals = reports
    .map((r) => ({
      label: VENUE_BY_ID[r.venueId]?.label ?? r.venueId,
      equity: (r.accounts ?? []).reduce((s, a) => s + (a.equity ?? 0), 0),
    }))
    .filter((v) => v.equity > 0);

  if (wallets.length === 0) {
    return (
      <Shell title="Dashboard" subtitle="no wallet yet">
        <Panel eyebrow="Step 01 // Context" title="Point it at a wallet">
          <div className="p-4">
            <p className="max-w-lg text-head text-ink-soft">
              Watch any address read-only, or connect one you control. From that moment the agent
              extracts every swap, send and receive into your inbox, you only answer why.
            </p>
            <div className="mt-4">
              <WalletPanel wallets={wallets} activeKey={null} />
            </div>
          </div>
        </Panel>
      </Shell>
    );
  }

  const top = baskets.slices[0];

  return (
    <Shell
      title="Dashboard"
      subtitle={
        isFetching ? "reading chain…" : fetchedAt ? `synced ${relativeTime(fetchedAt)}` : "—"
      }
      action={
        <button
          type="button"
          onClick={refresh}
          aria-label="Refresh"
          className="doodle-pill grid h-8 w-8 place-items-center text-ink-faint hover:border-ink hover:text-ink"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
        </button>
      }
    >
      <div className="grid items-start gap-4 lg:grid-cols-[1.15fr_1fr]">
        <Panel
          eyebrow="Net worth // Wallet + venues"
          className={cn(isFetching && "scan overflow-hidden")}
        >
          <div className="p-4">
            <div className="flex items-start gap-3">
              {baskets.priced ? (
                <p className="num text-[30px] font-semibold leading-none tracking-tight sm:text-[38px]">
                  {usd(netWorth.net, hidden)}
                </p>
              ) : (
                <span
                  aria-label="Reading net worth"
                  className="skeleton h-[30px] w-[190px] sm:h-[38px] sm:w-[240px]"
                />
              )}
              <button
                type="button"
                onClick={() => patchSettings({ hideBalances: !hidden })}
                aria-label="Toggle balance privacy"
                className="-m-2 mt-0 grid h-9 w-9 place-items-center text-ink-faint transition hover:text-ink"
              >
                {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {/* Where the money sits: one readable row per venue instead of a
                wrapped caps line. The basket bars live in the Exposure panel
                beside this one; drawing them twice here clipped their labels. */}
            <div className="mt-3 space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="eyebrow">on Ink</span>
                <span className="num text-soft">{usd(netWorth.wallet, hidden)}</span>
              </div>
              {venueTotals.map((v) => (
                <div key={v.label} className="flex items-baseline justify-between gap-3">
                  <span className="eyebrow">on {v.label}</span>
                  <span className="num text-soft">{usd(v.equity, hidden)}</span>
                </div>
              ))}
            </div>
            <p className="eyebrow mt-3">
              {baskets.holdings.length} assets · {baskets.slices.length} baskets
              {top &&
                ` · ${SECTOR_BY_ID[top.sector]?.label ?? top.sector} leads at ${Math.round(top.share * 100)}%`}
            </p>
          </div>
        </Panel>

        <Panel eyebrow="Exposure // Baskets" delay={60}>
          {baskets.slices.length === 0 ? (
            <p className="empty">Nothing priced on this wallet yet.</p>
          ) : (
            <ul>
              {baskets.slices.map((s) => {
                const sector = SECTOR_BY_ID[s.sector];
                return (
                  <li key={s.sector} className="border-b border-stroke px-4 py-3 last:border-0">
                    <div className="flex items-baseline gap-3">
                      <span className="flex-1 text-body font-medium">
                        {sector?.label ?? s.sector}
                      </span>
                      <span className="num text-body">{usd(s.value, hidden)}</span>
                      <span className="num w-10 text-right text-soft text-ink-faint">
                        {Math.round(s.share * 100)}%
                      </span>
                    </div>
                    <div className="mt-2 h-1 w-full bg-sunken">
                      <div
                        className="h-full bg-ink transition-[width] duration-500"
                        style={{ width: `${Math.max(s.share * 100, 1.5)}%` }}
                      />
                    </div>
                    <p className="eyebrow mt-1.5">{s.symbols.join(" · ")}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[1.15fr_1fr]">
        <Panel
          eyebrow="Agent // Extracted"
          title={inbox.length > 0 ? `${inbox.length} moments need a reason` : "Inbox clear"}
          delay={100}
          action={
            <Link
              to="/journal"
              search={{ tab: "inbox" as const, filter: "all", venue: "all" as const }}
              className="doodle-pill inline-flex items-center gap-1 px-3 py-1 text-soft hover:border-ink"
            >
              Open <Ext />
            </Link>
          }
        >
          <ul className="max-h-[280px] overflow-y-auto overscroll-contain">
            {inbox.slice(0, 6).map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-3 border-b border-stroke px-4 py-3 last:border-0"
              >
                {s.venue && s.venue !== "evm" ? (
                  <VenueIcon id={s.venue} className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                ) : (
                  <span className="num text-caption text-ink-faint">
                    {s.side === "in" ? "IN" : "OUT"}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-body">
                  {s.symbol}
                  <span className="num ml-2 text-ink-faint">
                    {s.value != null ? usd(s.value, hidden) : <NullMark label="no value yet" />}
                  </span>
                </span>
                <span className="eyebrow">{relativeTime(s.ts)}</span>
              </li>
            ))}
            {inbox.length === 0 && (
              <li className="empty">Every extracted trade has been answered.</li>
            )}
          </ul>
        </Panel>

        <Panel eyebrow="Holdings // Detail" delay={140}>
          <ul className="max-h-[280px] overflow-y-auto overscroll-contain">
            {baskets.holdings.slice(0, 12).map((h) => (
              <li
                key={h.key}
                className="flex items-center gap-3 border-b border-stroke px-4 py-3 last:border-0"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-body font-medium">
                    <span className="truncate">{h.symbol}</span>
                    {h.sources
                      .filter((src) => src !== "wallet")
                      .map((src) => (
                        <VenueIcon key={src} id={src} className="h-3 w-3 shrink-0 text-ink-faint" />
                      ))}
                  </span>
                  <span className="eyebrow">{SECTOR_BY_ID[h.sector]?.label}</span>
                </span>
                <span className="num text-right text-body">
                  {h.value != null ? usd(h.value, hidden) : <NullMark label="unpriced" />}
                  <span className="block text-caption text-ink-faint">
                    {hidden
                      ? "•••"
                      : h.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </span>
                </span>
              </li>
            ))}
            {baskets.holdings.length === 0 && <li className="empty">No balances.</li>}
          </ul>
        </Panel>
      </div>

      <button
        type="button"
        onClick={() => setComposing(true)}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+72px)] right-4 z-30 rounded-full inline-flex items-center gap-2 bg-ink px-4 py-3 text-body font-medium text-paper shadow-lg active:scale-95 transition hover:opacity-90 lg:bottom-6 lg:right-6"
      >
        <Plus className="h-4 w-4" /> New entry
      </button>

      {composing && (
        <Reconcile
          signals={[]}
          theses={doc.theses}
          hidden={hidden}
          onClose={() => setComposing(false)}
        />
      )}
    </Shell>
  );
}
