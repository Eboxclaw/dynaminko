import { SECTOR_COLORS, sectorTotals, type Sector } from "@/lib/fustore-data";

const CONVICTION: Record<Sector, string> = {
  Privacy: "MAX",
  Defense: "HEAVY",
  Chips: "HEAVY",
  AI: "SIZED",
  "Store of Value": "HEDGED",
  Health: "SELECTIVE",
  Firearms: "TACTICAL",
};

export function CategoryExposure({ hidden }: { hidden: boolean }) {
  const totals = sectorTotals().sort((a, b) => b.usd - a.usd);
  const max = Math.max(...totals.map((t) => t.usd));

  return (
    <div className="bg-onyx border border-steel p-6">
      <div className="flex justify-between items-center mb-5">
        <h2 className="text-[10px] font-mono uppercase tracking-[0.25em] text-slate-400">
          Category Exposure Basket
        </h2>
        <span className="text-[9px] font-mono text-slate-500 uppercase">Niche Weighting</span>
      </div>
      <div className="space-y-4">
        {totals.map((t) => {
          const pct = (t.usd / max) * 100;
          return (
            <div key={t.sector}>
              <div className="flex justify-between items-baseline text-[11px] mb-1.5">
                <div className="flex items-center gap-2">
                  <div className="size-1.5" style={{ backgroundColor: SECTOR_COLORS[t.sector as Sector] }} />
                  <span className="uppercase text-slate-200 tracking-wider font-medium">
                    {t.sector}
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono">
                    · {CONVICTION[t.sector as Sector]}
                  </span>
                </div>
                <span className="font-mono text-slate-300 tabular-nums">
                  {hidden ? "***.*k" : `$${(t.usd / 1000).toFixed(1)}k`}
                </span>
              </div>
              <div className="h-1 w-full bg-steel/70 relative overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 transition-all"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: SECTOR_COLORS[t.sector as Sector],
                    boxShadow: `0 0 12px ${SECTOR_COLORS[t.sector as Sector]}80`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
