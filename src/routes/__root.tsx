import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-onyx px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-mono text-paper">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-paper">Signal not found</h2>
        <p className="mt-2 text-sm text-ash">
          The requested resource is off-grid or has been redacted.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center border border-lavender px-4 py-2 text-xs font-mono uppercase tracking-widest text-lavender hover:bg-lavender hover:text-onyx"
          >
            Return to terminal
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-onyx px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-paper">Terminal fault</h1>
        <p className="mt-2 text-sm text-ash">
          A subsystem failed to resolve. Retry or return to base.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="border border-lavender px-4 py-2 text-xs font-mono uppercase tracking-widest text-lavender hover:bg-lavender hover:text-onyx"
          >
            Retry
          </button>
          <a
            href="/"
            className="border border-hairline px-4 py-2 text-xs font-mono uppercase tracking-widest text-paper hover:border-lavender"
          >
            Return
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#0A0A0C" },
      { title: "Proof of Thesis, by INKO — Thesis-first trading journal" },
      {
        name: "description",
        content:
          "POT is a thesis-first trading journal and execution assistant. Track a wallet, reconcile every trade with a reason, and score conviction against execution.",
      },
      { name: "author", content: "INKO" },
      { property: "og:title", content: "Proof of Thesis, by INKO — Thesis-first trading journal" },
      {
        property: "og:description",
        content:
          "POT is a thesis-first trading journal and execution assistant. Track a wallet, reconcile every trade with a reason, and score conviction against execution.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Proof of Thesis, by INKO" },
      { name: "twitter:description", content: "Thesis-first trading journal and execution assistant." },

      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/357627a2-d211-4797-bf66-5c4190a12ffb/id-preview-57c5ec31--ea035cf9-2bcb-4a23-94a6-03dc8b529c01.lovable.app-1784994420551.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/357627a2-d211-4797-bf66-5c4190a12ffb/id-preview-57c5ec31--ea035cf9-2bcb-4a23-94a6-03dc8b529c01.lovable.app-1784994420551.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", type: "image/svg+xml", href: "/dynaminko.svg" },
      { rel: "apple-touch-icon", href: "/dynaminko-logo.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
