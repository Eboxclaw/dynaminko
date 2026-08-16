import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Copy, Ghost, Inbox, Lightbulb, NotebookText, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { Reconcile } from "@/components/pot/Reconcile";
import { Panel, Shell } from "@/components/pot/Shell";
import { VenueIcon } from "@/components/pot/VenueIcon";
import { useAgent } from "@/hooks/useAgent";
import { useDoc } from "@/hooks/useDoc";
import { describeSignal, suggestThesis } from "@/lib/agent/extract";
import { dayLabel, relativeTime, usd } from "@/lib/format";
import { addThesis, type Signal } from "@/lib/store";
import { cn } from "@/lib/utils";

type Tab = "inbox" | "entries" | "theses" | "ghosts";
const TABS: { id: Tab; label: string; icon: typeof Inbox }[] = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "entries", label: "Journal", icon: NotebookText },
  { id: "theses", label: "Theses", icon: Lightbulb },
  { id: "ghosts", label: "Ghosts", icon: Ghost },
];

const VENUE_FILTERS = [
  { id: "all", label: "All sources" },
  { id: "ink", label: "Ink wallet" },
  { id: "nado", label: "Nado" },
  { id: "hyperliquid", label: "Hyperliquid" },
] as const;
type VenueFilter = (typeof VENUE_FILTERS)[number]["id"];

/** Eyebrow line for one inbox card, source-aware. */
function eyebrowFor(s: Signal): string {
  const src = s.venue === "nado" ? "Nado" : s.venue === "hyperliquid" ? "Hyperliquid" : "Ink";
  if (s.action === "deposit") return `${src} · DEPOSIT`;
  if (s.action === "withdraw") return `${src} · WITHDRAW`;
  if (s.action === "trade") return `${src} · ${s.side === "in" ? "BUY" : "SELL"} · FILLED`;
  return `Trade // ${s.side === "in" ? "INBOUND" : "OUTBOUND"} · EXECUTED`;
}

