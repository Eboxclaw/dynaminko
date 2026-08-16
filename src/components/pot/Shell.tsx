import { Link, useRouterState } from "@tanstack/react-router";
import {
  BellRing,
  Bot,
  Gauge,
  LayoutGrid,
  Moon,
  NotebookPen,
  Settings as SettingsIcon,
  Sun,
  Wallet,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { useAlerts } from "@/hooks/useAlerts";
import { useDoc } from "@/hooks/useDoc";
import { patchSettings } from "@/lib/store";
import { cn } from "@/lib/utils";

import { Mark, Wordmark } from "./Mark";
import { WalletChip } from "./WalletChip";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutGrid },
  { to: "/portfolio", label: "Baskets", icon: Wallet },
  { to: "/journal", label: "Theses", icon: NotebookPen },
  { to: "/pot", label: "POT Index", icon: Gauge },
  { to: "/alerts", label: "Alerts", icon: BellRing },
  { to: "/agents", label: "Agents", icon: Bot },
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
      className="doodle-pill grid h-8 w-8 place-items-center text-ink-faint hover:border-ink hover:text-ink"
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
  const inbox = doc.signals.filter((s) => s.state === "inbox").length;
  useAlerts();

  // register the service worker once: installability + background notifications
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  return (
    <div className="min-h-dvh bg-paper text-ink">
      {/* desktop rail — icons, expands on hover */}
      <aside className="group fixed inset-y-0 left-0 z-30 hidden w-[68px] flex-col border-r border-stroke bg-surface py-4 transition-[width] duration-200 hover:w-[212px] lg:flex">
        <Link to="/" className="mb-6 flex h-8 items-center overflow-hidden px-[21px]">
          <Mark className="h-[26px] w-[26px] shrink-0" />
          <span className="ml-3 whitespace-nowrap text-[14px] font-semibold tracking-tight opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            Proof of Thesis
          </span>
        </Link>
        <nav className="flex flex-col gap-0.5 px-2">
          {NAV.map((item) => {
            const active = item.to === "/" ? path === "/" : path.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "relative flex h-10 items-center overflow-hidden rounded-[2px] px-[13px] transition",
                  active ? "bg-sunken text-ink" : "text-ink-faint hover:text-ink",
                )}
              >
                {active && <span className="absolute inset-y-1 left-0 w-[2px] bg-ink" />}
                <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.7} />
                <span className="ml-3 whitespace-nowrap text-[13px] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                  {item.label}
                </span>
                {item.to === "/journal" && inbox > 0 && (
                  <span className="num absolute right-1.5 top-1 rounded-[999px] bg-sunken px-1.5 text-[10px] leading-4 text-ink-soft tabular-nums group-hover:static group-hover:ml-auto">
                    {inbox > 999 ? "999+" : inbox}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto px-2">
          <Link
            to="/settings"
            className={cn(
              "flex h-10 items-center overflow-hidden rounded-[2px] px-[13px] transition",
              path.startsWith("/settings") ? "bg-sunken text-ink" : "text-ink-faint hover:text-ink",
            )}
          >
            <SettingsIcon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.7} />
            <span className="ml-3 whitespace-nowrap text-[13px] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              Settings
            </span>
          </Link>
        </div>
      </aside>

      <header className="sticky top-0 z-20 border-b border-stroke bg-paper/90 backdrop-blur-xl lg:pl-[68px]">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 md:px-8">
          <Link to="/" className="lg:hidden">
            <Mark className="h-6 w-6" />
          </Link>
          <div className="min-w-0 flex-1">
            {title && <h1 className="truncate text-[15px] font-semibold leading-tight">{title}</h1>}
            {subtitle && <p className="eyebrow mt-1 truncate">{subtitle}</p>}
          </div>
          {action}
          <WalletChip />
          <ThemeToggle />
        </div>
      </header>

      {/* The rail offset lives on the outer element so the cards stay centred
          inside the remaining width instead of drifting right of centre. */}
      <main className="pb-28 pt-5 lg:pb-14 lg:pl-[68px]">
        <div className="mx-auto w-full max-w-5xl px-4 md:px-8">{children}</div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-stroke bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-md items-stretch justify-between px-2 py-1.5">
          {NAV.map((item) => {
            const active = item.to === "/" ? path === "/" : path.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "relative flex flex-1 flex-col items-center gap-1 py-1.5 transition",
                  active ? "text-ink" : "text-ink-faint",
                )}
              >
                <item.icon className="h-[19px] w-[19px]" strokeWidth={active ? 2 : 1.6} />
                <span className="eyebrow text-[9px]">{item.label}</span>
                {item.to === "/journal" && inbox > 0 && (
                  <span className="absolute right-3 top-1 h-1.5 w-1.5 rounded-full bg-ink" />
                )}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export function Panel({
  eyebrow,
  title,
  action,
  children,
  className,
  delay = 0,
}: {
  eyebrow?: string;
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <section
      className={cn("card animate-rise tick min-w-0", className)}
      style={{ animationDelay: `${delay}ms` }}
    >
      {(eyebrow || title || action) && (
        <header className="flex items-center gap-3 border-b border-stroke px-4 py-2.5">
          <div className="min-w-0 flex-1">
            {eyebrow && <p className="eyebrow truncate">{eyebrow}</p>}

            {title && <h2 className="mt-1 text-[14px] font-semibold">{title}</h2>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
