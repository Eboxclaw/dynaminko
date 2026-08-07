import { createFileRoute, Link } from "@tanstack/react-router";
import { Ghost, Inbox, Lightbulb, NotebookText, Plus, X } from "lucide-react";
import { useState } from "react";

import { Reconcile } from "@/components/pot/Reconcile";
import { Panel, Shell } from "@/components/pot/Shell";
import { useAgent } from "@/hooks/useAgent";
import { useDoc } from "@/hooks/useDoc";
import { describeSignal, suggestThesis } from "@/lib/agent/extract";
import { dayLabel, relativeTime, usd } from "@/lib/format";
import { addThesis, setSignalState, type Signal } from "@/lib/store";
import { cn } from "@/lib/utils";

type Tab = "inbox" | "entries" | "theses" | "ghosts";
const TABS: { id: Tab; label: string; icon: typeof Inbox }[] = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "entries", label: "Journal", icon: NotebookText },
  { id: "theses", label: "Theses", icon: Lightbulb },
  { id: "ghosts", label: "Ghosts", icon: Ghost },
];

export const Route = createFileRoute("/journal")({
  validateSearch: (s: Record<string, unknown>) => ({
    tab: (TABS.some((t) => t.id === s.tab) ? s.tab : "inbox") as Tab,
  }),
  head: () => ({
    meta: [
      { title: "Theses & Journal — Proof of Thesis" },
      {
        name: "description",
        content:
          "The inbox of extracted trades, the entries you wrote, the theses behind them and the ideas that never executed.",
      },
      { property: "og:title", content: "Theses & Journal — Proof of Thesis" },
      {
        property: "og:description",
        content: "Reconcile extracted trades with the thesis that caused them.",
      },
    ],
  }),
  component: JournalHub,
});

