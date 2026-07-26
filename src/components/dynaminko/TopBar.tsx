import { Eye, EyeOff, Zap } from "lucide-react";
import { DiamondLogo } from "./DiamondLogo";

export function TopBar({
  balance,
  balanceHidden,
  onToggleBalance,
  onQuickCapture,
  walletConnected,
  onToggleWallet,
}: {
  balance: number;
  balanceHidden: boolean;
  onToggleBalance: () => void;
  onQuickCapture: () => void;
  walletConnected: boolean;
  onToggleWallet: () => void;
}) {
  const fmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(balance);
  return (
    <header className="h-16 border-b border-hairline px-4 lg:px-6 flex items-center justify-between bg-onyx/70 backdrop-blur-md sticky top-0 z-20">
      {/* wordmark */}
      <div className="flex items-center gap-4 min-w-0">
        <div className="md:hidden">
          <DiamondLogo size={18} glow />
        </div>
        <div className="hidden md:flex items-baseline gap-3">
          <span className="font-sans font-semibold text-paper tracking-tight">Dynaminko</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-ash">
            Trading Journal // Ink Chain
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 lg:gap-4">
        {/* Ink chain status */}
        <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 border border-hairline">
          <span
            className="size-1.5 rounded-full bg-mint"
            style={{ animation: "dyn-pulse-dot 1.8s ease-in-out infinite" }}
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper">
            Ink Chain target · 57073
          </span>
        </div>

        {/* Quick capture (desktop) */}
        <button
          onClick={onQuickCapture}
          className="hidden md:flex items-center gap-2 px-3 h-8 border border-lavender/60 text-lavender font-mono text-[10px] uppercase tracking-[0.18em] hover:bg-lavender hover:text-onyx transition-colors"
        >
          <Zap className="size-3.5" strokeWidth={1.5} />
          Quick capture
        </button>

        {/* Balance */}
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

        {/* Wallet */}
        <button
          onClick={onToggleWallet}
          className="hidden lg:flex items-center gap-2 h-8 px-3 border border-hairline hover:border-lavender font-mono text-[10px] uppercase tracking-[0.18em] text-paper"
        >
          <span
            className={"size-1.5 rounded-full " + (walletConnected ? "bg-mint" : "bg-ash")}
          />
          {walletConnected ? "Demo wallet" : "Connect wallet"}
        </button>
      </div>
    </header>
  );
}
