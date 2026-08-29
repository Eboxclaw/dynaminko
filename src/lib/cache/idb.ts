// IndexedDB for the app's own caches. v2 adds real object stores next to the
// v1 key/value store the older caches still use:
//   trades  keyed rows (keyPath id) with wallet/symbol/ts indexes: the
//           persistent transfer ledger the trade feed reads from
//   actions keyed venue actions (keyPath id) with wallet/venue/ts indexes:
//           the inbox's fallback when a venue read fails
//   meta    sync bookmarks (last block per wallet, last full-scan time)
// One shared connection: every call used to open its own.

const DB_NAME = "dynaminko";
const VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexeddb unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("trades")) {
        const store = db.createObjectStore("trades", { keyPath: "id" });
        store.createIndex("wallet", "wallet");
        store.createIndex("symbol", "symbol");
        store.createIndex("ts", "ts");
      }
      if (!db.objectStoreNames.contains("actions")) {
        const store = db.createObjectStore("actions", { keyPath: "id" });
        store.createIndex("wallet", "wallet");
        store.createIndex("venue", "venue");
        store.createIndex("ts", "ts");
      }
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    req.onsuccess = () => {
      const db = req.result;
      // Drop the cached connection when the browser closes or upgrades it, so
      // a later call reopens instead of handing out a dead handle.
      db.onclose = () => {
        dbPromise = null;
      };
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("indexeddb open failed"));
    };
  });
  return dbPromise;
}

// ── v1 key/value store (snapshots, venue reports, quotes, offloads) ────────

export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction("kv", "readonly");
      const req = tx.objectStore("kv").get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* cache is best-effort */
  }
}

export async function idbDelete(key: string): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* cache is best-effort */
  }
}

// ── v2 keyed stores (trades, actions) + meta ───────────────────────────────

type KeyedStore = "trades" | "actions";

/** Put keyed rows in one transaction. Best-effort: a failed cache write
 * resolves instead of throwing, and the caller reports what it filed. */
export async function storePut(name: KeyedStore, rows: unknown[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(name, "readwrite");
      const store = tx.objectStore(name);
      for (const row of rows) store.put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* best-effort */
  }
}

export async function storeByIndex<T>(
  name: KeyedStore,
  index: string,
  value: IDBValidKey,
): Promise<T[]> {
  try {
    const db = await open();
    return await new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction(name, "readonly");
      const req = tx.objectStore(name).index(index).getAll(value);
      req.onsuccess = () => resolve((req.result ?? []) as T[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function storeCount(name: KeyedStore): Promise<number> {
  try {
    const db = await open();
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(name, "readonly");
      const req = tx.objectStore(name).count();
      req.onsuccess = () => resolve(req.result ?? 0);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return 0;
  }
}

export async function metaGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction("meta", "readonly");
      const req = tx.objectStore("meta").get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

export async function metaSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("meta", "readwrite");
      tx.objectStore("meta").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* best-effort */
  }
}
