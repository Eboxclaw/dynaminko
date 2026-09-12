import { createFileRoute } from "@tanstack/react-router";

// Eager route shell: head lives in a non-lazy module so a hard load of /earn
// serves the real title on first paint. The component stays in earn.lazy.tsx.
export const Route = createFileRoute("/earn")({
  head: () => ({
    meta: [
      { title: "Earn · Proof of Thesis" },
      {
        name: "description",
        content:
          "Metrom incentive campaigns on Ink: live and upcoming pools, your claimable rewards and campaign leaderboards.",
      },
      { property: "og:title", content: "Earn · Proof of Thesis" },
      { property: "og:description", content: "Metrom campaigns and claimable rewards on Ink." },
    ],
  }),
});
