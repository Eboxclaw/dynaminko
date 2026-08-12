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
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="doodle-card max-w-md p-8 text-center">
        <p className="font-hand text-6xl text-accent">404</p>
        <h2 className="mt-3 text-lg font-semibold text-ink">This page never happened</h2>
        <p className="mt-2 text-sm text-ink-soft">
          No entry, no trade, no thesis lives at this address.
        </p>
        <Link
          to="/"
          className="doodle-pill mt-6 inline-flex items-center px-5 py-2 text-sm font-medium text-ink hover:bg-accent-soft"
        >
          Back to the journal
        </Link>
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
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="doodle-card max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold text-ink">Something smudged</h1>
        <p className="mt-2 text-sm text-ink-soft">
          A part of the page failed to draw. Your journal is stored locally and is safe.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="doodle-pill bg-ink px-5 py-2 text-sm font-medium text-paper"
          >
            Retry
          </button>
          <a href="/" className="doodle-pill px-5 py-2 text-sm font-medium text-ink">
            Return
          </a>
        </div>
      </div>
    </div>
  );
}

const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("pot.theme");if(t==="dark"){document.documentElement.classList.add("dark")}}catch(e){}})();`;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#F4F3F0" },
      { title: "Proof of Thesis — an assisted journal for your trades" },
      {
        name: "description",
        content:
          "Proof of Thesis reads your wallet, builds your portfolio and helps you write down why you traded. Local-first, on-device AI, no accounts.",
      },
      { name: "author", content: "INKO" },
      { property: "og:title", content: "Proof of Thesis — an assisted journal for your trades" },
      {
        property: "og:description",
        content:
          "Read your wallet, build your portfolio, and reconcile every trade with the reason behind it.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", type: "image/svg+xml", href: "/pot-mark.svg" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Caveat:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap",
      },
    ],
    scripts: [{ children: THEME_SCRIPT }],
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
      <Toaster position="top-center" toastOptions={{ className: "doodle-card" }} />
    </QueryClientProvider>
  );
}
