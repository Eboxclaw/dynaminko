// Progressive Markets flow: list first, ticket next. Selecting an asset
// swaps the panel to the CLOB ticket + depth for that asset. Back returns
// to the list (also on Esc).

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import {
  ASSETS,
  CATEGORIES,
  SUBCATEGORY_COLORS,
  generateOrderBook,
  type Asset,
  type Category,
} from "@/lib/dynaminko-data";
import { DossierCard } from "../DossierCard";

type CatFilter = Category | "ALL";

export function MarketsView() {
  const [cat, setCat] = useState<CatFilter>("ALL");
  const [sub, setSub] = useState<string | "ALL">("ALL");
  const [selected, setSelected] = useState<Asset | null>(null);

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
        <div className="flex items-center justify-between">
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ClobTicket asset={selected} />
          <OrderBook asset={selected} />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-6xl mx-auto space-y-5">
      {/* Category tabs */}
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

      {/* Sub-category chips */}
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

      {/* Asset list */}
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

function ClobTicket({ asset }: { asset: Asset }) {
  const [action, setAction] = useState<"BUY SPOT" | "GO LONG" | "SWAP">("BUY SPOT");
  const [qty, setQty] = useState("1");
  return (
    <DossierCard
      label="CLOB TICKET"
      index={asset.ticker}
      status={{ tone: "lavender", text: "NADO // OPEN" }}
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

        <div className="grid grid-cols-3 gap-0 border border-hairline">
          {(["BUY SPOT", "GO LONG", "SWAP"] as const).map((a) => (
            <button
              key={a}
              onClick={() => setAction(a)}
              className={
                "py-2 font-mono text-[10px] uppercase tracking-widest border-r border-hairline last:border-r-0 " +
                (action === a
                  ? "bg-lavender/[0.08] text-lavender"
                  : "text-ash hover:text-paper")
              }
            >
              {a}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <label className="font-mono text-[10px] uppercase tracking-widest text-ash">
            Quantity
          </label>
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="w-full bg-onyx border border-hairline px-3 py-2 font-mono text-paper focus:border-lavender focus:outline-none"
          />
          <div className="flex justify-between font-mono text-[10px] text-ash">
            <span>Est. cost</span>
            <span className="text-paper tabular-nums">
              $
              {(Number(qty || 0) * asset.price).toLocaleString(undefined, {
                minimumFractionDigits: 2,
              })}
            </span>
          </div>
        </div>

        <button
          onClick={() =>
            toast(`${action} · ${asset.ticker}`, {
              description: `Routed via Nado on Ink Chain @ $${asset.price.toFixed(2)} (mock)`,
            })
          }
          className="w-full py-2.5 bg-lavender text-onyx font-mono text-[11px] uppercase tracking-[0.2em] hover:brightness-110"
        >
          Route {action.toLowerCase()}
        </button>
      </div>
    </DossierCard>
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
