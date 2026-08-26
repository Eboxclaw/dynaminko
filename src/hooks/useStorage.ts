// Bridge between the synchronous store and the storage worker.
// Call useStorage() once at the app root (__root.tsx). It spawns the storage
// worker and wires the store's persist functions to fire-and-forget
// postMessage calls, so React never blocks on localStorage writes.
//
// The in-memory document stays on the main thread for synchronous reads
// (getDoc()). Only persistence moves behind the worker.
//
// Fallback: if the worker cannot be created (SSR, unsupported browser),
// the store falls back to direct localStorage — no data loss, just sync.

import { useEffect, useRef } from "react";

import { setMemoryPersistFn, setPersistFn } from "@/lib/store";
import type { StorageRequest, StorageResponse } from "@/workers/storage.worker";

/**
 * Wire the store's persist functions to the storage worker, but only after
 * proving the worker can actually write to localStorage. Some webviews expose
 * the Worker API yet lack localStorage inside dedicated workers; in that case
 * the bridge would swallow every write and the app would lose data on refresh.
 * The probe asks the worker to write and remove a key; on any failure the
 * store keeps its default direct-localStorage path. A persist error that
 * arrives later (quota, sandboxing at write time) also drops the bridge so
 * subsequent writes go back to the main thread.
 */
export function useStorage() {
  const workerRef = useRef<Worker | null>(null);
  const initializedRef = useRef(false);
  const probePending = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    let w: Worker | null = null;

    const fallBack = (reason: string) => {
      console.warn(`storage worker unavailable (${reason}), using direct localStorage:`);
      if (w) {
        w.removeEventListener("message", onMessage);
        w.removeEventListener("error", onError);
        w.terminate();
      }
      workerRef.current = null;
      setPersistFn(null);
      setMemoryPersistFn(null);
    };

    const onMessage = (e: MessageEvent<StorageResponse>) => {
      const res = e.data;
      if (!res?.type) return;
      if (res.type === "probe") {
        if (res.ok && w) {
          probePending.current = false;
          installBridge(w);
        } else {
          fallBack(res.error ?? "probe failed");
        }
        return;
      }
      // A persist that reached the worker but failed on disk (quota or
      // sandboxing) cannot be retried through the bridge: drop it and let
      // the default writer take over for the next mutation.
      if (res.type === "error") {
        fallBack(res.message);
      }
    };

    const onError = (e: Event) => {
      fallBack(e instanceof ErrorEvent ? e.message : "worker error event");
    };

    const installBridge = (worker: Worker) => {
      setPersistFn((data: string) => {
        worker.postMessage({ type: "persist-doc", doc: JSON.parse(data) } satisfies StorageRequest);
      });
      setMemoryPersistFn((data: string) => {
        worker.postMessage({ type: "persist-memory", entries: JSON.parse(data) } satisfies StorageRequest);
      });
      workerRef.current = worker;
    };

    try {
      if (typeof Worker === "undefined") throw new Error("no Worker API");
      w = new Worker(new URL("../workers/storage.worker.ts", import.meta.url), { type: "module" });
      w.addEventListener("message", onMessage);
      w.addEventListener("error", onError);
      // Probe before trusting the bridge: one write + remove round trip.
      probePending.current = true;
      w.postMessage({ type: "probe" } satisfies StorageRequest);
      // Safety net: if the worker never answers (script failed to load in
      // this webview), the error handler fires; if not, keep default.
      setTimeout(() => {
        if (probePending.current && !workerRef.current) fallBack("probe timed out");
      }, 1500);
    } catch (err) {
      console.warn("storage worker unavailable, using direct localStorage:", err);
      // Default persist functions stay — they write directly to localStorage
    }

    return () => {
      if (workerRef.current) {
        // Reset to direct localStorage before the worker dies
        setPersistFn(null);
        setMemoryPersistFn(null);
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);
}
