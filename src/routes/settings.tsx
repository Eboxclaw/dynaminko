import { createFileRoute } from "@tanstack/react-router";

// Eager route shell: head lives in a non-lazy module so a hard load of
// /settings serves the real title on first paint. The component stays in
// settings.lazy.tsx.
export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings · Proof of Thesis" },
      {
        name: "description",
        content: "Wallets, privacy, on-device assistant and your local data.",
      },
      { property: "og:title", content: "Settings · Proof of Thesis" },
      { property: "og:description", content: "Wallets, privacy and your local data." },
    ],
  }),
});