function priceLabel(price: number): string {
  const digits = price >= 1000 ? 2 : 6;
  return price.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/** Per-tab sub-filters. Each one narrows the same data, never invents rows. */
const FILTERS: Record<Tab, { id: string; label: string }[]> = {
  inbox: [
    { id: "all", label: "All" },
    { id: "in", label: "Bought / received" },
    { id: "out", label: "Sold / sent" },
    { id: "valued", label: "Priced" },
    { id: "today", label: "Today" },
  ],
  entries: [
    { id: "all", label: "All" },
    { id: "aligned", label: "Aligned" },
    { id: "partial", label: "Partial" },
    { id: "deviated", label: "Deviated" },
    { id: "reactive", label: "Reactive" },
    { id: "executed", label: "Executed" },
  ],
  theses: [
    { id: "all", label: "All" },
    { id: "open", label: "Open" },
    { id: "played-out", label: "Played out" },
    { id: "invalidated", label: "Invalidated" },
    { id: "stale", label: "Stale 30d+" },
    { id: "unlinked", label: "No entry" },
  ],
  ghosts: [
    { id: "all", label: "All" },
    { id: "thesis", label: "Theses" },
    { id: "entry", label: "Intents" },
  ],
};

export const Route = createFileRoute("/journal")({
  validateSearch: (s: Record<string, unknown>) => {
    const tab = (TABS.some((t) => t.id === s.tab) ? s.tab : "inbox") as Tab;
    const filter = typeof s.filter === "string" ? s.filter : "all";
    const venue =
      typeof s.venue === "string" && VENUE_FILTERS.some((v) => v.id === s.venue)
        ? (s.venue as VenueFilter)
        : "all";
    return {
      tab,
      filter: FILTERS[tab].some((f) => f.id === filter) ? filter : "all",
      venue,
    };
  },
  head: () => ({
    meta: [
      { title: "Theses & Journal · Proof of Thesis" },
      {
        name: "description",
        content:
          "The inbox of extracted trades, the entries you wrote, the theses behind them and the ideas that never executed.",
      },
      { property: "og:title", content: "Theses & Journal · Proof of Thesis" },
      {
        property: "og:description",
        content: "Reconcile extracted trades with the thesis that caused them.",
      },
    ],
  }),
  component: JournalHub,
});

function JournalHub() {
  const { tab, filter, venue } = Route.useSearch();
  const navigate = Route.useNavigate();
  const doc = useDoc();
  const { inbox } = useAgent();
  const hidden = doc.settings.hideBalances;
  const [active, setActive] = useState<Signal[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [newThesis, setNewThesis] = useState("");

  const entries = doc.entries;
  // A thesis or an intent stops being a ghost the moment a real trade is
  // attached to it — either directly, or through any entry that links both.
  const executedThesisIds = useMemo(
    () => new Set(entries.filter((e) => e.tradeId && e.thesisId).map((e) => e.thesisId)),
    [entries],
  );
  const ghostEntries = entries.filter(
    (e) => e.ghost && !e.tradeId && !(e.thesisId && executedThesisIds.has(e.thesisId)),
  );
  const ghostTheses = doc.theses.filter((t) => !executedThesisIds.has(t.id));

  const startOfDay = new Date().setHours(0, 0, 0, 0);
  const visibleInbox = inbox.filter((s) => {
    if (venue === "ink" && s.venue && s.venue !== "evm") return false;
    if ((venue === "nado" || venue === "hyperliquid") && s.venue !== venue) return false;
    if (filter === "in") return s.side === "in";
    if (filter === "out") return s.side === "out";
    if (filter === "valued") return s.value != null;
    if (filter === "today") return s.ts >= startOfDay;
    return true;
  });
  const visibleEntries = entries.filter((e) =>
    filter === "reactive"
      ? e.sentiment === "reactive" || e.sentiment === "fomo"
      : filter === "executed"
        ? Boolean(e.tradeId)
        : filter === "all"
          ? true
          : e.alignment === filter,
  );
  const staleAfter = Date.now() - 30 * 86_400_000;
  const visibleTheses = doc.theses.filter((t) =>
    filter === "stale"
      ? t.updatedAt < staleAfter
      : filter === "unlinked"
        ? !entries.some((e) => e.thesisId === t.id)
        : filter === "all"
          ? true
          : t.status === filter,
  );

  const selectedSignals = inbox.filter((s) => selected.includes(s.id));
  const allSelected = visibleInbox.length > 0 && selected.length === visibleInbox.length;
  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  async function copyHash(hash: string) {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(hash);
      setTimeout(() => setCopied((c) => (c === hash ? null : c)), 1500);
    } catch {
      /* clipboard blocked — nothing to do */
    }
  }

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
            search={{ tab: t.id, filter: "all", venue }}
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

      <div className="-mt-2 mb-4 flex gap-1 overflow-x-auto pb-1">
        {FILTERS[tab].map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => void navigate({ search: { tab, filter: f.id, venue } })}
            className={cn(
              "doodle-pill shrink-0 px-3 py-1 text-[11px] transition",
              filter === f.id ? "bg-ink text-paper" : "text-ink-soft hover:border-ink",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {tab === "inbox" && (
        <div className="-mt-2 mb-4 flex items-center gap-1 overflow-x-auto pb-1">
          {VENUE_FILTERS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => void navigate({ search: { tab, filter, venue: v.id } })}
              className={cn(
                "doodle-pill flex shrink-0 items-center gap-1.5 px-3 py-1 text-[11px] transition",
                venue === v.id ? "bg-ink text-paper" : "text-ink-soft hover:border-ink",
              )}
            >
              {(v.id === "nado" || v.id === "hyperliquid") && (
                <VenueIcon id={v.id} className="h-3 w-3" />
              )}
              {v.label}
            </button>
          ))}
        </div>
      )}

      {tab === "inbox" && (
        <div className="space-y-3">
          {visibleInbox.length === 0 && (
            <Panel eyebrow="Inbox // Empty">
              <p className="p-6 text-center text-[13px] text-ink-faint">
                Nothing waiting. The agent files new on-chain moments here as they land.
              </p>
            </Panel>
          )}

          {inbox.length > 0 && (
            <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-3 border border-stroke bg-surface px-3 py-2">
              <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? [] : visibleInbox.map((s) => s.id))}
                  className="h-4 w-4 accent-current"
                />
                Select all
              </label>
              <span className="eyebrow flex-1">{selected.length} selected</span>
              <button
                type="button"
                disabled={selected.length === 0}
                onClick={() => setActive(selectedSignals)}
                className="bg-ink px-3 py-1.5 text-[12px] font-medium text-paper disabled:opacity-30"
              >
                Resolve {selected.length || ""} together
              </button>
            </div>
          )}

          {visibleInbox.map((s, i) => {
            const hint = suggestThesis(s, doc.theses);
            const checked = selected.includes(s.id);
            return (
              <Panel key={s.id} eyebrow={eyebrowFor(s)} delay={i * 40}>
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(s.id)}
                      aria-label="Select trade"
                      className="mt-1 h-4 w-4 accent-current"
                    />
                    <p className="flex flex-1 items-center gap-2 text-[15px] font-medium">
                      {s.venue && s.venue !== "evm" && (
                        <VenueIcon id={s.venue} className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span>{describeSignal(s)}</span>
                    </p>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                    <Field label="Value" value={s.value != null ? usd(s.value, hidden) : "—"} />
                    <Field label="When" value={relativeTime(s.ts)} />
                    <div>
                      <dt className="eyebrow">Tx</dt>
                      <dd className="mt-1 flex items-center gap-1.5">
                        <span className="num text-[13px]">
                          {`${s.txHash.slice(0, 6)}…${s.txHash.slice(-4)}`}
                        </span>
                        <button
                          type="button"
                          onClick={() => void copyHash(s.txHash)}
                          aria-label="Copy transaction hash"
                          className="grid h-6 w-6 place-items-center text-ink-faint transition hover:text-ink"
                        >
                          {copied === s.txHash ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </dd>
                    </div>
                    <Field
                      label={s.meta?.feeUsd != null ? "Fee" : "Gas"}
                      value={
                        s.meta?.feeUsd != null
                          ? usd(s.meta.feeUsd, hidden)
                          : s.gasUsd != null
                            ? usd(s.gasUsd, hidden)
                            : "—"
                      }
                    />
                    {s.meta?.price != null && (
                      <Field label="Price" value={priceLabel(s.meta.price)} />
                    )}
                    {s.meta?.pnl != null && <Field label="PnL" value={usd(s.meta.pnl, hidden)} />}
                  </dl>
                  {hint && <p className="eyebrow mt-3">Agent suggests: {hint.title}</p>}
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => setActive([s])}
                      className="bg-ink px-4 py-2 text-[12px] font-medium text-paper"
                    >
                      Complete the cycle
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
          {visibleEntries.length === 0 && (
            <Panel eyebrow="Journal // Empty">
              <p className="p-6 text-center text-[13px] text-ink-faint">No entries yet.</p>
            </Panel>
          )}
          {visibleEntries.map((e, i) => {
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
          {visibleTheses.map((t, i) => {
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
          {visibleTheses.length === 0 && (
            <p className="py-6 text-center text-[13px] text-ink-faint">No theses written yet.</p>
          )}
        </div>
      )}

      {tab === "ghosts" && (
        <div className="space-y-3">
          <Panel eyebrow="Ghosts // Never executed">
            <p className="p-4 text-[13px] text-ink-soft">
              Theses and intents with no trade behind them. They still count against the index, a
              conviction you never acted on is a result too.
            </p>
          </Panel>
          {(filter === "entry" ? [] : ghostTheses).map((t, i) => (
            <Panel key={t.id} eyebrow="Ghost // Thesis" delay={i * 30}>
              <div className="p-4">
                <p className="text-[14px]">{t.title}</p>
                <p className="eyebrow mt-2">written {relativeTime(t.createdAt)}</p>
              </div>
            </Panel>
          ))}
          {(filter === "thesis" ? [] : ghostEntries).map((e, i) => (
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
          signals={active ?? []}
          theses={doc.theses}
          hidden={hidden}
          onClose={() => {
            setSelected([]);
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