function JournalHub() {
  const { tab } = Route.useSearch();
  const doc = useDoc();
  const { inbox } = useAgent();
  const hidden = doc.settings.hideBalances;
  const [active, setActive] = useState<Signal | null>(null);
  const [composing, setComposing] = useState(false);
  const [newThesis, setNewThesis] = useState("");

  const entries = doc.entries;
  const ghostEntries = entries.filter((e) => e.ghost);
  const executedThesisIds = new Set(
    entries.filter((e) => e.tradeId && e.thesisId).map((e) => e.thesisId),
  );
  const ghostTheses = doc.theses.filter((t) => !executedThesisIds.has(t.id));

  return (
    <Shell
      title="Theses & Journal"
      subtitle={`${inbox.length} in inbox · ${entries.length} entries · ${doc.theses.length} theses`}
      action={
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="inline-flex items-center gap-1.5 bg-ink px-3 py-1.5 text-[12px] font-medium text-paper"
        >
          <Plus className="h-3.5 w-3.5" /> Entry
        </button>
      }
    >
      <div className="mb-4 flex gap-1 border-b border-stroke">
        {TABS.map((t) => (
          <Link
            key={t.id}
            to="/journal"
            search={{ tab: t.id }}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-[13px] transition",
              tab === t.id
                ? "border-ink text-ink"
                : "border-transparent text-ink-faint hover:text-ink",
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
            {t.id === "inbox" && inbox.length > 0 && (
              <span className="num text-[11px] text-ink-faint">{inbox.length}</span>
            )}
          </Link>
        ))}
      </div>

      {tab === "inbox" && (
        <div className="space-y-3">
          {inbox.length === 0 && (
            <Panel eyebrow="Inbox // Empty">
              <p className="p-6 text-center text-[13px] text-ink-faint">
                Nothing waiting. The agent files new on-chain moments here as they land.
              </p>
            </Panel>
          )}
          {inbox.map((s, i) => {
            const hint = suggestThesis(s, doc.theses);
            return (
              <Panel
                key={s.id}
                eyebrow={`Signal // ${s.side === "in" ? "INBOUND" : "OUTBOUND"}`}
                delay={i * 40}
              >
                <div className="p-4">
                  <p className="text-[15px] font-medium">{describeSignal(s)}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                    <Field label="Value" value={s.value != null ? usd(s.value, hidden) : "—"} />
                    <Field label="When" value={relativeTime(s.ts)} />
                    <Field
                      label="Tx"
                      value={`${s.txHash.slice(0, 6)}…${s.txHash.slice(-4)}`}
                    />
                    <Field label="Gas" value={s.gasUsd != null ? usd(s.gasUsd, hidden) : "—"} />
                  </dl>
                  {hint && (
                    <p className="eyebrow mt-3">Agent suggests: {hint.title}</p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setActive(s)}
                      className="bg-ink px-4 py-2 text-[12px] font-medium text-paper"
                    >
                      Complete the cycle
                    </button>
                    <button
                      type="button"
                      onClick={() => setSignalState(s.id, "dismissed")}
                      className="doodle-pill inline-flex items-center gap-1 px-3 py-2 text-[12px] text-ink-faint hover:border-ink hover:text-ink"
                    >
                      <X className="h-3 w-3" /> Not journalable
                    </button>
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {tab === "entries" && (
        <div className="space-y-3">
          {entries.length === 0 && (
            <Panel eyebrow="Journal // Empty">
              <p className="p-6 text-center text-[13px] text-ink-faint">
                No entries yet.
              </p>
            </Panel>
          )}
          {entries.map((e, i) => {
            const thesis = doc.theses.find((t) => t.id === e.thesisId);
            return (
              <Panel
                key={e.id}
                eyebrow={`${dayLabel(e.createdAt)} // ${e.ghost ? "GHOST" : "EXECUTED"}`}
                delay={i * 30}
              >
                <div className="p-4">
                  <p className="text-[14px] font-medium">{e.headline}</p>
                  {e.body && (
                    <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">{e.body}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {thesis && <Tag>{thesis.title}</Tag>}
                    {e.alignment && <Tag>{e.alignment.replace("_", " ")}</Tag>}
                    {e.sentiment && <Tag>{e.sentiment}</Tag>}
                    {e.sizing && <Tag>{e.sizing}</Tag>}
                    {e.emotion && <Tag>{e.emotion}</Tag>}
                    {e.health && <Tag>{e.health}</Tag>}
                    {e.finances && <Tag>{e.finances}</Tag>}
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {tab === "theses" && (
        <div className="space-y-3">
          <Panel eyebrow="Thesis // New">
            <form
              className="flex gap-2 p-4"
              onSubmit={(ev) => {
                ev.preventDefault();
                if (!newThesis.trim()) return;
                addThesis({ title: newThesis.trim() });
                setNewThesis("");
              }}
            >
              <input
                value={newThesis}
                onChange={(ev) => setNewThesis(ev.target.value)}
                placeholder="What do you believe, and why now?"
                className="min-w-0 flex-1 border border-stroke bg-paper px-3 py-2 text-[14px] outline-none placeholder:text-ink-faint focus:border-ink"
              />
              <button type="submit" className="bg-ink px-4 text-[12px] font-medium text-paper">
                Write
              </button>
            </form>
          </Panel>
          {doc.theses.map((t, i) => {
            const linked = entries.filter((e) => e.thesisId === t.id);
            return (
              <Panel key={t.id} eyebrow={`Thesis // ${t.status.toUpperCase()}`} delay={i * 30}>
                <div className="p-4">
                  <p className="text-[14px] font-medium">{t.title}</p>
                  {t.body && <p className="mt-1 text-[13px] text-ink-soft">{t.body}</p>}
                  <p className="eyebrow mt-3">
                    {linked.length} linked {linked.length === 1 ? "entry" : "entries"} · updated{" "}
                    {relativeTime(t.updatedAt)}
                  </p>
                </div>
              </Panel>
            );
          })}
          {doc.theses.length === 0 && (
            <p className="py-6 text-center text-[13px] text-ink-faint">No theses written yet.</p>
          )}
        </div>
      )}

      {tab === "ghosts" && (
        <div className="space-y-3">
          <Panel eyebrow="Ghosts // Never executed">
            <p className="p-4 text-[13px] text-ink-soft">
              Theses and intents with no trade behind them. They still count against the index —
              a conviction you never acted on is a result too.
            </p>
          </Panel>
          {ghostTheses.map((t, i) => (
            <Panel key={t.id} eyebrow="Ghost // Thesis" delay={i * 30}>
              <div className="p-4">
                <p className="text-[14px]">{t.title}</p>
                <p className="eyebrow mt-2">written {relativeTime(t.createdAt)}</p>
              </div>
            </Panel>
          ))}
          {ghostEntries.map((e, i) => (
            <Panel key={e.id} eyebrow="Ghost // Entry" delay={i * 30}>
              <div className="p-4">
                <p className="text-[14px]">{e.headline}</p>
                <p className="eyebrow mt-2">{dayLabel(e.createdAt)}</p>
              </div>
            </Panel>
          ))}
          {ghostTheses.length === 0 && ghostEntries.length === 0 && (
            <p className="py-6 text-center text-[13px] text-ink-faint">
              No ghosts. Everything you wrote, you traded.
            </p>
          )}
        </div>
      )}

      {(active || composing) && (
        <Reconcile
          signal={active}
          theses={doc.theses}
          hidden={hidden}
          onClose={() => {
            setActive(null);
            setComposing(false);
          }}
        />
      )}
    </Shell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="num mt-1 text-[13px]">{value}</dd>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="doodle-pill px-2.5 py-0.5 text-[11px] capitalize text-ink-soft">
      {children}
    </span>
  );
}
