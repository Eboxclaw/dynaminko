import { Check, ChevronDown, Eye, Plug, Trash2, Wallet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { CHAINS, DEFAULT_CHAIN_ID } from "@/chains";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useActiveWallet } from "@/hooks/usePortfolio";
import { useInjectedWallet } from "@/hooks/useInjectedWallet";
import { currentChainId } from "@/lib/chain/injected";
import { shortAddress } from "@/lib/format";
import { track } from "@/lib/stats/client";
import { addWallet, removeWallet, setActiveWallet, setWalletPaused, walletKey } from "@/lib/store";
import { cn } from "@/lib/utils";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function WalletChip() {
  const { active, wallets } = useActiveWallet();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="doodle-pill flex items-center gap-2 px-3 py-1.5 text-[13px] text-ink transition hover:bg-accent-soft"
        >
          <Wallet className="h-4 w-4 text-ink-soft" strokeWidth={1.9} />
          <span className="num hidden sm:inline">
            {active ? shortAddress(active.address) : "Add wallet"}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-ink-faint" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="doodle-card w-[320px] border-0 p-0 shadow-none">
        <WalletPanel
          onDone={() => setOpen(false)}
          wallets={wallets}
          activeKey={active ? walletKey(active.chainId, active.address) : null}
        />
      </PopoverContent>
    </Popover>
  );
}

export function WalletPanel({
  onDone,
  wallets,
  activeKey,
}: {
  onDone?: () => void;
  wallets: ReturnType<typeof useActiveWallet>["wallets"];
  activeKey: string | null;
}) {
  const injected = useInjectedWallet();
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState(DEFAULT_CHAIN_ID);

  function watch() {
    const value = address.trim();
    if (!ADDRESS_RE.test(value)) {
      toast.error("That doesn't look like an address");
      return;
    }
    addWallet({ address: value, chainId, label: "Watching", kind: "watch" });
    track("wallet_watched");
    setAddress("");
    toast.success("Wallet added, reading it now");
    onDone?.();
  }

  async function connect() {
    try {
      const accounts = await injected.connect();
      if (!accounts[0]) return;
      // The app is Ink-first: if the wallet sits on another network, prompt
      // the switch with the docs-verified params in chains/ink.ts. A decline
      // still connects; the panel then shows a "Switch to Ink" action.
      let cid = await currentChainId();
      if (cid == null || !CHAINS.some((c) => c.id === cid)) {
        try {
          await injected.switchTo(DEFAULT_CHAIN_ID);
          cid = await currentChainId();
        } catch {
          toast("Connect stays read-only until the wallet is on Ink.");
        }
      }
      addWallet({
        address: accounts[0],
        chainId: cid ?? DEFAULT_CHAIN_ID,
        label: injected.name,
        kind: "connected",
      });
      track("wallet_watched");
      toast.success(`${injected.name} connected · reads only until you attest`);
      onDone?.();
    } catch {
      toast.error("Connection cancelled");
    }
  }

  return (
    <div className="space-y-4 p-4">
      <div>
        <p className="text-[13px] font-medium">Your wallets</p>
        <p className="text-[12px] text-ink-faint">
          Reads only. Signing happens only when you attest, always an explicit wallet prompt.
        </p>
      </div>

      {wallets.length > 0 && (
        <ul className="space-y-1.5">
          {wallets.map((w) => {
            const key = walletKey(w.chainId, w.address);
            const chain = CHAINS.find((c) => c.id === w.chainId);
            const wrongNetwork = w.kind === "connected" && w.chainId !== DEFAULT_CHAIN_ID;
            return (
              <li key={key}>
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-2xl px-2.5 py-2 transition",
                    key === activeKey ? "bg-accent-soft" : "hover:bg-sunken",
                    w.paused && "opacity-50",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      // Activating a paused row unpauses it: one intent, one action.
                      if (w.paused) setWalletPaused(key, false);
                      else setActiveWallet(key);
                      onDone?.();
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    {w.kind === "connected" ? (
                      <Plug className="h-4 w-4 shrink-0 text-ink-soft" strokeWidth={1.9} />
                    ) : (
                      <Eye className="h-4 w-4 shrink-0 text-ink-soft" strokeWidth={1.9} />
                    )}
                    <span className="min-w-0">
                      <span className="num block truncate text-[13px]">
                        {shortAddress(w.address)}
                      </span>
                      <span className="block text-[11px] text-ink-faint">
                        {chain?.name ?? "Unknown network"}
                        {wrongNetwork && " · not Ink"}
                      </span>
                    </span>
                    {key === activeKey && <Check className="ml-auto h-4 w-4 text-accent" />}
                  </button>
                  <button
                    type="button"
                    aria-label={w.paused ? "Activate wallet" : "Pause wallet"}
                    title={w.paused ? "Activate: reads and attest on" : "Pause: no reads, no attest"}
                    onClick={() => setWalletPaused(key, !w.paused)}
                    className={cn(
                      "doodle-pill px-2 py-0.5 text-[11px]",
                      w.paused ? "text-ink-faint" : "bg-ink text-paper",
                    )}
                  >
                    {w.paused ? "Off" : "On"}
                  </button>
                  <button
                    type="button"
                    aria-label="Remove wallet"
                    onClick={() => removeWallet(key)}
                    className="text-ink-faint transition hover:text-loss"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {(() => {
        // The active connected wallet sits on another network: reads and
        // attest need Ink. One deliberate click prompts the switch.
        const aw = wallets.find((w) => walletKey(w.chainId, w.address) === activeKey);
        if (!aw || aw.kind !== "connected" || aw.chainId === DEFAULT_CHAIN_ID) return null;
        return (
          <button
            type="button"
            onClick={async () => {
              try {
                await injected.switchTo(DEFAULT_CHAIN_ID);
                // Re-key the row onto Ink mainnet; the address is unchanged.
                addWallet({
                  address: aw.address,
                  chainId: DEFAULT_CHAIN_ID,
                  label: aw.label,
                  kind: "connected",
                });
                removeWallet(walletKey(aw.chainId, aw.address));
                toast.success("Wallet switched to Ink");
              } catch {
                toast.error("Switch cancelled");
              }
            }}
            className="doodle-pill w-full border border-stroke px-3 py-2 text-[12px] text-ink-soft hover:bg-accent-soft"
          >
            Wallet is on another network · Switch to Ink
          </button>
        );
      })()}

      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && watch()}
            placeholder="0x… paste an address to watch"
            spellCheck={false}
            className="num doodle-inset min-w-0 flex-1 bg-transparent px-3 py-2 text-[12px] outline-none placeholder:font-sans placeholder:text-ink-faint focus:border-accent"
          />
          <button
            type="button"
            onClick={watch}
            className="doodle-pill bg-ink px-3 py-2 text-[12px] font-medium text-paper"
          >
            Watch
          </button>
        </div>
        <select
          value={chainId}
          onChange={(e) => setChainId(Number(e.target.value))}
          className="doodle-inset w-full bg-transparent px-3 py-2 text-[12px] outline-none"
        >
          {CHAINS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={connect}
          disabled={!injected.available || injected.connecting}
          className="doodle-pill flex w-full items-center justify-center gap-2 border border-stroke px-3 py-2 text-[12px] text-ink transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plug className="h-3.5 w-3.5" strokeWidth={1.9} />
          {injected.connecting
            ? "Connecting…"
            : injected.available
              ? `Connect ${injected.name}`
              : "No wallet found in this browser"}
        </button>
      </div>
    </div>
  );
}
