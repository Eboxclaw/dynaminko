// Device-bound secret storage.
//
// API keys (cloud endpoints, Jina, Tavily) never sit in plaintext storage.
// They are sealed with AES-GCM under a device key that is generated once and
// persisted as a NON-EXTRACTABLE CryptoKey in IndexedDB: nothing outside this
// origin can read the blobs, and no code path (not even this module) can
// export the key material. Sealed slots live in IndexedDB first, with a
// sealed localStorage mirror for fast sync reads and for webviews where IDB
// is flaky.
//
// Honest threat model, mirrored in the panel copy: this is at-rest protection
// against storage dumps, backups and casual inspection. Code running on the
// page (this app, or an XSS on this origin) can always USE the keys while the
// tab is open; that is true of every in-browser key store.
//
// Slots: "web.jina", "web.tavily", "cloud.<providerId>".

const DB_NAME = "pot-secrets";
const STORE = "slots";
const MIRROR_KEY = "inko.secrets.v1";
/** prefix for sealed payloads; anything unprefixed is legacy plaintext */
const SEALED_PREFIX = "enc1.";

const cache = new Map<string, string>();
let hydrated = false;
const readyCbs: (() => void)[] = [];
/** set once a device key exists; false in environments without WebCrypto */
let cryptoOk = true;

export function onSecretsReady(fn: () => void): () => void {
  if (hydrated) {
    fn();
    return () => {};
  }
  readyCbs.push(fn);
  return () => {
    const i = readyCbs.indexOf(fn);
    if (i >= 0) readyCbs.splice(i, 1);
  };
}

/** Sync read from the boot cache. Null before hydration or for empty slots;
 * hot paths (fetch headers, cloud cfg) must never wait on IDB. */
export function peekSecret(slot: string): string | null {
  return cache.get(slot) ?? null;
}

/** Test and wipe hook: forget every cached slot. Stored blobs are untouched. */
export function clearSecretCache() {
  cache.clear();
}

// ── device key ────────────────────────────────────────────────────────

let deviceKeyPromise: Promise<CryptoKey | null> | null = null;

function idb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readDeviceBytes(db: IDBDatabase): Promise<ArrayBuffer | null> {
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE).objectStore(STORE).get("__device__");
      req.onsuccess = () => resolve((req.result as ArrayBuffer | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * The device key as raw bytes in IndexedDB. A non-extractable CryptoKey was
 * the first choice, but WebKit builds silently fail to structured-clone it
 * into IDB, which rotates the key on every boot and orphans every blob.
 * Raw bytes survive IDB everywhere; the protection story stays the same
 * (origin-bound at-rest encryption, honest about XSS).
 */
async function deviceKey(): Promise<CryptoKey | null> {
  deviceKeyPromise ??= (async () => {
    if (typeof crypto?.subtle === "undefined") {
      cryptoOk = false;
      return null;
    }
    try {
      const db = await idb();
      let bytes = db ? await readDeviceBytes(db) : null;
      if (!bytes) {
        bytes = crypto.getRandomValues(new Uint8Array(32)).buffer;
        if (db) {
          await new Promise<void>((resolve) => {
            try {
              const tx = db.transaction(STORE, "readwrite");
              tx.objectStore(STORE).put(bytes, "__device__");
              tx.oncomplete = () => resolve();
              tx.onerror = () => resolve();
            } catch {
              resolve();
            }
          });
        }
      }
      return await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
        "encrypt",
        "decrypt",
      ]);
    } catch {
      cryptoOk = false;
      return null;
    }
  })();
  return deviceKeyPromise;
}

// ── seal / open ───────────────────────────────────────────────────────

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
  // Size by the DECODED length: sizing by s.length leaves NUL padding on the
  // buffer, which corrupts ciphertext and leaks NULs into decrypted keys
  // (fetch then rejects the authorization header as an invalid value).
  const decoded = atob(s);
  const out = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let i = 0; i < decoded.length; i++) out[i] = decoded.charCodeAt(i);
  return out;
}

