import { Eye, EyeOff, TerminalSquare } from "lucide-react";

export function TopBar({
  balance,
  balanceHidden,
  onToggleBalance,
  onOpenCli,
}: {
  balance: number;
  balanceHidden: boolean;
  onToggleBalance: () => void;
  onOpenCli: () => void;
}) {
  const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(balance);
  return (
    <header className="h-16 border-b border-steel px-6 lg:px-8 flex items-center justify-between bg-onyx/40 backdrop-blur-md sticky top-0 z-30">
      <div className="flex items-center gap-6 min-w-0">
        <h1 className="text-sm font-mono tracking-tight text-white truncate">
          MARKETPLACE / <span className="text-neon-mint">TERMINAL_1</span>
        </h1>
        <div className="hidden md:flex items-center gap-2 px-2.5 py-1 border border-ink-purple/40 bg-ink-purple/10 rounded-sm">
          <span
            className="size-1.5 rounded-full bg-neon-mint"
            style={{ animation: "fu-pulse-dot 1.6s ease-in-out infinite" }}
          />
          <span className="text-[10px] font-mono uppercase tracking-widest text-slate-200">
            Connected · Ink Chain L2
          </span>
        </div>
      </div>
      <div className="flex items-center gap-4 lg:gap-6">
        <button
          onClick={onOpenCli}
          className="hidden md:flex items-center gap-2 px-3 py-1.5 border border-steel text-[10px] font-mono uppercase tracking-widest text-slate-300 hover:text-neon-mint hover:border-neon-mint/40 transition-colors"
        >
          <TerminalSquare className="size-3.5" strokeWidth={1.5} />
          Kraken CLI
        </button>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[9px] uppercase opacity-40 tracking-[0.2em]">Total Balance</div>
            <div className="text-sm font-mono text-white tabular-nums">
              {balanceHidden ? "$ ***,***.**" : fmt}
            </div>
          </div>
          <button
            onClick={onToggleBalance}
            className="size-7 grid place-items-center border border-steel hover:bg-steel text-slate-400"
            title={balanceHidden ? "Show balance" : "Hide balance"}
          >
            {balanceHidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        </div>
        <div className="w-px h-6 bg-steel" />
        <div className="flex items-center gap-2">
          <div className="size-8 bg-steel rounded-full border border-neon-mint/30" />
          <div className="hidden lg:block text-xs font-mono text-white">0xkraken.eth</div>
        </div>
      </div>
    </header>
  );
}
