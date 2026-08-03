// WalletSwitcher — the header control for picking THE active wallet.
// Exactly one wallet is active at a time; selecting another unloads the
// previous one from every dashboard-bound surface. Roster management
// (add / remove / rename) lives in Settings → Wallets & Accounts.

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Layers, Plug, Plus, Wallet as WalletIcon, X } from "lucide-react";
import { isValidAddress, shortenAddress } from "@/lib/wallet-mock";
import {
  activeWallet,
  autoLabel,
  mockLiveAddress,
  newWalletId,
  withActiveWallet,
  type Wallet,
} from "@/lib/wallets";

export function WalletSwitcher({
  wallets,
  onChange,
  chainLabel,
}: {
  wallets: Wallet[];
  onChange: (next: Wallet[]) => void;
  chainLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const active = activeWallet(wallets);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const select = (id: string) => {
    onChange(withActiveWallet(wallets, id));
    setOpen(false);
  };

  const addRead = () => {
    const v = draft.trim();
    if (!isValidAddress(v)) return;
    const existing = wallets.find((w) => w.address.toLowerCase() === v.toLowerCase());
    if (existing) {
      select(existing.id);
      setDraft("");
      return;
    }
    const id = newWalletId();
    onChange([
      ...wallets.map((w) => ({ ...w, visible: false })),
      {
        id,
        address: v,
        label: autoLabel(v, "read"),
        kind: "read" as const,
        visible: true,
        addedAt: Date.now(),
      },
    ]);
    setDraft("");
    setOpen(false);
  };

  // Signing in always wins: the signed wallet becomes active immediately and
  // whatever read wallet was active is unloaded, announced explicitly.
  const connectSigned = () => {
    const previous = active;
    const addr = mockLiveAddress();
    const id = newWalletId();
    onChange([
      ...wallets.map((w) => ({ ...w, visible: false })),
      {
        id,
        address: addr,
        label: autoLabel(addr, "live"),
        kind: "live" as const,
        visible: true,
        addedAt: Date.now(),
      },
    ]);
    setOpen(false);
    toast(
      previous
        ? `Switched to signed wallet ${shortenAddress(addr)} — read wallet ${shortenAddress(previous.address)} unloaded.`
        : `Signed wallet ${shortenAddress(addr)} is now active.`,
    );
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={
          "flex items-center gap-2 h-8 px-2.5 border font-mono text-[10px] uppercase tracking-[0.16em] transition-colors " +
          (active
            ? "border-lavender/60 text-paper hover:bg-lavender/[0.06]"
            : "border-hairline text-ash hover:border-lavender hover:text-paper")
        }
      >
        <WalletIcon className="size-3.5 shrink-0" strokeWidth={1.5} />
        {active ? (
          <>
            <span className="tabular-nums">{shortenAddress(active.address)}</span>
            <span
              className={
                "px-1 border text-[9px] " +
                (active.kind === "live"
                  ? "border-mint/50 text-mint"
                  : "border-lavender/50 text-lavender")
              }
            >
              {active.kind === "live" ? "SIGNED" : "READ"}
            </span>
            <span className="hidden xl:inline text-ash">{chainLabel}</span>
          </>
        ) : (
          "Select wallet"
        )}
        <ChevronDown className="size-3 text-ash" strokeWidth={1.5} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-[340px] bg-obsidian border border-hairline z-40 max-h-[70vh] overflow-auto">
          <div className="px-3 py-2 border-b border-hairline flex items-center justify-between sticky top-0 bg-obsidian">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ash">
              ACTIVE WALLET // <span className="text-paper">1 OF {wallets.length}</span>
            </span>
            <button onClick={() => setOpen(false)} className="text-ash hover:text-paper" aria-label="Close">
              <X className="size-3.5" />
            </button>
          </div>

          {wallets.length === 0 ? (
            <div className="px-3 py-4 font-mono text-[10px] text-ash">
              No wallets tracked yet.
            </div>
          ) : (
            <div>
              {wallets.map((w) => {
                const isActive = active?.id === w.id;
                return (
                  <button
                    key={w.id}
                    onClick={() => select(w.id)}
                    className={
                      "w-full text-left grid grid-cols-[auto_1fr_auto] items-center gap-2 px-3 py-2.5 border-b border-hairline/60 transition-colors " +
                      (isActive ? "bg-lavender/[0.06]" : "hover:bg-paper/[0.02]")
                    }
                  >
                    <span
                      className={
                        "size-1.5 rounded-full " +
                        (isActive ? (w.kind === "live" ? "bg-mint" : "bg-lavender") : "bg-ash/40")
                      }
                    />
                    <div className="min-w-0">
                      <div className={"font-mono text-[11px] truncate " + (isActive ? "text-paper" : "text-ash")}>
                        {w.label}
                      </div>
                      <div className="font-mono text-[9px] text-ash truncate">
                        {shortenAddress(w.address)}
                      </div>
                    </div>
                    <span
                      className={
                        "font-mono text-[9px] px-1 border " +
                        (w.kind === "live"
                          ? "border-mint/40 text-mint"
                          : "border-hairline text-ash")
                      }
                    >
                      {w.kind === "live" ? "SIGNED" : "READ"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Reserved IA slot — aggregation is a later phase, not forgotten. */}
          <div
            aria-disabled
            className="grid grid-cols-[auto_1fr_auto] items-center gap-2 px-3 py-2.5 border-b border-hairline/60 opacity-45 cursor-not-allowed"
          >
            <Layers className="size-3.5 text-ash" strokeWidth={1.5} />
            <span className="font-mono text-[11px] text-ash">All wallets (aggregated)</span>
            <span className="font-mono text-[9px] px-1 border border-hairline text-ash">SOON</span>
          </div>

          <div className="p-3 space-y-2">
            <div className="flex gap-1.5">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addRead()}
                placeholder="0x… track a new address"
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
              onClick={connectSigned}
              className="w-full flex items-center justify-center gap-2 px-2 py-1.5 font-mono text-[10px] uppercase tracking-widest border border-mint/50 text-mint hover:bg-mint/[0.06]"
            >
              <Plug className="size-3" /> Sign in with wallet (mock)
            </button>
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-ash/70 leading-relaxed">
              one active wallet at a time · manage the roster in settings
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
