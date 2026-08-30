import { useMemo } from "react";

import type { Axis } from "@/lib/pot-index";

/**
 * Lightweight SVG skill star for the POT Index axes.
 * Each axis is an attribute; the score is the points spent on it.
 * Pure SVG, no WebGL, no per-frame work.
 */

const SIZE = 220;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 78;
const RINGS = [0.25, 0.5, 0.75, 1];

function pointAt(angle: number, radius: number) {
  return [CX + Math.cos(angle) * radius, CY + Math.sin(angle) * radius] as const;
}

export function PotIndexOrb({ axes }: { axes: Axis[] }) {
  const activeAxes = useMemo(() => {
    const measured = axes.filter((a) => a.score != null);
    if (measured.length === 0) return [];
    const max = Math.max(...measured.map((a) => a.score ?? 0));
    const n = Math.max(measured.length, 3);
    return measured.map((a, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      const level = max > 0 ? 0.18 + 0.82 * ((a.score ?? 0) / max) : 0.18;
      return { ...a, angle, level, n };
    });
  }, [axes]);

  if (activeAxes.length === 0) {
    return (
      <div className="grid h-[140px] place-items-center text-[12px] text-ink-faint">
        No axes measured yet.
      </div>
    );
  }

  const n = activeAxes[0]!.n;
  const ringPath = (k: number) =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const [x, y] = pointAt(a, R * k);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ") + " Z";

  const shape =
    activeAxes
      .map((a, i) => {
        const [x, y] = pointAt(a.angle, R * a.level);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ") + " Z";

  return (
    <div className="animate-fade">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="mx-auto block h-auto w-full max-w-[260px]"
        role="img"
        aria-label={`POT Index skill star: ${activeAxes
          .map((a) => `${a.label} ${Math.round((a.score ?? 0) * 100)}%`)
          .join(", ")}`}
      >
        {RINGS.map((k) => (
          <path
            key={k}
            d={ringPath(k)}
            fill="none"
            stroke="var(--stroke)"
            strokeWidth={k === 1 ? 1 : 0.6}
          />
        ))}

        {activeAxes.map((a) => {
          const [x, y] = pointAt(a.angle, R);
          return (
            <line
              key={`spoke-${a.id}`}
              x1={CX}
              y1={CY}
              x2={x}
              y2={y}
              stroke="var(--stroke)"
              strokeWidth={0.6}
            />
          );
        })}

        <path
          d={shape}
          fill="color-mix(in oklab, var(--ink) 12%, transparent)"
          stroke="var(--ink)"
          strokeWidth={1.25}
          strokeLinejoin="round"
        />

        {activeAxes.map((a) => {
          const [x, y] = pointAt(a.angle, R * a.level);
          return <circle key={`pt-${a.id}`} cx={x} cy={y} r={2.4} fill="var(--ink)" />;
        })}

        {activeAxes.map((a) => {
          const [x, y] = pointAt(a.angle, R + 20);
          const anchor = Math.abs(x - CX) < 6 ? "middle" : x > CX ? "start" : "end";
          return (
            <g key={`label-${a.id}`}>
              <text
                x={x}
                y={y}
                textAnchor={anchor}
                fill="var(--ink-soft)"
                style={{ fontSize: 8, letterSpacing: "0.1em", textTransform: "uppercase" }}
                fontFamily="var(--font-mono)"
              >
                {a.label}
              </text>
              <text
                x={x}
                y={y + 9}
                textAnchor={anchor}
                fill="var(--ink-faint)"
                style={{ fontSize: 8.5 }}
                fontFamily="var(--font-mono)"
              >
                {Math.round((a.score ?? 0) * 100)}%
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
