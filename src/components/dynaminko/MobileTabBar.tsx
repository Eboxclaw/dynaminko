import { NAV, type ViewId } from "./Sidebar";
import { Zap } from "lucide-react";

export function MobileTabBar({
  active,
  onSelect,
  thesesBadge,
  onQuickCapture,
}: {
  active: ViewId;
  onSelect: (id: ViewId) => void;
  thesesBadge?: number;
  onQuickCapture: () => void;
}) {
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-hairline bg-obsidian/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
      <div className="grid grid-cols-7 items-end">
        {NAV.slice(0, 3).map((n) => (
          <Tab key={n.id} item={n} active={active} onSelect={onSelect} badge={n.id === "theses" ? thesesBadge : undefined} />
        ))}
        <div className="col-span-1 flex justify-center -mt-4">
          <button
            onClick={onQuickCapture}
            aria-label="Quick capture"
            className="size-12 grid place-items-center border border-lavender bg-onyx text-lavender shadow-[0_0_20px_-4px_rgba(182,165,240,0.6)]"
            style={{ clipPath: "polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)" }}
          >
            <Zap className="size-5" strokeWidth={1.5} />
          </button>
        </div>
        {NAV.slice(3).map((n) => (
          <Tab key={n.id} item={n} active={active} onSelect={onSelect} badge={n.id === "theses" ? thesesBadge : undefined} />
        ))}
      </div>
    </nav>
  );
}

function Tab({
  item,
  active,
  onSelect,
  badge,
}: {
  item: (typeof NAV)[number];
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
      <span className="font-mono text-[9px] uppercase tracking-widest">{item.label.split(" ")[0]}</span>
      {badge && badge > 0 && (
        <span className="absolute top-1 right-3 font-mono text-[9px] text-mint tabular-nums">
          {badge}
        </span>
      )}
    </button>
  );
}
