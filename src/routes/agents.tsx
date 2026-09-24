import { createFileRoute } from "@tanstack/react-router";

import { agentRailSearch } from "@/lib/chat/agentRail";

// Search validation and metadata must run before the lazy component renders.
// Keeping them eager makes the server HTML and the first client render agree.
export const Route = createFileRoute("/agents")({
  validateSearch: agentRailSearch,
  head: () => ({
    meta: [
      { title: "Assistant · Proof of Thesis" },
      {
        name: "description",
        content:
          "An inline console over your journal: slash commands run deterministic tools first, and the on-device model only speaks when reasoning is actually needed.",
      },
      { property: "og:title", content: "Assistant · Proof of Thesis" },
      {
        property: "og:description",
        content: "Slash commands, real tools, and a local model you control.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});
