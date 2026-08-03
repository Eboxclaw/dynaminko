import { useEffect, useState } from "react";
import { PRIMARY_NAV, SECONDARY_NAV, type ViewId } from "./Sidebar";
import { MoreHorizontal, Zap, X } from "lucide-react";

export function MobileTabBar({
  active,
  onSelect,
  journalBadge,
  onQuickCapture,
}: {
  active: ViewId;
  onSelect: (id: ViewId) => void;
  journalBadge?: number;
  onQuickCapture: () => void;
}) {
  const [more, setMore] = useState(false);
  const primary = PRIMARY_NAV;
  const overflow = SECONDARY_NAV;

  // Close the sheet whenever the view changes.
  useEffect(() => {
    setMore(false);
  }, [active]);

  return (
    <>
      {more && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-onyx/80 backdrop-blur-sm"
          onClick={() => setMore(false)}
        >
          <div
            className="absolute bottom-[calc(5.75rem+env(safe-area-inset-bottom))] inset-x-0 border-t border-hairline bg-obsidian p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ash">
                More // Sections
              </span>
              <button onClick={() => setMore(false)} aria-label="Close" className="text-ash">
                <X className="size-4" strokeWidth={1.5} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {overflow.map((n) => {
                const Icon = n.icon;
                const isActive = active === n.id;
                return (
                  <button
                    key={n.id}
                    onClick={() => onSelect(n.id)}
                    className={
                      "flex items-center gap-2.5 border border-hairline px-3 h-12 font-mono text-[11px] uppercase tracking-[0.12em] " +
                      (isActive ? "text-lavender border-lavender/40" : "text-ash")
                    }
                  >
                    <Icon className="size-4 shrink-0" strokeWidth={1.5} />
                    <span className="truncate">{n.label}</span>
                    {n.soon && (
                      <span className="ml-auto px-1 border border-hairline text-[8px] text-ash">
                        SOON
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-hairline bg-obsidian/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-6 items-end">
          {primary.slice(0, 2).map((n) => (
            <Tab
              key={n.id}
              item={n}
              active={active}
              onSelect={onSelect}
              badge={n.id === "journal" ? journalBadge : undefined}
            />
          ))}
          <div className="col-span-2 flex justify-center -mt-4">
            <button
              onClick={onQuickCapture}
              aria-label="Quick capture"
              className="size-12 grid place-items-center border border-lavender bg-onyx text-lavender shadow-[0_0_20px_-4px_rgba(182,165,240,0.6)] active:scale-95 transition-transform"
              style={{ clipPath: "polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)" }}
            >
              <Zap className="size-5" strokeWidth={1.5} />
            </button>
          </div>
          {primary.slice(2).map((n) => (
            <Tab
              key={n.id}
              item={n}
              active={active}
              onSelect={onSelect}
              badge={n.id === "journal" ? journalBadge : undefined}
            />
          ))}
        </div>
        <div className="border-t border-hairline">
          <button
            onClick={() => setMore((v) => !v)}
            className={
              "w-full h-9 flex items-center justify-center gap-2 font-mono text-[9px] uppercase tracking-[0.22em] " +
              (overflow.some((n) => n.id === active) ? "text-lavender" : "text-ash")
            }
          >
            <MoreHorizontal className="size-3.5" strokeWidth={1.5} />
            {more ? "Close" : "More"}
          </button>
        </div>
      </nav>
    </>
  );
}

function Tab({
  item,
  active,
  onSelect,
  badge,
}: {
  item: (typeof PRIMARY_NAV)[number];
  active: ViewId;
  onSelect: (id: ViewId) => void;
  badge?: number;
}) {
  const isActive = active === item.id;
  const Icon = item.icon;
  return (
    <button
      onClick={() => onSelect(item.id)}
      className={
        "relative h-14 flex flex-col items-center justify-center gap-0.5 " +
        (isActive ? "text-lavender" : "text-ash")
      }
    >
      <Icon className="size-4" strokeWidth={1.5} />
      <span className="font-mono text-[9px] uppercase tracking-widest">{item.short}</span>
      {badge && badge > 0 && (
        <span className="absolute top-1 right-3 font-mono text-[9px] text-mint tabular-nums">
          {badge}
        </span>
      )}
    </button>
  );
}
