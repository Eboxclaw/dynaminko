import { useMemo } from "react";

import type { Axis } from "@/lib/pot-index";

/**
 * Lightweight SVG skill star for the POT Index axes.
 * Always renders every axis; unmeasured ones sit at zero, dimmed.
 * Pure SVG, no WebGL, no per-frame work.
 */

const SIZE_W = 360;
const SIZE_H = 280;
const CX = SIZE_W / 2;
const CY = SIZE_H / 2;
const R = 88;
const LABEL_R = R + 20;
const RINGS = [0.25, 0.5, 0.75, 1];
// Longest axis label that fits before the anchor runs it out of the viewBox.
const MAX_LABEL = 10;

function pointAt(angle: number, radius: number) {
  return [CX + Math.cos(angle) * radius, CY + Math.sin(angle) * radius] as const;
}

export function PotIndexOrb({ axes }: { axes: Axis[] }) {
  const star = useMemo(() => {
    if (axes.length === 0) return [];
    const n = Math.max(axes.length, 3);
    return axes.map((a, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      const measured = a.score != null;
      // measured: score drives radius; unmeasured: collapsed to centre
      const level = measured ? Math.max(0.1, Math.min(1, a.score ?? 0)) : 0;
      return { ...a, angle, level, measured, n };
    });
  }, [axes]);

  if (star.length === 0) {
    return (
      <div className="grid h-[140px] place-items-center text-soft text-ink-faint">
        No axes measured yet.
      </div>
    );
  }

  const n = star[0]!.n;
  const ringPath = (k: number) =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const [x, y] = pointAt(a, R * k);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ") + " Z";

  const shape =
    star
      .map((a, i) => {
        const [x, y] = pointAt(a.angle, R * a.level);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ") + " Z";

  return (
    <div className="animate-fade">
      <svg
        viewBox={`0 0 ${SIZE_W} ${SIZE_H}`}
        className="mx-auto block h-auto w-full max-w-[360px]"
        role="img"
        aria-label={`POT Index skill star: ${star
          .map((a) => `${a.label} ${a.measured ? `${Math.round((a.score ?? 0) * 100)}%` : "unmeasured"}`)
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

        {star.map((a) => {
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

        {star.map((a) => {
          if (!a.measured) return null;
          const [x, y] = pointAt(a.angle, R * a.level);
          return <circle key={`pt-${a.id}`} cx={x} cy={y} r={2.4} fill="var(--ink)" />;
        })}

        {star.map((a) => {
          const [x, y] = pointAt(a.angle, LABEL_R);
          const anchor = Math.abs(x - CX) < 8 ? "middle" : x > CX ? "start" : "end";
          const fill = a.measured ? "var(--ink-soft)" : "var(--ink-faint)";
          const label = a.label.length > MAX_LABEL ? `${a.label.slice(0, MAX_LABEL)}…` : a.label;
          return (
            <g key={`label-${a.id}`} opacity={a.measured ? 1 : 0.55}>
              <text
                x={x}
                y={y}
                textAnchor={anchor}
                fill={fill}
                style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}
                fontFamily="var(--font-mono)"
              >
                {label}
              </text>
              <text
                x={x}
                y={y + 12}
                textAnchor={anchor}
                fill="var(--ink-faint)"
                style={{ fontSize: 10 }}
                fontFamily="var(--font-mono)"
              >
                {a.measured ? `${Math.round((a.score ?? 0) * 100)}%` : "-"}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
