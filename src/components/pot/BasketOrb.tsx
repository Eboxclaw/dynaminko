import { useMemo } from "react";

export type OrbSlice = { label: string; share: number };

/**
 * Skill star: an RPG-style attribute radar where each axis is a basket and
 * the point spent on it is its share of the portfolio. Pure SVG, no WebGL,
 * no per-frame work: the whole thing is one static paint plus a CSS fade.
 */

const SIZE = 260;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 84;
const RINGS = [0.25, 0.5, 0.75, 1];

function pointAt(angle: number, radius: number) {
  return [CX + Math.cos(angle) * radius, CY + Math.sin(angle) * radius] as const;
}

export function BasketOrb({ slices }: { slices: OrbSlice[] }) {
  const axes = useMemo(() => {
    const list = [...slices]
      .filter((s) => s.share > 0)
      .sort((a, b) => b.share - a.share)
      .slice(0, 8);
    // Below three axes a polygon collapses into a line; pad with the rest.
    if (list.length === 0) return [];
    const max = Math.max(...list.map((s) => s.share));
    const n = Math.max(list.length, 3);
    return list.map((s, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      const level = max > 0 ? 0.18 + 0.82 * (s.share / max) : 0.18;
      return { ...s, angle, level, n };
    });
  }, [slices]);

  if (axes.length === 0) {
    return (
      <div className="grid h-[180px] place-items-center text-[12px] text-ink-faint">
        No baskets yet.
      </div>
    );
  }

  const n = axes[0]!.n;
  const ringPath = (k: number) =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const [x, y] = pointAt(a, R * k);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ") + " Z";

  const shape =
    axes
      .map((a, i) => {
        const [x, y] = pointAt(a.angle, R * a.level);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ") + " Z";

  return (
    <div className="animate-fade">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="mx-auto block h-auto w-full max-w-[320px]"
        role="img"
        aria-label={`Basket allocation star: ${axes
          .map((a) => `${a.label} ${Math.round(a.share * 100)}%`)
          .join(", ")}`}
      >
        {/* web */}
        {RINGS.map((k) => (
          <path
            key={k}
            d={ringPath(k)}
            fill="none"
            stroke="var(--stroke)"
            strokeWidth={k === 1 ? 1 : 0.6}
          />
        ))}

        {/* spokes */}
        {axes.map((a) => {
          const [x, y] = pointAt(a.angle, R);
          return (
            <line
              key={`spoke-${a.label}`}
              x1={CX}
              y1={CY}
              x2={x}
              y2={y}
              stroke="var(--stroke)"
              strokeWidth={0.6}
            />
          );
        })}

        {/* attribute shape */}
        <path
          d={shape}
          fill="color-mix(in oklab, var(--ink) 12%, transparent)"
          stroke="var(--ink)"
          strokeWidth={1.25}
          strokeLinejoin="round"
        />

        {/* points */}
        {axes.map((a) => {
          const [x, y] = pointAt(a.angle, R * a.level);
          return <circle key={`pt-${a.label}`} cx={x} cy={y} r={2.4} fill="var(--ink)" />;
        })}

        {/* labels */}
        {axes.map((a) => {
          const [x, y] = pointAt(a.angle, R + 24);
          const anchor = Math.abs(x - CX) < 6 ? "middle" : x > CX ? "start" : "end";
          return (
            <g key={`label-${a.label}`}>
              <text
                x={x}
                y={y}
                textAnchor={anchor}
                fill="var(--ink-soft)"
                style={{ fontSize: 8.5, letterSpacing: "0.12em", textTransform: "uppercase" }}
                fontFamily="var(--font-mono)"
              >
                {a.label}
              </text>
              <text
                x={x}
                y={y + 10}
                textAnchor={anchor}
                fill="var(--ink-faint)"
                style={{ fontSize: 9 }}
                fontFamily="var(--font-mono)"
              >
                {Math.round(a.share * 100)}%
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
