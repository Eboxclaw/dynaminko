import { useEffect } from "react";
import { X, Terminal, ScrollText, LineChart } from "lucide-react";
import type { ViewId } from "./Sidebar";

// Compact command-style panel — three actions, no more.
export function QuickCapture({
  open,
  onClose,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (v: ViewId, intent?: "new-thesis" | "ask") => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const actions = [
    { id: "ask", label: "Ask AI Terminal", hint: "/", icon: Terminal, go: () => onNavigate("terminal", "ask") },
    { id: "thesis", label: "New Thesis", hint: "T", icon: ScrollText, go: () => onNavigate("theses", "new-thesis") },
    { id: "markets", label: "View Markets", hint: "M", icon: LineChart, go: () => onNavigate("markets") },
  ] as const;

  return (
    <div
      className="fixed inset-0 z-50 bg-onyx/80 backdrop-blur-sm flex items-start justify-center pt-24 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-obsidian border border-hairline dyn-fade-in"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-hairline">
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-ash">
            QUICK CAPTURE // <span className="text-paper">ROUTE</span>
          </span>
          <button onClick={onClose} className="text-ash hover:text-paper">
            <X className="size-4" />
          </button>
        </div>
        <div>
          {actions.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                a.go();
                onClose();
              }}
              className="w-full flex items-center gap-4 px-4 py-3 border-b border-hairline last:border-b-0 hover:bg-lavender/[0.05] text-left group"
            >
              <a.icon className="size-4 text-ash group-hover:text-lavender" strokeWidth={1.5} />
              <span className="flex-1 text-paper font-sans">{a.label}</span>
              <kbd className="font-mono text-[10px] text-ash border border-hairline px-1.5 py-0.5">
                {a.hint}
              </kbd>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
