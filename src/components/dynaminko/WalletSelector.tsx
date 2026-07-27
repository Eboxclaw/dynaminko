import { useEffect, useRef, useState } from "react";
import { Wallet, X, Check } from "lucide-react";
import { isValidAddress, shortenAddress } from "@/lib/wallet-mock";

export function WalletSelector({
  address,
  onChange,
}: {
  address: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(address);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 40);
  }, [open]);

  useEffect(() => setDraft(address), [address]);

  const commit = () => {
    const v = draft.trim();
    if (v === "" || isValidAddress(v)) {
      onChange(v);
      setOpen(false);
    }
  };

  const valid = draft === "" || isValidAddress(draft);
  const active = !!address && isValidAddress(address);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={
          "flex items-center gap-2 h-8 px-3 border font-mono text-[10px] uppercase tracking-[0.18em] transition-colors " +
          (active
            ? "border-lavender/60 text-lavender hover:bg-lavender/[0.08]"
            : "border-hairline text-paper hover:border-lavender")
        }
        title={active ? address : "Paste a wallet address"}
      >
        <Wallet className="size-3.5" strokeWidth={1.5} />
        {active ? shortenAddress(address) : "Track wallet"}
        <span
          className={"size-1.5 rounded-full " + (active ? "bg-mint" : "bg-ash")}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-[320px] bg-obsidian border border-hairline z-40">
          <div className="px-3 py-2 border-b border-hairline flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ash">
              TRACK // <span className="text-paper">INK WALLET</span>
            </span>
            <button
              onClick={() => setOpen(false)}
              className="text-ash hover:text-paper"
              aria-label="Close"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <div className="p-3 space-y-2">
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") setOpen(false);
              }}
              placeholder="0x…"
              spellCheck={false}
              className={
                "w-full bg-onyx border px-2.5 py-2 font-mono text-[11px] text-paper focus:outline-none " +
                (valid ? "border-hairline focus:border-lavender" : "border-rose/60")
              }
            />
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-ash">
                {valid
                  ? draft
                    ? "valid 0x address"
                    : "clear to disconnect"
                  : "invalid format"}
              </span>
              <div className="flex gap-1.5">
                {address && (
                  <button
                    onClick={() => {
                      setDraft("");
                      onChange("");
                      setOpen(false);
                    }}
                    className="px-2 py-1 font-mono text-[10px] uppercase tracking-widest border border-hairline text-ash hover:text-rose hover:border-rose/40"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={commit}
                  disabled={!valid}
                  className="flex items-center gap-1 px-2 py-1 font-mono text-[10px] uppercase tracking-widest bg-lavender text-onyx hover:brightness-110 disabled:opacity-40"
                >
                  <Check className="size-3" /> Track
                </button>
              </div>
            </div>
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-ash/70 leading-relaxed">
              staged positions only — no chain calls this pass
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
