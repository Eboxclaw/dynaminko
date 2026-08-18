// Minimal service worker: makes the app installable, serves the shell offline
// and lets alerts show notifications when the tab is in the background.
// Also caches wllama WASM binary and GGUF model weights for offline inference.

const CACHE = "pot-v1";
const SHELL = ["/", "/manifest.webmanifest", "/pot-mark.svg"];
const WASM_CACHE = "pot-wasm-v1";

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
            .filter((k) => k.startsWith("pot-") && k !== CACHE && k !== WASM_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// ── fetch strategies ─────────────────────────────────────────────────

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

  // Network-first for navigations so fresh builds land; cache is the fallback.
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
