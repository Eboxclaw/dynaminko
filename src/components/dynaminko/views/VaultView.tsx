import { toast } from "sonner";
import { VAULT_MARKETS } from "@/lib/dynaminko-data";
import { usePublicData } from "@/hooks/usePublicData";
import { DataSource, SkeletonRows } from "../DataSource";

export function VaultView() {
  const { data, loading, error } = usePublicData();
  const totalSupplied = VAULT_MARKETS.reduce((s, m) => s + m.userSupplied * priceOf(m.asset), 0);
  const totalBorrowed = VAULT_MARKETS.reduce((s, m) => s + m.userBorrowed * priceOf(m.asset), 0);

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatTile label="Total Supplied" value={fmtUsd(totalSupplied)} accent="mint" />
        <StatTile label="Total Borrowed" value={fmtUsd(totalBorrowed)} accent="lavender" />
        <StatTile label="Net APY" value="+3.42%" accent="mint" />
      </div>

      {/* Live protocol TVL — real numbers, read-only */}
      <section className="dyn-dossier">
        <div className="px-4 pt-3 pb-2 border-b border-hairline font-mono text-[10px] uppercase tracking-[0.14em] text-ash">
          INK VENUES // <span className="text-paper">LIVE TVL</span>
        </div>
        {loading && !data ? (
          <SkeletonRows rows={4} />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-hairline">
            {(data?.protocols ?? []).map((p) => (
              <div key={p.slug} className="p-4">
                <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ash">
                  {p.name}
                </div>
                <div className="font-mono text-paper text-lg tabular-nums mt-1">
                  {p.tvlUsd == null ? "—" : `$${(p.tvlUsd / 1e6).toFixed(2)}M`}
                </div>
                <div className="font-mono text-[10px] text-mint tabular-nums">
                  {p.apy == null ? "" : `${p.apy.toFixed(2)}% APY`}
                </div>
              </div>
            ))}
          </div>
        )}
        <DataSource
          source="defillama"
          at={data ? Date.now() : null}
          status={error ? "error" : loading ? "loading" : "ready"}
        />
      </section>

      <section>
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-ash">
            TYDRO // <span className="text-paper">RESERVES</span>
          </h2>
          <span className="font-mono text-[10px] text-ash">indicative · no live reserve feed yet</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">

          {VAULT_MARKETS.map((m) => (
            <div key={m.asset} className="bg-obsidian border border-hairline p-5">
              <div className="flex justify-between items-baseline mb-4">
                <div>
                  <div className="font-mono text-paper text-lg">{m.asset}</div>
                  <div className="text-[11px] text-ash">{m.name}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[9px] uppercase tracking-widest text-ash">TVL</div>
                  <div className="font-mono text-paper text-xs tabular-nums">
                    ${(m.supplied * priceOf(m.asset) / 1e6).toFixed(2)}M
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="border border-hairline p-2">
                  <div className="text-[9px] uppercase tracking-widest text-ash">Supply APY</div>
                  <div className="font-mono text-mint text-sm tabular-nums">
                    {m.supplyApy.toFixed(2)}%
                  </div>
                </div>
                <div className="border border-hairline p-2">
                  <div className="text-[9px] uppercase tracking-widest text-ash">Borrow APY</div>
                  <div className="font-mono text-paper text-sm tabular-nums">
                    {m.borrowApy.toFixed(2)}%
                  </div>
                </div>
              </div>

              <div className="space-y-1.5 mb-4 text-[11px]">
                <div className="flex justify-between text-ash">
                  <span>Your supply</span>
                  <span className="font-mono text-paper tabular-nums">{m.userSupplied || "—"}</span>
                </div>
                <div className="flex justify-between text-ash">
                  <span>Your borrow</span>
                  <span className="font-mono text-paper tabular-nums">{m.userBorrowed || "—"}</span>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => toast(`Supply ${m.asset}`, { description: "Tydro action queued (mock)" })}
                  className="flex-1 py-1.5 font-mono text-[10px] uppercase tracking-widest border border-mint/50 text-mint hover:bg-mint hover:text-onyx"
                >
                  Supply
                </button>
                <button
                  onClick={() => toast(`Borrow ${m.asset}`, { description: "Tydro action queued (mock)" })}
                  className="flex-1 py-1.5 font-mono text-[10px] uppercase tracking-widest border border-hairline text-paper hover:border-lavender"
                >
                  Borrow
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string; accent: "mint" | "lavender" }) {
  return (
    <div className="bg-obsidian border border-hairline p-5">
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ash">{label}</div>
      <div className={"font-mono text-2xl tabular-nums mt-1 " + (accent === "mint" ? "text-mint" : "text-lavender")}>
        {value}
      </div>
    </div>
  );
}

function fmtUsd(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
function priceOf(asset: string): number {
  switch (asset) {
    case "USDC": return 1;
    case "ETH": return 3420;
    case "tBTC": return 63820;
    case "XMR": return 161.8;
    case "PAXG": return 2341.5;
    default: return 1;
  }
}
