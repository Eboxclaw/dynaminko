// Progressive Markets flow: list first, ticket next. Selecting an asset
// swaps the panel to the CLOB ticket + depth for that asset. Once inside
// the ticket, sub-tabs switch between four dedicated tickets:
//   SPOT · SWAP · LONG · SHORT
// Each ticket is intentionally minimal — one job per screen.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight } from "lucide-react";
import {
  ASSETS,
  CATEGORIES,
  SUBCATEGORY_COLORS,
  generateOrderBook,
  type Asset,
  type Category,
} from "@/lib/dynaminko-data";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { DossierCard } from "../DossierCard";

type CatFilter = Category | "ALL";
export type TradeMode = "spot" | "swap" | "long" | "short";

const MODE_LABEL: Record<TradeMode, string> = {
  spot: "SPOT",
  swap: "SWAP",
  long: "LONG",
  short: "SHORT",
};

export function MarketsView() {
  const [cat, setCat] = useState<CatFilter>("ALL");
  const [sub, setSub] = useState<string | "ALL">("ALL");
  const [selected, setSelected] = useState<Asset | null>(null);
  const [defaultMode] = useLocalStorage<TradeMode>("dyn.tradeMode", "spot");
  const [mode, setMode] = useState<TradeMode>(defaultMode);

  useEffect(() => {
    if (selected) setMode(defaultMode);
  }, [selected, defaultMode]);

  const filtered = useMemo(() => {
    return ASSETS.filter(
      (a) =>
        (cat === "ALL" || a.category === cat) &&
        (sub === "ALL" || a.subCategory === sub),
    );
  }, [cat, sub]);

  const subCategoriesInScope = useMemo(() => {
    const set = new Set<string>();
    ASSETS.filter((a) => cat === "ALL" || a.category === cat).forEach((a) =>
      set.add(a.subCategory),
    );
    return Array.from(set);
  }, [cat]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  if (selected) {
    return (
      <div className="p-4 md:p-6 lg:p-8 max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <button
            onClick={() => setSelected(null)}
            className="flex items-center gap-2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest border border-hairline text-paper hover:border-lavender"
          >
            <ArrowLeft className="size-3" /> back to list
          </button>
          <div className="flex items-baseline gap-4">
            <div className="font-mono text-[10px] uppercase tracking-widest text-ash">
              {selected.category} // <span className="text-paper">{selected.subCategory}</span>
            </div>
            <div className="font-mono text-lg text-paper">{selected.ticker}</div>
            <div className="font-mono text-sm text-ash">{selected.name}</div>
          </div>
        </div>

        {/* Trade-mode sub-nav (dedicated ticket per mode) */}
        <div className="grid grid-cols-4 border border-hairline">
          {(Object.keys(MODE_LABEL) as TradeMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={
                "py-2 font-mono text-[10px] uppercase tracking-[0.18em] border-r border-hairline last:border-r-0 " +
                (mode === m
                  ? "bg-lavender/[0.08] text-lavender"
                  : "text-ash hover:text-paper")
              }
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ClobTicket asset={selected} mode={mode} />
          <OrderBook asset={selected} />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-6xl mx-auto space-y-5">
      <div>
        <div className="font-mono text-[9px] uppercase tracking-[0.24em] text-ash mb-2">
          Category
        </div>
        <div className="flex gap-1">
          {(["ALL", ...CATEGORIES] as CatFilter[]).map((c) => (
            <button
              key={c}
              onClick={() => {
                setCat(c);
                setSub("ALL");
              }}
              className={
                "px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] border transition-colors " +
                (cat === c
                  ? "border-lavender text-lavender bg-lavender/[0.05]"
                  : "border-hairline text-ash hover:text-paper")
              }
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="font-mono text-[9px] uppercase tracking-[0.24em] text-ash mb-2">
          Sub-basket
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setSub("ALL")}
            className={
              "px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest border transition-colors " +
              (sub === "ALL"
                ? "border-lavender text-lavender"
                : "border-hairline text-ash hover:text-paper")
            }
          >
            all
          </button>
          {subCategoriesInScope.map((s) => (
            <button
              key={s}
              onClick={() => setSub(s)}
              className={
                "flex items-center gap-1.5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest border transition-colors " +
                (sub === s
                  ? "border-lavender text-lavender"
                  : "border-hairline text-ash hover:text-paper")
              }
            >
              <span className="size-1" style={{ backgroundColor: SUBCATEGORY_COLORS[s] }} />
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-obsidian border border-hairline">
        <div className="grid grid-cols-[1.4fr_0.8fr_0.8fr_1fr_0.7fr] font-mono text-[10px] uppercase tracking-[0.14em] text-ash px-4 py-2 border-b border-hairline">
          <span>Asset</span>
          <span>Category</span>
          <span>Sub-basket</span>
          <span className="text-right">Price</span>
          <span className="text-right">24h</span>
        </div>
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-ash text-sm">No assets in scope.</div>
        ) : (
          filtered.map((a) => (
            <button
              key={a.ticker}
              onClick={() => setSelected(a)}
              className="w-full grid grid-cols-[1.4fr_0.8fr_0.8fr_1fr_0.7fr] items-center px-4 py-3 border-b border-hairline last:border-b-0 text-left hover:bg-lavender/[0.04] transition-colors"
            >
              <div className="flex items-center gap-3">
                <div
                  className="size-1.5"
                  style={{ backgroundColor: SUBCATEGORY_COLORS[a.subCategory] }}
                />
                <div>
                  <div className="font-mono text-paper">{a.ticker}</div>
                  <div className="text-[10px] text-ash truncate">{a.name}</div>
                </div>
              </div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-ash">
                {a.category}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-ash">
                {a.subCategory}
              </div>
              <div className="font-mono text-paper text-right tabular-nums">
                ${a.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              <div
                className={
                  "font-mono text-right tabular-nums " +
                  (a.change24h >= 0 ? "text-mint" : "text-rose")
                }
              >
                {a.change24h >= 0 ? "+" : ""}
                {a.change24h.toFixed(2)}%
              </div>
            </button>
          ))
        )}
      </div>

      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ash text-center">
        select an asset · CLOB ticket opens in the next step
      </p>
    </div>
  );
}

// ── Ticket dispatcher — one dedicated body per trade mode ─────────────
function ClobTicket({ asset, mode }: { asset: Asset; mode: TradeMode }) {
  return (
    <DossierCard
      label={mode === "swap" ? "SWAP" : mode === "spot" ? "SPOT" : "PERP"}
      index={asset.ticker}
      status={{
        tone: mode === "short" ? "rose" : mode === "long" ? "mint" : "lavender",
        text:
          mode === "swap"
            ? "NADO // ROUTE"
            : mode === "spot"
              ? "NADO // CLOB"
              : mode === "long"
                ? "NADO // PERP · LONG"
                : "NADO // PERP · SHORT",
      }}
    >
      <div className="p-4 space-y-4">
        <div className="flex justify-between items-baseline">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-ash">Mark</div>
            <div className="font-mono text-2xl text-paper tabular-nums">
              ${asset.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div
            className={
              "font-mono text-sm tabular-nums " +
              (asset.change24h >= 0 ? "text-mint" : "text-rose")
            }
          >
            {asset.change24h >= 0 ? "+" : ""}
            {asset.change24h.toFixed(2)}%
          </div>
        </div>

        {mode === "spot" && <SpotBody asset={asset} />}
        {mode === "swap" && <SwapBody asset={asset} />}
        {mode === "long" && <PerpBody asset={asset} side="long" />}
        {mode === "short" && <PerpBody asset={asset} side="short" />}
      </div>
    </DossierCard>
  );
}

// SPOT — market-only CLOB buy/sell against USDC
function SpotBody({ asset }: { asset: Asset }) {
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [qty, setQty] = useState("1");
  const cost = Number(qty || 0) * asset.price;
  return (
    <>
      <div className="grid grid-cols-2 border border-hairline">
        {(["BUY", "SELL"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className={
              "py-2 font-mono text-[10px] uppercase tracking-widest border-r border-hairline last:border-r-0 " +
              (side === s
                ? s === "BUY"
                  ? "bg-mint/[0.08] text-mint"
                  : "bg-rose/[0.08] text-rose"
                : "text-ash hover:text-paper")
            }
          >
            {s} {asset.ticker}
          </button>
        ))}
      </div>
      <NumField label={`Quantity (${asset.ticker})`} value={qty} onChange={setQty} />
      <Kv label="Est. cost" value={`$${cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
      <RouteButton
        label={`${side} ${asset.ticker} · spot`}
        onClick={() =>
          toast(`${side} SPOT · ${asset.ticker}`, {
            description: `Routed via Nado CLOB @ $${asset.price.toFixed(2)} (mock)`,
          })
        }
      />
    </>
  );
}

// SWAP — asset A → asset B with slippage
function SwapBody({ asset }: { asset: Asset }) {
  const other = ASSETS.find((a) => a.ticker !== asset.ticker) ?? ASSETS[0];
  const [fromTicker, setFromTicker] = useState(other.ticker);
  const [amount, setAmount] = useState("100");
  const [slippage, setSlippage] = useState("0.3");
  const from = ASSETS.find((a) => a.ticker === fromTicker) ?? other;
  const receive = (Number(amount || 0) * from.price) / asset.price;
  return (
    <>
      <div className="space-y-2">
        <label className="font-mono text-[10px] uppercase tracking-widest text-ash">From</label>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="bg-onyx border border-hairline px-3 py-2 font-mono text-paper focus:border-lavender focus:outline-none"
          />
          <select
            value={fromTicker}
            onChange={(e) => setFromTicker(e.target.value)}
            className="bg-onyx border border-hairline px-2 font-mono text-[11px] text-paper"
          >
            {ASSETS.filter((a) => a.ticker !== asset.ticker).map((a) => (
              <option key={a.ticker}>{a.ticker}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex justify-center">
        <ArrowRight className="size-4 text-lavender rotate-90" />
      </div>
      <Kv label={`Receive · ${asset.ticker}`} value={receive.toLocaleString(undefined, { maximumFractionDigits: 6 })} strong />
      <NumField label="Max slippage %" value={slippage} onChange={setSlippage} />
      <RouteButton
        label={`Swap ${fromTicker} → ${asset.ticker}`}
        onClick={() =>
          toast(`SWAP · ${fromTicker} → ${asset.ticker}`, {
            description: `Nado router · slippage ${slippage}% (mock)`,
          })
        }
      />
    </>
  );
}

// PERP — long or short with leverage; margin + liquidation estimate
function PerpBody({ asset, side }: { asset: Asset; side: "long" | "short" }) {
  const [size, setSize] = useState("1000");
  const [lev, setLev] = useState(5);
  const notional = Number(size || 0);
  const margin = lev > 0 ? notional / lev : notional;
  const liq =
    side === "long"
      ? asset.price * (1 - 1 / lev + 0.005)
      : asset.price * (1 + 1 / lev - 0.005);
  const tone = side === "long" ? "text-mint" : "text-rose";
  return (
    <>
      <NumField label={`Size (USDC notional)`} value={size} onChange={setSize} />
      <div className="space-y-1.5">
        <div className="flex justify-between font-mono text-[10px] uppercase tracking-widest">
          <span className="text-ash">Leverage</span>
          <span className={tone + " tabular-nums"}>{lev}x</span>
        </div>
        <input
          type="range"
          min={1}
          max={20}
          value={lev}
          onChange={(e) => setLev(Number(e.target.value))}
          className="w-full accent-lavender"
        />
        <div className="flex justify-between font-mono text-[9px] text-ash">
          <span>1x</span><span>5x</span><span>10x</span><span>20x</span>
        </div>
      </div>
      <Kv label="Initial margin" value={`$${margin.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
      <Kv
        label={`Est. liquidation`}
        value={`$${liq.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
        toneClass="text-rose"
      />
      <RouteButton
        label={`Open ${side.toUpperCase()} ${asset.ticker}`}
        onClick={() =>
          toast(`${side.toUpperCase()} · ${asset.ticker}`, {
            description: `Nado unified margin · ${lev}x · notional $${notional.toLocaleString()} (mock)`,
          })
        }
        tone={side === "short" ? "rose" : "mint"}
      />
    </>
  );
}

// ── Small primitives shared by every ticket ────────────────────────────
function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="font-mono text-[10px] uppercase tracking-widest text-ash">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-onyx border border-hairline px-3 py-2 font-mono text-paper focus:border-lavender focus:outline-none"
      />
    </div>
  );
}

function Kv({
  label,
  value,
  strong = false,
  toneClass,
}: {
  label: string;
  value: string;
  strong?: boolean;
  toneClass?: string;
}) {
  return (
    <div className="flex justify-between font-mono text-[11px]">
      <span className="text-ash uppercase tracking-widest text-[10px]">{label}</span>
      <span className={"tabular-nums " + (toneClass ?? (strong ? "text-paper" : "text-paper"))}>
        {value}
      </span>
    </div>
  );
}

function RouteButton({
  label,
  onClick,
  tone = "lavender",
}: {
  label: string;
  onClick: () => void;
  tone?: "lavender" | "mint" | "rose";
}) {
  const cls =
    tone === "mint"
      ? "bg-mint text-onyx"
      : tone === "rose"
        ? "bg-rose text-onyx"
        : "bg-lavender text-onyx";
  return (
    <button
      onClick={onClick}
      className={
        "w-full py-2.5 font-mono text-[11px] uppercase tracking-[0.2em] hover:brightness-110 " +
        cls
      }
    >
      {label}
    </button>
  );
}

function OrderBook({ asset }: { asset: Asset }) {
  const { asks, bids } = generateOrderBook(asset.price);
  const maxSize = Math.max(...asks.map((a) => a.size), ...bids.map((b) => b.size));
  return (
    <div className="bg-obsidian border border-hairline">
      <div className="flex justify-between items-center px-4 py-3 border-b border-hairline">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ash">
          ORDER BOOK <span className="text-paper">// {asset.ticker}/USDC</span>
        </div>
        <span className="font-mono text-[10px] uppercase text-ash">Nado depth</span>
      </div>
      <div className="p-3 font-mono text-[11px] space-y-0.5">
        {asks
          .slice()
          .reverse()
          .map((a, i) => (
            <Row
              key={"a" + i}
              price={a.price}
              size={a.size}
              pct={(a.size / maxSize) * 100}
              side="ask"
            />
          ))}
        <div className="my-2 py-1.5 border-y border-hairline flex justify-between text-xs">
          <span className="text-paper tabular-nums">${asset.price.toFixed(2)}</span>
          <span
            className={
              "tabular-nums " + (asset.change24h >= 0 ? "text-mint" : "text-rose")
            }
          >
            {asset.change24h >= 0 ? "+" : ""}
            {asset.change24h.toFixed(2)}%
          </span>
        </div>
        {bids.map((b, i) => (
          <Row
            key={"b" + i}
            price={b.price}
            size={b.size}
            pct={(b.size / maxSize) * 100}
            side="bid"
          />
        ))}
      </div>
    </div>
  );
}

function Row({
  price,
  size,
  pct,
  side,
}: {
  price: number;
  size: number;
  pct: number;
  side: "ask" | "bid";
}) {
  return (
    <div className="relative flex justify-between px-1 py-[3px]">
      <div
        className="absolute inset-y-0 right-0"
        style={{
          width: `${pct}%`,
          background: side === "ask" ? "rgba(201,124,116,0.10)" : "rgba(79,247,180,0.10)",
        }}
      />
      <span
        className={
          "relative tabular-nums " + (side === "ask" ? "text-rose" : "text-mint")
        }
      >
        {price.toFixed(2)}
      </span>
      <span className="relative text-ash tabular-nums">{size.toFixed(2)}</span>
    </div>
  );
}
