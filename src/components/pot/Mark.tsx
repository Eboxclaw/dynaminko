import { cn } from "@/lib/utils";

/** Stamped seal: a faceted P/O monogram struck into the page. */
export function Mark({ className }: { className?: string; animate?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-7 w-7", className)} aria-hidden="true">
      <rect
        x="1.5"
        y="1.5"
        width="29"
        height="29"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M1.5 8.5 8.5 1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M23.5 30.5 30.5 23.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="16" cy="16" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M16 9v14" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5 text-ink">
      <Mark className="h-7 w-7" />
      {!compact && (
        <span className="leading-none">
          <span className="block text-[14px] font-semibold tracking-tight">Proof of Thesis</span>
          <span className="eyebrow mt-1 block">Ink · local first</span>
        </span>
      )}
    </span>
  );
}
