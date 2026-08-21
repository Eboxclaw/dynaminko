/// <reference lib="webworker" />
// Storage worker. Owns all persistent I/O — localStorage writes, IndexedDB
// reads and writes — so the UI thread never blocks on disk. The in-memory
// document stays on the main thread for synchronous reads; this worker is
// only for the persist path which is genuinely I/O-bound.
//
// Pattern: typed request/response union, DedicatedWorkerGlobalScope,
// postMessage for results, same design as wallet-reader.worker.ts.

import { idbGet, idbSet } from "@/lib/cache/idb";

// ── Persistence keys — must match store.ts ────────────────────────────

const POT_DOC_KEY = "pot.doc.v1";
const MEMORY_KEY = "pot.memory.v1";

// ── types ────────────────────────────────────────────────────────────

export type StorageRequest =
  | { type: "persist-doc"; doc: unknown }
  | { type: "persist-memory"; entries: unknown }
  | { type: "idb-get"; key: string }
  | { type: "idb-set"; key: string; value: unknown }
  | { type: "wipe" };

export type StorageResponse =
  | { type: "persist-doc"; ok: true }
  | { type: "persist-memory"; ok: true }
  | { type: "idb-get"; ok: true; value: unknown | undefined }
  | { type: "wipe"; ok: true }
  | { type: "error"; message: string };

// ── worker ───────────────────────────────────────────────────────────

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener("message", (event: MessageEvent<StorageRequest>) => {
  const msg = event.data;
  if (!msg?.type) return;

  switch (msg.type) {
    case "persist-doc": {
      try {
        localStorage.setItem(POT_DOC_KEY, JSON.stringify(msg.doc));
        ctx.postMessage({ type: "persist-doc", ok: true } satisfies StorageResponse);
      } catch (err) {
        ctx.postMessage({
          type: "error",
          message: err instanceof Error ? err.message : "persist-doc failed",
        } satisfies StorageResponse);
      }
      return;
    }

    case "persist-memory": {
      try {
        localStorage.setItem(MEMORY_KEY, JSON.stringify(msg.entries));
        ctx.postMessage({ type: "persist-memory", ok: true } satisfies StorageResponse);
      } catch (err) {
        ctx.postMessage({
          type: "error",
          message: err instanceof Error ? err.message : "persist-memory failed",
        } satisfies StorageResponse);
      }
      return;
    }

    case "idb-get": {
      idbGet<string>(msg.key)
        .then((value) => {
          ctx.postMessage({ type: "idb-get", ok: true, value } satisfies StorageResponse);
        })
        .catch((err) => {
          ctx.postMessage({
            type: "error",
            message: err instanceof Error ? err.message : "idb-get failed",
          } satisfies StorageResponse);
        });
      return;
    }

    case "idb-set": {
      idbSet(msg.key, msg.value)
        .then(() => {
          ctx.postMessage({
            type: "idb-get",
            ok: true,
            value: undefined,
          } as unknown as StorageResponse);
        })
        .catch((err) => {
          ctx.postMessage({
            type: "error",
            message: err instanceof Error ? err.message : "idb-set failed",
          } satisfies StorageResponse);
        });
      return;
    }

    case "wipe": {
      try {
        localStorage.removeItem(POT_DOC_KEY);
        localStorage.removeItem(MEMORY_KEY);
        ctx.postMessage({ type: "wipe", ok: true } satisfies StorageResponse);
      } catch (err) {
        ctx.postMessage({
          type: "error",
          message: err instanceof Error ? err.message : "wipe failed",
        } satisfies StorageResponse);
      }
      return;
    }

    default:
      ctx.postMessage({
        type: "error",
        message: `unknown storage request: ${(msg as { type: string }).type}`,
      } satisfies StorageResponse);
  }
});
