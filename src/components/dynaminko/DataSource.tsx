import { ChevronRight, RefreshCw } from "lucide-react";

/** Quiet provenance footer: where a panel's numbers came from and how old. */
export function DataSource({
  source,
  at,
  status = "ready",
  onRefresh,
  note,
}: {
  source: string;
  at?: number | null;
  status?: "idle" | "loading" | "ready" | "error";
  onRefresh?: () => void;
  note?: string;
}) {
  const age = (() => {
    if (!at) return null;
    const s = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.round(s / 60);
    return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
  })();

  const tone =
    status === "error" ? "text-rose" : status === "loading" ? "text-lavender" : "text-ash";

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-1.5 border-t border-hairline font-mono text-[9px] uppercase tracking-[0.18em]">
      <span className={tone}>
        {source}
        {age ? ` · ${age}` : ""}
        {status === "loading" ? " · syncing" : ""}
        {status === "error" ? " · unreachable" : ""}
      </span>
      <span className="flex items-center gap-2 text-ash/70">
        {note && <span className="normal-case tracking-normal">{note}</span>}
        {onRefresh && (
          <button
            onClick={onRefresh}
            aria-label="Refresh data"
            className="hover:text-lavender focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-lavender p-0.5"
          >
            <RefreshCw className={"size-3 " + (status === "loading" ? "animate-spin" : "")} />
          </button>
        )}
      </span>
    </div>
  );
}

/** Single reusable empty state so no panel ever renders a blank void. */
export function EmptyState({
  label,
  hint,
  action,
  onAction,
}: {
  label: string;
  hint?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="border border-dashed border-hairline p-8 text-center">
      <p className="text-sm text-paper mb-1">{label}</p>
      {hint && (
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ash/70">{hint}</p>
      )}
      {action && onAction && (
        <button
          onClick={onAction}
          className="mt-4 inline-flex items-center gap-1 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest border border-hairline text-lavender hover:bg-lavender/[0.08] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-lavender"
        >
          {action}
          <ChevronRight className="size-3" />
        </button>
      )}
    </div>
  );
}

/** Hairline skeleton rows for loading panels. */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="divide-y divide-hairline">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="size-1.5 bg-hairline" />
          <div className="h-2 flex-1 bg-hairline/70 animate-pulse" style={{ maxWidth: `${70 - i * 8}%` }} />
          <div className="h-2 w-12 bg-hairline/70 animate-pulse" />
        </div>
      ))}
    </div>
  );
}
