import { SECTOR_COLORS, sectorTotals, type Sector } from "@/lib/fustore-data";

export function PortfolioPie({ hidden }: { hidden: boolean }) {
  const totals = sectorTotals().sort((a, b) => b.usd - a.usd);
  const total = totals.reduce((s, t) => s + t.usd, 0);

  // Build conic gradient
  let acc = 0;
  const stops = totals
    .map((t) => {
      const start = (acc / total) * 100;
      acc += t.usd;
      const end = (acc / total) * 100;
      return `${SECTOR_COLORS[t.sector as Sector]} ${start}% ${end}%`;
    })
    .join(", ");

  const topSector = totals[0];
  const topPct = ((topSector.usd / total) * 100).toFixed(1);

  return (
    <div className="bg-onyx border border-steel p-6">
      <div className="flex justify-between items-start mb-6">
        <h2 className="text-[10px] font-mono uppercase tracking-[0.25em] text-slate-400">
          Portfolio Breakdown
        </h2>
        <div className="text-[10px] text-neon-mint font-mono flex items-center gap-1.5">
          <span
            className="size-1.5 rounded-full bg-neon-mint"
            style={{ animation: "fu-pulse-dot 1.6s infinite" }}
          />
          LIVE
        </div>
      </div>

      <div className="relative aspect-square max-w-[220px] mx-auto mb-6">
        <div
          className="absolute inset-0 rounded-full"
          style={{ background: `conic-gradient(${stops})` }}
        />
        <div className="absolute inset-[14%] rounded-full bg-obsidian border border-steel" />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-[9px] uppercase opacity-40 tracking-[0.25em]">Dominant</div>
          <div className="text-lg font-bold text-white mt-1">{topSector.sector}</div>
          <div className="text-xs font-mono text-neon-mint">{topPct}%</div>
        </div>
      </div>

      <div className="space-y-2">
        {totals.map((t) => {
          const pct = ((t.usd / total) * 100).toFixed(1);
          return (
            <div key={t.sector} className="flex justify-between items-center text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className="size-2 shrink-0"
                  style={{ backgroundColor: SECTOR_COLORS[t.sector as Sector] }}
                />
                <span className="uppercase text-slate-300 tracking-wide truncate">{t.sector}</span>
              </div>
              <div className="flex items-center gap-3 font-mono tabular-nums">
                <span className="text-slate-500 text-[10px]">{pct}%</span>
                <span className="text-slate-200">
                  {hidden ? "$ ***.*k" : `$${(t.usd / 1000).toFixed(1)}k`}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
