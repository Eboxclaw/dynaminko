import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Eye, EyeOff, Plug } from "lucide-react";
import { useInjectedWallet } from "@/hooks/useInjectedWallet";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { ASSETS } from "@/lib/dynaminko-data";
import { isValidAddress, shortenAddress } from "@/lib/wallet-mock";
import { autoLabel, newWalletId, type Wallet } from "@/lib/wallets";
import type { TradeMode } from "./MarketsView";
import { probeCapabilities, llamaReadiness, type Capability } from "@/lib/capabilities";
import { useChain } from "@/hooks/useChain";
import { DataSource } from "../DataSource";

function DataSourceSection() {
  const { status, fetchedAt, refresh, sourceLabel, snapshotList } = useChain();
  return (
    <section className="xl:col-span-2 bg-obsidian border border-hairline">
      <div className="px-4 py-3 border-b border-hairline font-mono text-[10px] uppercase tracking-[0.18em] text-ash flex justify-between">
        <span>
          DATA // <span className="text-paper">SOURCE</span>
        </span>
        <span className="text-ash">
          {snapshotList.length} wallet snapshot{snapshotList.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="p-4 flex flex-wrap items-center gap-3">
        <button
          onClick={refresh}
          className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest border border-hairline text-paper hover:border-lavender disabled:opacity-40"
        >
          Refresh chain reads
        </button>
        <p className="text-[11px] text-ash flex-1 min-w-[220px]">
          Live read-only reads from the Ink explorer, cached in IndexedDB and parsed in a worker.
        </p>
      </div>
      <DataSource source={sourceLabel} at={fetchedAt} status={status} onRefresh={refresh} />
    </section>
  );
}

type AlertKind = "price" | "onchain" | "thesis";
type Alert = { id: string; kind: AlertKind; ticker: string; condition: string; enabled: boolean };

const SEED: Alert[] = [
  { id: "a1", kind: "price", ticker: "XMR", condition: "< $150.00", enabled: true },
  { id: "a2", kind: "onchain", ticker: "tLMT", condition: "whale tx > 100k USDC", enabled: true },
  {
    id: "a3",
    kind: "thesis",
    ticker: "tTSM",
    condition: "invalidate if breaks $170",
    enabled: false,
  },
];

const KIND_LABEL: Record<AlertKind, string> = {
  price: "PRICE",
  onchain: "ON-CHAIN",
  thesis: "THESIS",
};

const TRADE_MODES: { id: TradeMode; label: string; desc: string }[] = [
  { id: "spot", label: "Spot", desc: "CLOB buy/sell against USDC." },
  { id: "swap", label: "Swap", desc: "Router-quoted token→token." },
  { id: "long", label: "Long (Perp)", desc: "Unified margin, up to 20x." },
  { id: "short", label: "Short (Perp)", desc: "Unified margin, up to 20x." },
];

export function SettingsView({
  wallets,
  onWalletsChange,
}: {
  wallets: Wallet[];
  onWalletsChange: (next: Wallet[]) => void;
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
  const [tradeMode, setTradeMode] = useLocalStorage<TradeMode>("dyn.tradeMode", "spot");
  const [draft, setDraft] = useState("");
  const injected = useInjectedWallet();
  const [caps, setCaps] = useState<Capability[] | null>(null);
  useEffect(() => {
    void probeCapabilities().then(setCaps);
  }, []);

  const arm = () => {
    if (!condition.trim()) return;
    setAlerts([
      { id: crypto.randomUUID(), kind, ticker, condition: condition.trim(), enabled: true },
      ...alerts,
    ]);
    setCondition("");
  };

  const addRead = () => {
    if (!isValidAddress(draft)) return;
    if (wallets.some((w) => w.address.toLowerCase() === draft.toLowerCase())) {
      setDraft("");
      return;
    }
    onWalletsChange([
      ...wallets,
      {
        id: newWalletId(),
        address: draft.trim(),
        label: autoLabel(draft.trim(), "read"),
        kind: "read",
        visible: true,
        addedAt: Date.now(),
      },
    ]);
    setDraft("");
  };
  const connectLive = async () => {
    try {
      const accounts = await injected.connect();
      const addr = accounts[0];
      if (!addr || !isValidAddress(addr)) throw new Error("Wallet did not return an EVM address");
      const existing = wallets.find((w) => w.address.toLowerCase() === addr.toLowerCase());
      if (existing) {
        onWalletsChange(
          wallets.map((w) => (w.id === existing.id ? { ...w, kind: "live", visible: true } : w)),
        );
      } else {
        onWalletsChange([
          ...wallets,
          {
            id: newWalletId(),
            address: addr,
            label: autoLabel(addr, "live"),
            kind: "live",
            visible: true,
            addedAt: Date.now(),
          },
        ]);
      }
      toast.success(`Connected ${shortenAddress(addr)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Wallet connection failed");
    }
  };
  const toggleVisible = (id: string) =>
    onWalletsChange(wallets.map((w) => (w.id === id ? { ...w, visible: !w.visible } : w)));
  const remove = (id: string) => onWalletsChange(wallets.filter((w) => w.id !== id));

  const readWallets = wallets.filter((w) => w.kind === "read");
  const liveWallets = wallets.filter((w) => w.kind === "live");

  return (
    <div className="p-4 md:p-6 lg:p-8 grid grid-cols-1 xl:grid-cols-2 gap-6 max-w-6xl mx-auto w-full">
      <DataSourceSection />

      {/* Wallets */}
      <section className="xl:col-span-2 bg-obsidian border border-hairline">
        <div className="px-4 py-3 border-b border-hairline font-mono text-[10px] uppercase tracking-[0.18em] text-ash flex justify-between">
          <span>
            WALLETS // <span className="text-paper">READ + LIVE</span>
          </span>
          <span className="text-ash">
            {wallets.filter((w) => w.visible).length}/{wallets.length} visible
          </span>
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 border-b border-hairline">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addRead()}
            placeholder="paste 0x… address to track (read-only)"
            spellCheck={false}
            className={
              "bg-onyx border px-3 py-1.5 font-mono text-[11px] text-paper focus:outline-none " +
              (draft === "" || isValidAddress(draft)
                ? "border-hairline focus:border-lavender"
                : "border-rose/60")
            }
          />
          <button
            onClick={addRead}
            disabled={!isValidAddress(draft)}
            className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest border border-lavender text-lavender hover:bg-lavender hover:text-onyx disabled:opacity-40"
          >
            <Plus className="size-3" /> Add read
          </button>
          <button
            onClick={() => void connectLive()}
            disabled={!injected.available || injected.connecting}
            className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest border border-mint/60 text-mint hover:bg-mint/[0.08] disabled:opacity-40"
          >
            <Plug className="size-3" />{" "}
            {injected.connecting ? "Connecting…" : `Connect ${injected.name}`}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2">
          <WalletGroup
            title="READ WALLETS"
            items={readWallets}
            onToggle={toggleVisible}
            onRemove={remove}
          />
          <WalletGroup
            title="LIVE WALLETS"
            items={liveWallets}
            onToggle={toggleVisible}
            onRemove={remove}
            liveTone
          />
        </div>
      </section>

      {/* Trading defaults */}
      <section className="bg-obsidian border border-hairline">
        <div className="px-4 py-3 border-b border-hairline font-mono text-[10px] uppercase tracking-[0.18em] text-ash">
          TRADING // <span className="text-paper">DEFAULT MODE</span>
        </div>
        <div className="p-4 grid grid-cols-2 gap-2">
          {TRADE_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setTradeMode(m.id)}
              className={
                "text-left px-3 py-3 border transition-colors " +
                (tradeMode === m.id
                  ? "border-lavender bg-lavender/[0.05]"
                  : "border-hairline hover:border-lavender/60")
              }
            >
              <div
                className={
                  "font-mono text-[11px] uppercase tracking-widest " +
                  (tradeMode === m.id ? "text-lavender" : "text-paper")
                }
              >
                {m.label}
              </div>
              <div className="text-[11px] text-ash mt-1">{m.desc}</div>
            </button>
          ))}
        </div>
        <div className="px-4 pb-4 font-mono text-[9px] uppercase tracking-widest text-ash/70">
          opens by default when you select an asset
        </div>
      </section>

      {/* Notifications */}
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
          <span>
            ALERTS // <span className="text-paper">PERMISSIONLESS TRIGGERS</span>
          </span>
          <span className="text-ash">{alerts.filter((a) => a.enabled).length} armed</span>
        </div>
        <div className="p-4 grid grid-cols-[auto_auto_1fr_auto] gap-2 border-b border-hairline">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as AlertKind)}
            className="bg-onyx border border-hairline px-2 py-1.5 font-mono text-[11px] text-paper"
          >
            <option value="price">PRICE</option>
            <option value="onchain">ON-CHAIN</option>
            <option value="thesis">THESIS</option>
          </select>
          <select
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            className="bg-onyx border border-hairline px-2 py-1.5 font-mono text-[11px] text-paper"
          >
            {ASSETS.map((a) => (
              <option key={a.ticker}>{a.ticker}</option>
            ))}
          </select>
          <input
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            placeholder="e.g. > $500.00"
            className="bg-onyx border border-hairline px-3 py-1.5 font-mono text-[11px] text-paper placeholder:text-ash/50 focus:border-lavender"
          />
          <button
            onClick={() => {
              arm();
              toast("Alert armed");
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest border border-lavender text-lavender hover:bg-lavender hover:text-onyx"
          >
            <Plus className="size-3" /> Arm
          </button>
        </div>
        <div className="divide-y divide-hairline max-h-72 overflow-y-auto">
          {alerts.map((a) => (
            <div key={a.id} className="px-4 py-3 flex items-center gap-4 group">
              <button
                onClick={() =>
                  setAlerts(alerts.map((x) => (x.id === a.id ? { ...x, enabled: !x.enabled } : x)))
                }
                className={
                  "size-7 grid place-items-center border " +
                  (a.enabled ? "border-mint/60" : "border-hairline")
                }
                title={a.enabled ? "Disarm" : "Arm"}
              >
                <span className={"size-1.5 rounded-full " + (a.enabled ? "bg-mint" : "bg-ash")} />
              </button>
              <div className="flex-1 min-w-0 flex items-center gap-3">
                <span className="font-mono text-[9px] uppercase tracking-widest text-ash">
                  {KIND_LABEL[a.kind]}
                </span>
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

      {/* Runtime capabilities — PWA / WASM / WebGPU / llama.cpp readiness */}
      <section className="xl:col-span-2 bg-obsidian border border-hairline">
        <div className="px-4 py-3 border-b border-hairline font-mono text-[10px] uppercase tracking-[0.18em] text-ash flex justify-between">
          <span>
            RUNTIME // <span className="text-paper">BROWSER SUBSTRATE</span>
          </span>
          {caps && (
            <span
              className={
                "font-mono " +
                (llamaReadiness(caps) === "ready"
                  ? "text-mint"
                  : llamaReadiness(caps) === "degraded"
                    ? "text-lavender"
                    : "text-rose")
              }
            >
              llama.cpp: {llamaReadiness(caps).toUpperCase()}
            </span>
          )}
        </div>
        <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-2">
          {(caps ?? []).map((c) => (
            <div key={c.key} className="border border-hairline p-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-widest text-ash">
                  {c.label}
                </span>
                <span className={"size-1.5 rounded-full " + (c.ok ? "bg-mint" : "bg-rose")} />
              </div>
              <div className={"font-mono text-[11px] mt-1 " + (c.ok ? "text-paper" : "text-ash")}>
                {c.ok ? "available" : "unavailable"}
              </div>
              {c.detail && <div className="font-mono text-[9px] text-ash mt-0.5">{c.detail}</div>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function WalletGroup({
  title,
  items,
  onToggle,
  onRemove,
  liveTone = false,
}: {
  title: string;
  items: Wallet[];
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  liveTone?: boolean;
}) {
  return (
    <div className="border-b md:border-b-0 md:border-r border-hairline last:border-r-0 last:border-b-0">
      <div className="px-4 py-2 bg-onyx/40 font-mono text-[9px] uppercase tracking-[0.18em] text-ash flex justify-between">
        <span>
          {title} <span className="text-paper">// {items.length}</span>
        </span>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-6 font-mono text-[10px] uppercase tracking-widest text-ash/60 text-center">
          — none —
        </div>
      ) : (
        items.map((w) => (
          <div
            key={w.id}
            className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 px-4 py-2.5 border-t border-hairline/60"
          >
            <span
              className={
                "size-1.5 rounded-full " +
                (w.visible ? (liveTone ? "bg-mint" : "bg-lavender") : "bg-ash/60")
              }
            />
            <div className="min-w-0">
              <div className="font-mono text-[11px] text-paper truncate">{w.label}</div>
              <div className="font-mono text-[9px] text-ash truncate">
                {shortenAddress(w.address)}
              </div>
            </div>
            <button
              onClick={() => onToggle(w.id)}
              title={w.visible ? "Hide" : "Show"}
              className="size-6 grid place-items-center border border-hairline text-ash hover:text-paper hover:border-lavender"
            >
              {w.visible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
            </button>
            <button
              onClick={() => onRemove(w.id)}
              title="Remove"
              className="size-6 grid place-items-center text-ash hover:text-rose"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        ))
      )}
    </div>
  );
}
