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
  | "journal"
  | "score"
  | "terminal"
  | "agents"
  | "vault"
  | "settings";

type Item = {
  id: ViewId;
  label: string;
  short: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  /** Sealed sections route to a dossier reveal instead of their full build. */
  soon?: boolean;
};

export const PRIMARY_NAV: Item[] = [
  { id: "dashboard", label: "Dashboard", short: "Home", icon: LayoutDashboard },
  { id: "markets", label: "Markets", short: "Markets", icon: LineChart },
  { id: "journal", label: "Journal", short: "Journal", icon: ScrollText },
  { id: "score", label: "POT Performance", short: "Score", icon: BarChart3 },
];

export const SECONDARY_NAV: Item[] = [
  { id: "terminal", label: "AI Terminal", short: "Term", icon: Terminal, soon: true },
  { id: "agents", label: "Agents", short: "Agents", icon: Bot, soon: true },
  { id: "vault", label: "Vault", short: "Vault", icon: Vault, soon: true },
  { id: "settings", label: "Settings", short: "Config", icon: Settings },
];

export const NAV: Item[] = [...PRIMARY_NAV, ...SECONDARY_NAV];

export function Sidebar({
  active,
  onSelect,
  journalBadge,
}: {
  active: ViewId;
  onSelect: (id: ViewId) => void;
  journalBadge?: number;
}) {
  const renderItem = (n: Item) => {
    const isActive = active === n.id;
    const Icon = n.icon;
    const badge = n.id === "journal" && journalBadge && journalBadge > 0 ? journalBadge : null;
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
        <span className="whitespace-nowrap opacity-0 group-hover/nav:opacity-100 transition-opacity truncate">
          {n.label}
        </span>
        {n.soon && (
          <span className="ml-auto px-1 border border-hairline text-ash text-[8px] tracking-[0.14em] opacity-0 group-hover/nav:opacity-100 transition-opacity">
            SOON
          </span>
        )}
        {badge && (
          <span className="ml-auto font-mono text-[10px] text-mint tabular-nums">{badge}</span>
        )}
      </button>
    );
  };

  return (
    <nav className="hidden md:flex group/nav w-14 hover:w-56 transition-[width] duration-200 border-r border-hairline bg-obsidian flex-col shrink-0 z-30 sticky top-0 h-dvh">
      <div className="h-16 border-b border-hairline flex items-center px-3 gap-3 overflow-hidden shrink-0">
        <DiamondLogo size={18} glow />
        <div className="whitespace-nowrap opacity-0 group-hover/nav:opacity-100 transition-opacity leading-none">
          <div className="font-sans font-semibold text-paper tracking-tight text-[13px]">
            PROOF OF THESIS
          </div>
          <div className="font-mono text-[8px] uppercase tracking-[0.28em] text-ash mt-1">
            by INKO
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-4 flex flex-col gap-1 scrollbar-none">
        {PRIMARY_NAV.map(renderItem)}
        <div className="my-3 mx-4 border-t border-hairline shrink-0" />
        {SECONDARY_NAV.map(renderItem)}
      </div>
    </nav>
  );
}
