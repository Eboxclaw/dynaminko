// DeBank-style cross-basket positions for the tracked wallet. Groups holdings
// under Crypto vs xStocks; each row shows sub-category dot · qty · USD · 24h.

import { ASSETS, SUBCATEGORY_COLORS, type Category } from "@/lib/dynaminko-data";
import { shortenAddress } from "@/lib/wallet-mock";

export function PositionsPanel({
  address,
  positions,
  hidden,
}: {
  address: string;
  positions: Record<string, number> | null;
  hidden: boolean;
}) {
  return (
    <div className="dyn-dossier">
      <div className="flex justify-between items-center px-4 pt-3 pb-2 border-b border-hairline">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ash">
          POSITIONS <span className="text-paper">// WALLET</span>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ash">
          {address ? shortenAddress(address) : "no wallet"}
        </div>
      </div>

      {!positions ? (
        <div className="p-8 text-center">
          <p className="text-ash text-sm mb-1">Paste a wallet to load positions.</p>
          <p className="font-mono text-[10px] uppercase tracking-widest text-ash/60">
            top bar · track wallet
          </p>
        </div>
      ) : (
        <div className="p-0">
          {(["Crypto", "xStocks"] as Category[]).map((cat) => {
            const rows = ASSETS
              .filter((a) => a.category === cat && (positions[a.ticker] ?? 0) > 0)
              .map((a) => {
                const qty = positions[a.ticker];
                const usd = qty * a.price;
                return { ...a, qty, usd };
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
                    {rows.length} · {hidden ? "$***" : `$${(total / 1000).toFixed(1)}k`}
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
                      {hidden ? "$***" : `$${r.usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                    </div>
                    <div className={"font-mono text-right tabular-nums " + (r.change24h >= 0 ? "text-mint" : "text-rose")}>
                      {r.change24h >= 0 ? "+" : ""}
                      {r.change24h.toFixed(2)}%
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
          {positions && Object.values(positions).every((v) => !v) && (
            <div className="p-8 text-center text-ash text-sm">
              No positions on this wallet (staged).
            </div>
          )}
        </div>
      )}
    </div>
  );
}
