// Journal inbox — the queue of wallet-detected trades that still need a
// meaning attached. Replaces the old concierge feed on the Theses tab.

import { useState } from "react";
import { DossierCard } from "./DossierCard";
import { JournalWizard } from "./JournalWizard";
import { useJournal } from "@/hooks/useJournal";
import { shortenAddress } from "@/lib/wallet-mock";
import type { Wallet } from "@/lib/wallets";
import type { Thesis } from "./views/ThesesView";
import type { JournaledTrade } from "@/lib/journal";
import { EMOTION_LABELS, SENTIMENT_LABELS } from "@/lib/journal";

function ago(ts: number) {
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function JournalInbox({
  wallets,
  theses,
}: {
  wallets: Wallet[];
  theses: Thesis[];
}) {
  const { trades, journal, skip, reopen } = useJournal(wallets);
  const [active, setActive] = useState<JournaledTrade | null>(null);
  const [tab, setTab] = useState<"pending" | "journaled" | "skipped">("pending");

  const counts = {
    pending: trades.filter((t) => t.status === "pending").length,
    journaled: trades.filter((t) => t.status === "journaled").length,
    skipped: trades.filter((t) => t.status === "skipped").length,
  };

  const filtered = trades.filter((t) => t.status === tab);

  return (
    <section>
      <div className="flex items-center justify-between mb-3 gap-3">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-ash">
          JOURNAL // <span className="text-paper">TRADES FROM WALLETS</span>
        </h2>
        <div className="flex border border-hairline">
          {(["pending", "journaled", "skipped"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                "px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest flex items-center gap-1.5 " +
                (tab === t
                  ? "bg-lavender/[0.08] text-lavender"
                  : "text-ash hover:text-paper")
              }
            >
              {t}
              <span className="tabular-nums text-ash">{counts[t]}</span>
            </button>
          ))}
        </div>
      </div>

      {wallets.length === 0 && (
        <div className="border border-dashed border-hairline p-6 text-center">
          <p className="font-mono text-[11px] text-ash">
            Add a read wallet or connect one to start intercepting trades.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4">
        {filtered.map((t, i) => (
          <DossierCard
            key={t.id}
            label={t.status === "pending" ? "RECONCILE" : t.status === "journaled" ? "ENTRY" : "SKIPPED"}
            index={String(i + 1).padStart(3, "0")}
            status={
              t.status === "journaled"
                ? { tone: "mint", text: "JOURNALED" }
                : t.status === "skipped"
                  ? { tone: "ash", text: "SKIPPED" }
                  : { tone: "lavender", text: "PENDING" }
            }
          >
            <div className="p-4">
              <div className="flex items-baseline justify-between mb-2 gap-2">
                <div className="flex items-baseline gap-3 min-w-0 flex-wrap">
                  <span className="font-mono text-lg text-paper">{t.ticker}</span>
                  <span
                    className={
                      "font-mono text-[10px] uppercase tracking-widest px-1.5 py-0.5 border " +
                      (t.side === "BUY" ? "text-mint border-mint/40" : "text-rose border-rose/40")
                    }
                  >
                    {t.side}
                  </span>
                  <span className="font-mono text-xs text-ash tabular-nums">
                    {t.qty} @ ${t.price.toFixed(2)} · ${(t.qty * t.price).toFixed(0)}
                  </span>
                </div>
                <span className="font-mono text-[10px] text-ash whitespace-nowrap">{ago(t.ts)}</span>
              </div>
              <div className="font-mono text-[10px] text-ash mb-3">
                via {shortenAddress(t.walletAddress)}
              </div>

              {t.status === "journaled" && t.entry && (
                <div className="border border-hairline p-3 mb-3 space-y-1 text-[12px]">
                  <div className="grid grid-cols-[90px_1fr] gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-ash">Thesis</span>
                    <span className="text-paper">
                      {t.entry.thesisId
                        ? theses.find((th) => th.id === t.entry!.thesisId)?.body?.slice(0, 120) ?? "linked"
                        : t.entry.newThesisDraft ?? "— impulse —"}
                    </span>
                  </div>
                  <div className="grid grid-cols-[90px_1fr] gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-ash">Sentiment</span>
                    <span className="text-paper">{SENTIMENT_LABELS[t.entry.sentiment]} · {EMOTION_LABELS[t.entry.emotion]} · {t.entry.confidence}/5</span>
                  </div>
                  {t.entry.notes && (
                    <div className="grid grid-cols-[90px_1fr] gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-ash">Notes</span>
                      <span className="text-ash">{t.entry.notes}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2 pt-2 border-t border-hairline">
                {t.status === "pending" ? (
                  <>
                    <button
                      onClick={() => setActive(t)}
                      className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest bg-lavender text-onyx hover:brightness-110"
                    >
                      Journal it
                    </button>
                    <button
                      onClick={() => skip(t.id)}
                      className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest border border-hairline text-ash hover:text-rose hover:border-rose/40"
                    >
                      Skip
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => reopen(t.id)}
                    className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest border border-hairline text-ash hover:text-paper"
                  >
                    Reopen
                  </button>
                )}
              </div>
            </div>
          </DossierCard>
        ))}
        {filtered.length === 0 && wallets.length > 0 && (
          <div className="border border-dashed border-hairline p-6 text-center font-mono text-[11px] text-ash">
            Nothing here.
          </div>
        )}
      </div>

      {active && (
        <JournalWizard
          trade={active}
          theses={theses}
          onClose={() => setActive(null)}
          onSkip={() => { skip(active.id); setActive(null); }}
          onCommit={(entry) => { journal(active.id, entry); setActive(null); }}
        />
      )}
    </section>
  );
}
