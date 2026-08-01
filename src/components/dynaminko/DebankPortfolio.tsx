// DeBank-style portfolio panel. Aggregates two layers for the visible wallets:
//   1. Token holdings (grouped by category, existing PositionsPanel shape)
//   2. Protocol positions on Ink-native venues: Nado (perps + margin),
//      Velodrome (LPs), InkySwap (LPs), InkyPump (meme bags), and
//      InkyPump Lock (dev-locked LP)
// Everything is mock and deterministic per address.

import { useMemo, useState } from "react";
import {
  ASSETS,
  SUBCATEGORY_COLORS,
  protocolPositionsForAddress,
  type Category,
  type Protocol,
  type ProtocolPosition,
} from "@/lib/dynaminko-data";
import { isValidAddress } from "@/lib/wallet-mock";
import { holdingsTotalUsd, type Holding } from "@/lib/portfolio";
import { SkeletonRows } from "./DataSource";
import type { Wallet } from "@/lib/wallets";


const PROTOCOL_ORDER: Protocol[] = [
  "Nado",
  "Velodrome",
  "InkySwap",
  "InkyPump",
  "InkyPump Lock",
];

const PROTOCOL_TINT: Record<Protocol, string> = {
  Nado: "#B6A5F0",
  Velodrome: "#4FF7B4",
  InkySwap: "#D8CBA0",
  InkyPump: "#C97C74",
  "InkyPump Lock": "#8B8894",
};

function fmtUsd(n: number, hidden: boolean) {
  if (hidden) return "$***";
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

export function DebankPortfolio({
  wallets,
  positions,
  hidden,
  holdings = [],
  demo = false,
  status = "ready",
}: {
  wallets: Wallet[];
  positions: Record<string, number> | null;
  hidden: boolean;
  holdings?: Holding[];
  demo?: boolean;
  status?: "idle" | "loading" | "ready" | "error";
}) {
  const [tab, setTab] = useState<"tokens" | "protocols">("tokens");

  const activeWallets = wallets.filter((w) => w.visible && isValidAddress(w.address));

  // Protocol positions stay staged until a real Nado/Velodrome indexer lands.
  const protocolItems = useMemo<ProtocolPosition[]>(() => {
    if (!demo) return [];
    const out: ProtocolPosition[] = [];
    for (const w of activeWallets) out.push(...protocolPositionsForAddress(w.address));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, activeWallets.map((w) => w.address).join(",")]);

  const tokenTotal = demo
    ? positions
      ? ASSETS.reduce((s, a) => s + (positions[a.ticker] ?? 0) * a.price, 0)
      : 0
    : holdingsTotalUsd(holdings);
  const protocolTotal = protocolItems.reduce((s, p) => s + p.usd, 0);
  const grandTotal = tokenTotal + protocolTotal;


  return (
    <div className="dyn-dossier">
      <div className="flex justify-between items-center px-4 pt-3 pb-2 border-b border-hairline">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ash">
          PORTFOLIO <span className="text-paper">// {activeWallets.length} WALLET{activeWallets.length === 1 ? "" : "S"}</span>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper tabular-nums">
          {fmtUsd(grandTotal, hidden)}
        </div>
      </div>

      <div className="flex border-b border-hairline">
        {(["tokens", "protocols"] as const).map((t) => {
          const total = t === "tokens" ? tokenTotal : protocolTotal;
          const count = t === "tokens"
            ? demo
              ? (positions ? ASSETS.filter((a) => (positions[a.ticker] ?? 0) > 0).length : 0)
              : holdings.length
            : protocolItems.length;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                "flex-1 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] border-r border-hairline last:border-r-0 flex items-center justify-between gap-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-lavender " +
                (tab === t ? "bg-lavender/[0.06] text-lavender" : "text-ash hover:text-paper")
              }
            >
              <span>{t}</span>
              <span className="tabular-nums text-[10px] text-ash">
                {count} · {fmtUsd(total, hidden)}
              </span>
            </button>
          );
        })}
      </div>

      {activeWallets.length === 0 ? (
        <div className="p-10 text-center">
          <p className="text-ash text-sm mb-1">No visible wallets.</p>
          <p className="font-mono text-[10px] uppercase tracking-widest text-ash/60">
            add or unhide a wallet from the top bar
          </p>
        </div>
      ) : tab === "tokens" ? (
        demo ? (
          <TokensView positions={positions} hidden={hidden} />
        ) : status === "loading" && holdings.length === 0 ? (
          <SkeletonRows rows={5} />
        ) : (
          <ChainTokensView holdings={holdings} hidden={hidden} />
        )
      ) : demo ? (
        <ProtocolsView items={protocolItems} hidden={hidden} />
      ) : (
        <div className="p-10 text-center">
          <p className="text-ash text-sm mb-1">Protocol reads are not wired yet.</p>
          <p className="font-mono text-[10px] uppercase tracking-widest text-ash/60">
            nado · velodrome · inkyswap indexers land next · switch on demo data to preview
          </p>
        </div>
      )}

    </div>
  );
}

