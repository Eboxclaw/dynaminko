// Theses page — dossier list + detail view. Toggle between Manual and
// AI-Assisted capture modes; both write the same shape.

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { ASSETS } from "@/lib/dynaminko-data";
import { DossierCard } from "../DossierCard";

export type Thesis = {
  id: string;
  ticker: string;
  body: string;
  ts: number;
  reviewedAt: number;
  status: "aligned" | "drifted" | "pending";
  trades: { ts: number; side: "BUY" | "SELL"; qty: number; price: number }[];
};

const STALE_MS = 1000 * 60 * 60 * 24 * 7; // 7d
const DAY_MS = 1000 * 60 * 60 * 24;
const SEED_NOW = Date.UTC(2026, 0, 1);

const SEED: Thesis[] = [
  {
    id: "t1",
    ticker: "tLMT",
    body:
      "Accumulating tLMT on Superchain dips — kinetic cycle beta plus tokenized-defense scarcity premium. Invalidation: sustained trade below $420 on volume.",
    ts: SEED_NOW - DAY_MS * 12,
    reviewedAt: SEED_NOW - DAY_MS * 12,
    status: "aligned",
    trades: [
      { ts: SEED_NOW - DAY_MS * 10, side: "BUY", qty: 20, price: 461.2 },
      { ts: SEED_NOW - DAY_MS * 3, side: "BUY", qty: 15, price: 478.8 },
    ],
  },
  {
    id: "t2",
    ticker: "XMR",
    body:
      "Privacy layer as sovereign hedge. Regulatory pressure is the buy signal, not the sell signal. Hold through drawdown.",
    ts: SEED_NOW - DAY_MS * 22,
    reviewedAt: SEED_NOW - DAY_MS * 22,
    status: "drifted",
    trades: [{ ts: SEED_NOW - DAY_MS * 20, side: "BUY", qty: 500, price: 158.4 }],
  },
  {
    id: "t3",
    ticker: "tTSM",
    body: "Semiconductor node leadership through 2027 — TSMC as monopoly on 2nm.",
    ts: SEED_NOW - DAY_MS * 2,
    reviewedAt: SEED_NOW - DAY_MS * 2,
    status: "pending",
    trades: [],
  },
];

