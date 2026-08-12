import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { Panel, Shell } from "@/components/pot/Shell";
import { useDoc } from "@/hooks/useDoc";
import { relativeTime } from "@/lib/format";
import { computeIndex, type Axis } from "@/lib/pot-index";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pot")({
  head: () => ({
    meta: [
      { title: "POT Index — Proof of Thesis" },
      {
        name: "description",
        content:
          "Sentiment times action over results: coverage, alignment, discipline, execution and steadiness, measured only from what you wrote.",
      },
      { property: "og:title", content: "POT Index — Proof of Thesis" },
      {
        property: "og:description",
        content: "The score of how well your trades matched your convictions.",
      },
    ],
  }),
  component: PotPage,
});

function pct(v: number | null) {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

function AxisRow({ axis }: { axis: Axis }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-stroke last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-4 py-3 text-left transition hover:bg-sunken"
      >
        <div className="flex items-baseline gap-3">
          <span className="flex-1 text-[13px] font-medium">{axis.label}</span>
          {axis.delta != null && axis.delta !== 0 && (
            <span
              className={cn(
                "num text-[11px]",
                axis.delta > 0 ? "text-gain" : "text-loss",
              )}
            >
              {axis.delta > 0 ? "+" : ""}
              {Math.round(axis.delta * 100)} pts / 30d
            </span>
          )}
          <span className="num text-[13px]">{pct(axis.score)}</span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-ink-faint transition-transform",
              open && "rotate-180",
            )}
          />
        </div>
        <div className="mt-2 h-[3px] w-full bg-sunken">
          <div
            className="h-full bg-ink transition-[width] duration-700"
            style={{ width: `${(axis.score ?? 0) * 100}%` }}
          />
        </div>
        <p className="eyebrow mt-1.5">
          {axis.hint} · {axis.detail}
        </p>
      </button>

      {open && (
        <div className="border-t border-stroke bg-sunken/40 px-4 py-3">
          <p className="eyebrow">Formula</p>
          <p className="mt-1 text-[12px] text-ink-soft">{axis.formula}</p>
          <p className="num mt-1 text-[12px]">
            {Math.round(axis.numerator * 10) / 10} ÷ {axis.denominator}
          </p>

          {axis.parts.length > 0 && (
            <>
              <p className="eyebrow mt-3">Breakdown</p>
              <ul className="mt-1 space-y-1">
                {axis.parts.map((p) => (
                  <li key={p.label} className="flex items-baseline gap-2 text-[12px]">
                    <span className="flex-1">{p.label}</span>
                    <span className="num text-ink-faint">
                      {p.value} · {p.of ? Math.round((p.value / p.of) * 100) : 0}%
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="eyebrow mt-3">Last 30 days</p>
          <p className="num mt-1 text-[12px]">
            {pct(axis.recent)}
            {axis.delta != null && (
              <span className="text-ink-faint">
                {" "}
                ({axis.delta > 0 ? "+" : ""}
                {Math.round(axis.delta * 100)} vs the 30 before)
              </span>
            )}
          </p>
        </div>
      )}
    </li>
  );
}

function PotPage() {
  const doc = useDoc();
  const index = computeIndex(doc.entries, doc.theses, doc.signals);

  return (
    <Shell
      title="POT Index"
      subtitle={`${index.executed} theses executed · ${index.pending} pending in inbox`}
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Panel eyebrow="Index // Composite">
          <div className="p-6 text-center">
            <p className="num text-[64px] font-semibold leading-none tracking-tight">
              {index.score ?? "—"}
            </p>
            <p className="eyebrow mt-3">
              {index.score == null ? "not enough written yet" : "sentiment × action ÷ result"}
            </p>
            <div className="mt-6 flex h-[6px] w-full overflow-hidden bg-sunken">
              <div
                className="h-full bg-ink transition-[width] duration-700"
                style={{ width: `${index.score ?? 0}%` }}
              />
            </div>
            <dl className="mt-5 grid grid-cols-3 gap-2 text-left">
              <div>
                <dt className="eyebrow">Last 30d</dt>
                <dd className="num text-[15px]">{index.recentScore ?? "—"}</dd>
              </div>
              <div>
                <dt className="eyebrow">Trend</dt>
                <dd
                  className={cn(
                    "num text-[15px]",
                    index.delta != null && index.delta > 0 && "text-gain",
                    index.delta != null && index.delta < 0 && "text-loss",
                  )}
                >
                  {index.delta == null
                    ? "—"
                    : `${index.delta > 0 ? "+" : ""}${index.delta}`}
                </dd>
              </div>
              <div>
                <dt className="eyebrow">Axes measured</dt>
                <dd className="num text-[15px]">{index.measured}/5</dd>
              </div>
            </dl>
          </div>
        </Panel>

        <Panel eyebrow="Axes // Tap one to see the maths" delay={60}>
          <ul>
            {index.axes.map((a) => (
              <AxisRow key={a.id} axis={a} />
            ))}
          </ul>
        </Panel>
      </div>

      <Panel
        eyebrow="Ghosts // Unexecuted conviction"
        className="mt-4"
        delay={120}
        action={
          <Link
            to="/journal"
            search={{ tab: "ghosts" }}
            className="doodle-pill px-3 py-1 text-[12px] hover:border-ink"
          >
            View all
          </Link>
        }
      >
        <ul>
          {index.ghosts.slice(0, 6).map((t) => (
            <li
              key={t.id}
              className="flex items-baseline gap-3 border-b border-stroke px-4 py-2.5 last:border-0"
            >
              <span className="min-w-0 flex-1 truncate text-[13px]">{t.title}</span>
              <span className="eyebrow">{relativeTime(t.createdAt)}</span>
            </li>
          ))}
          {index.ghosts.length === 0 && (
            <li className="px-4 py-6 text-center text-[13px] text-ink-faint">
              No open thesis is missing a trade.
            </li>
          )}
        </ul>
      </Panel>
    </Shell>
  );
}

