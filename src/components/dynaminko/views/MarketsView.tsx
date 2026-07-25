import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ASSETS, SECTORS, SECTOR_COLORS, generateOrderBook, type Asset, type Sector } from "@/lib/dynaminko-data";
import { DossierCard } from "../DossierCard";

type Filter = Sector | "ALL";

export function MarketsView() {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [selected, setSelected] = useState<Asset>(ASSETS[0]);
  const rows = useMemo(
    () => (filter === "ALL" ? ASSETS : ASSETS.filter((a) => a.sector === filter)),
    [filter],
  );

  return (
    <div className="p-4 md:p-6 lg:p-8 grid grid-cols-1 xl:grid-cols-12 gap-6">
      {/* Sector tabs + asset list */}
      <div className="xl:col-span-7 space-y-4">
        <div className="flex flex-wrap gap-1">
          {(["ALL", ...SECTORS] as Filter[]).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={
                "px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] border transition-colors " +
                (filter === s
                  ? "border-lavender text-lavender"
                  : "border-hairline text-ash hover:text-paper")
              }
            >
              {s}
            </button>
          ))}
        </div>

        <div className="bg-obsidian border border-hairline">
          <div className="grid grid-cols-[1.5fr_0.8fr_1fr_0.7fr] font-mono text-[10px] uppercase tracking-[0.14em] text-ash px-4 py-2 border-b border-hairline">
            <span>Asset</span><span>Sector</span><span className="text-right">Price</span><span className="text-right">24h</span>
          </div>
          <div>
            {rows.map((a) => {
              const isSel = a.ticker === selected.ticker;
              return (
                <button
                  key={a.ticker}
                  onClick={() => setSelected(a)}
                  className={
                    "w-full grid grid-cols-[1.5fr_0.8fr_1fr_0.7fr] items-center px-4 py-3 border-b border-hairline text-left transition-colors " +
                    (isSel ? "bg-lavender/[0.05]" : "hover:bg-lavender/[0.03]")
                  }
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="size-1.5"
                      style={{ backgroundColor: SECTOR_COLORS[a.sector] }}
                    />
                    <div>
                      <div className="font-mono text-paper">{a.ticker}</div>
                      <div className="text-[10px] text-ash truncate">{a.name}</div>
                    </div>
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-ash">
                    {a.sector}
                  </div>
                  <div className="font-mono text-paper text-right tabular-nums">
                    ${a.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                  <div className={"font-mono text-right tabular-nums " + (a.change24h >= 0 ? "text-mint" : "text-rose")}>
                    {a.change24h >= 0 ? "+" : ""}
                    {a.change24h.toFixed(2)}%
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* CLOB ticket + order book */}
      <div className="xl:col-span-5 space-y-4">
        <ClobTicket asset={selected} />
        <OrderBook asset={selected} />
      </div>
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
          <div className={"font-mono text-sm tabular-nums " + (asset.change24h >= 0 ? "text-mint" : "text-rose")}>
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
          <label className="font-mono text-[10px] uppercase tracking-widest text-ash">Quantity</label>
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="w-full bg-onyx border border-hairline px-3 py-2 font-mono text-paper focus:border-lavender"
          />
          <div className="flex justify-between font-mono text-[10px] text-ash">
            <span>Est. cost</span>
            <span className="text-paper tabular-nums">
              ${(Number(qty || 0) * asset.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
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
        {asks.slice().reverse().map((a, i) => (
          <Row key={"a" + i} price={a.price} size={a.size} pct={(a.size / maxSize) * 100} side="ask" />
        ))}
        <div className="my-2 py-1.5 border-y border-hairline flex justify-between text-xs">
          <span className="text-paper tabular-nums">${asset.price.toFixed(2)}</span>
          <span className={"tabular-nums " + (asset.change24h >= 0 ? "text-mint" : "text-rose")}>
            {asset.change24h >= 0 ? "+" : ""}
            {asset.change24h.toFixed(2)}%
          </span>
        </div>
        {bids.map((b, i) => (
          <Row key={"b" + i} price={b.price} size={b.size} pct={(b.size / maxSize) * 100} side="bid" />
        ))}
      </div>
    </div>
  );
}

function Row({ price, size, pct, side }: { price: number; size: number; pct: number; side: "ask" | "bid" }) {
  return (
    <div className="relative flex justify-between px-1 py-[3px]">
      <div
        className="absolute inset-y-0 right-0"
        style={{ width: `${pct}%`, background: side === "ask" ? "rgba(201,124,116,0.10)" : "rgba(79,247,180,0.10)" }}
      />
      <span className={"relative tabular-nums " + (side === "ask" ? "text-rose" : "text-mint")}>{price.toFixed(2)}</span>
      <span className="relative text-ash tabular-nums">{size.toFixed(2)}</span>
    </div>
  );
}
