import { SECTORS, SECTOR_COLORS, sectorTotals } from "@/lib/dynaminko-data";

export function CategoryExposure({ hidden }: { hidden: boolean }) {
  const totals = sectorTotals();
  const max = Math.max(...totals.map((t) => t.usd), 1);

  return (
    <div className="bg-obsidian border border-hairline">
      <div className="flex justify-between items-center px-4 py-3 border-b border-hairline">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ash">
          CATEGORY EXPOSURE <span className="text-paper">// BASKET</span>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ash">
          {SECTORS.length} sectors
        </div>
      </div>
      <div className="p-5 space-y-4">
        {totals.map((t) => {
          const pct = (t.usd / max) * 100;
          const share = totals.reduce((s, x) => s + x.usd, 0);
          const sharePct = share > 0 ? ((t.usd / share) * 100).toFixed(1) : "0.0";
          return (
            <div key={t.sector}>
              <div className="flex justify-between items-baseline mb-1.5 text-[11px]">
                <div className="flex items-center gap-2">
                  <div className="size-1.5" style={{ backgroundColor: SECTOR_COLORS[t.sector] }} />
                  <span className="text-paper font-sans">{t.sector}</span>
                </div>
                <div className="flex items-center gap-3 font-mono tabular-nums text-ash">
                  <span>{sharePct}%</span>
                  <span className="text-paper">
                    {hidden ? "$***.*k" : `$${(t.usd / 1000).toFixed(1)}k`}
                  </span>
                </div>
              </div>
              <div className="h-[2px] w-full bg-hairline relative">
                <div
                  className="absolute inset-y-0 left-0 transition-all"
                  style={{ width: `${pct}%`, backgroundColor: SECTOR_COLORS[t.sector] }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