export function ThesesView({ initialCompose }: { initialCompose?: boolean }) {
  const [items, setItems] = useLocalStorage<Thesis[]>("dyn.theses", SEED);
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null);
  const [composing, setComposing] = useState(initialCompose ?? false);

  const selected = items.find((t) => t.id === selectedId) ?? items[0] ?? null;

  const commit = (t: Omit<Thesis, "id" | "ts" | "reviewedAt" | "status" | "trades">) => {
    const now = Date.now();
    setItems([
      {
        ...t,
        id: crypto.randomUUID(),
        ts: now,
        reviewedAt: now,
        status: "pending",
        trades: [],
      },
      ...items,
    ]);
    setComposing(false);
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 grid grid-cols-1 xl:grid-cols-12 gap-6">
      {/* List */}
      <div className="xl:col-span-4 space-y-3">
        <div className="flex justify-between items-center">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.24em] text-ash">
            THESES // <span className="text-paper">{items.length}</span>
          </h2>
          <button
            onClick={() => setComposing(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest border border-lavender text-lavender hover:bg-lavender hover:text-onyx"
          >
            <Plus className="size-3" /> New
          </button>
        </div>
        {items.map((t, i) => {
          const stale = Date.now() - t.reviewedAt > STALE_MS;
          const isSel = t.id === selected?.id;
          return (
            <button
              key={t.id}
              onClick={() => { setSelectedId(t.id); setComposing(false); }}
              className={
                "w-full text-left dyn-dossier transition-all " +
                (isSel ? "border-lavender/60" : "")
              }
            >
              <div className="flex items-center justify-between px-3 pt-2 pb-1.5 border-b border-hairline">
                <span className="font-mono text-[10px] uppercase tracking-widest text-ash">
                  THESIS <span className="text-paper">// {String(i + 1).padStart(3, "0")}</span>
                </span>
                <span
                  className={
                    "font-mono text-[10px] uppercase " +
                    (t.status === "aligned"
                      ? "text-mint"
                      : t.status === "drifted"
                        ? "text-rose"
                        : "text-lavender")
                  }
                >
                  {t.status}
                </span>
              </div>
              <div className="p-3">
                <div className="flex items-baseline justify-between mb-1">
                  <span className="font-mono text-paper">{t.ticker}</span>
                  {stale && (
                    <span className="font-mono text-[9px] text-mint uppercase tracking-widest">stale</span>
                  )}
                </div>
                <p className="text-xs text-ash line-clamp-2">{t.body}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Detail / Composer */}
      <div className="xl:col-span-8">
        {composing ? (
          <Composer onCommit={commit} onCancel={() => setComposing(false)} />
        ) : selected ? (
          <ThesisDetail
            thesis={selected}
            onDelete={() => {
              const nextItems = items.filter((x) => x.id !== selected.id);
              setItems(nextItems);
              setSelectedId(nextItems[0]?.id ?? null);
            }}
          />
        ) : (
          <div className="p-12 text-center text-ash">Commit your first thesis.</div>
        )}
      </div>
    </div>
  );
}

function ThesisDetail({ thesis, onDelete }: { thesis: Thesis; onDelete: () => void }) {
  return (
    <DossierCard
      label="THESIS"
      index={thesis.ticker}
      status={
        thesis.status === "aligned"
          ? { tone: "mint", text: "ALIGNED" }
          : thesis.status === "drifted"
            ? { tone: "rose", text: "DRIFTED" }
            : { tone: "lavender", text: "PENDING" }
      }
    >
      <div className="p-5 space-y-5">
        <p className="text-paper leading-relaxed">{thesis.body}</p>

        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-ash mb-2">
            RECONCILED TRADES // {thesis.trades.length}
          </div>
          <div className="border border-hairline">
            {thesis.trades.length === 0 ? (
              <div className="p-4 text-center text-ash text-xs">No trades linked yet.</div>
            ) : (
              thesis.trades.map((tr, i) => (
                <div
                  key={i}
                  className="grid grid-cols-4 items-center px-4 py-2 border-b border-hairline last:border-b-0 font-mono text-[11px]"
                >
                  <span className={tr.side === "BUY" ? "text-mint" : "text-rose"}>{tr.side}</span>
                  <span className="text-paper tabular-nums">{tr.qty}</span>
                  <span className="text-paper tabular-nums">${tr.price.toFixed(2)}</span>
                  <span className="text-ash text-right">
                    {new Date(tr.ts).toLocaleDateString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex justify-between items-center pt-3 border-t border-hairline">
          <span className="font-mono text-[10px] text-ash">
            committed {new Date(thesis.ts).toLocaleString()}
          </span>
          <button
            onClick={onDelete}
            className="flex items-center gap-1 text-ash hover:text-rose text-xs"
          >
            <Trash2 className="size-3" /> delete
          </button>
        </div>
      </div>
    </DossierCard>
  );
}

function Composer({
  onCommit,
  onCancel,
}: {
  onCommit: (t: { ticker: string; body: string }) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"manual" | "ai">("manual");
  const [ticker, setTicker] = useState(ASSETS[0].ticker);
  const [body, setBody] = useState("");
  const [aiStep, setAiStep] = useState(0);
  const [aiAnswers, setAiAnswers] = useState<string[]>([]);
  const [aiDraft, setAiDraft] = useState("");

  const questions = useMemo(
    () => [
      `Why now for ${ticker}? What's the catalyst?`,
      `What would invalidate this thesis?`,
      `What's your time horizon and sizing?`,
    ],
    [ticker],
  );

  const submitAiAnswer = (a: string) => {
    const next = [...aiAnswers, a];
    setAiAnswers(next);
    if (aiStep + 1 >= questions.length) {
      // synthesize
      setAiDraft(
        `Catalyst: ${next[0]}\n\nInvalidation: ${next[1]}\n\nHorizon & sizing: ${next[2]}`,
      );
    } else {
      setAiStep(aiStep + 1);
    }
  };

  return (
    <DossierCard label="THESIS" index="NEW" status={{ tone: "lavender", text: "DRAFT" }}>
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <select
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            className="bg-onyx border border-hairline px-2 py-1.5 font-mono text-[11px] text-paper"
          >
            {ASSETS.map((a) => (
              <option key={a.ticker}>{a.ticker}</option>
            ))}
          </select>
          <div className="flex border border-hairline ml-auto">
            {(["manual", "ai"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={
                  "px-3 py-1 font-mono text-[10px] uppercase tracking-widest " +
                  (mode === m ? "bg-lavender/[0.08] text-lavender" : "text-ash hover:text-paper")
                }
              >
                {m === "manual" ? "Manual" : "AI Assisted"}
              </button>
            ))}
          </div>
        </div>

        {mode === "manual" ? (
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="State the thesis. Cause, catalyst, invalidation."
            className="w-full h-40 bg-onyx border border-hairline p-3 font-sans text-paper placeholder:text-ash/50 focus:border-lavender resize-none"
          />
        ) : (
          <div className="space-y-3">
            {aiDraft ? (
              <textarea
                value={aiDraft}
                onChange={(e) => setAiDraft(e.target.value)}
                className="w-full h-40 bg-onyx border border-hairline p-3 font-sans text-paper focus:border-lavender resize-none"
              />
            ) : (
              <AiQuestion q={questions[aiStep]} onAnswer={submitAiAnswer} step={aiStep} total={questions.length} />
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-hairline">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest border border-hairline text-ash hover:text-paper"
          >
            Cancel
          </button>
          <button
            disabled={mode === "manual" ? !body.trim() : !aiDraft.trim()}
            onClick={() => onCommit({ ticker, body: mode === "manual" ? body : aiDraft })}
            className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest bg-lavender text-onyx hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Commit
          </button>
        </div>
      </div>
    </DossierCard>
  );
}

function AiQuestion({
  q,
  onAnswer,
  step,
  total,
}: {
  q: string;
  onAnswer: (a: string) => void;
  step: number;
  total: number;
}) {
  const [val, setVal] = useState("");
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-widest text-lavender mb-2">
        step {step + 1} of {total}
      </div>
      <p className="text-paper mb-2">{q}</p>
      <textarea
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="answer…"
        className="w-full h-24 bg-onyx border border-hairline p-3 text-paper focus:border-lavender resize-none"
      />
      <button
        onClick={() => {
          if (!val.trim()) return;
          onAnswer(val.trim());
          setVal("");
        }}
        className="mt-2 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest border border-lavender text-lavender hover:bg-lavender hover:text-onyx"
      >
        Next →
      </button>
    </div>
  );
}

// Helper used by the shell to compute nav badge
export function unreviewedCount(items: Thesis[]) {
  return items.filter(
    (t) => Date.now() - t.reviewedAt > STALE_MS || t.status === "pending",
  ).length;
}
