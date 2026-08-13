import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { HelpDot } from "@/components/pot/HelpDot";
import { Panel, Shell } from "@/components/pot/Shell";
import { VenueIcon } from "@/components/pot/VenueIcon";

import { useDoc } from "@/hooks/useDoc";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useVenues } from "@/hooks/useVenues";
import { amount, pct, usd } from "@/lib/format";
import {
  SECTOR_BY_ID,
  SECTOR_ORDER,
  SECTORS,
  SOURCE_LABEL,
  classifyAsset,
  sectorColor,
  type SectorId,
} from "@/lib/sectors";
import { patchSettings } from "@/lib/store";
import { VENUE_BY_ID, VENUES } from "@/lib/venues";
import type { AccountSummary, Position, VenueReport } from "@/lib/venues/types";

export const Route = createFileRoute("/portfolio")({
  head: () => ({
    meta: [
      { title: "Portfolio · Proof of Thesis" },
      {
        name: "description",
        content:
          "Wallet balances, liquidity positions and trading accounts, grouped into conviction baskets.",
      },
      { property: "og:title", content: "Portfolio · Proof of Thesis" },
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
  const [sort, setSort] = useState<"basket" | "asset">("basket");

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

        <Panel
          eyebrow="Holdings // Detail"
          delay={60}
          action={
            <div className="flex items-center gap-1">
              {(["basket", "asset"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSort(mode)}
                  aria-pressed={sort === mode}
                  className={`doodle-pill px-2.5 py-1 text-[11px] ${
                    sort === mode ? "bg-ink text-paper" : "text-ink-soft"
                  }`}
                >
                  by {mode}
                </button>
              ))}
            </div>
          }
        >
          {grouped.length === 0 ? (
            <p className="p-4 text-[13px] text-ink-soft">No balances found on this wallet yet.</p>
          ) : sort === "asset" ? (
            <ul>
              {[...portfolio.holdings]
                .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
                .map((h) => (
                  <HoldingRow
                    key={h.key}
                    h={h}
                    hidden={hidden}
                    overrides={doc.settings.basketOverrides ?? {}}
                    showBasket
                  />
                ))}
            </ul>
          ) : (
            <div>
              {grouped.map((g) => (
                <section key={g.id}>
                  <header className="flex items-baseline gap-2 border-y border-stroke bg-sunken px-4 py-1.5 first:border-t-0">
                    <span className="eyebrow flex-1">
                      {SECTOR_BY_ID[g.id]?.label}
                      {g.id === "unsorted" && (
                        <span className="ml-2 normal-case text-ink-faint">
                          tap a dot to sort
                        </span>
                      )}
                    </span>
                    <span className="num text-[12px]">{usd(g.value, hidden)}</span>
                    <span className="num text-[11px] text-ink-faint">
                      {Math.round(g.share * 100)}%
                    </span>
                  </header>
                  <ul>
                    {g.holdings.map((h) => (
                      <HoldingRow
                        key={h.key}
                        h={h}
                        hidden={hidden}
                        overrides={doc.settings.basketOverrides ?? {}}
                      />
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
  reports: VenueReport[];
  hidden: boolean;
  loading: boolean;
}) {
  return (
    <Panel eyebrow={eyebrow} delay={100}>
      <div className="grid content-start gap-3 p-3">
        {venues.map((id) => (
          <VenueCard
            key={id}
            id={id}
            report={reports.find((r) => r.venueId === id)}
            hidden={hidden}
            loading={loading}
          />
        ))}
      </div>
    </Panel>
  );
}


const GROUPS: { kind: Position["kind"][]; label: string }[] = [
  { kind: ["perp"], label: "Perps" },
  { kind: ["spot"], label: "Margin spot" },
  { kind: ["lp-concentrated", "lp-constant-product"], label: "Liquidity" },
];

function VenueCard({
  id,
  report,
  hidden,
  loading,
}: {
  id: string;
  report?: VenueReport;
  hidden: boolean;
  loading: boolean;
}) {
  const [showEmpty, setShowEmpty] = useState(false);
  const venue = VENUE_BY_ID[id];
  const accounts = report?.accounts ?? [];
  const funded = accounts.filter((a) => (a.equity ?? 0) > 0);
  const idle = accounts.length - funded.length;
  const positions = report?.positions ?? [];
  const equity = accounts.reduce((s, a) => s + (a.equity ?? 0), 0);
  const notional = positions.reduce((s, p) => s + (p.notionalValue ?? 0), 0);
  const headline = equity > 0 ? equity : notional;
  const quiet = !report || (accounts.length === 0 && positions.length === 0);
  const state = loading && !report ? "reading" : stateLabel(report?.status);
  const unpriced = positions.some((p) => p.notionalValue == null);

  // Terminal-density summary: what kind of risk sits in this venue.
  const count = (kinds: Position["kind"][]) =>
    positions.filter((p) => kinds.includes(p.kind)).length;
  const chips = [
    { label: "perp", value: count(["perp"]) },
    { label: "spot", value: count(["spot"]) },
    { label: "lp", value: count(["lp-concentrated", "lp-constant-product"]) },
  ]
    .filter((c) => c.value > 0)
    .map((c) => ({ label: c.label, value: String(c.value) }));
  if (equity > 0) chips.push({ label: "equity", value: usd(equity, hidden) });
  if (notional > 0) chips.push({ label: "notional", value: usd(notional, hidden) });

  const notes = [
    unpriced ? "A dash means this venue reported no USD price. Amounts are read on-chain." : null,
    report?.note ?? null,
    report?.stale ? "Showing the last cached read." : null,
  ].filter(Boolean) as string[];

  return (
    <section className="doodle-inset px-3 py-3">
      <header className="flex items-center gap-3">
        <span className="shrink-0 text-ink-soft">
          <VenueIcon id={id} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium">
            {venue?.label}
            {report?.stale && <span className="eyebrow ml-2">cached</span>}
          </span>
          <span className="eyebrow block truncate">{venue?.blurb}</span>
        </span>
        <span className="num shrink-0 text-right text-[13px]">
          {headline > 0 ? usd(headline, hidden) : <span className="text-ink-faint">{state}</span>}
        </span>
        {notes.length > 0 && (
          <span className="shrink-0">
            <HelpDot label={`About ${venue?.label ?? "this venue"}`}>
              <span className="grid gap-1.5">
                {notes.map((n) => (
                  <span key={n} className="block">
                    {n}
                  </span>
                ))}
              </span>
            </HelpDot>
          </span>
        )}
      </header>

      {chips.length > 0 && (
        <ul className="mt-2.5 flex flex-wrap gap-1">
          {chips.map((c) => (
            <li key={c.label} className="doodle-pill num px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-ink-soft">
              {c.label}
              <span className="ml-1 text-ink">{c.value}</span>
            </li>
          ))}
        </ul>
      )}

      {!quiet && (
        <div className="mt-3 grid gap-3">
          {(showEmpty ? accounts : funded).length > 0 && (
            <ul className="grid gap-1.5">
              {(showEmpty ? accounts : funded).map((a: AccountSummary) => (
                <li key={a.id} className="flex items-baseline gap-3 text-[13px]">
                  <span className="min-w-0 flex-1 truncate text-ink-soft">{a.label}</span>
                  {a.detail && (
                    <span className="num hidden text-[11px] text-ink-faint sm:inline">
                      {a.detail}
                    </span>
                  )}
                  <span className="num w-24 shrink-0 text-right">
                    {a.equity != null ? usd(a.equity, hidden) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {idle > 0 && (
            <button
              type="button"
              onClick={() => setShowEmpty((v) => !v)}
              className="eyebrow w-fit hover:text-ink"
            >
              {showEmpty ? "hide" : "show"} {idle} empty subaccount{idle === 1 ? "" : "s"}
            </button>
          )}

          {GROUPS.map((group) => {
            const rows = positions.filter((p) => group.kind.includes(p.kind));
            if (rows.length === 0) return null;
            return (
              <div key={group.label}>
                <p className="eyebrow border-b border-stroke pb-1">{group.label}</p>
                <ul className="mt-1.5 grid gap-2">
                  {rows.map((p) => (
                    <PositionRow key={p.id} p={p} hidden={hidden} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** One position, with the raw venue payload one tap away. */
function PositionRow({ p, hidden }: { p: Position; hidden: boolean }) {
  const [open, setOpen] = useState(false);
  const meta = Object.entries(p.metadata ?? {}).filter(
    ([, v]) => v != null && typeof v !== "object",
  );
  const legs = lpLegs(p);
  const range = rangeChip(p);
  return (
    <li>
      <button
        type="button"
        onClick={() => meta.length > 0 && setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left text-[13px]"
      >
        <span className="flex items-baseline gap-3">
          <span className="min-w-0 flex-1 truncate">
            {pairLabel(p)}
            {p.side && <span className="eyebrow ml-2">{p.side}</span>}
          </span>
          {range && <span className="eyebrow shrink-0">{range}</span>}
          {!range && !legs && p.detail && (
            <span className="num hidden text-[11px] text-ink-faint sm:inline">{p.detail}</span>
          )}
          <span className="num w-24 shrink-0 text-right">
            {p.notionalValue != null ? usd(p.notionalValue, hidden) : "—"}
          </span>
        </span>
        {legs && (
          <span className="mt-0.5 flex items-baseline gap-2 text-[11px] text-ink-faint">
            <span className="num min-w-0 flex-1 truncate">
              {legs.map((l, i) => (
                <span key={l.symbol + i} className={l.zero ? "opacity-45" : undefined}>
                  {i > 0 && <span className="mx-1.5 opacity-45">+</span>}
                  {amount(l.value, hidden)} {l.symbol}
                </span>
              ))}
            </span>
          </span>
        )}
      </button>
      {open && meta.length > 0 && (
        <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 border-l border-stroke pl-2">
          {meta.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="eyebrow truncate">{k}</dt>
              <dd className="num truncate text-right text-[11px]">{String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

/** Token legs of an LP position, read from the venue metadata. */
function lpLegs(p: Position): { symbol: string; value: number; zero: boolean }[] | null {
  if (!p.kind.startsWith("lp")) return null;
  const a0 = p.metadata?.amount0;
  const a1 = p.metadata?.amount1;
  if (typeof a0 !== "number" || typeof a1 !== "number") return null;
  const [s0, s1] = [clean(p.symbols?.[0] ?? ""), clean(p.symbols?.[1] ?? "")];
  return [
    { symbol: s0, value: a0, zero: a0 === 0 },
    { symbol: s1, value: a1, zero: a1 === 0 },
  ];
}

/**
 * On-chain strings can be junk. Only clean symbols reach the UI, and the
 * common unicode tickers are folded to their plain ASCII spelling.
 */
function clean(symbol: string): string {
  const s = (symbol ?? "")
    .normalize("NFKC")
    .replace(/₮/g, "T")
    .replace(/[^\w.\-/]/g, "")
    .trim();
  return s.slice(0, 12) || "?";
}

function pairLabel(p: Position): string {
  if (p.symbols && p.symbols.length >= 2) return p.symbols.slice(0, 2).map(clean).join(" / ");
  return clean(p.symbol || p.label);
}


function rangeChip(p: Position): string | null {
  const state = p.metadata?.range ?? p.metadata?.inRange;
  if (state == null) return null;
  if (state === 1 || state === "in" || state === "in-range" || state === "true")
    return "in range";
  if (state === 0 || state === "out" || state === "out-of-range" || state === "false")
    return "out of range";
  return typeof state === "string" ? state : null;
}

function HoldingRow({
  h,
  hidden,
  overrides,
  showBasket = false,
}: {
  h: { key: string; symbol: string; name: string; amount: number; value: number | null; change24h?: number | null; sector: SectorId };
  hidden: boolean;
  overrides: Record<string, string>;
  showBasket?: boolean;
}) {
  return (
    <li className="flex items-center gap-3 border-b border-stroke px-4 py-3 last:border-0">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium">{h.symbol}</span>
        <span className="block truncate text-[12px] text-ink-faint">
          {showBasket ? (SECTOR_BY_ID[h.sector]?.label ?? h.name) : h.name}
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
      <BasketPicker symbol={h.symbol} current={h.sector} overrides={overrides} />
    </li>
  );
}

function BasketPicker({
  symbol,
  current,
  overrides,
}: {
  symbol: string;
  current: SectorId;
  overrides: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const key = symbol.toUpperCase();
  const overridden = Boolean(overrides[key]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const set = (id: SectorId | null) => {
    const next = { ...overrides };
    if (id) next[key] = id;
    else delete next[key];
    patchSettings({ basketOverrides: next });
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={`Basket for ${symbol}`}
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-stroke hover:border-ink"
      >
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: sectorColor(current) }}
        />
      </button>
      {overridden && (
        <span className="pointer-events-none absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-ink" />
      )}
      {open && (
        <div className="absolute right-0 top-8 z-20 w-52 rounded-xl border border-stroke bg-paper p-1 shadow-lg">
          <p className="eyebrow px-2 py-1.5">
            {SOURCE_LABEL[classifyAsset(symbol, overrides).source]}
          </p>
          {SECTORS.map((sct) => (
            <button
              key={sct.id}
              type="button"
              onClick={() => set(sct.id)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-sunken"
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: sectorColor(sct.id) }}
              />
              <span className="flex-1">{sct.label}</span>
              {current === sct.id && <span className="eyebrow">now</span>}
            </button>
          ))}
          {overridden && (
            <button
              type="button"
              onClick={() => set(null)}
              className="eyebrow w-full px-2 py-1.5 text-left hover:text-ink"
            >
              reset to automatic
            </button>
          )}
        </div>
      )}
    </div>
  );
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
