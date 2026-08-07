import { createFileRoute, Link } from "@tanstack/react-router";

import { Panel, Shell } from "@/components/pot/Shell";
import { useDoc } from "@/hooks/useDoc";
import { relativeTime } from "@/lib/format";
import { computeIndex } from "@/lib/pot-index";

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
          </div>
        </Panel>

        <Panel eyebrow="Axes // Breakdown" delay={60}>
          <ul>
            {index.axes.map((a) => (
              <li key={a.id} className="border-b border-stroke px-4 py-3 last:border-0">
                <div className="flex items-baseline gap-3">
                  <span className="flex-1 text-[13px] font-medium">{a.label}</span>
                  <span className="num text-[13px]">
                    {a.score == null ? "—" : `${Math.round(a.score * 100)}%`}
                  </span>
                </div>
                <div className="mt-2 h-[3px] w-full bg-sunken">
                  <div
                    className="h-full bg-ink transition-[width] duration-700"
                    style={{ width: `${(a.score ?? 0) * 100}%` }}
                  />
                </div>
                <p className="eyebrow mt-1.5">
                  {a.hint} · {a.detail}
                </p>
              </li>
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
