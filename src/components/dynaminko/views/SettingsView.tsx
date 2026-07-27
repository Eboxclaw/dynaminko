import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { ASSETS } from "@/lib/dynaminko-data";
import { WalletSelector } from "../WalletSelector";
import { shortenAddress } from "@/lib/wallet-mock";

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

export function SettingsView({
  walletAddress,
  onWalletAddressChange,
}: {
  walletAddress: string;
  onWalletAddressChange: (v: string) => void;
}) {
  const [alerts, setAlerts] = useLocalStorage<Alert[]>("dyn.alerts", SEED);
  const [ticker, setTicker] = useState(ASSETS[0].ticker);
  const [kind, setKind] = useState<AlertKind>("price");
  const [condition, setCondition] = useState("");
  const [prefs, setPrefs] = useLocalStorage("dyn.prefs", {
    email: true,
    push: true,
    concierge: true,
  });

  const arm = () => {
    if (!condition.trim()) return;
    setAlerts([
      { id: crypto.randomUUID(), kind, ticker, condition: condition.trim(), enabled: true },
      ...alerts,
    ]);
    setCondition("");
  };

  const connected = !!walletAddress;

  return (
    <div className="p-4 md:p-6 lg:p-8 grid grid-cols-1 xl:grid-cols-2 gap-6 max-w-6xl mx-auto w-full">
      {/* Wallet */}
      <section className="bg-obsidian border border-hairline">
        <div className="px-4 py-3 border-b border-hairline font-mono text-[10px] uppercase tracking-[0.18em] text-ash">
          WALLET // <span className="text-paper">TRACKING</span>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-paper font-mono">
                {connected ? shortenAddress(walletAddress) : "No wallet tracked"}
              </div>
              <div className="font-mono text-[10px] text-ash mt-0.5">
                {connected ? "Ink Chain · 57073 · staged read-only" : "Paste a 0x address to track"}
              </div>
              <p className="mt-2 max-w-md text-xs leading-relaxed text-ash">
                Paste-address tracking uses staged positions this pass. Live Ink Chain RPC reads
                arrive in a later phase.
              </p>
            </div>
            <WalletSelector address={walletAddress} onChange={onWalletAddressChange} />
          </div>
        </div>
      </section>

      {/* Notification prefs */}
      <section className="bg-obsidian border border-hairline">
        <div className="px-4 py-3 border-b border-hairline font-mono text-[10px] uppercase tracking-[0.18em] text-ash">
          NOTIFICATIONS // <span className="text-paper">PREFERENCES</span>
        </div>
        <div className="p-5 space-y-2">
          {(
            [
              ["email", "Email digest"],
              ["push", "Push (PWA install required)"],
              ["concierge", "Concierge reconcile nudges"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center justify-between py-2 cursor-pointer">
              <span className="text-paper text-sm">{label}</span>
              <input
                type="checkbox"
                checked={prefs[k]}
                onChange={(e) => setPrefs({ ...prefs, [k]: e.target.checked })}
                className="accent-lavender size-4"
              />
            </label>
          ))}
        </div>
      </section>

      {/* Alerts */}
      <section className="xl:col-span-2 bg-obsidian border border-hairline">
        <div className="px-4 py-3 border-b border-hairline font-mono text-[10px] uppercase tracking-[0.18em] text-ash flex justify-between">
          <span>ALERTS // <span className="text-paper">PERMISSIONLESS TRIGGERS</span></span>
          <span className="text-ash">{alerts.filter((a) => a.enabled).length} armed</span>
        </div>
        <div className="p-4 grid grid-cols-[auto_auto_1fr_auto] gap-2 border-b border-hairline">
          <select value={kind} onChange={(e) => setKind(e.target.value as AlertKind)}
            className="bg-onyx border border-hairline px-2 py-1.5 font-mono text-[11px] text-paper">
            <option value="price">PRICE</option>
            <option value="onchain">ON-CHAIN</option>
            <option value="thesis">THESIS</option>
          </select>
          <select value={ticker} onChange={(e) => setTicker(e.target.value)}
            className="bg-onyx border border-hairline px-2 py-1.5 font-mono text-[11px] text-paper">
            {ASSETS.map((a) => <option key={a.ticker}>{a.ticker}</option>)}
          </select>
          <input
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            placeholder="e.g. > $500.00"
            className="bg-onyx border border-hairline px-3 py-1.5 font-mono text-[11px] text-paper placeholder:text-ash/50 focus:border-lavender"
          />
          <button
            onClick={() => { arm(); toast("Alert armed"); }}
            className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest border border-lavender text-lavender hover:bg-lavender hover:text-onyx"
          >
            <Plus className="size-3" /> Arm
          </button>
        </div>
        <div className="divide-y divide-hairline max-h-72 overflow-y-auto">
          {alerts.map((a) => (
            <div key={a.id} className="px-4 py-3 flex items-center gap-4 group">
              <button
                onClick={() => setAlerts(alerts.map((x) => x.id === a.id ? { ...x, enabled: !x.enabled } : x))}
                className={"size-7 grid place-items-center border " + (a.enabled ? "border-mint/60" : "border-hairline")}
                title={a.enabled ? "Disarm" : "Arm"}
              >
                <span className={"size-1.5 rounded-full " + (a.enabled ? "bg-mint" : "bg-ash")} />
              </button>
              <div className="flex-1 min-w-0 flex items-center gap-3">
                <span className="font-mono text-[9px] uppercase tracking-widest text-ash">{KIND_LABEL[a.kind]}</span>
                <span className="font-mono text-paper">{a.ticker}</span>
                <span className="font-mono text-[11px] text-ash truncate">{a.condition}</span>
              </div>
              <button
                onClick={() => setAlerts(alerts.filter((x) => x.id !== a.id))}
                className="text-ash hover:text-rose opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
