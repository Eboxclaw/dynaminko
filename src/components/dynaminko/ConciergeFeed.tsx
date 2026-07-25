// Concierge feed: AI-fetched trades waiting to be reconciled against a thesis.
// Rendered as dossier cards (signature surface).

import { useState } from "react";
import { CONCIERGE_SEED, type Concierge } from "@/lib/dynaminko-data";
import { DossierCard } from "./DossierCard";

function fmtTime(min: number) {
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

export function ConciergeFeed({ onProposeThesis }: { onProposeThesis?: (c: Concierge) => void }) {
  const [items, setItems] = useState<Concierge[]>(CONCIERGE_SEED);
  const [resolved, setResolved] = useState<Record<string, "linked" | "dismissed">>({});

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-ash">
          CONCIERGE // <span className="text-paper">RECONCILE</span>
        </h2>
        <span className="font-mono text-[10px] text-mint tabular-nums">
          {items.filter((i) => !resolved[i.id]).length} pending
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {items.map((c, i) => {
          const state = resolved[c.id];
          return (
            <DossierCard
              key={c.id}
              label="RECONCILE"
              index={String(i + 1).padStart(3, "0")}
              status={
                state === "linked"
                  ? { tone: "mint", text: "LINKED" }
                  : state === "dismissed"
                    ? { tone: "ash", text: "DISMISSED" }
                    : { tone: "lavender", text: "PENDING" }
              }
            >
              <div className="p-4">
                <div className="flex items-baseline justify-between mb-3">
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-lg text-paper">{c.ticker}</span>
                    <span
                      className={
                        "font-mono text-[10px] uppercase tracking-widest px-1.5 py-0.5 border " +
                        (c.side === "SELL"
                          ? "text-rose border-rose/40"
                          : "text-mint border-mint/40")
                      }
                    >
                      {c.side}
                    </span>
                    <span className="font-mono text-xs text-ash tabular-nums">
                      {c.qty} @ ${c.price.toFixed(2)}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-ash">{fmtTime(c.minutesAgo)}</span>
                </div>
                {c.suggestedThesis && (
                  <p className="text-[13px] text-paper leading-relaxed mb-3">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-lavender mr-2">
                      Suggested thesis
                    </span>
                    {c.suggestedThesis}
                  </p>
                )}
                {!state && (
                  <div className="flex gap-2 pt-2 border-t border-hairline">
                    <button
                      onClick={() => {
                        onProposeThesis?.(c);
                        setResolved((r) => ({ ...r, [c.id]: "linked" }));
                      }}
                      className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest border border-lavender bg-lavender text-onyx hover:brightness-110"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => onProposeThesis?.(c)}
                      className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest border border-hairline text-paper hover:border-lavender"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setResolved((r) => ({ ...r, [c.id]: "dismissed" }))}
                      className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest border border-hairline text-ash hover:text-rose hover:border-rose/40"
                    >
                      Discard
                    </button>
                  </div>
                )}
              </div>
            </DossierCard>
          );
        })}
      </div>
    </section>
  );
}
