import { useMemo, useState } from "react";
import { ASSETS, SECTOR_COLORS, type Asset, type Sector } from "@/lib/fustore-data";

const SECTORS: (Sector | "ALL")[] = [
  "ALL",
  "Privacy",
  "Defense",
  "Firearms",
  "Chips",
  "AI",
  "Health",
  "Store of Value",
];

export function MarketTable({
  selected,
  onSelect,
  onAction,
}: {
  selected: Asset;
  onSelect: (a: Asset) => void;
  onAction: (a: Asset, action: "BUY SPOT" | "GO LONG" | "PREDICT") => void;
}) {
  const [filter, setFilter] = useState<Sector | "ALL">("ALL");
  const rows = useMemo(
    () => (filter === "ALL" ? ASSETS : ASSETS.filter((a) => a.sector === filter)),
    [filter],
  );

  return (
    <div className="bg-onyx border border-steel">
      <div className="p-4 border-b border-steel flex flex-wrap gap-4 justify-between items-center">
        <div className="flex flex-col">
          <div className="text-xs font-mono uppercase text-white tracking-wider">
            Nado CLOB · Premium Selection
          </div>
          <div className="text-[10px] font-mono text-neon-mint italic mt-0.5">
            Best goods on earth and beyond
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {SECTORS.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={
                "px-2.5 py-1 text-[10px] font-mono uppercase tracking-widest border transition-colors " +
                (filter === s
                  ? "border-neon-mint/50 text-neon-mint bg-neon-mint/5"
                  : "border-steel text-slate-500 hover:text-white hover:border-slate-600")
              }
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left font-mono">
          <thead>
            <tr className="text-[10px] uppercase text-slate-500 border-b border-steel">
              <th className="px-4 py-3 font-normal">Asset</th>
              <th className="px-4 py-3 font-normal">Sector</th>
              <th className="px-4 py-3 font-normal text-right">Price (USDC)</th>
              <th className="px-4 py-3 font-normal text-right">24h</th>
              <th className="px-4 py-3 font-normal">Permissionless Actions</th>
            </tr>
          </thead>
          <tbody className="text-xs">
            {rows.map((a) => {
              const isSel = a.ticker === selected.ticker;
              return (
                <tr
                  key={a.ticker}
                  onClick={() => onSelect(a)}
                  className={
                    "fu-clob-row border-b border-steel/50 transition-colors cursor-pointer " +
                    (isSel ? "bg-neon-mint/[0.04]" : "")
                  }
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="size-6 rounded-sm border border-steel grid place-items-center text-[9px] font-bold"
                        style={{ color: SECTOR_COLORS[a.sector] }}
                      >
                        {a.ticker.slice(0, 2)}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-white font-bold tracking-tight">{a.ticker}</span>
                        <span className="text-[10px] text-slate-500 truncate max-w-[200px]">
                          {a.name}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="px-2 py-0.5 text-[9px] uppercase font-bold tracking-widest border"
                      style={{
                        color: SECTOR_COLORS[a.sector],
                        borderColor: `${SECTOR_COLORS[a.sector]}40`,
                      }}
                    >
                      {a.sector}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-white tabular-nums">
                    ${a.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td
                    className={
                      "px-4 py-3 text-right tabular-nums " +
                      (a.change24h >= 0 ? "text-neon-mint" : "text-red-400")
                    }
                  >
                    {a.change24h >= 0 ? "+" : ""}
                    {a.change24h.toFixed(2)}%
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      <ActionBtn onClick={() => onAction(a, "BUY SPOT")} tone="primary">
                        BUY SPOT
                      </ActionBtn>
                      <ActionBtn onClick={() => onAction(a, "GO LONG")}>GO LONG</ActionBtn>
                      <ActionBtn onClick={() => onAction(a, "PREDICT")}>PREDICT</ActionBtn>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActionBtn({
  children,
  onClick,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "primary";
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={
        "px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest border transition-all " +
        (tone === "primary"
          ? "bg-neon-mint text-obsidian border-neon-mint hover:brightness-110"
          : "border-steel text-slate-300 hover:bg-steel hover:text-white")
      }
    >
      {children}
    </button>
  );
}
