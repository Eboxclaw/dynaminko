// Portfolio breakdown as a rotating faceted 3D diamond — diamondmorphism moment.
// Reduced-motion fallback: flat pie chart with SVG conic segments.

import { useEffect, useState } from "react";
import { SECTOR_COLORS, sectorTotals, type Sector } from "@/lib/dynaminko-data";

export function PortfolioDiamond({ hidden }: { hidden: boolean }) {
  const totals = sectorTotals().filter((t) => t.usd > 0).sort((a, b) => b.usd - a.usd);
  const total = totals.reduce((s, t) => s + t.usd, 0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const topSector = totals[0];
  const topPct = ((topSector.usd / total) * 100).toFixed(1);

  return (
    <div className="dyn-dossier">
      <div className="flex justify-between items-center px-4 pt-3 pb-2 border-b border-hairline">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ash">
          PORTFOLIO <span className="text-paper">// BREAKDOWN</span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase text-mint">
          <span className="size-1.5 rounded-full bg-mint" style={{ animation: "dyn-pulse-dot 1.8s infinite" }} />
          LIVE
        </div>
      </div>

      <div className="p-6 flex flex-col items-center">
        {/* 3D Diamond */}
        <div
          className="relative"
          style={{
            width: 200,
            height: 200,
            perspective: "800px",
          }}
        >
          {reduced ? (
            <FlatDiamond totals={totals} total={total} />
          ) : (
            <FacetedDiamond3D totals={totals} total={total} />
          )}
        </div>

        <div className="mt-4 text-center">
          <div className="font-mono text-[9px] uppercase tracking-[0.25em] text-ash">Dominant</div>
          <div className="text-lg font-semibold text-paper mt-0.5">{topSector.sector}</div>
          <div className="font-mono text-xs text-lavender tabular-nums">{topPct}%</div>
        </div>

        <div className="w-full mt-6 space-y-2">
          {totals.map((t) => {
            const pct = ((t.usd / total) * 100).toFixed(1);
            return (
              <div key={t.sector} className="flex justify-between items-center text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="size-2 shrink-0" style={{ backgroundColor: SECTOR_COLORS[t.sector as Sector] }} />
                  <span className="text-paper font-sans">{t.sector}</span>
                </div>
                <div className="flex items-center gap-3 font-mono tabular-nums">
                  <span className="text-ash text-[10px]">{pct}%</span>
                  <span className="text-paper">
                    {hidden ? "$***.*k" : `$${(t.usd / 1000).toFixed(1)}k`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FacetedDiamond3D({
  totals,
  total,
}: {
  totals: { sector: Sector; usd: number }[];
  total: number;
}) {
  // Build faceted crystal: an octahedron-ish stack made from N vertical slices,
  // each a diamond-shaped face sized by its share.
  return (
    <div
      className="absolute inset-0"
      style={{
        transformStyle: "preserve-3d",
        animation: "dyn-rotate-diamond 24s linear infinite",
      }}
    >
      {totals.map((t, i) => {
        const share = t.usd / total;
        const angle = (360 / totals.length) * i;
        const color = SECTOR_COLORS[t.sector];
        const facetWidth = 40 + share * 120; // width scales with share
        return (
          <div
            key={t.sector}
            className="absolute left-1/2 top-1/2"
            style={{
              width: facetWidth,
              height: 180,
              marginLeft: -facetWidth / 2,
              marginTop: -90,
              transform: `rotateY(${angle}deg) translateZ(60px)`,
              background: `linear-gradient(180deg, rgba(182,165,240,0.35), ${color}22 40%, rgba(10,10,12,0.9) 100%)`,
              border: `1px solid ${color}80`,
              clipPath: "polygon(50% 0, 100% 30%, 100% 70%, 50% 100%, 0 70%, 0 30%)",
              boxShadow: `inset 0 0 30px ${color}22`,
            }}
          />
        );
      })}
      {/* central spine glint */}
      <div
        className="absolute left-1/2 top-1/2 w-[2px] h-[190px]"
        style={{
          marginLeft: -1,
          marginTop: -95,
          background: "linear-gradient(180deg, transparent, rgba(182,165,240,0.9), transparent)",
          transform: "translateZ(0)",
        }}
      />
    </div>
  );
}

function FlatDiamond({
  totals,
  total,
}: {
  totals: { sector: Sector; usd: number }[];
  total: number;
}) {
  let acc = 0;
  const stops = totals
    .map((t) => {
      const start = (acc / total) * 100;
      acc += t.usd;
      const end = (acc / total) * 100;
      return `${SECTOR_COLORS[t.sector]} ${start}% ${end}%`;
    })
    .join(", ");
  return (
    <div
      className="absolute inset-0"
      style={{
        background: `conic-gradient(${stops})`,
        clipPath: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)",
      }}
    >
      <div className="absolute inset-[18%] bg-obsidian border border-hairline" style={{ clipPath: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)" }} />
    </div>
  );
}
