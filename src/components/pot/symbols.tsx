// Shared symbol primitives: one glyph per meaning across every tab.
// Convention: lucide icons render h-4 w-4 stroke 1.7 in content and 18px in
// the shell nav; money always goes through lib/format usd(); these components
// own every standalone glyph so two tabs can't drift apart again.

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** External-link marker for the end of a link label. Decorative: the parent
    anchor carries its own accessible name. */
export function Ext({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("text-ink-faint", className)}>
      ↗
    </span>
  );
}

/** The null value mark: unpriced asset, empty slot, not-applicable cell. */
export function NullMark({
  label = "unpriced",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span aria-label={label} className={cn("num text-ink-faint", className)}>
      -
    </span>
  );
}

/** Direction pill for flows: in (gain) / out (loss), word or custom label. */
export function DirPill({
  dir,
  children,
  className,
}: {
  dir: "in" | "out";
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "doodle-pill px-1.5 py-0.5 text-micro",
        dir === "in" ? "text-gain" : "text-loss",
        className,
      )}
    >
      {children ?? dir}
    </span>
  );
}
