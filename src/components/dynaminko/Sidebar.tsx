import {
  LayoutDashboard,
  LineChart,
  Terminal,
  ScrollText,
  BarChart3,
  Vault,
  Bot,
  Settings,
} from "lucide-react";
import { DiamondLogo } from "./DiamondLogo";
import type { ComponentType } from "react";

export type ViewId =
  | "dashboard"
  | "markets"
  | "terminal"
  | "theses"
  | "dpi"
  | "vault"
  | "agents"
  | "settings";

type Item = {
  id: ViewId;
  label: string;
  short: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
};

export const NAV: Item[] = [
  { id: "dashboard", label: "Dashboard", short: "Home", icon: LayoutDashboard },
  { id: "markets", label: "Markets", short: "Markets", icon: LineChart },
  { id: "terminal", label: "AI Terminal", short: "Term", icon: Terminal },
  { id: "theses", label: "Theses & Journal", short: "Theses", icon: ScrollText },
  { id: "dpi", label: "DPI", short: "DPI", icon: BarChart3 },
  { id: "vault", label: "Vault", short: "Vault", icon: Vault },
  { id: "agents", label: "Agents", short: "Agents", icon: Bot },
  { id: "settings", label: "Settings", short: "Config", icon: Settings },
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
    <nav className="hidden md:flex group/nav w-14 hover:w-52 transition-[width] duration-200 border-r border-hairline bg-obsidian flex-col shrink-0 z-30 sticky top-0 h-dvh">
      <div className="h-16 border-b border-hairline flex items-center px-3 gap-3 overflow-hidden shrink-0">
        <DiamondLogo size={18} glow />
        <span className="font-sans font-semibold text-paper tracking-tight whitespace-nowrap opacity-0 group-hover/nav:opacity-100 transition-opacity">
          Dynaminko
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-4 gap-1 flex flex-col scrollbar-none">
        {NAV.map((n) => {
          const isActive = active === n.id;
          const Icon = n.icon;
          const badge = n.id === "theses" && thesesBadge && thesesBadge > 0 ? thesesBadge : null;
          return (
            <button
              key={n.id}
              onClick={() => onSelect(n.id)}
              title={n.label}
              className={
                "relative h-11 shrink-0 flex items-center gap-4 px-4 text-xs font-mono uppercase tracking-[0.14em] transition-colors " +
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
                <span className="ml-auto font-mono text-[10px] text-mint tabular-nums">{badge}</span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
