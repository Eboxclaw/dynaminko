import { usePublicData } from "@/hooks/usePublicData";

export function PublicDataStrip() {
  const { data, error, loading } = usePublicData();

  if (loading && !data) {
    return (
      <div className="bg-obsidian border border-hairline p-4 font-mono text-[10px] uppercase tracking-widest text-ash">
        Phase A public data // warming feeds
      </div>
    );
  }

  const gasGwei = data?.ink.gasPriceWei ? Number(data.ink.gasPriceWei) / 1e9 : null;
  const protocolTvl =
    data?.protocols.reduce((sum, protocol) => sum + (protocol.tvlUsd ?? 0), 0) ?? null;

  return (
    <section className="bg-obsidian border border-hairline p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-ash">
          Phase A // <span className="text-paper">Public data</span>
        </h2>
        <span className="font-mono text-[9px] uppercase tracking-widest text-ash">
          {error ? "feed degraded" : data?.stale ? "cached fallback" : "live keyless reads"}
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="Ink block" value={fmtInt(data?.ink.blockNumber)} />
        <Metric label="Gas" value={gasGwei == null ? "—" : `${gasGwei.toFixed(4)} gwei`} />
        <Metric label="Tracked TVL" value={protocolTvl == null ? "—" : fmtUsd(protocolTvl)} />
        <Metric label="Chain" value={`Ink · ${data?.ink.chainId ?? 57073}`} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {(data?.prices ?? []).map((price) => (
          <div key={price.id} className="border border-hairline p-2">
            <div className="font-mono text-[9px] uppercase tracking-widest text-ash">
              {price.ticker}
            </div>
            <div className="font-mono text-paper tabular-nums">
              {price.usd == null ? "—" : fmtUsd(price.usd)}
            </div>
            <div
              className={`font-mono text-[10px] tabular-nums ${(price.change24h ?? 0) >= 0 ? "text-mint" : "text-rose"}`}
            >
              {price.change24h == null
                ? "—"
                : `${price.change24h >= 0 ? "+" : ""}${price.change24h.toFixed(2)}%`}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-hairline p-3">
      <div className="font-mono text-[9px] uppercase tracking-widest text-ash">{label}</div>
      <div className="font-mono text-paper tabular-nums mt-1">{value}</div>
    </div>
  );
}

function fmtUsd(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 1000 ? 0 : 2,
  }).format(n);
}

function fmtInt(n: number | null | undefined) {
  return n == null ? "—" : new Intl.NumberFormat("en-US").format(n);
}
