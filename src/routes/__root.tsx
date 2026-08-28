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
import { Analytics } from "@vercel/analytics/react";
import { useStorage } from "../hooks/useStorage";

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

// Pre-style fallback for the window before styles.css applies (or where it
// fails outright): paper/ink defaults for both themes and a cap on the brand
// marks so a failed stylesheet renders a readable page instead of raw HTML
// with a screen-filling logo. The block is UNLAYERED, which would beat
// Tailwind's layered rules forever, so RootComponent removes it at boot once
// the real stylesheet is confirmed alive. Token values mirror :root / .dark
// in src/styles.css.
const BOOT_BASE_CSS = `html,body{margin:0;padding:0;background:#f6f5f3;color:#101012;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}html.dark,html.dark body{background:#0a0a0b;color:#f3f2f0}aside svg,header svg{max-height:32px;width:auto}a{color:inherit;text-decoration:none}`;

/** True when at least one same-origin stylesheet parsed real rules (the
 * Google-fonts sheet is cross-origin and unreadable, hence the try/catch).
 * Decides whether the unlayered boot fallback can safely step aside. */
function realStylesheetAlive(): boolean {
  for (const sheet of document.styleSheets) {
    try {
      if (sheet.cssRules.length > 4) return true;
    } catch {
      /* cross-origin sheet: not ours */
    }
  }
  return false;
}

// Boot watchdog: if the app has not hydrated 8s after the shell arrives,
// say so instead of leaving a silent, apparently-dead page. The notice is
// self-styled so it works even with the stylesheet gone, and is only ever
// injected on the failure path (nothing for hydration to reconcile when
// boot succeeds). Retry reloads; a late boot removes the card via the
// __potBooted flag set in RootComponent.
const BOOT_WATCHDOG_SCRIPT = `(function(){
if(window.__potWatchdog)return;window.__potWatchdog=true;
function reveal(){
if(window.__potBooted)return;
if(document.getElementById("pot-boot-notice"))return;
var dark=false;try{dark=document.documentElement.classList.contains("dark")}catch(e){}
var line="13px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif";
var d=document.createElement("div");d.id="pot-boot-notice";
d.style.cssText="position:fixed;left:16px;right:16px;bottom:16px;margin:0 auto;max-width:440px;z-index:2147483000;display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 14px;border-radius:8px;border:1px solid "+(dark?"#26262a":"#dedcd7")+";background:"+(dark?"#131315":"#fdfdfc")+";color:"+(dark?"#f3f2f0":"#101012")+";font:"+line+";box-shadow:0 6px 20px rgba(0,0,0,.12)";
var t=document.createElement("div");
t.innerHTML="<strong>Still loading.</strong> The app is taking longer than usual. Your data stays in this browser.";
var b=document.createElement("button");b.textContent="Retry";
b.style.cssText="flex:none;cursor:pointer;padding:6px 14px;border-radius:999px;border:0;background:"+(dark?"#f3f2f0":"#101012")+";color:"+(dark?"#0a0a0b":"#f6f5f3")+";font:600 12px system-ui,sans-serif";
b.onclick=function(){location.reload()};
d.appendChild(t);d.appendChild(b);
(document.body||document.documentElement).appendChild(d);
}
window.__potShowBootNotice=reveal;
setTimeout(reveal,8000);
})();`;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#F4F3F0" },
      { title: "Proof of Thesis, an assisted journal for your trades" },
      {
        name: "description",
        content:
          "Proof of Thesis reads your wallet, builds your portfolio and helps you write down why you traded. Local-first, on-device AI, no accounts.",
      },
      { name: "author", content: "INKO" },
      { property: "og:title", content: "Proof of Thesis, an assisted journal for your trades" },
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
      { rel: "icon", type: "image/png", sizes: "64x64", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/pot-icon-192.png" },

      { rel: "preconnect", href: "https://fonts.googleapis.com", crossOrigin: "anonymous" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        // crossorigin makes the request CORS-mode: without it COEP
        // require-corp (needed for SharedArrayBuffer) blocks Google Fonts.
        crossOrigin: "anonymous",
        href: "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Caveat:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap",
      },
    ],
    scripts: [{ children: THEME_SCRIPT }, { children: BOOT_WATCHDOG_SCRIPT }],
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
        <style id="pot-boot-base" dangerouslySetInnerHTML={{ __html: BOOT_BASE_CSS }} />
        <HeadContent />
      </head>
      <body>
        <noscript>
          <div
            style={{
              margin: 16,
              padding: "12px 14px",
              borderRadius: 8,
              border: "1px solid #dedcd7",
              background: "#fdfdfc",
              color: "#101012",
              font: "13px/1.5 system-ui, sans-serif",
            }}
          >
            This app needs JavaScript. Everything is stored only in this browser, and nothing loads
            without it.
          </div>
        </noscript>
        {children}
        <Scripts />
        <Analytics />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useStorage();
  useEffect(() => {
    // Boot complete: disarm the watchdog and clear its notice if it fired.
    (window as unknown as { __potBooted?: boolean }).__potBooted = true;
    document.getElementById("pot-boot-notice")?.remove();
    // Step the pre-style fallback aside only when the real stylesheet is
    // alive; if CSS is genuinely gone the fallback keeps the page readable.
    if (realStylesheetAlive()) document.getElementById("pot-boot-base")?.remove();
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster position="top-center" toastOptions={{ className: "doodle-card" }} />
    </QueryClientProvider>
  );
}
