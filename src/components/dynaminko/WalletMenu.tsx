// WalletMenu — the multi-wallet control that lives in the top bar (and in
// Settings). Wallets are grouped by kind:
//   READ WALLETS  — pasted 0x addresses, read-only tracking
//   LIVE WALLETS  — accounts returned by the injected EIP-1193 wallet
// Each wallet can be shown/hidden without deleting it, so users can slice
// which subset feeds the dashboard aggregation without losing addresses.

import { useEffect, useRef, useState } from "react";
import { Wallet as WalletIcon, Plus, Trash2, Eye, EyeOff, Plug, X, Check } from "lucide-react";
import { toast } from "sonner";
import { useInjectedWallet } from "@/hooks/useInjectedWallet";
import { isValidAddress, shortenAddress } from "@/lib/wallet-mock";
import { autoLabel, newWalletId, type Wallet } from "@/lib/wallets";

export function WalletMenu({
  wallets,
  onChange,
  compact = false,
}: {
  wallets: Wallet[];
  onChange: (next: Wallet[]) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const injected = useInjectedWallet();

  const visible = wallets.filter((w) => w.visible && isValidAddress(w.address));
  const active = visible.length > 0;

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 40);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const addRead = () => {
    const v = draft.trim();
    if (!isValidAddress(v)) return;
    if (wallets.some((w) => w.address.toLowerCase() === v.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([
      ...wallets,
      {
        id: newWalletId(),
        address: v,
        label: autoLabel(v, "read"),
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
        onChange(
          wallets.map((w) => (w.id === existing.id ? { ...w, kind: "live", visible: true } : w)),
        );
      } else {
        onChange([
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
    onChange(wallets.map((w) => (w.id === id ? { ...w, visible: !w.visible } : w)));
  const remove = (id: string) => onChange(wallets.filter((w) => w.id !== id));

  const label = compact
    ? active
      ? `${visible.length} on`
      : "Wallets"
    : active
      ? visible.length === 1
        ? shortenAddress(visible[0].address)
        : `${visible.length} wallets`
      : "Track wallets";

  const groups: { kind: "read" | "live"; title: string; items: Wallet[] }[] = [
    { kind: "read", title: "READ WALLETS", items: wallets.filter((w) => w.kind === "read") },
    { kind: "live", title: "LIVE WALLETS", items: wallets.filter((w) => w.kind === "live") },
  ];

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={
          "flex items-center gap-2 h-8 px-3 border font-mono text-[10px] uppercase tracking-[0.18em] transition-colors " +
          (active
            ? "border-lavender/60 text-lavender hover:bg-lavender/[0.08]"
            : "border-hairline text-paper hover:border-lavender")
        }
      >
        <WalletIcon className="size-3.5" strokeWidth={1.5} />
        {label}
        <span className={"size-1.5 rounded-full " + (active ? "bg-mint" : "bg-ash")} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-[360px] bg-obsidian border border-hairline z-40 max-h-[70vh] overflow-auto">
          <div className="px-3 py-2 border-b border-hairline flex items-center justify-between sticky top-0 bg-obsidian">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ash">
              WALLETS // <span className="text-paper">{wallets.length}</span>
            </span>
            <button onClick={() => setOpen(false)} className="text-ash hover:text-paper">
              <X className="size-3.5" />
            </button>
          </div>

          {/* Add read wallet */}
          <div className="p-3 border-b border-hairline space-y-2">
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ash">
              ADD READ WALLET
            </div>
            <div className="flex gap-1.5">
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addRead();
                }}
                placeholder="0x…"
                spellCheck={false}
                className={
                  "flex-1 bg-onyx border px-2.5 py-1.5 font-mono text-[11px] text-paper focus:outline-none " +
                  (draft === "" || isValidAddress(draft)
                    ? "border-hairline focus:border-lavender"
                    : "border-rose/60")
                }
              />
              <button
                onClick={addRead}
                disabled={!isValidAddress(draft)}
                className="flex items-center gap-1 px-2 py-1 font-mono text-[10px] uppercase tracking-widest bg-lavender text-onyx hover:brightness-110 disabled:opacity-40"
              >
                <Plus className="size-3" /> Add
              </button>
            </div>
            <button
              onClick={() => void connectLive()}
              disabled={!injected.available || injected.connecting}
              className="w-full flex items-center justify-center gap-2 px-2 py-1.5 font-mono text-[10px] uppercase tracking-widest border border-mint/50 text-mint hover:bg-mint/[0.06] disabled:opacity-40"
            >
              <Plug className="size-3" />{" "}
              {injected.connecting ? "Connecting…" : `Connect ${injected.name}`}
            </button>
          </div>

          {groups.map((g) => (
            <div key={g.kind} className="border-b border-hairline last:border-b-0">
              <div className="px-3 py-2 flex items-center justify-between bg-onyx/40">
                <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-ash">
                  {g.title} <span className="text-paper">// {g.items.length}</span>
                </span>
                {g.items.length > 0 && (
                  <button
                    onClick={() => {
                      const allOn = g.items.every((w) => w.visible);
                      onChange(
                        wallets.map((w) => (w.kind === g.kind ? { ...w, visible: !allOn } : w)),
                      );
                    }}
                    className="font-mono text-[9px] uppercase tracking-widest text-ash hover:text-paper"
                  >
                    {g.items.every((w) => w.visible) ? "hide all" : "show all"}
                  </button>
                )}
              </div>
              {g.items.length === 0 ? (
                <div className="px-3 py-3 font-mono text-[10px] text-ash">— none —</div>
              ) : (
                g.items.map((w) => (
                  <div
                    key={w.id}
                    className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 px-3 py-2 border-t border-hairline/60"
                  >
                    <span
                      className={
                        "size-1.5 rounded-full " +
                        (w.visible ? (w.kind === "live" ? "bg-mint" : "bg-lavender") : "bg-ash/60")
                      }
                    />
                    <div className="min-w-0">
                      <div className="font-mono text-[11px] text-paper truncate">{w.label}</div>
                      <div className="font-mono text-[9px] text-ash truncate">
                        {shortenAddress(w.address)}
                      </div>
                    </div>
                    <button
                      onClick={() => toggleVisible(w.id)}
                      title={w.visible ? "Hide from dashboard" : "Show on dashboard"}
                      className="size-6 grid place-items-center border border-hairline text-ash hover:text-paper hover:border-lavender"
                    >
                      {w.visible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                    </button>
                    <button
                      onClick={() => remove(w.id)}
                      title="Remove"
                      className="size-6 grid place-items-center text-ash hover:text-rose"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
          ))}

          <div className="px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-ash/70 leading-relaxed">
            visible wallets aggregate into dashboard · staged reads only
          </div>
        </div>
      )}
    </div>
  );
}

export function ConfirmLike({ onOk }: { onOk: () => void }) {
  return (
    <button onClick={onOk} className="text-mint">
      <Check className="size-3" />
    </button>
  );
}
