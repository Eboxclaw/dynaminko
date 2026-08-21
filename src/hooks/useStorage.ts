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
import type { StorageRequest } from "@/workers/storage.worker";

export function useStorage() {
  const workerRef = useRef<Worker | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    let w: Worker | null = null;

    try {
      if (typeof Worker === "undefined") throw new Error("no Worker API");
      w = new Worker(new URL("../workers/storage.worker.ts", import.meta.url), { type: "module" });

      w.addEventListener("error", (e) => {
        console.warn("storage worker error, falling back to direct localStorage:", e);
        w?.terminate();
        workerRef.current = null;
        // Reset persist functions to default (direct localStorage)
        setPersistFn(null);
        setMemoryPersistFn(null);
      });

      // Wire the store's persist functions to the worker
      setPersistFn((data: string) => {
        if (workerRef.current) {
          workerRef.current.postMessage({
            type: "persist-doc",
            doc: JSON.parse(data),
          } satisfies StorageRequest);
        }
      });

      setMemoryPersistFn((data: string) => {
        if (workerRef.current) {
          workerRef.current.postMessage({
            type: "persist-memory",
            entries: JSON.parse(data),
          } satisfies StorageRequest);
        }
      });

      workerRef.current = w;
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
