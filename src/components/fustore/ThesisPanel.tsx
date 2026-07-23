import { useState } from "react";
import { Trash2, Plus } from "lucide-react";
import { useLocalStorage } from "@/hooks/useLocalStorage";

type Thesis = { id: string; ticker: string; body: string; ts: number };

const SEED: Thesis[] = [
  {
    id: "t1",
    ticker: "tLMT",
    body: "Accumulating tLMT on Superchain dips — kinetic-cycle beta plus tokenized-defense scarcity premium.",
    ts: Date.now() - 86400000,
  },
  {
    id: "t2",
    ticker: "XMR",
    body: "Privacy layer as sovereign hedge; regulatory pressure is the buy signal, not the sell signal.",
    ts: Date.now() - 3600000 * 6,
  },
];

export function ThesisPanel({ activeTicker }: { activeTicker: string }) {
  const [items, setItems] = useLocalStorage<Thesis[]>("fu.theses", SEED);
  const [draft, setDraft] = useState("");

  const add = () => {
    if (!draft.trim()) return;
    setItems([{ id: crypto.randomUUID(), ticker: activeTicker, body: draft.trim(), ts: Date.now() }, ...items]);
    setDraft("");
  };

  return (
    <div className="bg-onyx border border-steel flex flex-col h-full">
      <div className="p-4 border-b border-steel flex justify-between items-center">
        <h2 className="text-[10px] font-mono uppercase tracking-[0.25em] text-slate-400">
          Thesis Engine
        </h2>
        <span className="text-[9px] font-mono text-slate-500">local · encrypted</span>
      </div>
      <div className="p-4 border-b border-steel">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Conviction thesis for ${activeTicker}…`}
          className="w-full h-20 bg-obsidian border border-steel p-3 text-xs font-mono text-slate-200 placeholder:text-slate-600 outline-none resize-none focus:border-neon-mint/50 transition-colors"
        />
        <div className="flex justify-between items-center mt-2">
          <span className="text-[10px] font-mono text-slate-500">
            Tag → <span className="text-neon-mint">{activeTicker}</span>
          </span>
          <button
            onClick={add}
            className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold uppercase tracking-widest border border-neon-mint/40 text-neon-mint hover:bg-neon-mint/10"
          >
            <Plus className="size-3" /> Commit
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-steel/60">
        {items.length === 0 && (
          <div className="p-6 text-center text-[11px] font-mono text-slate-600">
            No theses. Commit your first conviction above.
          </div>
        )}
        {items.map((t) => (
          <div key={t.id} className="p-4 group hover:bg-steel/20 transition-colors">
            <div className="flex justify-between items-start mb-1.5">
              <span className="text-[10px] font-mono text-neon-mint tracking-widest">
                {t.ticker}
              </span>
              <div className="flex items-center gap-3">
                <span className="text-[9px] font-mono text-slate-600">
                  {new Date(t.ts).toLocaleDateString()}
                </span>
                <button
                  onClick={() => setItems(items.filter((x) => x.id !== t.id))}
                  className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-300 font-mono">{t.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