/** Real ERC-20 + native balances read from the Ink explorer. */
function ChainTokensView({ holdings, hidden }: { holdings: Holding[]; hidden: boolean }) {
  if (holdings.length === 0)
    return (
      <div className="p-10 text-center">
        <p className="text-ash text-sm mb-1">No balances found on Ink for these wallets.</p>
        <p className="font-mono text-[10px] uppercase tracking-widest text-ash/60">
          nothing invented — this is the chain's answer
        </p>
      </div>
    );
  const priced = holdings.filter((h) => h.usd != null);
  const unpriced = holdings.filter((h) => h.usd == null);
  const section = (label: string, rows: Holding[]) =>
    rows.length === 0 ? null : (
      <div key={label} className="border-b border-hairline last:border-b-0">
        <div className="flex justify-between items-center px-4 py-2 bg-onyx/40">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper">
            {label}
          </span>
          <span className="font-mono text-[10px] text-ash tabular-nums">
            {rows.length} · {fmtUsd(holdingsTotalUsd(rows), hidden)}
          </span>
        </div>
        {rows.map((h) => (
          <div
            key={h.address + h.symbol}
            className="grid grid-cols-[1.4fr_1fr_0.9fr] items-center px-4 py-2.5 border-t border-hairline text-[11px]"
          >
            <div className="min-w-0">
              <div className="font-mono text-paper truncate">{h.symbol}</div>
              <div className="text-[10px] text-ash truncate">{h.name}</div>
            </div>
            <div className="font-mono text-paper text-right tabular-nums text-[10px]">
              {hidden
                ? "***"
                : h.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })}
            </div>
            <div className="font-mono text-right tabular-nums text-paper">
              {h.usd == null ? (
                <span className="text-ash text-[10px] uppercase tracking-widest">no quote</span>
              ) : (
                fmtUsd(h.usd * h.amount, hidden)
              )}
            </div>
          </div>
        ))}
      </div>
    );
  return (
    <div>
      {section("Priced on-chain", priced)}
      {section("Unpriced", unpriced)}
    </div>
  );
}


