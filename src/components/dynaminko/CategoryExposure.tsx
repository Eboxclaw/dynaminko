import {
  CATEGORIES,
  CATEGORY_COLORS,
  SUBCATEGORY_COLORS,
  subCategoryTotals,
  type Category,
} from "@/lib/dynaminko-data";

export function CategoryExposure({
  hidden,
  positions,
}: {
  hidden: boolean;
  positions?: Record<string, number> | null;
}) {
  const totals = subCategoryTotals(positions ?? undefined);
  const grand = totals.reduce((s, t) => s + t.usd, 0);

  return (
    <div className="bg-obsidian border border-hairline">
      <div className="flex justify-between items-center px-4 py-3 border-b border-hairline">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ash">
          CATEGORY EXPOSURE <span className="text-paper">// BASKET</span>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ash">
          {totals.length} sub-baskets
        </div>
      </div>

      {totals.length === 0 ? (
        <div className="p-6 text-center text-ash text-sm">No exposure — track a wallet.</div>
      ) : (
        <div className="divide-y divide-hairline">
          {(CATEGORIES as Category[]).map((cat) => {
            const rows = totals.filter((t) => t.category === cat);
            if (rows.length === 0) return null;
            const catTotal = rows.reduce((s, r) => s + r.usd, 0);
            const max = Math.max(...rows.map((r) => r.usd), 1);
            return (
              <div key={cat} className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="size-1.5" style={{ backgroundColor: CATEGORY_COLORS[cat] }} />
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper">
                      {cat}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] tabular-nums text-ash">
                    {grand > 0 ? ((catTotal / grand) * 100).toFixed(1) : "0.0"}% ·{" "}
                    <span className="text-paper">
                      {hidden ? "$***.*k" : `$${(catTotal / 1000).toFixed(1)}k`}
                    </span>
                  </span>
                </div>
                <div className="space-y-3">
                  {rows.map((t) => {
                    const pct = (t.usd / max) * 100;
                    const share = grand > 0 ? ((t.usd / grand) * 100).toFixed(1) : "0.0";
                    return (
                      <div key={t.subCategory}>
                        <div className="flex justify-between items-baseline mb-1 text-[11px]">
                          <div className="flex items-center gap-2">
                            <div
                              className="size-1"
                              style={{ backgroundColor: SUBCATEGORY_COLORS[t.subCategory] }}
                            />
                            <span className="text-paper font-mono uppercase tracking-widest text-[10px]">
                              {t.subCategory}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 font-mono tabular-nums text-ash">
                            <span>{share}%</span>
                            <span className="text-paper">
                              {hidden ? "$***.*k" : `$${(t.usd / 1000).toFixed(1)}k`}
                            </span>
                          </div>
                        </div>
                        <div className="h-[2px] w-full bg-hairline relative">
                          <div
                            className="absolute inset-y-0 left-0 transition-all"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: SUBCATEGORY_COLORS[t.subCategory],
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
