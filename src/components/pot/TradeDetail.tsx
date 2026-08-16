// TradeDetail — the card a venue position opens into.
//
// The fill history renders only after "More info" is pressed, so a position
// with a long history costs nothing to glance at.

import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useMemo, useState } from "react";

import { useDoc } from "@/hooks/useDoc";
import { describeSignal } from "@/lib/agent/extract";
import { dayLabel, usd } from "@/lib/format";
import { baseSymbol } from "@/lib/sectors";
import type { ActiveTrade } from "@/lib/exposure";
import { cn } from "@/lib/utils";

import { VenueIcon } from "./VenueIcon";

export function TradeDetail({
  trade,
  hidden,
  onClose,
}: {
  trade: ActiveTrade;
  hidden: boolean;
  onClose: () => void;
}) {
  const doc = useDoc();
  // The fill list is the expensive half of the card — it only renders once
  // the user asks for it. "Started" needs just the earliest timestamp.
  const [showFills, setShowFills] = useState(false);

  const fills = useMemo(
    () =>
      doc.signals.filter(
        (s) =>
          s.venue === trade.venue && s.action === "trade" && baseSymbol(s.symbol) === trade.base,
      ),
    [doc.signals, trade.venue, trade.base],
  );
  const started = fills.length > 0 ? Math.min(...fills.map((f) => f.ts)) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="animate-rise flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden border border-stroke bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-stroke p-4">
          <span className="mt-0.5 shrink-0">
            <VenueIcon id={trade.venue} className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="eyebrow">
              {trade.venue === "nado" ? "Nado" : "Hyperliquid"} ·{" "}
              {trade.side === "long" ? "LONG" : "SHORT"} · OPEN
            </p>
            <h2 className="mt-1 text-[16px] font-semibold leading-snug">{trade.displaySymbol}</h2>
            {started != null && <p className="eyebrow mt-1">started {dayLabel(started)}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="doodle-pill grid h-8 w-8 place-items-center text-ink-faint hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="overflow-y-auto">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-stroke p-4 sm:grid-cols-3">
            <Field label="Size" value={String(trade.size)} />
            <Field
              label="Entry → mark"
              value={
                trade.entryPrice != null && trade.markPrice != null
                  ? `${trade.entryPrice.toLocaleString()} → ${trade.markPrice.toLocaleString()}`
                  : "—"
              }
            />
            <Field
              label="Notional"
              value={trade.notional != null ? usd(trade.notional, hidden) : "—"}
            />
            <Field
              label="Unrealized PnL"
              value={trade.unrealizedPnl != null ? usd(trade.unrealizedPnl, hidden) : "—"}
              tone={(trade.unrealizedPnl ?? 0) >= 0 ? "gain" : "loss"}
            />
            <Field label="Margin" value={trade.margin != null ? usd(trade.margin, hidden) : "—"} />
            <Field label="Leverage" value={trade.leverage != null ? `${trade.leverage}x` : "—"} />
            <Field
              label="Liquidation"
              value={trade.liquidationPrice != null ? trade.liquidationPrice.toLocaleString() : "—"}
            />
            <Field label="Account" value={trade.accountLabel ?? "main"} />
          </dl>

          <div className="p-4">
            <button
              type="button"
              onClick={() => setShowFills((v) => !v)}
              aria-expanded={showFills}
              className="doodle-pill inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-ink-soft hover:border-ink hover:text-ink"
            >
              {showFills ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {showFills
                ? "Hide fills"
                : `More info — ${fills.length} fill${fills.length === 1 ? "" : "s"}`}
            </button>

            {showFills && (
              <div className="mt-3">
                {fills.length === 0 ? (
                  <p className="text-[13px] text-ink-faint">
                    No extracted fills for this position yet — the inbox fills as venue reads land.
                  </p>
                ) : (
                  <>
                    <ul className="grid gap-2">
                      {fills.slice(0, 12).map((f) => (
                        <li
                          key={f.id}
                          className="flex items-baseline gap-3 border-b border-stroke pb-2 text-[13px] last:border-0"
                        >
                          <span className="eyebrow w-20 shrink-0">{dayLabel(f.ts)}</span>
                          <span className="min-w-0 flex-1 truncate">{describeSignal(f)}</span>
                          <span
                            className={cn(
                              "num shrink-0 text-[12px]",
                              (f.meta?.pnl ?? 0) > 0
                                ? "text-gain"
                                : (f.meta?.pnl ?? 0) < 0
                                  ? "text-loss"
                                  : "text-ink-faint",
                            )}
                          >
                            {f.meta?.pnl != null
                              ? usd(f.meta.pnl, hidden)
                              : f.value != null
                                ? usd(f.value, hidden)
                                : "—"}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {fills.length > 12 && (
                      <p className="eyebrow mt-2">+{fills.length - 12} earlier fills</p>
                    )}
                    <Link
                      to="/journal"
                      search={{
                        tab: "inbox" as const,
                        filter: "all",
                        venue: trade.venue as "nado" | "hyperliquid",
                      }}
                      onClick={onClose}
                      className="eyebrow mt-3 inline-block hover:text-ink"
                    >
                      Open these fills in the inbox →
                    </Link>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: "gain" | "loss" }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd
        className={cn(
          "num mt-1 text-[13px]",
          tone === "gain" && "text-gain",
          tone === "loss" && "text-loss",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
