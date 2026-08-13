import { createFileRoute } from "@tanstack/react-router";

import { Panel, Shell } from "@/components/pot/Shell";
import { VenueIcon } from "@/components/pot/VenueIcon";
import { useDoc } from "@/hooks/useDoc";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useVenues } from "@/hooks/useVenues";
import { amount, pct, usd } from "@/lib/format";
import { SECTOR_BY_ID, SECTOR_ORDER, sectorColor, type SectorId } from "@/lib/sectors";
import { VENUE_BY_ID, VENUES } from "@/lib/venues";

export const Route = createFileRoute("/portfolio")({
  head: () => ({
    meta: [
      { title: "Portfolio — Proof of Thesis" },
      {
        name: "description",
        content:
          "Wallet balances, liquidity positions and trading accounts, grouped into conviction baskets.",
      },
      { property: "og:title", content: "Portfolio — Proof of Thesis" },
      {
        property: "og:description",
        content: "Wallet, LPs and trading accounts grouped into conviction baskets.",
      },
    ],
  }),
  component: PortfolioPage,
});

function PortfolioPage() {
  const doc = useDoc();
  const hidden = doc.settings.hideBalances;
  const { portfolio, status, refresh, isFetching } = usePortfolio();
  const { reports, equity, isFetching: venuesFetching } = useVenues();

  const grouped = SECTOR_ORDER.map((id: SectorId) => {
    const holdings = portfolio.holdings.filter((h) => h.sector === id);
    const value = holdings.reduce((sum, h) => sum + (h.value ?? 0), 0);
    return { id, holdings, value, share: portfolio.total > 0 ? value / portfolio.total : 0 };
  }).filter((g) => g.holdings.length > 0);

  const lpVenues = VENUES.filter((v) => v.kind === "lp");
  const tradingVenues = VENUES.filter((v) => v.kind === "trading");
  // Net worth = wallet balances + trading-account equity. Perp notional is
  // exposure, not money, so it never enters this sum.
  const net = portfolio.total + equity;


  return (
    <Shell
      title="Portfolio"
      subtitle={portfolio.priced ? usd(net, hidden) : "not priced yet"}
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

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <Panel eyebrow="Exposure // Baskets">
          {grouped.length === 0 ? (
            <p className="p-4 text-[13px] text-ink-faint">Nothing priced on this wallet yet.</p>
          ) : (
            <div className="p-4">
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-sunken">
                {grouped.map((g) => (
                  <span
                    key={g.id}
                    style={{ width: `${g.share * 100}%`, background: sectorColor(g.id) }}
                    title={SECTOR_BY_ID[g.id]?.label}
                  />
                ))}
              </div>
              <ul className="mt-4 space-y-3">
                {grouped.map((g) => (
                  <li key={g.id}>
                    <div className="flex items-baseline gap-3 text-[14px]">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: sectorColor(g.id) }}
                      />
                      <span className="flex-1 font-medium">{SECTOR_BY_ID[g.id]?.label}</span>
                      <span className="num text-[12px] text-ink-faint">
                        {Math.round(g.share * 100)}%
                      </span>
                      <span className="num w-24 text-right">{usd(g.value, hidden)}</span>
                    </div>
                    <p className="eyebrow mt-1 pl-[22px]">
                      {g.holdings.map((h) => h.symbol).join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <Panel eyebrow="Holdings // Detail" delay={60}>
          {grouped.length === 0 ? (
            <p className="p-4 text-[13px] text-ink-soft">No balances found on this wallet yet.</p>
          ) : (
            <div>
              {grouped.map((g) => (
                <section key={g.id}>
                  <header className="flex items-baseline gap-2 border-y border-stroke bg-sunken px-4 py-1.5 first:border-t-0">
                    <span className="eyebrow flex-1">{SECTOR_BY_ID[g.id]?.label}</span>
                    <span className="num text-[12px]">{usd(g.value, hidden)}</span>
                    <span className="num text-[11px] text-ink-faint">
                      {Math.round(g.share * 100)}%
                    </span>
                  </header>
                  <ul>
                    {g.holdings.map((h) => (
                      <li
                        key={h.key}
                        className="flex items-center gap-3 border-b border-stroke px-4 py-3 last:border-0"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium">
                            {h.symbol}
                          </span>
                          <span className="block truncate text-[12px] text-ink-faint">
                            {h.name}
                          </span>
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
                </section>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <VenueSection
          eyebrow="Liquidity // Positions"
          venues={lpVenues.map((v) => v.id)}
          reports={reports}
          hidden={hidden}
          loading={venuesFetching}
        />
        <VenueSection
          eyebrow="Trading // Accounts"
          venues={tradingVenues.map((v) => v.id)}
          reports={reports}
          hidden={hidden}
          loading={venuesFetching}
        />
      </div>
    </Shell>
  );
}

function VenueSection({
  eyebrow,
  venues,
  reports,
  hidden,
  loading,
}: {
  eyebrow: string;
  venues: string[];
  reports: ReturnType<typeof useVenues>["reports"];
  hidden: boolean;
  loading: boolean;
}) {
  return (
    <Panel eyebrow={eyebrow} delay={100}>
      <ul>
        {venues.map((id) => {
          const venue = VENUE_BY_ID[id];
          const report = reports.find((r) => r.venueId === id);
          const equity = report?.accounts.reduce((s, a) => s + (a.equity ?? 0), 0) ?? 0;
          const notional = report?.positions.reduce((s, p) => s + (p.notionalValue ?? 0), 0) ?? 0;
          const headline = equity > 0 ? equity : notional;
          const state = loading && !report ? "reading…" : stateLabel(report?.status);
          return (
            <li key={id} className="border-b border-stroke px-4 py-3 last:border-0">
              <div className="flex items-center gap-3">
                <span className="text-ink-soft">
                  <VenueIcon id={id} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium">
                    {venue?.label}
                    {report?.stale && <span className="eyebrow ml-2">cached</span>}
                  </span>
                  <span className="eyebrow">{venue?.blurb}</span>
                </span>
                <span className="num text-right text-[13px]">
                  {headline > 0 ? (
                    usd(headline, hidden)
                  ) : (
                    <span className="text-ink-faint">{state}</span>
                  )}
                </span>
              </div>

              {report && report.accounts.length > 0 && (
                <ul className="mt-2 space-y-1 pl-7">
                  {report.accounts.map((a) => (
                    <li key={a.id} className="flex items-baseline gap-3 text-[13px]">
                      <span className="flex-1 truncate text-ink-soft">
                        {a.label}
                        <span className="eyebrow ml-2">equity</span>
                      </span>
                      {a.detail && (
                        <span className="num text-[11px] text-ink-faint">{a.detail}</span>
                      )}
                      <span className="num">{a.equity != null ? usd(a.equity, hidden) : "—"}</span>
                    </li>
                  ))}
                </ul>
              )}

              {report && report.positions.length > 0 && (
                <ul className="mt-2 space-y-1 pl-7">
                  {report.positions.map((p) => (
                    <li key={p.id} className="flex items-baseline gap-3 text-[13px]">
                      <span className="flex-1 truncate">
                        {p.label}
                        <span className="eyebrow ml-2">{kindLabel(p.kind)}</span>
                      </span>
                      {p.detail && (
                        <span className="num text-[11px] text-ink-faint">{p.detail}</span>
                      )}
                      <span className="num">
                        {p.notionalValue != null ? usd(p.notionalValue, hidden) : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {report?.note && <p className="eyebrow mt-1.5 pl-7">{report.note}</p>}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function kindLabel(kind: string) {
  switch (kind) {
    case "perp":
      return "perp";
    case "spot":
      return "margin spot";
    case "lp-concentrated":
      return "CL pool";
    case "lp-constant-product":
      return "v2 pool";
    default:
      return kind;
  }
}

function stateLabel(status?: string) {

  switch (status) {
    case "empty":
      return "no positions";
    case "pending":
      return "pending";
    case "error":
      return "unavailable";
    default:
      return "—";
  }
}
