import { Eye, EyeOff, Zap } from "lucide-react";
import { DiamondLogo } from "./DiamondLogo";
import { WalletSwitcher } from "./WalletSwitcher";
import { useChain } from "@/hooks/useChain";
import { activeWallet, type Wallet } from "@/lib/wallets";

export function TopBar({
  balance,
  balanceHidden,
  onToggleBalance,
  onQuickCapture,
  wallets,
  onWalletsChange,
}: {
  balance: number;
  balanceHidden: boolean;
  onToggleBalance: () => void;
  onQuickCapture: () => void;
  wallets: Wallet[];
  onWalletsChange: (next: Wallet[]) => void;
}) {
  const { chain, head } = useChain();
  const active = activeWallet(wallets);

  // The venue segment is contextual — derived from the active wallet's
  // network, never a hardcoded chain string.
  const venue = active
    ? `${chain.shortName.toUpperCase()} · ${chain.id}`
    : "NO WALLET";

  const fmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(balance);

  return (
    <header className="h-16 border-b border-hairline px-3 lg:px-6 flex items-center justify-between gap-3 bg-onyx/70 backdrop-blur-md sticky top-0 z-20">
      <div className="flex items-center gap-3 min-w-0">
        <DiamondLogo size={26} glow />
        <div className="hidden md:block leading-none">
          <div className="font-sans font-semibold text-paper tracking-tight text-[15px]">
            PROOF OF THESIS
          </div>
          <div className="font-mono text-[9px] uppercase tracking-[0.28em] text-ash mt-1">
            by INKO
          </div>
        </div>
        <span className="md:hidden font-mono text-sm tracking-[0.18em] text-paper">POT</span>
        <span className="hidden lg:inline-flex items-center px-2 py-0.5 border border-hairline font-mono text-[9px] uppercase tracking-[0.2em] text-ash">
          POT <span className="text-paper ml-1.5">// {venue}</span>
        </span>
      </div>

      <div className="flex items-center gap-2 lg:gap-4">
        <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 border border-hairline">
          <span
            className={"size-1.5 rounded-full " + (head.online ? "bg-mint" : "bg-rose")}
            style={head.online ? { animation: "dyn-pulse-dot 1.8s ease-in-out infinite" } : undefined}
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper">
            {head.online ? chain.shortName : "offline"}
            {head.latencyMs != null && (
              <span className="text-ash ml-1.5 tabular-nums">{head.latencyMs}ms</span>
            )}
          </span>
        </div>

        <button
          onClick={onQuickCapture}
          className="hidden md:flex items-center gap-2 px-3 h-8 border border-lavender/60 text-lavender font-mono text-[10px] uppercase tracking-[0.18em] hover:bg-lavender hover:text-onyx transition-colors"
        >
          <Zap className="size-3.5" strokeWidth={1.5} />
          Quick capture
        </button>

        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-ash">Balance</div>
            <div className="font-mono text-sm text-paper tabular-nums">
              {balanceHidden ? "*** *** ***" : fmt}
            </div>
          </div>
          <button
            onClick={onToggleBalance}
            className="size-7 grid place-items-center border border-hairline text-ash hover:text-paper hover:border-lavender"
            title={balanceHidden ? "Reveal balance" : "Mask balance"}
          >
            {balanceHidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        </div>

        <div className="hidden md:block">
          <WalletSwitcher
            wallets={wallets}
            onChange={onWalletsChange}
            chainLabel={chain.shortName}
          />
        </div>
      </div>
    </header>
  );
}
