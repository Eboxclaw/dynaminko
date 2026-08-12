import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Eye, EyeOff, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";

import { BasketOrb } from "@/components/pot/BasketOrb";
import { Reconcile } from "@/components/pot/Reconcile";
import { Panel, Shell } from "@/components/pot/Shell";
import { WalletPanel } from "@/components/pot/WalletChip";
import { useAgent } from "@/hooks/useAgent";
import { useDoc } from "@/hooks/useDoc";
import { useActiveWallet, usePortfolio } from "@/hooks/usePortfolio";
import { relativeTime, usd } from "@/lib/format";
import { SECTOR_BY_ID } from "@/lib/sectors";
import { patchSettings } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Proof of Thesis" },
      {
        name: "description",
        content:
          "Your wallet split into conviction baskets, with every on-chain move the agent has extracted and queued for you to explain.",
      },
      { property: "og:title", content: "Dashboard — Proof of Thesis" },
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
  const { inbox } = useAgent();
  const [composing, setComposing] = useState(false);
  const hidden = doc.settings.hideBalances;

  if (wallets.length === 0) {
    return (
      <Shell title="Dashboard" subtitle="no wallet yet">
        <Panel eyebrow="Step 01 // Context" title="Point it at a wallet">
          <div className="p-4">
            <p className="max-w-lg text-[14px] text-ink-soft">
              Watch any address read-only, or connect one you control. From that moment the
              agent extracts every swap, send and receive into your inbox — you only answer
              why.
            </p>
            <div className="mt-4">
              <WalletPanel wallets={wallets} activeKey={null} />
            </div>
          </div>
        </Panel>
      </Shell>
    );
  }

  const top = portfolio.slices[0];

  return (
    <Shell
      title="Dashboard"
      subtitle={isFetching ? "reading chain…" : fetchedAt ? `synced ${relativeTime(fetchedAt)}` : "—"}
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
      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <Panel eyebrow="Net worth // Ink" className={cn(isFetching && "scan overflow-hidden")}>
          <div className="p-4">
            <div className="flex items-start gap-3">
              <p className="num text-[30px] font-semibold leading-none tracking-tight sm:text-[38px]">
                {portfolio.priced ? usd(portfolio.total, hidden) : "—"}
              </p>
              <button
                type="button"
                onClick={() => patchSettings({ hideBalances: !hidden })}
                aria-label="Toggle balance privacy"
                className="-m-2 mt-0 grid h-9 w-9 place-items-center text-ink-faint transition hover:text-ink"
              >
                {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="eyebrow mt-3">
              {portfolio.holdings.length} assets · {portfolio.slices.length} baskets
              {top && ` · ${SECTOR_BY_ID[top.sector]?.label} leads at ${Math.round(top.share * 100)}%`}
            </p>
            <div className="mt-2">
              <BasketOrb
                slices={portfolio.slices.map((s) => ({
                  label: SECTOR_BY_ID[s.sector]?.label ?? s.sector,
                  share: s.share,
                }))}
              />
            </div>
          </div>
        </Panel>

        <Panel eyebrow="Exposure // Baskets" delay={60}>
          {portfolio.slices.length === 0 ? (
            <p className="p-4 text-[13px] text-ink-faint">
              Nothing priced on this wallet yet.
            </p>
          ) : (
            <ul>
              {portfolio.slices.map((s) => {
                const sector = SECTOR_BY_ID[s.sector];
                return (
                  <li key={s.sector} className="border-b border-stroke px-4 py-3 last:border-0">
                    <div className="flex items-baseline gap-3">
                      <span className="flex-1 text-[13px] font-medium">
                        {sector?.label ?? s.sector}
                      </span>
                      <span className="num text-[13px]">{usd(s.value, hidden)}</span>
                      <span className="num w-10 text-right text-[12px] text-ink-faint">
                        {Math.round(s.share * 100)}%
                      </span>
                    </div>
                    <div className="mt-2 h-[3px] w-full bg-sunken">
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

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <Panel
          eyebrow="Agent // Extracted"
          title={inbox.length > 0 ? `${inbox.length} moments need a reason` : "Inbox clear"}
          delay={100}
          action={
            <Link
              to="/journal"
              search={{ tab: "inbox" as const, filter: "all" }}
              className="doodle-pill inline-flex items-center gap-1 px-3 py-1 text-[12px] hover:border-ink"
            >
              Open <ArrowUpRight className="h-3 w-3" />
            </Link>
          }
        >
          <ul className="max-h-[300px] overflow-y-auto overscroll-contain sm:max-h-[260px]">
            {inbox.slice(0, 6).map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-3 border-b border-stroke px-4 py-3 last:border-0 sm:py-2.5"
              >
                <span className="num text-[11px] text-ink-faint">
                  {s.side === "in" ? "IN" : "OUT"}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {s.symbol}
                  <span className="num ml-2 text-ink-faint">
                    {s.value != null ? usd(s.value, hidden) : "—"}
                  </span>
                </span>
                <span className="eyebrow">{relativeTime(s.ts)}</span>
              </li>
            ))}
            {inbox.length === 0 && (
              <li className="px-4 py-6 text-center text-[13px] text-ink-faint">
                Every extracted trade has been answered.
              </li>
            )}
          </ul>
        </Panel>

        <Panel eyebrow="Holdings // Detail" delay={140}>
          <ul className="max-h-[300px] overflow-y-auto overscroll-contain sm:max-h-[260px]">
            {portfolio.holdings.slice(0, 12).map((h) => (
              <li
                key={h.key}
                className="flex items-center gap-3 border-b border-stroke px-4 py-3 last:border-0 sm:py-2.5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{h.symbol}</span>
                  <span className="eyebrow">{SECTOR_BY_ID[h.sector]?.label}</span>
                </span>
                <span className="num text-right text-[13px]">
                  {h.value != null ? usd(h.value, hidden) : "—"}
                  <span className="block text-[11px] text-ink-faint">
                    {hidden ? "•••" : h.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </span>
                </span>
              </li>
            ))}
            {portfolio.holdings.length === 0 && (
              <li className="px-4 py-6 text-center text-[13px] text-ink-faint">No balances.</li>
            )}
          </ul>
        </Panel>
      </div>

      <button
        type="button"
        onClick={() => setComposing(true)}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+72px)] right-4 z-30 rounded-full inline-flex items-center gap-2 bg-ink px-4 py-3 text-[13px] font-medium text-paper shadow-lg active:scale-95 transition hover:opacity-90 lg:bottom-6 lg:right-6"
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
