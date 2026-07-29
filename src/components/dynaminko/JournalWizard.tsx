// Multi-step journaling wizard. Fired when the user chooses to reconcile
// a wallet-detected trade. Prices/quantities are pre-filled; the human is
// only asked to supply the *meaning*: thesis, sentiment, emotion, confidence.
// Deliberately spartan — this is a discipline tool, not a survey.

import { useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  EMOTION_LABELS,
  SENTIMENT_LABELS,
  type Emotion,
  type JournalEntry,
  type JournaledTrade,
  type Sentiment,
} from "@/lib/journal";
import type { Thesis } from "@/components/dynaminko/views/ThesesView";
import { shortenAddress } from "@/lib/wallet-mock";
import { DossierCard } from "./DossierCard";

const STEPS = ["Thesis", "Sentiment", "Emotion", "Review"] as const;

export function JournalWizard({
  trade,
  theses,
  onCommit,
  onClose,
  onSkip,
}: {
  trade: JournaledTrade;
  theses: Thesis[];
  onCommit: (entry: JournalEntry) => void;
  onClose: () => void;
  onSkip: () => void;
}) {
  const relevant = useMemo(
    () => theses.filter((t) => t.ticker === trade.ticker),
    [theses, trade.ticker],
  );
  const [step, setStep] = useState(0);
  const [thesisId, setThesisId] = useState<string | null>(relevant[0]?.id ?? null);
  const [newThesis, setNewThesis] = useState("");
  const [sentiment, setSentiment] = useState<Sentiment>("conviction");
  const [emotion, setEmotion] = useState<Emotion>("calm");
  const [confidence, setConfidence] = useState(3);
  const [notes, setNotes] = useState("");

  const usd = trade.qty * trade.price;

  const canAdvance = () => {
    if (step === 0) return thesisId !== null || newThesis.trim().length > 0 || thesisId === "__none__";
    return true;
  };

  const commit = () => {
    onCommit({
      tradeId: trade.id,
      thesisId: thesisId === "__none__" ? null : thesisId,
      newThesisDraft: newThesis.trim() ? newThesis.trim() : undefined,
      sentiment,
      emotion,
      confidence,
      notes: notes.trim(),
      createdAt: Date.now(),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-onyx/80 backdrop-blur-sm flex items-start justify-center pt-16 md:pt-24 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-obsidian border border-hairline dyn-fade-in"
      >
        {/* header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-hairline">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ash">
            JOURNAL // <span className="text-paper">RECONCILE TRADE</span>
          </span>
          <button onClick={onClose} className="text-ash hover:text-paper" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        {/* trade summary — always visible */}
        <div className="px-4 py-3 border-b border-hairline grid grid-cols-[1fr_auto] gap-2 items-baseline">
          <div className="flex items-baseline gap-3 min-w-0">
            <span className="font-mono text-paper text-lg">{trade.ticker}</span>
            <span
              className={
                "font-mono text-[10px] uppercase tracking-widest px-1.5 py-0.5 border " +
                (trade.side === "BUY" ? "text-mint border-mint/40" : "text-rose border-rose/40")
              }
            >
              {trade.side}
            </span>
            <span className="font-mono text-[11px] text-ash tabular-nums truncate">
              {trade.qty} @ ${trade.price.toFixed(2)} · ${usd.toFixed(0)}
            </span>
          </div>
          <span className="font-mono text-[10px] text-ash tabular-nums text-right">
            {shortenAddress(trade.walletAddress)}
          </span>
        </div>

        {/* step indicator */}
        <div className="px-4 py-2 border-b border-hairline flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <span
                className={
                  "px-1.5 py-0.5 border " +
                  (i === step
                    ? "border-lavender text-lavender"
                    : i < step
                      ? "border-mint/40 text-mint"
                      : "border-hairline text-ash")
                }
              >
                {i + 1}. {s}
              </span>
              {i < STEPS.length - 1 && <span className="text-ash">·</span>}
            </div>
          ))}
        </div>

        {/* step body */}
        <div className="p-5 min-h-[240px]">
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-ash mb-2">
                  Link to existing thesis
                </div>
                {relevant.length === 0 ? (
                  <div className="font-mono text-[11px] text-ash/70 border border-dashed border-hairline p-3">
                    No existing thesis for {trade.ticker}.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {relevant.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setThesisId(t.id)}
                        className={
                          "w-full text-left px-3 py-2 border transition-colors " +
                          (thesisId === t.id
                            ? "border-lavender bg-lavender/[0.05]"
                            : "border-hairline hover:border-lavender/60")
                        }
                      >
                        <div className="font-mono text-[11px] text-paper">{t.ticker}</div>
                        <div className="text-[12px] text-ash line-clamp-2">{t.body}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block space-y-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-ash">
                    Or draft a new one
                  </span>
                  <textarea
                    value={newThesis}
                    onChange={(e) => {
                      setNewThesis(e.target.value);
                      if (e.target.value.trim()) setThesisId(null);
                    }}
                    placeholder={`Why this ${trade.side} of ${trade.ticker}?`}
                    className="w-full h-20 bg-onyx border border-hairline p-3 text-paper placeholder:text-ash/50 focus:border-lavender resize-none text-sm"
                  />
                </label>
              </div>

              <button
                onClick={() => { setThesisId("__none__"); setNewThesis(""); }}
                className={
                  "w-full text-left px-3 py-2 border font-mono text-[10px] uppercase tracking-widest transition-colors " +
                  (thesisId === "__none__"
                    ? "border-ash text-ash bg-ash/[0.06]"
                    : "border-hairline text-ash/70 hover:text-ash")
                }
              >
                No thesis — mark as impulse
              </button>
            </div>
          )}

          {step === 1 && (
            <StepChoice
              label="Sentiment"
              options={SENTIMENT_LABELS}
              value={sentiment}
              onChange={setSentiment}
              help="What role did this trade play?"
            />
          )}

          {step === 2 && (
            <div className="space-y-5">
              <StepChoice
                label="Emotion"
                options={EMOTION_LABELS}
                value={emotion}
                onChange={setEmotion}
                help="How were you feeling when you pressed submit?"
              />
              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-ash mb-2">
                  Confidence · {confidence}/5
                </div>
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={confidence}
                  onChange={(e) => setConfidence(Number(e.target.value))}
                  className="w-full accent-lavender"
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <DossierCard
                label="ENTRY"
                index="DRAFT"
                status={{ tone: "lavender", text: "REVIEW" }}
              >
                <div className="p-4 space-y-2 text-[12px]">
                  <Row k="Thesis" v={
                    thesisId === "__none__"
                      ? "— impulse —"
                      : thesisId
                        ? theses.find((t) => t.id === thesisId)?.body ?? "existing"
                        : newThesis || "—"
                  } />
                  <Row k="Sentiment" v={SENTIMENT_LABELS[sentiment]} />
                  <Row k="Emotion" v={EMOTION_LABELS[emotion]} />
                  <Row k="Confidence" v={`${confidence}/5`} />
                </div>
              </DossierCard>
              <label className="block space-y-1.5">
                <span className="font-mono text-[10px] uppercase tracking-widest text-ash">
                  Notes (optional)
                </span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything you want to remember 6 months from now."
                  className="w-full h-20 bg-onyx border border-hairline p-3 text-paper placeholder:text-ash/50 focus:border-lavender resize-none text-sm"
                />
              </label>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-hairline">
          <button
            onClick={onSkip}
            className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest border border-hairline text-ash hover:text-rose hover:border-rose/40"
          >
            Skip
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest border border-hairline text-paper hover:border-lavender"
              >
                <ChevronLeft className="size-3" /> Back
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button
                disabled={!canAdvance()}
                onClick={() => setStep((s) => s + 1)}
                className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest bg-lavender text-onyx hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <ChevronRight className="size-3" />
              </button>
            ) : (
              <button
                onClick={commit}
                className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest bg-mint text-onyx hover:brightness-110"
              >
                <Check className="size-3" /> Commit entry
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepChoice<T extends string>({
  label,
  options,
  value,
  onChange,
  help,
}: {
  label: string;
  options: Record<T, string>;
  value: T;
  onChange: (v: T) => void;
  help?: string;
}) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-widest text-ash mb-1.5">
        {label}
      </div>
      {help && <p className="text-[12px] text-ash/80 mb-3">{help}</p>}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {(Object.entries(options) as [T, string][]).map(([k, v]) => (
          <button
            key={k}
            onClick={() => onChange(k)}
            className={
              "px-3 py-2 border font-mono text-[11px] uppercase tracking-widest transition-colors " +
              (value === k
                ? "border-lavender text-lavender bg-lavender/[0.05]"
                : "border-hairline text-paper hover:border-lavender/60")
            }
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-3">
      <span className="font-mono text-[10px] uppercase tracking-widest text-ash">{k}</span>
      <span className="text-paper">{v}</span>
    </div>
  );
}
