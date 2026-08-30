import { createLazyFileRoute, type LazyRouteOptions } from "@tanstack/react-router";

import { Shell } from "@/components/pot/Shell";

// Lazy route: no trading code exists yet, so the placeholder page (and its
// Shell import) leave the shared entry chunk. The LazyRouteOptions type in
// this router release only models component props; the runtime merges every
// lazy option when the chunk loads, so head behaves as on the eager route.
export const Route = createLazyFileRoute("/trade")(
  {
    head: () => ({
      meta: [
        { title: "Trade · Proof of Thesis" },
        {
          name: "description",
          content: "Execution comes after the journal. Here's what's planned for trading.",
        },
        { property: "og:title", content: "Trade · Proof of Thesis" },
        { property: "og:description", content: "Execution comes after the journal." },
      ],
    }),
    component: TradePage,
  } as LazyRouteOptions,
);

function TradePage() {
  return (
    <Shell title="Trade" subtitle="next phase">
      <section className="doodle-card animate-rise p-4">
        <p className="font-hand text-2xl text-accent">Journal first, execution second.</p>
        <p className="mt-2 max-w-md text-[15px] text-ink-soft">
          Trading is deliberately not wired up yet. When it lands, an order will start from a
          thesis. You'll pick what you believe, then the size, and the entry writes itself.
        </p>
      </section>
    </Shell>
  );
}
