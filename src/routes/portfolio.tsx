import { createFileRoute } from "@tanstack/react-router";

import { Shell } from "@/components/pot/Shell";
import { useDoc } from "@/hooks/useDoc";
import { usePortfolio } from "@/hooks/usePortfolio";
import { amount, pct, usd } from "@/lib/format";
import { SECTOR_BY_ID, sectorColor } from "@/lib/sectors";

export const Route = createFileRoute("/portfolio")({
  head: () => ({
    meta: [
      { title: "Portfolio — Proof of Thesis" },
      {
        name: "description",
        content: "What you hold, grouped by conviction sector, read live from your wallet.",
      },
      { property: "og:title", content: "Portfolio — Proof of Thesis" },
      { property: "og:description", content: "What you hold, grouped by conviction sector." },
    ],
  }),
  component: PortfolioPage,
});

function PortfolioPage() {
  const doc = useDoc();
  const hidden = doc.settings.hideBalances;
  const { portfolio, status, refresh, isFetching } = usePortfolio();

  return (
    <Shell
      title="Portfolio"
      subtitle={portfolio.priced ? usd(portfolio.total, hidden) : "not priced yet"}
      action={
        <button
          type="button"
          onClick={refresh}
          className="doodle-pill px-3 py-1.5 text-[12px] text-ink-soft hover:bg-accent-soft"
        >
          {isFetching ? "Reading…" : "Refresh"}
        </button>
      }
    >
      {status === "pending" && (
        <p className="font-hand text-xl text-ink-faint">reading the chain…</p>
      )}

      {portfolio.slices.length > 0 && (
        <section className="doodle-card animate-rise mb-5 p-5">
          <p className="text-[15px] font-semibold">Sector exposure</p>
          <div className="mt-4 flex h-4 w-full overflow-hidden rounded-full">
            {portfolio.slices.map((s) => (
              <span
                key={s.sector}
                style={{ width: `${s.share * 100}%`, background: sectorColor(s.sector) }}
                title={SECTOR_BY_ID[s.sector]?.label}
              />
            ))}
          </div>
          <ul className="mt-4 space-y-2">
            {portfolio.slices.map((s) => (
              <li key={s.sector} className="flex items-center gap-3 text-[14px]">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: sectorColor(s.sector) }}
                />
                <span className="flex-1">{SECTOR_BY_ID[s.sector]?.label ?? s.sector}</span>
                <span className="num text-ink-soft">{Math.round(s.share * 100)}%</span>
                <span className="num w-24 text-right">{usd(s.value, hidden)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="doodle-card animate-rise p-5" style={{ animationDelay: "60ms" }}>
        <p className="text-[15px] font-semibold">Holdings</p>
        {portfolio.holdings.length === 0 ? (
          <p className="mt-2 text-[14px] text-ink-soft">
            No balances found on this wallet yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-stroke">
            {portfolio.holdings.map((h) => (
              <li key={h.key} className="flex items-center gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{h.symbol}</span>
                  <span className="block truncate text-[12px] text-ink-faint">{h.name}</span>
                </span>
                <span className="text-right">
                  <span className="num block text-[14px]">{amount(h.amount, hidden)}</span>
                  <span className="num block text-[12px] text-ink-faint">
                    {h.value != null ? usd(h.value, hidden) : "unpriced"}
                  </span>
                </span>
                <span
                  className={`num w-16 text-right text-[12px] ${
                    (h.change24h ?? 0) >= 0 ? "text-gain" : "text-loss"
                  }`}
                >
                  {pct(h.change24h)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Shell>
  );
}
