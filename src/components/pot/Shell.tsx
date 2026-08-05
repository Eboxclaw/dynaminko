import { Link, useRouterState } from "@tanstack/react-router";
import {
  BellRing,
  BookOpen,
  Home,
  Lightbulb,
  Moon,
  PieChart,
  Plus,
  Settings as SettingsIcon,
  Sun,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { useDoc } from "@/hooks/useDoc";
import { patchSettings } from "@/lib/store";
import { cn } from "@/lib/utils";

import { Mark, Wordmark } from "./Mark";
import { WalletChip } from "./WalletChip";

const NAV = [
  { to: "/", label: "Today", icon: Home },
  { to: "/portfolio", label: "Portfolio", icon: PieChart },
  { to: "/journal", label: "Journal", icon: BookOpen },
  { to: "/theses", label: "Theses", icon: Lightbulb },
  { to: "/alerts", label: "Alerts", icon: BellRing },
] as const;

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.classList.toggle("dark", next);
        try {
          localStorage.setItem("pot.theme", next ? "dark" : "light");
        } catch {
          /* ignore */
        }
        patchSettings({ theme: next ? "dark" : "light" });
      }}
      className="doodle-pill grid h-9 w-9 place-items-center text-ink-soft transition hover:bg-accent-soft hover:text-ink"
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

export function Shell({
  children,
  title,
  subtitle,
  action,
}: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const doc = useDoc();
  const openTheses = doc.theses.filter((t) => t.status === "open").length;

  return (
    <div className="min-h-dvh bg-paper text-ink">
      {/* desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-stroke bg-paper px-5 py-6 lg:flex">
        <Link to="/" className="mb-8">
          <Wordmark />
        </Link>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => {
            const active = item.to === "/" ? path === "/" : path.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "group flex items-center gap-3 rounded-[16px_14px_17px_13px/13px_17px_13px_16px] px-3 py-2.5 text-[15px] transition",
                  active
                    ? "bg-accent-soft font-medium text-ink"
                    : "text-ink-soft hover:bg-sunken hover:text-ink",
                )}
              >
                <item.icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
                {item.label}
                {item.to === "/theses" && openTheses > 0 && (
                  <span className="num ml-auto text-[11px] text-ink-faint">{openTheses}</span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto space-y-3">
          <Link
            to="/trade"
            className="block rounded-[16px_14px_17px_13px/13px_17px_13px_16px] px-3 py-2.5 text-[15px] text-ink-soft transition hover:bg-sunken hover:text-ink"
          >
            Trade
            <span className="ml-2 font-hand text-[13px] text-ink-faint">soon</span>
          </Link>
          <Link
            to="/settings"
            className={cn(
              "flex items-center gap-3 rounded-[16px_14px_17px_13px/13px_17px_13px_16px] px-3 py-2.5 text-[15px] transition",
              path.startsWith("/settings")
                ? "bg-accent-soft font-medium text-ink"
                : "text-ink-soft hover:bg-sunken hover:text-ink",
            )}
          >
            <SettingsIcon className="h-[18px] w-[18px]" strokeWidth={1.9} />
            Settings
          </Link>
        </div>
      </aside>

      {/* header */}
      <header className="sticky top-0 z-20 border-b border-stroke bg-paper/85 backdrop-blur-xl lg:pl-[248px]">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3 md:px-8">
          <Link to="/" className="lg:hidden">
            <Mark className="h-7 w-7 text-accent" />
          </Link>
          <div className="min-w-0 flex-1">
            {title && (
              <h1 className="truncate text-[17px] font-semibold leading-tight">{title}</h1>
            )}
            {subtitle && <p className="truncate text-[13px] text-ink-faint">{subtitle}</p>}
          </div>
          {action}
          <WalletChip />
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 pb-32 pt-5 md:px-8 lg:pb-16 lg:pl-[280px] lg:pr-8">
        {children}
      </main>

      {/* mobile tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-stroke bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-md items-end justify-between px-4 py-2">
          {NAV.slice(0, 2).map((item) => (
            <TabLink key={item.to} {...item} path={path} />
          ))}
          <Link
            to="/journal"
            search={{ compose: true }}
            className="doodle-pill -mt-6 grid h-14 w-14 place-items-center border-2 border-ink bg-ink text-paper shadow-lg"
            aria-label="New entry"
          >
            <Plus className="h-6 w-6" strokeWidth={2.2} />
          </Link>
          {NAV.slice(3).map((item) => (
            <TabLink key={item.to} {...item} path={path} />
          ))}
        </div>
      </nav>
    </div>
  );
}

function TabLink({
  to,
  label,
  icon: Icon,
  path,
}: {
  to: string;
  label: string;
  icon: typeof Home;
  path: string;
}) {
  const active = to === "/" ? path === "/" : path.startsWith(to);
  return (
    <Link
      to={to}
      className={cn(
        "flex w-16 flex-col items-center gap-1 py-1 text-[11px] transition",
        active ? "text-ink" : "text-ink-faint",
      )}
    >
      <Icon className="h-[21px] w-[21px]" strokeWidth={active ? 2.2 : 1.8} />
      {label}
    </Link>
  );
}
