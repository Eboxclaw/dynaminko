// Venue marks. Real local logos where we have them (see src/lib/logos.ts),
// rendered on a fixed obsidian tile so every mark reads in both themes;
// pure-geometry fallbacks in currentColor for everything else.

import { venueLogo } from "@/lib/logos";
import { cn } from "@/lib/utils";

export function VenueIcon({ id, className }: { id: string; className?: string }) {
  const src = venueLogo(id);
  if (src) {
    return (
      <span
        className={cn(
          "grid shrink-0 place-items-center rounded-[3px] border border-white/15 bg-[#0c0c0d] p-[2px]",
          className ?? "h-4 w-4",
        )}
      >
        <img src={src} alt="" draggable={false} className="h-full w-full object-contain" />
      </span>
    );
  }

  const common = {
    className: className ?? "h-4 w-4",
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (id) {
    case "velodrome":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" />
          <path d="M4.5 5.5 8 12l3.5-6.5" />
        </svg>
      );
    case "inkyswap":
      return (
        <svg {...common}>
          <path d="M8 2c2.5 3 4 5 4 7a4 4 0 1 1-8 0c0-2 1.5-4 4-7Z" />
        </svg>
      );
    case "nado":
      return (
        <svg {...common}>
          <path d="M2.5 4h11M4 8h8M6 12h4" />
        </svg>
      );
    case "hyperliquid":
      return (
        <svg {...common}>
          <path d="M2 9c2-3.5 4-3.5 6 0s4 3.5 6 0" />
          <path d="M2 5.5h12" opacity="0.4" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="3" y="3" width="10" height="10" rx="2" />
        </svg>
      );
  }
}
