import { Link, createLazyFileRoute, type LazyRouteOptions } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Panel, Shell } from "@/components/pot/Shell";
import { VenueIcon } from "@/components/pot/VenueIcon";
import { useVenues } from "@/hooks/useVenues";
import { relativeTime } from "@/lib/format";
import { fetchHLQuotes, type Quote } from "@/lib/prices";

// Lazy route: the venue readers and market fetches stay out of the entry
// chunk. The LazyRouteOptions type in this router release only models
// component props; the runtime merges every lazy option when the chunk
// loads, so head and validateSearch behave as on the eager route.
export const Route = createLazyFileRoute("/trade")(
  {
    head: () => ({
      meta: [
        { title: "Trading · Proof of Thesis" },
        {
          name: "description",
          content: "Light per-venue trading surface: positions, activity and live marks.",
        },
        { property: "og:title", content: "Trading · Proof of Thesis" },
        { property: "og:description", content: "Light per-venue trading surface." },
      ],
    }),
    validateSearch: (search: Record<string, unknown>) => {
      const venue = search.venue === "nado" ? "nado" : "hyperliquid";
      const section = ["positions", "activity", "market"].includes(String(search.section))
        ? (search.section as TradeSection)
        : ("positions" as TradeSection);
      return { venue, section } as { venue: TradeVenue; section: TradeSection };
    },
    component: TradePage,
  } as LazyRouteOptions,
);

type TradeVenue = "hyperliquid" | "nado";
type TradeSection = "positions" | "activity" | "market";

const VENUE_TABS: { id: TradeVenue; label: string }[] = [
  { id: "hyperliquid", label: "Hyperliquid" },
  { id: "nado", label: "Nado" },
];

const SECTIONS: { id: TradeSection; label: string }[] = [
  { id: "positions", label: "Positions" },
  { id: "activity", label: "Activity" },
  { id: "market", label: "Market" },
];

function fmtUsd(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 2 })}`;
}

function fmtPx(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function TradePage() {
  const { venue, section } = Route.useSearch() as {
    venue: TradeVenue;
    section: TradeSection;
  };
  const navigate = Route.useNavigate();
  const { reports, accounts, actions, isFetching } = useVenues();

  const report = reports.find((r) => r.venueId === venue);
  const positions = report?.positions ?? [];
  const venueAccounts = accounts.filter((a) => a.venue === venue);
  const venueActions = actions.filter((a) => a.venue === venue);

  return (
    <Shell
      title="Trading"
      subtitle="light per-venue surface · hype and nado, charts later"
      action={
        isFetching ? (
          <span className="doodle-pill px-3 py-1 text-[11px] text-ink-faint">reading venues…</span>
        ) : undefined
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {VENUE_TABS.map((v) => (
          <Link
            key={v.id}
            to="/trade"
            search={{ venue: v.id, section }}
            className={`doodle-pill flex items-center gap-1.5 px-3 py-1.5 text-[12px] ${
              venue === v.id ? "bg-ink text-paper" : "text-ink-soft hover:border-ink"
            }`}
          >
            <VenueIcon id={v.id} className="h-3.5 w-3.5 shrink-0" />
            {v.label}
          </Link>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {SECTIONS.map((s) => (
          <Link
            key={s.id}
            to="/trade"
            search={{ venue, section: s.id }}
            className={`doodle-pill px-3 py-1 text-[11px] ${
              section === s.id ? "bg-ink text-paper" : "text-ink-soft hover:border-ink"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      {section === "positions" && <Positions venue={venue} report={report} positions={positions} accounts={venueAccounts} />}
      {section === "activity" && <Activity venue={venue} actions={venueActions} />}
      {section === "market" && <Market venue={venue} positions={positions} />}
    </Shell>
  );
}

