import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/theses")({
  beforeLoad: () => {
    throw redirect({
      to: "/journal",
      search: { tab: "theses" as const, filter: "all", venue: "all" as const },
    });
  },
});
