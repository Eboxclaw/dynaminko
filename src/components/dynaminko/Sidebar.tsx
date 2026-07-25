import { LayoutDashboard, LineChart, Terminal, ScrollText, Vault, Settings } from "lucide-react";
import { DiamondLogo } from "./DiamondLogo";
import type { ComponentType } from "react";

export type ViewId = "dashboard" | "markets" | "terminal" | "theses" | "vault" | "settings";

type Item = { id: ViewId; label: string; icon: ComponentType<{ className?: string; strokeWidth?: number }> };

export const NAV: Item[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "markets", label: "Markets", icon: LineChart },
  { id: "terminal", label: "AI Terminal", icon: Terminal },
  { id: "theses", label: "Theses", icon: ScrollText },
  { id: "vault", label: "Vault", icon: Vault },
  { id: "settings", label: "Settings", icon: Settings },
];

export function Sidebar({
  active,
  onSelect,
  thesesBadge,
}: {
  active: ViewId;
  onSelect: (id: ViewId) => void;
  thesesBadge?: number;
}) {
  return (
    <nav className="hidden md:flex group/nav w-14 hover:w-52 transition-[width] duration-200 border-r border-hairline bg-obsidian flex-col shrink-0 z-30">
      <div className="h-16 border-b border-hairline flex items-center px-3 gap-3 overflow-hidden">
        <DiamondLogo size={18} glow />
        <span className="font-sans font-semibold text-paper tracking-tight whitespace-nowrap opacity-0 group-hover/nav:opacity-100 transition-opacity">
          Dynaminko
        </span>
      </div>
      <div className="flex-1 flex flex-col py-4 gap-1">
        {NAV.map((n) => {
          const isActive = active === n.id;
          const Icon = n.icon;
          const badge = n.id === "theses" && thesesBadge && thesesBadge > 0 ? thesesBadge : null;
          return (
            <button
              key={n.id}
              onClick={() => onSelect(n.id)}
              className={
                "relative h-11 flex items-center gap-4 px-4 text-xs font-mono uppercase tracking-[0.14em] transition-colors " +
                (isActive
                  ? "text-lavender bg-lavender/[0.06] border-l-2 border-lavender"
                  : "text-ash hover:text-paper border-l-2 border-transparent")
              }
            >
              <Icon className="size-4 shrink-0" strokeWidth={1.4} />
              <span className="whitespace-nowrap opacity-0 group-hover/nav:opacity-100 transition-opacity">
                {n.label}
              </span>
              {badge && (
                <span className="ml-auto font-mono text-[10px] text-mint tabular-nums opacity-100 group-hover/nav:opacity-100">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
