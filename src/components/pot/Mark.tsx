import { cn } from "@/lib/utils";

/** Hand-inked mark: a seed/ink drop with a sprouting stroke. */
export function Mark({ className, animate = false }: { className?: string; animate?: boolean }) {
  return (
    <svg viewBox="0 0 48 48" className={cn("h-8 w-8", className)} aria-hidden="true">
      <path
        d="M24 6c-2 6-9 10-9 17a9 9 0 0 0 18 0c0-7-7-11-9-17Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={animate ? "draw-stroke" : undefined}
      />
      <path
        d="M24 32v10M24 38c-4 0-7-2-8-5M24 36c3.5 0 6.5-1.6 7.5-4.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.75"
      />
      <circle cx="21" cy="24" r="2.4" fill="currentColor" opacity="0.9" />
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2 text-ink">
      <Mark className="h-7 w-7 text-accent" />
      {!compact && (
        <span className="leading-none">
          <span className="block text-[15px] font-semibold tracking-tight">Proof of Thesis</span>
          <span className="block font-hand text-[13px] text-ink-faint">your trades, explained</span>
        </span>
      )}
    </span>
  );
}
