import { LayoutDashboard, LineChart, TerminalSquare, ScrollText, Vault, Settings } from "lucide-react";

const NAV = [
  { id: "dash", label: "Dashboard", icon: LayoutDashboard },
  { id: "mkt", label: "Markets", icon: LineChart },
  { id: "cli", label: "Kraken CLI", icon: TerminalSquare },
  { id: "ths", label: "Theses", icon: ScrollText },
  { id: "vlt", label: "Vault", icon: Vault },
];

export function Sidebar({
  active,
  onSelect,
  onOpenCli,
}: {
  active: string;
  onSelect: (id: string) => void;
  onOpenCli: () => void;
}) {
  return (
    <nav className="w-16 lg:w-20 border-r border-steel flex flex-col items-center py-6 gap-8 bg-onyx/50 shrink-0">
      <div className="size-10 bg-neon-mint grid place-items-center rotate-45 mb-2 shadow-[0_0_24px_-4px_#00ff9d]">
        <span className="-rotate-45 text-obsidian font-extrabold text-lg tracking-tighter">FU</span>
      </div>
      <div className="flex flex-col gap-2">
        {NAV.map((n) => {
          const isActive = active === n.id;
          const Icon = n.icon;
          return (
            <button
              key={n.id}
              onClick={() => {
                if (n.id === "cli") onOpenCli();
                onSelect(n.id);
              }}
              title={n.label}
              className={
                "size-11 grid place-items-center rounded border transition-all group relative " +
                (isActive
                  ? "text-neon-mint border-neon-mint/40 bg-neon-mint/5"
                  : "text-slate-500 border-transparent hover:text-white hover:border-steel")
              }
            >
              <Icon className="size-4" strokeWidth={1.5} />
              <span className="absolute left-full ml-3 px-2 py-1 bg-onyx border border-steel text-[10px] font-mono uppercase tracking-widest text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                {n.label}
              </span>
            </button>
          );
        })}
      </div>
      <button
        title="Settings"
        className="mt-auto size-11 grid place-items-center text-slate-500 hover:text-white transition-colors"
      >
        <Settings className="size-4" strokeWidth={1.5} />
      </button>
    </nav>
  );
}
