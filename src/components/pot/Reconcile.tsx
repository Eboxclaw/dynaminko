import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { useMemo, useState } from "react";

import { describeSignal, suggestThesis } from "@/lib/agent/extract";
import { relativeTime, usd } from "@/lib/format";
import {
  addEntry,
  addThesis,
  setSignalState,
  type Alignment,
  type Emotion,
  type Finances,
  type Health,
  type Sentiment,
  type Signal,
  type Sizing,
  type Thesis,
} from "@/lib/store";
import { cn } from "@/lib/utils";

type Answers = {
  thesisId: string | null;
  newThesis: string;
  alignment: Alignment | null;
  sentiment: Sentiment | null;
  sizing: Sizing | null;
  emotion: Emotion | null;
  health: Health | null;
  finances: Finances | null;
  note: string;
};

const EMPTY: Answers = {
  thesisId: null,
  newThesis: "",
  alignment: null,
  sentiment: null,
  sizing: null,
  emotion: null,
  health: null,
  finances: null,
  note: "",
};

function Options<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T | null;
  onChange: (v: T) => void;
  options: { value: T; label: string; hint?: string }[];
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "group border px-3 py-2.5 text-left transition",
              active
                ? "border-ink bg-ink text-paper"
                : "border-stroke bg-paper hover:border-stroke-strong",
            )}
          >
            <span className="block text-[14px] font-medium">{o.label}</span>
            {o.hint && (
              <span
                className={cn(
                  "mt-0.5 block text-[12px]",
                  active ? "opacity-70" : "text-ink-faint",
                )}
              >
                {o.hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Reconcile({
  signals,
  theses,
  hidden,
  onClose,
}: {
  /** one or more executed trades; empty means a manual, trade-less entry */
  signals: Signal[];
  theses: Thesis[];
  hidden: boolean;
  onClose: () => void;
}) {
  const signal = signals[0] ?? null;
  const bulk = signals.length > 1;
  const suggested = useMemo(
    () => (signal ? suggestThesis(signal, theses) : null),
    [signal, theses],
  );
  const [a, setA] = useState<Answers>(() => ({
    ...EMPTY,
    thesisId: suggested?.id ?? null,
  }));
  const [step, setStep] = useState(0);
  const set = (patch: Partial<Answers>) => setA((prev) => ({ ...prev, ...patch }));

  const steps = [
    {
      eyebrow: "01 // Link",
      title: "Which thesis does it belong to?",
      body: (
        <div className="space-y-2">
          {theses.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {theses.slice(0, 6).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => set({ thesisId: t.id, newThesis: "" })}
                  className={cn(
                    "border px-3 py-2.5 text-left text-[14px] transition",
                    a.thesisId === t.id
                      ? "border-ink bg-ink text-paper"
                      : "border-stroke bg-paper hover:border-stroke-strong",
                  )}
                >
                  {t.title}
                  {suggested?.id === t.id && (
                    <span className="eyebrow mt-1 block">agent suggestion</span>
                  )}
                </button>
              ))}
            </div>
          )}
          <div className="border border-stroke bg-paper p-3">
            <p className="eyebrow">No fit, write a new one</p>
            <input
              value={a.newThesis}
              onChange={(e) => set({ newThesis: e.target.value, thesisId: null })}
              placeholder="e.g. Privacy money re-rates as surveillance tightens"
              className="mt-2 w-full bg-transparent text-[14px] outline-none placeholder:text-ink-faint"
            />
          </div>
        </div>
      ),
    },
    {
      eyebrow: "02 // Alignment",
      title: "Did the action match the thesis?",
      body: (
        <Options
          value={a.alignment}
          onChange={(alignment) => set({ alignment })}
          options={[
            { value: "aligned", label: "Aligned", hint: "exactly what I planned" },
            { value: "partial", label: "Partial", hint: "right idea, wrong execution" },
            { value: "deviated", label: "Deviated", hint: "I went off script" },
            { value: "no_thesis", label: "No thesis", hint: "there was no plan" },
          ]}
        />
      ),
    },
    {
      eyebrow: "03 // Motive",
      title: "Why did you do it?",
      body: (
        <Options
          value={a.sentiment}
          onChange={(sentiment) => set({ sentiment })}
          options={[
            { value: "conviction", label: "Conviction", hint: "the thesis said so" },
            { value: "rebalance", label: "Rebalance", hint: "housekeeping" },
            { value: "hedge", label: "Hedge", hint: "reducing a risk" },
            { value: "reactive", label: "Reactive", hint: "responding to price" },
            { value: "fomo", label: "FOMO", hint: "I didn't want to miss it" },
          ]}
        />
      ),
    },
    {
      eyebrow: "04 // Size",
      title: "How big, relative to the plan?",
      body: (
        <Options
          value={a.sizing}
          onChange={(sizing) => set({ sizing })}
          options={[
            { value: "starter", label: "Starter", hint: "toe in the water" },
            { value: "full", label: "Full size", hint: "the intended position" },
            { value: "adding", label: "Adding", hint: "scaling into it" },
            { value: "oversized", label: "Oversized", hint: "more than I should have" },
          ]}
        />
      ),
    },
    {
      eyebrow: "05 // State",
      title: "Where were you, honestly?",
      body: (
        <div className="space-y-4">
          <div>
            <p className="eyebrow mb-2">Mind</p>
            <Options
              value={a.emotion}
              onChange={(emotion) => set({ emotion })}
              options={[
                { value: "calm", label: "Calm" },
                { value: "excited", label: "Excited" },
                { value: "anxious", label: "Anxious" },
                { value: "uncertain", label: "Uncertain" },
              ]}
            />
          </div>
          <div>
            <p className="eyebrow mb-2">Body</p>
            <Options
              value={a.health}
              onChange={(health) => set({ health })}
              options={[
                { value: "rested", label: "Rested" },
                { value: "tired", label: "Tired" },
                { value: "stressed", label: "Stressed" },
                { value: "unwell", label: "Unwell" },
              ]}
            />
          </div>
          <div>
            <p className="eyebrow mb-2">Finances</p>
            <Options
              value={a.finances}
              onChange={(finances) => set({ finances })}
              options={[
                { value: "flush", label: "Flush" },
                { value: "comfortable", label: "Comfortable" },
                { value: "tight", label: "Tight" },
                { value: "leveraged", label: "Leveraged" },
              ]}
            />
          </div>
        </div>
      ),
    },
    {
      eyebrow: "06 // Record",
      title: "In your own words.",
      body: (
        <textarea
          value={a.note}
          onChange={(e) => set({ note: e.target.value })}
          rows={5}
          placeholder="What you were seeing, and what would make you exit."
          className="w-full resize-none border border-stroke bg-paper p-3 text-[14px] outline-none placeholder:text-ink-faint focus:border-ink"
        />
      ),
    },
  ];

  const last = step === steps.length - 1;

  function commit() {
    let thesisId = a.thesisId;
    if (!thesisId && a.newThesis.trim()) {
      thesisId = addThesis({
        title: a.newThesis.trim(),
        symbols: Array.from(new Set(signals.map((s) => s.symbol))),
      }).id;
    }
    const shared = {
      thesisId,
      body: a.note.trim(),
      alignment: a.alignment,
      sentiment: a.sentiment,
      sizing: a.sizing,
      emotion: a.emotion,
      health: a.health,
      finances: a.finances,
    };
    if (signals.length === 0) {
      addEntry({
        ...shared,
        tradeId: null,
        headline: a.note.trim().slice(0, 80) || "Journal entry",
        ghost: true,
        createdAt: Date.now(),
      });
    } else {
      for (const s of signals) {
        addEntry({
          ...shared,
          tradeId: s.id,
          headline: describeSignal(s),
          ghost: false,
          createdAt: s.ts,
        });
        setSignalState(s.id, "linked");
      }
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div className="animate-rise flex max-h-[92dvh] w-full max-w-lg flex-col border border-stroke bg-surface">
        <header className="flex items-start gap-3 border-b border-stroke p-4">
          <div className="min-w-0 flex-1">
            <p className="eyebrow">{steps[step].eyebrow}</p>
            <h2 className="mt-1 text-[16px] font-semibold leading-snug">{steps[step].title}</h2>
            {signal && (
              <p className="num mt-1 truncate text-[12px] text-ink-faint">
                {bulk ? `${signals.length} trades selected` : describeSignal(signal)}
                {!bulk && signal.value != null && ` · ${usd(signal.value, hidden)}`}
                {!bulk && ` · ${relativeTime(signal.ts)}`}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="doodle-pill grid h-8 w-8 place-items-center text-ink-faint hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex gap-1 px-4 pt-3">
          {steps.map((s, i) => (
            <span
              key={s.eyebrow}
              className={cn("h-[2px] flex-1 transition", i <= step ? "bg-ink" : "bg-stroke")}
            />
          ))}
        </div>

        <div key={step} className="animate-fade flex-1 overflow-y-auto p-4">
          {steps[step].body}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-stroke p-4">
          <button
            type="button"
            onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
            className="doodle-pill inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-ink-soft hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {step === 0 ? "Cancel" : "Back"}
          </button>
          <button
            type="button"
            onClick={() => (last ? commit() : setStep(step + 1))}
            className="inline-flex items-center gap-1.5 bg-ink px-4 py-2 text-[13px] font-medium text-paper transition hover:opacity-90"
          >
            {last ? (bulk ? `Save ${signals.length} entries` : "Save entry") : "Next"}
            {last ? <Check className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
          </button>
        </footer>
      </div>
    </div>
  );
}
