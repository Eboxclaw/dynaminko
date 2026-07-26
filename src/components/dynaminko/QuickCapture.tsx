import { useEffect, useRef, useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import { ASSETS } from "@/lib/dynaminko-data";
import type { ViewId } from "./Sidebar";

type QuickThesis = {
  id: string;
  ticker: string;
  body: string;
  ts: number;
  reviewedAt: number;
  status: "aligned" | "drifted" | "pending";
  trades: { ts: number; side: "BUY" | "SELL"; qty: number; price: number }[];
};

type CaptureMetric = {
  id: string;
  openedAt: number;
  committedAt: number;
  elapsedMs: number;
  ticker: string;
};

const THESES_KEY = "dyn.theses";
const CAPTURE_METRICS_KEY = "dyn.captureMetrics";

const readLocalArray = <T,>(key: string): T[] => {
  const raw = window.localStorage.getItem(key);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const randomId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `quick-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

// Compact thesis-capture panel. Writes directly to local storage and never changes the active view.
export function QuickCapture({
  open,
  onClose,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (v: ViewId, intent?: "new-thesis" | "ask") => void;
}) {
  const [ticker, setTicker] = useState(ASSETS[0]?.ticker ?? "");
  const [body, setBody] = useState("");
  const openedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      openedAtRef.current = null;
      return;
    }

    openedAtRef.current = performance.now();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const discard = () => {
    setTicker(ASSETS[0]?.ticker ?? "");
    setBody("");
    onClose();
  };

  const commit = () => {
    const trimmed = body.trim();
    if (!ticker || !trimmed) return;

    const now = Date.now();
    const thesis: QuickThesis = {
      id: randomId(),
      ticker,
      body: trimmed,
      ts: now,
      reviewedAt: now,
      status: "pending",
      trades: [],
    };

    const theses = readLocalArray<QuickThesis>(THESES_KEY);
    window.localStorage.setItem(THESES_KEY, JSON.stringify([thesis, ...theses]));

    const committedAt = performance.now();
    const elapsedMs = Math.round(committedAt - (openedAtRef.current ?? committedAt));
    const metric: CaptureMetric = {
      id: thesis.id,
      openedAt: now - elapsedMs,
      committedAt: now,
      elapsedMs,
      ticker,
    };
    const metrics = readLocalArray<CaptureMetric>(CAPTURE_METRICS_KEY);
    window.localStorage.setItem(CAPTURE_METRICS_KEY, JSON.stringify([metric, ...metrics]));
    console.info("[QuickCapture] thesis committed", metric);

    setBody("");
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-onyx/80 backdrop-blur-sm flex items-start justify-center pt-24 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-obsidian border border-hairline dyn-fade-in"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-hairline">
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-ash">
            QUICK CAPTURE // <span className="text-paper">THESIS</span>
          </span>
          <button onClick={discard} className="text-ash hover:text-paper" aria-label="Discard quick thesis">
            <X className="size-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <label className="block space-y-1.5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-ash">Ticker</span>
            <select
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              className="w-full bg-onyx border border-hairline px-3 py-2 font-mono text-[11px] text-paper focus:border-lavender"
            >
              {ASSETS.map((asset) => (
                <option key={asset.ticker} value={asset.ticker}>
                  {asset.ticker} // {asset.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-ash">Short thesis</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              autoFocus
              placeholder="Cause, catalyst, invalidation. Keep it fast."
              className="w-full h-36 bg-onyx border border-hairline p-3 font-sans text-paper placeholder:text-ash/50 focus:border-lavender resize-none"
            />
          </label>

          <div className="flex items-center justify-between gap-2 pt-3 border-t border-hairline">
            <button
              onClick={() => setBody("")}
              className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest border border-hairline text-ash hover:text-paper"
            >
              <RotateCcw className="size-3" /> Edit
            </button>
            <div className="flex gap-2">
              <button
                onClick={discard}
                className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest border border-hairline text-ash hover:text-paper"
              >
                Discard
              </button>
              <button
                disabled={!body.trim() || !ticker}
                onClick={commit}
                className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest bg-lavender text-onyx hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Check className="size-3" /> Approve
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
