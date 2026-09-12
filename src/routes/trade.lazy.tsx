import { Link, createLazyFileRoute, type LazyRouteOptions } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Panel, Shell } from "@/components/pot/Shell";
import { VenueIcon } from "@/components/pot/VenueIcon";
import { useVenues } from "@/hooks/useVenues";
import { relativeTime } from "@/lib/format";
import { fetchHLQuotes, fetchQuotes, type Quote } from "@/lib/prices";
import { feeBreakdown, swapReceiveEstimate } from "@/lib/trade/fees";
import { symbols as nadoSymbols } from "@/lib/venues/nado";

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
      const section = ["trade", "swap", "positions", "activity", "market"].includes(
        String(search.section),
      )
        ? (search.section as TradeSection)
        : ("trade" as TradeSection);
      return { venue, section } as { venue: TradeVenue; section: TradeSection };
    },
    component: TradePage,
  } as LazyRouteOptions,
);

type TradeVenue = "hyperliquid" | "nado";
type TradeSection = "trade" | "swap" | "positions" | "activity" | "market";

const VENUE_TABS: { id: TradeVenue; label: string }[] = [
  { id: "hyperliquid", label: "Hyperliquid" },
  { id: "nado", label: "Nado" },
];

const SECTIONS: { id: TradeSection; label: string }[] = [
  { id: "trade", label: "Trade" },
  { id: "swap", label: "Swap" },
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

      {section === "trade" && (
        <TradeTicket venue={venue} positions={positions} available={venueAccounts.reduce((s, a) => s + (a.available ?? 0), 0)} />
      )}
      {section === "swap" && <SwapTicket venue={venue} />}
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

// ── light trading mode: the order ticket ──────────────────────────────
// Wallet-style ticket, house-style skin. It builds an order slip with the
// full fee ladder and stops there: nothing signs until the execution
// wallet exists (S9). The agent proposes; the human signs.

const SIDE_META: { id: "long" | "short"; label: string; active: string }[] = [
  { id: "long", label: "LONG", active: "bg-ink text-paper border-ink" },
  { id: "short", label: "SHORT", active: "bg-loss text-paper border-loss" },
];

function TradeTicket({
  venue,
  positions,
  available,
}: {
  venue: TradeVenue;
  positions: { id: string; symbol: string; markPrice?: number | null }[];
  available: number;
}) {
  const [symbol, setSymbol] = useState(positions[0]?.symbol.replace("-PERP", "") ?? "BTC");
  const [side, setSide] = useState<"long" | "short">("long");
  const [mode, setMode] = useState<"market" | "limit">("market");
  const [limitPx, setLimitPx] = useState("");
  const [size, setSize] = useState("");
  const mark = positions.find((p) => p.symbol.replace("-PERP", "") === symbol)?.markPrice ?? null;
  // Venue marks ride the wallet read; until it lands, the quote layer arms
  // the ticket from public mids so the slip never waits on the account.
  const [midPx, setMidPx] = useState<number | null>(null);
  useEffect(() => {
    if (mark != null) return;
    let live = true;
    fetchQuotes([symbol])
      .then((qs) => {
        const q = qs.find((x) => x.symbol === symbol) ?? qs[0];
        if (live && q?.usd) setMidPx(q.usd);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [symbol, mark]);
  const refPx = mode === "limit" && Number(limitPx) > 0 ? Number(limitPx) : (mark ?? midPx);
  const notional = Number(size) > 0 && refPx ? Number(size) * refPx : 0;
  const fees = notional > 0 ? feeBreakdown({ venue, kind: "perp", notionalUsd: notional }) : null;
  const [slip, setSlip] = useState(false);

  const sizePct = (pct: number) => {
    if (!refPx || available <= 0) return;
    setSize((available * (pct / 100) / refPx).toFixed(4));
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Panel eyebrow={`Order ticket // ${venue}`}>
        <div className="grid grid-cols-2 gap-2">
          {SIDE_META.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSide(s.id)}
              className={`doodle-card px-3 py-2.5 text-[13px] font-medium ${
                side === s.id ? s.active : "text-ink-faint hover:border-ink"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="doodle-card num flex-1 bg-surface px-2 py-2 text-[13px] outline-none"
          >
            {(positions.length ? positions.map((p) => p.symbol.replace("-PERP", "")) : ["BTC", "ETH", "HYPE"]).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <div className="flex">
            {(["market", "limit"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`doodle-pill px-2.5 py-1.5 text-[11px] capitalize ${
                  mode === m ? "bg-ink text-paper" : "text-ink-faint"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        {mode === "limit" && (
          <input
            value={limitPx}
            onChange={(e) => setLimitPx(e.target.value)}
            inputMode="decimal"
            placeholder="limit price"
            className="num mt-2 w-full doodle-card bg-surface px-2 py-2 text-[13px] outline-none"
          />
        )}
        <div className="mt-2 flex items-center gap-2">
          <input
            value={size}
            onChange={(e) => setSize(e.target.value)}
            inputMode="decimal"
            placeholder={`size (${symbol})`}
            className="num min-w-0 flex-1 doodle-card bg-surface px-2 py-2 text-[13px] outline-none"
          />
          {[25, 50, 100].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => sizePct(p)}
              className="doodle-pill px-2 py-1 text-[10px] text-ink-faint hover:text-ink"
            >
              {p}%
            </button>
          ))}
        </div>
        <p className="eyebrow mt-2">
          notional {fmtUsd(notional)} · available {fmtUsd(available)}
        </p>
        {fees && (
          <div className="mt-3 border-t border-stroke pt-2">
            {fees.rows.map((r) => (
              <div key={r.label} className="flex items-baseline justify-between py-0.5">
                <span className="eyebrow">{r.label}</span>
                <span className="num text-[12px]">
                  {r.usd.toFixed(2)} · {r.bps} bps
                </span>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => setSlip(true)}
          disabled={!fees}
          className={`mt-3 w-full px-3 py-2.5 text-[13px] font-medium ${
            fees ? "bg-ink text-paper" : "doodle-pill text-ink-faint"
          }`}
        >
          Build order slip
        </button>
        <p className="eyebrow mt-2 text-ink-faint">
          paper only · signing arrives with the execution wallet
        </p>
      </Panel>
      {slip && fees && (
        <Panel eyebrow="Order slip // paper" delay={60}>
          <p className="font-hand text-2xl text-accent">
            {side === "long" ? "LONG" : "SHORT"} {size} {symbol}
          </p>
          <p className="num mt-1 text-[13px]">
            {mode} @ {fmtPx(refPx)} · notional {fmtUsd(notional)}
          </p>
          <div className="mt-3 border-t border-stroke pt-2">
            {fees.rows.map((r) => (
              <div key={r.label} className="flex items-baseline justify-between py-0.5">
                <span className="eyebrow">{r.label}</span>
                <span className="num text-[12px]">{fmtUsd(r.usd)}</span>
              </div>
            ))}
          </div>
          <p className="eyebrow mt-3 text-ink-faint">
            nothing is sent: the slip is paper until the execution wallet exists (S9)
          </p>
        </Panel>
      )}
    </div>
  );
}

// ── swap mode: from/to over the venue's spot book ─────────────────────

function SwapTicket({ venue }: { venue: TradeVenue }) {
  const [spotList, setSpotList] = useState<string[] | null>(null);
  const [from, setFrom] = useState("USD₮0");
  const [to, setTo] = useState("BTC");
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState("");
  const [slip, setSlip] = useState(false);

  useEffect(() => {
    if (venue !== "nado") return;
    let live = true;
    nadoSymbols()
      .then((s) => {
        if (live) setSpotList([...s.spot.values()].filter(Boolean));
      })
      .catch(() => {
        if (live) setSpotList([]);
      });
    return () => {
      live = false;
    };
  }, [venue]);

  // Prefill the price from the quote layer; the field stays editable.
  useEffect(() => {
    if (!to || venue !== "nado") return;
    let live = true;
    fetchQuotes([to])
      .then((qs) => {
        const q = qs.find((x) => x.symbol === to) ?? qs[0];
        if (live && q?.usd) setPrice((prev) => (prev ? prev : String(q.usd)));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [to, venue]);

  const notional = Number(amount) > 0 ? Number(amount) : 0;
  const fees = notional > 0 ? feeBreakdown({ venue, kind: "spot", notionalUsd: notional }) : null;
  const px = Number(price) > 0 ? Number(price) : 0;
  const estimate =
    notional > 0 && px > 0
      ? swapReceiveEstimate({ notionalUsd: notional, price: px })
      : null;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Panel eyebrow={`Swap ticket // ${venue} spot`}>
        <div className="space-y-2">
          <select
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="doodle-card num w-full bg-surface px-2 py-2 text-[13px] outline-none"
          >
            {(spotList ?? ["USD₮0"]).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="doodle-card num w-full bg-surface px-2 py-2 text-[13px] outline-none"
          >
            {(spotList ?? []).filter((s) => s !== from).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder={`amount (${from})`}
            className="num w-full doodle-card bg-surface px-2 py-2 text-[13px] outline-none"
          />
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder={`price of ${to} in ${from}`}
            className="num w-full doodle-card bg-surface px-2 py-2 text-[13px] outline-none"
          />
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <span className="eyebrow">slippage</span>
          {[0.5, 1, 3].map((s) => (
            <button key={s} type="button" className="doodle-pill px-2 py-0.5 text-[10px] text-ink-faint">
              {s}%
            </button>
          ))}
        </div>
        {fees && (
          <div className="mt-3 border-t border-stroke pt-2">
            {fees.rows.map((r) => (
              <div key={r.label} className="flex items-baseline justify-between py-0.5">
                <span className="eyebrow">{r.label}</span>
                <span className="num text-[12px]">
                  {r.usd.toFixed(2)} · {r.bps} bps
                </span>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => setSlip(true)}
          disabled={!fees}
          className={`mt-3 w-full px-3 py-2.5 text-[13px] font-medium ${
            fees ? "bg-ink text-paper" : "doodle-pill text-ink-faint"
          }`}
        >
          Build swap slip
        </button>
        <p className="eyebrow mt-2 text-ink-faint">
          paper only · signing arrives with the execution wallet
        </p>
      </Panel>
      {slip && estimate && !("problem" in estimate) && (
        <Panel eyebrow="Swap slip // paper" delay={60}>
          <p className="font-hand text-2xl text-accent">
            {from} to {to}
          </p>
          <p className="num mt-1 text-[13px]">
            {amount} {from} at {fmtPx(px)} = {estimate.receiveAmount} {to}
          </p>
          <div className="mt-3 border-t border-stroke pt-2">
            <div className="flex items-baseline justify-between py-0.5">
              <span className="eyebrow">app fee</span>
              <span className="num text-[12px]">{fmtUsd(estimate.feeUsd)}</span>
            </div>
          </div>
          <p className="eyebrow mt-3 text-ink-faint">
            nothing is sent: the slip is paper until the execution wallet exists (S9)
          </p>
        </Panel>
      )}
    </div>
  );
}