export async function seal(plain: string): Promise<string> {
  const key = await deviceKey();
  if (!key) return SEALED_PREFIX + "plain." + b64(new TextEncoder().encode(plain));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(plain);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt);
  return `${SEALED_PREFIX}${b64(iv)}.${b64(new Uint8Array(ct))}`;
}

export async function open(sealed: string): Promise<string | null> {
  if (!sealed.startsWith(SEALED_PREFIX)) return sealed; // legacy plaintext
  const body = sealed.slice(SEALED_PREFIX.length);
  if (body.startsWith("plain.")) {
    try {
      return new TextDecoder().decode(unb64(body.slice(6)));
    } catch {
      return null;
    }
  }
  const key = await deviceKey();
  if (!key) return null;
  const [ivB64, ctB64] = body.split(".");
  if (!ivB64 || !ctB64) return null;
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(ivB64) },
      key,
      unb64(ctB64),
    );
    return new TextDecoder().decode(pt);
  } catch {
    // a different device key (cleared IDB) cannot open old blobs
    return null;
  }
}

// ── slot persistence ─────────────────────────────────────────────────

function readMirror(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(MIRROR_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function writeMirror(slots: Record<string, string>) {
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(slots));
  } catch {
    /* localStorage full or blocked: IDB remains the primary */
  }
}

export async function putSecret(slot: string, value: string): Promise<void> {
  if (!value) return deleteSecret(slot);
  // Sync-first: async bodies run synchronously up to the first await, so
  // sync readers (fetch headers, panel inputs) see the new value at once
  // while sealing and persistence complete in the background.
  cache.set(slot, value);
  const sealed = await seal(value);
  const mirror = readMirror();
  mirror[slot] = sealed;
  writeMirror(mirror);
  const db = await idb();
  if (db) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(sealed, slot);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}

export async function deleteSecret(slot: string): Promise<void> {
  cache.delete(slot);
  const mirror = readMirror();
  delete mirror[slot];
  writeMirror(mirror);
  const db = await idb();
  if (db) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(slot);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}

/**
 * Hydrate the boot cache from IDB (primary) or the localStorage mirror, then
 * migrate legacy plaintext (inko.web-keys, unsealed mirror entries). Safe to
 * call once at boot; every caller re-reads after onSecretsReady fires.
 */
export async function initSecrets(): Promise<void> {
  if (hydrated) return;
  const db = await idb();
  const sealed: Record<string, string> = { ...readMirror() };
  if (db) {
    const fromIdb = await new Promise<Record<string, string>>((resolve) => {
      try {
        const req = db.transaction(STORE).objectStore(STORE).getAll();
        const keys = db.transaction(STORE).objectStore(STORE).getAllKeys();
        req.onsuccess = () => {
          keys.onsuccess = () => {
            const out: Record<string, string> = {};
            (keys.result as IDBValidKey[]).forEach((k, i) => {
              if (k === "__device__") return;
              out[String(k)] = String(req.result[i] ?? "");
            });
            resolve(out);
          };
          keys.onerror = () => resolve({});
        };
        req.onerror = () => resolve({});
      } catch {
        resolve({});
      }
    });
    Object.assign(sealed, fromIdb);
  }
  for (const [slot, blob] of Object.entries(sealed)) {
    const value = await open(blob);
    if (value) {
      cache.set(slot, value);
    } else {
      // Unreadable under this device key (key rotation or corruption):
      // drop the stale blob so the UI shows an empty key instead of
      // pretending one exists. The user re-enters it once.
      await deleteSecret(slot);
    }
  }
  migrateLegacyWebKeys();
  hydrated = true;
  for (const fn of readyCbs.splice(0)) fn();
}

/** inko.web-keys was plaintext localStorage; seal it and remove the plaintext. */
function migrateLegacyWebKeys() {
  try {
    const raw = localStorage.getItem("inko.web-keys");
    if (!raw) return;
    const legacy = JSON.parse(raw) as { jina?: string; tavily?: string };
    for (const [name, value] of Object.entries(legacy)) {
      if (value && !cache.has(`web.${name}`)) void putSecret(`web.${name}`, value);
    }
    localStorage.removeItem("inko.web-keys");
  } catch {
    /* unreadable legacy blob: nothing to migrate */
  }
}