function Positions({
  venue,
  report,
  positions,
  accounts,
}: {
  venue: TradeVenue;
  report: ReturnType<typeof useVenues>["reports"][number] | undefined;
  positions: ReturnType<typeof useVenues>["reports"][number]["positions"];
  accounts: { id: string; accountId?: string; label: string; equity: number | null; available: number | null; marginUsed: number | null }[];
}) {
  if (!report && positions.length === 0) {
    return (
      <Panel eyebrow={`Positions // ${venue}`} title="Nothing loaded yet">
        <p className="empty">Connect a wallet on the dashboard and the venue reads land here.</p>
      </Panel>
    );
  }
  return (
    <div className="space-y-4">
      <Panel eyebrow={`Positions // ${venue}`} title={`${positions.length} open`}>
        {positions.length === 0 ? (
          <p className="empty">No open positions on {venue}.</p>
        ) : (
          <ul>
            {positions.map((p) => (
              <li key={p.id} className="border-b border-stroke px-4 py-3 last:border-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium">
                    <VenueIcon id={p.venue} className="h-3 w-3 shrink-0 text-ink-faint" />
                    {p.symbol}
                  </span>
                  <span className={`num text-[13px] ${(p.unrealizedPnl ?? 0) >= 0 ? "text-gain" : "text-loss"}`}>
                    {p.unrealizedPnl != null ? fmtUsd(p.unrealizedPnl) : "—"}
                  </span>
                </div>
                <p className="eyebrow mt-1">
                  {p.side ?? "position"} · size {p.size ?? "—"}
                  {p.leverage != null ? ` · ${p.leverage}x` : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-faint">
                  <span>entry {fmtPx(p.entryPrice)}</span>
                  <span>mark {fmtPx(p.markPrice)}</span>
                  <span>notional {fmtUsd(p.notionalValue)}</span>
                  {p.liquidationPrice != null && <span>liq {fmtPx(p.liquidationPrice)}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {accounts.length > 0 && (
        <Panel eyebrow={`Accounts // ${venue}`} delay={60}>
          <ul>
            {accounts.map((a) => (
              <li key={a.id} className="border-b border-stroke px-4 py-3 last:border-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-medium">{a.label || a.accountId}</span>
                  <span className="num text-[13px]">{fmtUsd(a.equity)}</span>
                </div>
                <p className="eyebrow mt-1">
                  available {fmtUsd(a.available)} · margin used {fmtUsd(a.marginUsed)}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function Activity({
  venue,
  actions,
}: {
  venue: TradeVenue;
  actions: { id: string; symbol: string; side: "in" | "out"; amount: string | number; value: number | null; feeUsd: number | null; ts: number; action: string }[];
}) {
  return (
    <Panel eyebrow={`Activity // ${venue}`} title={`${actions.length} recorded`}>
      {actions.length === 0 ? (
        <p className="empty">No recorded trades for {venue} yet.</p>
      ) : (
        <ul className="max-h-[520px] overflow-y-auto overscroll-contain">
          {actions.map((a) => (
            <li key={a.id} className="border-b border-stroke px-4 py-3 last:border-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-medium">
                  {a.symbol}{" "}
                  <span className={`doodle-pill px-1.5 py-0.5 text-[10px] ${a.side === "in" ? "text-gain" : "text-loss"}`}>
                    {a.side}
                  </span>
                </span>
                <span className="num text-[13px]">{fmtUsd(a.value)}</span>
              </div>
              <p className="eyebrow mt-1">
                {a.action} · {String(a.amount)} · fee {fmtUsd(a.feeUsd)} · {relativeTime(a.ts)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Market({ venue, positions }: { venue: TradeVenue; positions: { id: string; symbol: string; markPrice?: number | null }[] }) {
  const hlSymbols = [...new Set([...positions.map((p) => p.symbol.replace("-PERP", "")), "BTC", "ETH"])];
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (venue !== "hyperliquid") return;
    let live = true;
    setQuotes(null);
    setFailed(false);
    fetchHLQuotes(hlSymbols)
      .then((qs) => {
        if (live) setQuotes(qs);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue, hlSymbols.join(",")]);

  if (venue === "hyperliquid") {
    return (
      <Panel eyebrow="Market // Hyperliquid" title="mid prices">
        {failed ? (
          <p className="empty">price read failed; retry by reopening the tab</p>
        ) : quotes == null ? (
          <p className="empty">reading all mids…</p>
        ) : (
          <ul>
            {quotes.map((q) => (
              <li key={q.symbol} className="flex items-baseline justify-between gap-3 border-b border-stroke px-4 py-3 last:border-0">
                <span className="flex items-center gap-1.5 text-[13px] font-medium">
                  <VenueIcon id="hyperliquid" className="h-3 w-3 shrink-0 text-ink-faint" />
                  {q.symbol}
                </span>
                <span className="num text-[13px]">{fmtPx(q.usd)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    );
  }
  return (
    <Panel eyebrow="Market // Nado" title="oracle marks on your open symbols">
      {positions.length === 0 ? (
        <p className="empty">Connect a wallet: Nado oracle marks ride the account read.</p>
      ) : (
        <ul>
          {positions.map((p) => (
            <li key={p.id} className="flex items-baseline justify-between gap-3 border-b border-stroke px-4 py-3 last:border-0">
              <span className="text-[13px] font-medium">{p.symbol}</span>
              <span className="num text-[13px]">{fmtPx(p.markPrice)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
