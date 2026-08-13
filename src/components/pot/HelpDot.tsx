import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A small "?" that keeps standing explanatory prose out of the card body.
 * Notes live one tap away instead of sitting under every list.
 */
export function HelpDot({ label = "What this means", children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid h-5 w-5 place-items-center rounded-full border border-stroke text-[10px] leading-none text-ink-faint transition hover:border-ink hover:text-ink"
      >
        ?
      </button>
      {open && (
        <span className="absolute right-0 top-6 z-30 w-60 rounded-[3px] border border-stroke bg-paper p-2.5 text-[11px] leading-relaxed text-ink-soft shadow-lg">
          {children}
        </span>
      )}
    </span>
  );
}