function TokensView({
  positions,
  hidden,
}: {
  positions: Record<string, number> | null;
  hidden: boolean;
}) {
  if (!positions) return <div className="p-10 text-center text-ash text-sm">No positions.</div>;
  const cats: Category[] = ["Crypto", "xStocks"];
  return (
    <div>
      {cats.map((cat) => {
        const rows = ASSETS.filter((a) => a.category === cat && (positions[a.ticker] ?? 0) > 0)
          .map((a) => {
            const qty = positions[a.ticker];
            return { ...a, qty, usd: qty * a.price };
          })
          .sort((a, b) => b.usd - a.usd);
        if (rows.length === 0) return null;
        const total = rows.reduce((s, r) => s + r.usd, 0);
        return (
          <div key={cat} className="border-b border-hairline last:border-b-0">
            <div className="flex justify-between items-center px-4 py-2 bg-onyx/40">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper">
                {cat}
              </span>
              <span className="font-mono text-[10px] text-ash tabular-nums">
                {rows.length} · {fmtUsd(total, hidden)}
              </span>
            </div>
            {rows.map((r) => (
              <div
                key={r.ticker}
                className="grid grid-cols-[1.4fr_0.9fr_1fr_0.7fr] items-center px-4 py-2.5 border-t border-hairline text-[11px]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="size-1.5 shrink-0"
                    style={{ backgroundColor: SUBCATEGORY_COLORS[r.subCategory] }}
                  />
                  <div className="min-w-0">
                    <div className="font-mono text-paper">{r.ticker}</div>
                    <div className="text-[10px] text-ash truncate uppercase tracking-widest">
                      {r.subCategory}
                    </div>
                  </div>
                </div>
                <div className="font-mono text-paper text-right tabular-nums text-[10px]">
                  {r.qty.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </div>
                <div className="font-mono text-paper text-right tabular-nums">
                  {fmtUsd(r.usd, hidden)}
                </div>
                <div
                  className={
                    "font-mono text-right tabular-nums " +
                    (r.change24h >= 0 ? "text-mint" : "text-rose")
                  }
                >
                  {r.change24h >= 0 ? "+" : ""}
                  {r.change24h.toFixed(2)}%
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function ProtocolsView({
  items,
  hidden,
}: {
  items: ProtocolPosition[];
  hidden: boolean;
}) {
  if (items.length === 0)
    return <div className="p-10 text-center text-ash text-sm">No protocol positions.</div>;
  return (
    <div>
      {PROTOCOL_ORDER.map((proto) => {
        const rows = items.filter((i) => i.protocol === proto);
        if (rows.length === 0) return null;
        const total = rows.reduce((s, r) => s + r.usd, 0);
        return (
          <div key={proto} className="border-b border-hairline last:border-b-0">
            <div className="flex justify-between items-center px-4 py-2 bg-onyx/40">
              <div className="flex items-center gap-2">
                <span className="size-1.5" style={{ backgroundColor: PROTOCOL_TINT[proto] }} />
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper">
                  {proto}
                </span>
              </div>
              <span className="font-mono text-[10px] text-ash tabular-nums">
                {rows.length} · {fmtUsd(total, hidden)}
              </span>
            </div>
            {rows.map((r) => (
              <div
                key={r.id}
                className="grid grid-cols-[1.6fr_0.9fr_0.7fr] items-center px-4 py-2.5 border-t border-hairline text-[11px] gap-2"
              >
                <div className="min-w-0">
                  <div className="font-mono text-paper truncate">{r.label}</div>
                  <div className="text-[10px] text-ash truncate uppercase tracking-widest">
                    {r.kind}{r.detail ? ` · ${r.detail}` : ""}
                    {r.unlockAt
                      ? ` · unlock ${new Date(r.unlockAt).toLocaleDateString()}`
                      : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-paper tabular-nums">
                    {fmtUsd(r.usd, hidden)}
                  </div>
                  {r.apy != null && (
                    <div className="font-mono text-[10px] text-mint tabular-nums">
                      {r.apy.toFixed(2)}% APY
                    </div>
                  )}
                </div>
                <div className="text-right">
                  {r.pnl != null ? (
                    <div
                      className={
                        "font-mono tabular-nums text-[11px] " +
                        (r.pnl >= 0 ? "text-mint" : "text-rose")
                      }
                    >
                      {r.pnl >= 0 ? "+" : ""}
                      {fmtUsd(Math.abs(r.pnl), hidden).replace("$", "$")}
                    </div>
                  ) : (
                    <div className="font-mono text-[10px] text-ash">—</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
