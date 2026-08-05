import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { Shell } from "@/components/pot/Shell";
import { useDoc } from "@/hooks/useDoc";
import { usePortfolio } from "@/hooks/usePortfolio";
import { dayLabel, relativeTime, usd } from "@/lib/format";
import { addEntry, dismissTrade } from "@/lib/store";

export const Route = createFileRoute("/journal")({
  validateSearch: (s: Record<string, unknown>) => ({ compose: s.compose === true }),
  head: () => ({
    meta: [
      { title: "Journal — Proof of Thesis" },
      {
        name: "description",
        content: "Every trade, with the reason behind it. Written by you, kept on your device.",
      },
      { property: "og:title", content: "Journal — Proof of Thesis" },
      { property: "og:description", content: "Every trade, with the reason behind it." },
    ],
  }),
  component: JournalPage,
});

function JournalPage() {
  const doc = useDoc();
  const hidden = doc.settings.hideBalances;
  const { trades } = usePortfolio();
  const [draft, setDraft] = useState("");
  const [activeTrade, setActiveTrade] = useState<string | null>(null);

  const answered = new Set(doc.entries.map((e) => e.tradeId).filter(Boolean));
  const dismissed = new Set(doc.settings.dismissedTrades);
  const waiting = trades.filter((t) => !answered.has(t.id) && !dismissed.has(t.id));

  function save(tradeId: string | null) {
    const text = draft.trim();
    if (!text) return;
    addEntry({ tradeId, headline: text.slice(0, 90), body: text });
    setDraft("");
    setActiveTrade(null);
  }

  return (
    <Shell title="Journal" subtitle={`${doc.entries.length} entries`}>
      <section className="doodle-card animate-rise p-5">
        <p className="font-hand text-xl text-accent">What happened today?</p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="I added to ETH because…"
          className="mt-3 w-full resize-none bg-transparent text-[15px] outline-none placeholder:text-ink-faint"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[12px] text-ink-faint">
            {activeTrade ? "attached to a trade" : "standalone note"}
          </span>
          <button
            type="button"
            onClick={() => save(activeTrade)}
            disabled={!draft.trim()}
            className="doodle-pill bg-ink px-4 py-1.5 text-[13px] font-medium text-paper disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </section>

      {waiting.length > 0 && (
        <section className="mt-5">
          <p className="mb-2 text-[13px] uppercase tracking-wide text-ink-faint">
            Waiting for a reason
          </p>
          <ul className="space-y-2">
            {waiting.slice(0, 8).map((t) => (
              <li key={t.id} className="doodle-card flex items-center gap-3 p-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px]">
                    {t.side === "in" ? "Received" : "Sent"} {t.symbol}{" "}
                    <span className="num text-ink-faint">
                      {t.value != null ? usd(t.value, hidden) : ""}
                    </span>
                  </span>
                  <span className="text-[12px] text-ink-faint">{relativeTime(t.ts)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setActiveTrade(t.id)}
                  className="doodle-pill px-3 py-1 text-[12px] hover:bg-accent-soft"
                >
                  Explain
                </button>
                <button
                  type="button"
                  onClick={() => dismissTrade(t.id)}
                  className="text-[12px] text-ink-faint hover:text-ink"
                >
                  Skip
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6 space-y-3">
        {doc.entries.map((e) => (
          <article key={e.id} className="doodle-card animate-rise p-4">
            <p className="text-[12px] text-ink-faint">{dayLabel(e.createdAt)}</p>
            <p className="mt-1 text-[15px] leading-relaxed">{e.body}</p>
          </article>
        ))}
        {doc.entries.length === 0 && (
          <p className="py-6 text-center font-hand text-xl text-ink-faint">
            your journal starts here
          </p>
        )}
      </section>
    </Shell>
  );
}
