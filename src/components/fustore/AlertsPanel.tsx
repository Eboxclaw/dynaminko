import { useState } from "react";
import { Bell, Trash2, Plus } from "lucide-react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { ASSETS } from "@/lib/fustore-data";

type AlertKind = "price" | "onchain" | "thesis";
type Alert = { id: string; kind: AlertKind; ticker: string; condition: string; enabled: boolean };

const SEED: Alert[] = [
  { id: "a1", kind: "price", ticker: "XMR", condition: "< $150.00", enabled: true },
  { id: "a2", kind: "onchain", ticker: "tLMT", condition: "whale tx > 100k USDC", enabled: true },
  { id: "a3", kind: "thesis", ticker: "tTSM", condition: "invalidate if breaks $170", enabled: false },
];

const KIND_LABEL: Record<AlertKind, string> = {
  price: "PRICE",
  onchain: "ON-CHAIN",
  thesis: "THESIS",
};

export function AlertsPanel() {
  const [items, setItems] = useLocalStorage<Alert[]>("fu.alerts", SEED);
  const [ticker, setTicker] = useState(ASSETS[0].ticker);
  const [kind, setKind] = useState<AlertKind>("price");
  const [condition, setCondition] = useState("");

  const add = () => {
    if (!condition.trim()) return;
    setItems([
      { id: crypto.randomUUID(), kind, ticker, condition: condition.trim(), enabled: true },
      ...items,
    ]);
    setCondition("");
  };

  return (
    <div className="bg-onyx border border-steel">
      <div className="p-4 border-b border-steel flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Bell className="size-3.5 text-neon-mint" strokeWidth={1.5} />
          <h2 className="text-[10px] font-mono uppercase tracking-[0.25em] text-slate-400">
            Notification Center · Permissionless Triggers
          </h2>
        </div>
        <span className="text-[9px] font-mono text-slate-500">PWA · push-ready</span>
      </div>

      <div className="p-4 border-b border-steel grid grid-cols-[auto_auto_1fr_auto] gap-2">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as AlertKind)}
          className="bg-obsidian border border-steel px-2 py-1.5 text-[11px] font-mono text-slate-200 outline-none"
        >
          <option value="price">PRICE</option>
          <option value="onchain">ON-CHAIN</option>
          <option value="thesis">THESIS</option>
        </select>
        <select
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          className="bg-obsidian border border-steel px-2 py-1.5 text-[11px] font-mono text-slate-200 outline-none"
        >
          {ASSETS.map((a) => (
            <option key={a.ticker} value={a.ticker}>
              {a.ticker}
            </option>
          ))}
        </select>
        <input
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          placeholder="e.g. > $500.00"
          className="bg-obsidian border border-steel px-3 py-1.5 text-[11px] font-mono text-slate-200 placeholder:text-slate-600 outline-none focus:border-neon-mint/50"
        />
        <button
          onClick={add}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border border-neon-mint/40 text-neon-mint hover:bg-neon-mint/10"
        >
          <Plus className="size-3" /> Arm
        </button>
      </div>

      <div className="divide-y divide-steel/60 max-h-56 overflow-y-auto">
        {items.map((a) => (
          <div key={a.id} className="px-4 py-3 flex items-center gap-4 group">
            <button
              onClick={() =>
                setItems(items.map((x) => (x.id === a.id ? { ...x, enabled: !x.enabled } : x)))
              }
              className={
                "size-8 shrink-0 grid place-items-center border transition-colors " +
                (a.enabled
                  ? "border-neon-mint/40 text-neon-mint bg-neon-mint/5"
                  : "border-steel text-slate-600")
              }
              title={a.enabled ? "Disarm" : "Arm"}
            >
              <span
                className="size-1.5 rounded-full"
                style={{
                  backgroundColor: a.enabled ? "#00ff9d" : "#334155",
                  boxShadow: a.enabled ? "0 0 8px #00ff9d" : "none",
                }}
              />
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-mono text-slate-500 tracking-widest">
                  {KIND_LABEL[a.kind]}
                </span>
                <span className="text-xs font-mono text-neon-mint">{a.ticker}</span>
                <span className="text-xs font-mono text-slate-300 truncate">{a.condition}</span>
              </div>
            </div>
            <button
              onClick={() => setItems(items.filter((x) => x.id !== a.id))}
              className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
