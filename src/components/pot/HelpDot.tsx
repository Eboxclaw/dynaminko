import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A small "?" that keeps standing explanatory prose out of the card body.
 * The note renders in a portal with fixed positioning, so a card with
 * `overflow-hidden` or a scrolling rail can never clip or cut it off.
 */
export function HelpDot({ label = "What this means", children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const el = btn.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = 240;
    const height = pop.current?.offsetHeight ?? 140;
    const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
    const below = r.bottom + 6;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, r.top - height - 6) : below;
    setBox({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-stroke text-[10px] leading-none text-ink-faint transition hover:border-ink hover:text-ink"
      >
        ?
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={pop}
            role="tooltip"
            style={{ top: box?.top ?? -9999, left: box?.left ?? -9999, width: 240 }}
            className="fixed z-[60] max-h-[60vh] overflow-y-auto rounded-[3px] border border-stroke bg-paper p-2.5 text-[11px] leading-relaxed text-ink-soft shadow-lg"
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
