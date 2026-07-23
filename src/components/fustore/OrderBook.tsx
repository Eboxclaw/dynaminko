import { useMemo } from "react";
import { generateOrderBook, type Asset } from "@/lib/fustore-data";

export function OrderBook({ asset }: { asset: Asset }) {
  const { asks, bids } = useMemo(() => generateOrderBook(asset.price), [asset.ticker]);
  const maxSize = Math.max(...asks.map((a) => a.size), ...bids.map((b) => b.size));

  return (
    <div className="bg-onyx border border-steel flex flex-col">
      <div className="px-4 py-3 border-b border-steel flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono uppercase text-white tracking-wider">
            Order Book
          </span>
          <span className="px-1.5 py-0.5 text-[9px] font-mono bg-steel text-slate-300 tracking-widest">
            {asset.ticker} / USDC
          </span>
        </div>
        <span className="text-[9px] font-mono text-slate-500 uppercase">Nado Builder</span>
      </div>
      <div className="p-3 font-mono text-[11px] space-y-0.5">
        {asks
          .slice()
          .reverse()
          .map((a, i) => (
            <Row key={"a" + i} price={a.price} size={a.size} pct={(a.size / maxSize) * 100} side="ask" />
          ))}
        <div className="my-2 py-2 border-y border-steel flex items-center justify-between text-xs">
          <span className="text-white font-bold tabular-nums">
            ${asset.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </span>
          <span
            className={
              "text-[10px] tabular-nums " +
              (asset.change24h >= 0 ? "text-neon-mint" : "text-red-400")
            }
          >
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
          background: side === "ask" ? "rgba(248,113,113,0.10)" : "rgba(0,255,157,0.10)",
        }}
      />
      <span className={"relative tabular-nums " + (side === "ask" ? "text-red-400" : "text-neon-mint")}>
        {price.toFixed(2)}
      </span>
      <span className="relative text-slate-400 tabular-nums">{size.toFixed(2)}</span>
    </div>
  );
}
