// App service worker: makes the app installable, serves the shell offline,
// caches same-origin build assets so repeat and offline visits are fast,
// and lets alerts show notifications in the background.
// Also caches the wllama WASM binary for offline inference.

const CACHE = "pot-v2";
const SHELL = ["/", "/manifest.webmanifest", "/pot-mark.svg"];
const WASM_CACHE = "pot-wasm-v1";
const ASSETS_CACHE = "pot-assets-v1";

// ── install: cache shell and wasm binary ─────────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await caches
        .open(CACHE)
        .then((c) => c.addAll(SHELL))
        .catch(() => undefined);
      // Pre-cache the wllama WASM binary so inference works offline
      await caches
        .open(WASM_CACHE)
        .then((c) => c.addAll(["/wasm/wllama.wasm"]))
        .catch(() => undefined);
    })(),
  );
  self.skipWaiting();
});

// ── activate: clean OUR old caches ────────────────────────────────────
//
// Only "pot-*" caches belong to this worker. wllama keeps downloaded model
// weights in the Cache API under its own names and transformers.js does the
// same for encoders: deleting foreign caches here would silently wipe every
// model the user downloaded on a service worker update.

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("pot-") && k !== CACHE && k !== WASM_CACHE && k !== ASSETS_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// ── fetch strategies ─────────────────────────────────────────────────

function assetUrl(reqUrl) {
  // Build-emitted assets live under /assets with hashed names; Google-hosted
  // fonts use woff2. Same-origin only, so we never adopt third-party URLs.
  return (
    reqUrl.origin === self.location.origin &&
    (/^\/assets\/.+/.test(reqUrl.pathname) || /\.woff2?$/.test(reqUrl.pathname))
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Cache-First for WASM binary
  if (url.pathname.endsWith(".wasm")) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          const copy = res.clone();
          caches
            .open(WASM_CACHE)
            .then((c) => c.put(req, copy))
            .catch(() => undefined);
          return res;
        });
      }),
    );
    return;
  }

  // Build assets (JS/CSS/fonts): cache-first, runtime-filled. The app shell
  // is hashed per build, so a cached chunk is always the build it came
  // from; new deployments simply reference new hashed names.
  if (assetUrl(url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches
                .open(ASSETS_CACHE)
                .then((c) => c.put(req, copy))
                .catch(() => undefined);
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Network-first for navigations so fresh builds land; cache is the
  // offline fallback. Build assets are content-hashed, so a deployment is
  // atomic: the new HTML references new /assets names that are fresh
  // cache-misses (fetched + cached via the branch above), while the
  // previous build's chunks stay intact in ASSETS_CACHE until a version
  // bump prunes them. No partial-cache deployment is possible.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches
            .open(CACHE)
            .then((c) => c.put(req, copy))
            .catch(() => undefined);
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/"))),
    );
    return;
  }
});

// ── notification click → focus or open ───────────────────────────────

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("/alerts");
    }),
  );
});
