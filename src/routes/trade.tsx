import { createFileRoute } from "@tanstack/react-router";

// Eager route shell: head and search validation live in a non-lazy module so
// a hard load of /trade serves the real title on first paint. The component
// stays in trade.lazy.tsx; the router merges the two definitions.
export const Route = createFileRoute("/trade")({
  head: () => ({
    meta: [
      { title: "Trading · Proof of Thesis" },
      {
        name: "description",
        content: "Light per-venue trading surface: positions, activity and live marks.",
      },
      { property: "og:title", content: "Trading · Proof of Thesis" },
      { property: "og:description", content: "Light per-venue trading surface." },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => {
    const venue = search.venue === "nado" ? "nado" : "hyperliquid";
    const section = ["trade", "swap", "positions", "activity", "market"].includes(
      String(search.section),
    )
      ? (search.section as "trade" | "swap" | "positions" | "activity" | "market")
      : ("trade" as "trade" | "swap" | "positions" | "activity" | "market");
    return { venue, section } as { venue: "hyperliquid" | "nado"; section: typeof section };
  },
});
