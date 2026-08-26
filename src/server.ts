import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { statsEndpoint } from "./lib/stats/server";
import { webSearchProxy, webReadProxy, webImageProxy } from "./lib/tools/web";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // Same-origin web search proxy: the browser cannot fetch DuckDuckGo's
    // HTML directly (no CORS headers), but the worker can. Runs before SSR;
    // every other path is untouched.
    const url = new URL(request.url);
    if (url.pathname === "/api/web-search") {
      return webSearchProxy(url, request);
    }
    // Page reader with its own SSRF-guarded handler: same-origin so the
    // browser's CORS policy never blocks the agent from visiting a page.
    if (url.pathname === "/api/web-read") {
      return webReadProxy(url, request);
    }
    // Same-origin image proxy: under COEP require-corp, cross-origin images
    // are blocked from canvas read operations. Proxying them through our own
    // origin avoids the restriction while keeping the SSRF guard.
    if (url.pathname === "/api/web-image") {
      return webImageProxy(url, request);
    }
    if (url.pathname === "/api/stats") {
      return statsEndpoint(request);
    }
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);

      // Inject COOP/COEP headers for SharedArrayBuffer (multi-thread WASM).
      // These are needed by wllama for pthreads support in inference workers.
      const headers = new Headers(response.headers);
      if (!headers.has("Cross-Origin-Opener-Policy")) {
        headers.set("Cross-Origin-Opener-Policy", "same-origin");
      }
      if (!headers.has("Cross-Origin-Embedder-Policy")) {
        headers.set("Cross-Origin-Embedder-Policy", "require-corp");
      }

      const enriched = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
      return await normalizeCatastrophicSsrResponse(enriched);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
