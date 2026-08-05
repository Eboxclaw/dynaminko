import { createFileRoute, Link } from "@tanstack/react-router";

import { Shell } from "@/components/pot/Shell";
import { WalletPanel } from "@/components/pot/WalletChip";
import { useDoc } from "@/hooks/useDoc";
import { useActiveWallet, usePortfolio } from "@/hooks/usePortfolio";
import { greeting, relativeTime, usd } from "@/lib/format";
import { SECTOR_BY_ID } from "@/lib/sectors";
import { walletKey } from "@/lib/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Today — Proof of Thesis" },
      {
        name: "description",
        content:
          "Your wallet, your open theses and the trades still waiting for a reason, in one calm page.",
      },
      { property: "og:title", content: "Today — Proof of Thesis" },
      {
        property: "og:description",
        content: "Your wallet, your open theses and the trades still waiting for a reason.",
      },
    ],
  }),
  component: Today,
});

function Today() {
  const doc = useDoc();
  const { wallets, active } = useActiveWallet();
  const { portfolio, trades, isFetching, fetchedAt } = usePortfolio();

  const answered = new Set(doc.entries.map((e) => e.tradeId).filter(Boolean));
  const dismissed = new Set(doc.settings.dismissedTrades);
  const waiting = trades.filter((t) => !answered.has(t.id) && !dismissed.has(t.id));
  const hidden = doc.settings.hideBalances;

  return (
    <Shell
      title={`${greeting()}.`}
      subtitle={
        active
          ? isFetching
            ? "reading your wallet…"
            : fetchedAt
              ? `updated ${relativeTime(fetchedAt)}`
              : undefined
          : "let's start with a wallet"
      }
    >
      {wallets.length === 0 ? (
        <section className="doodle-card animate-rise overflow-hidden p-6">
          <p className="font-hand text-2xl text-accent">First, a wallet.</p>
          <p className="mt-1 max-w-md text-[15px] text-ink-soft">
            Paste an address to watch or connect one you already have. Everything you write
            afterwards stays on this device.
          </p>
          <div className="mt-4 doodle-inset">
            <WalletPanel wallets={wallets} activeKey={null} />
          </div>
        </section>
      ) : (
        <div className="space-y-5">
          <section className="doodle-card animate-rise p-5">
            <p className="text-[12px] uppercase tracking-wide text-ink-faint">Portfolio</p>
            <p className="num mt-1 text-4xl font-semibold tracking-tight">
              {portfolio.priced ? usd(portfolio.total, hidden) : "—"}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {portfolio.slices.slice(0, 4).map((s) => (
                <span key={s.sector} className="doodle-pill px-3 py-1 text-[12px] text-ink-soft">
                  {SECTOR_BY_ID[s.sector]?.label ?? s.sector}
                  <span className="num ml-2 text-ink">{Math.round(s.share * 100)}%</span>
                </span>
              ))}
              {portfolio.slices.length === 0 && (
                <span className="text-[13px] text-ink-faint">
                  No priced holdings on this wallet yet.
                </span>
              )}
            </div>
            <Link
              to="/portfolio"
              className="mt-4 inline-block text-[13px] font-medium text-accent underline-offset-4 hover:underline"
            >
              See the breakdown →
            </Link>
          </section>

          <section
            className="doodle-card animate-rise p-5"
            style={{ animationDelay: "60ms" }}
          >
            <div className="flex items-baseline justify-between">
              <p className="text-[15px] font-semibold">Waiting for a reason</p>
              <span className="num text-[13px] text-ink-faint">{waiting.length}</span>
            </div>
            {waiting.length === 0 ? (
              <p className="mt-2 text-[14px] text-ink-soft">
                Nothing unexplained. Every move on this wallet has a note next to it.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {waiting.slice(0, 4).map((t) => (
                  <li key={t.id} className="doodle-inset flex items-center gap-3 px-3 py-2.5">
                    <span
                      className={
                        t.side === "in"
                          ? "num text-[13px] text-gain"
                          : "num text-[13px] text-loss"
                      }
                    >
                      {t.side === "in" ? "+" : "−"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px]">
                        {t.symbol}{" "}
                        <span className="text-ink-faint">
                          {t.value != null ? usd(t.value, hidden) : ""}
                        </span>
                      </span>
                      <span className="text-[12px] text-ink-faint">{relativeTime(t.ts)}</span>
                    </span>
                    <Link
                      to="/journal"
                      className="doodle-pill px-3 py-1 text-[12px] font-medium hover:bg-accent-soft"
                    >
                      Explain
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section
            className="doodle-card animate-rise p-5"
            style={{ animationDelay: "120ms" }}
          >
            <p className="text-[15px] font-semibold">Open theses</p>
            {doc.theses.length === 0 ? (
              <p className="mt-2 text-[14px] text-ink-soft">
                Write one line about what you believe. It becomes the thing your trades are
                measured against.{" "}
                <Link to="/theses" className="text-accent underline-offset-4 hover:underline">
                  Start one
                </Link>
                .
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {doc.theses
                  .filter((t) => t.status === "open")
                  .slice(0, 3)
                  .map((t) => (
                    <li key={t.id} className="doodle-inset px-3 py-2.5">
                      <p className="text-[14px]">{t.title}</p>
                      <p className="text-[12px] text-ink-faint">
                        {t.symbols.join(" · ") || "no tickers"} · {relativeTime(t.updatedAt)}
                      </p>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </div>
      )}
      <p className="mt-6 text-center font-hand text-[15px] text-ink-faint">
        {active ? walletKey(active.chainId, active.address).split(":")[0] : ""}
      </p>
    </Shell>
  );
}
