// Dynaminko dossier card — one of only three signature surfaces (also on
// thesis entries and trade confirmations). Do NOT reuse this style on
// ordinary panels; the restraint is what sells the premium feel.

import type { ReactNode } from "react";

export function DossierCard({
  label,
  index,
  children,
  className = "",
  status,
}: {
  label: string;      // e.g. "SECTOR"
  index: string;      // e.g. "DEFENSE" or "003"
  status?: { tone: "mint" | "lavender" | "rose" | "ash"; text: string };
  children: ReactNode;
  className?: string;
}) {
  const toneColor =
    status?.tone === "mint"
      ? "text-mint"
      : status?.tone === "lavender"
        ? "text-lavender"
        : status?.tone === "rose"
          ? "text-rose"
          : "text-ash";
  return (
    <div className={"dyn-dossier " + className}>
      <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-hairline">
        <div className="font-mono text-[10px] tracking-[0.14em] text-ash uppercase">
          {label} <span className="text-paper">// {index}</span>
        </div>
        {status && (
          <div className={"font-mono text-[10px] uppercase tracking-[0.14em] " + toneColor}>
            {status.text}
          </div>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}
