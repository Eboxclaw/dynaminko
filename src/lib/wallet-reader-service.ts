// Persistent wallet-reader service.
//
// The wallet reader (chain snapshot + venue positions/actions) is the most
// expensive parsing in the app, so it runs in a dedicated worker. The hooks
// used to create-and-terminate a fresh worker on every read (each of which
// costs ~200-400ms to instantiate the module, felt on phones). This module
// keeps ONE worker alive between reads and serializes requests through it.
//
// The worker protocol is unchanged: a request posts one message, the worker
// replies with its result(s) then a `{ type: "done" }` marker. Because reads
// are serialized here, each task's listener only ever sees its own exchange.

import type { WalletSnapshot } from "@/lib/chain/blockscout";
import type { ReaderRequest, ReaderResponse } from "@/workers/wallet-reader.worker";
import type { VenueAction, VenueReport } from "@/lib/venues";

type LiveWorker = {
  postMessage: (msg: ReaderRequest) => void;
  addEventListener: (type: "message" | "error", fn: (e: MessageEvent) => void) => void;
  removeEventListener: (type: "message", fn: (e: MessageEvent) => void) => void;
  terminate: () => void;
};

let worker: LiveWorker | null = null;

// Serialized read chain: one read at a time through the shared worker.
let chain: Promise<unknown> = Promise.resolve();

function getWorker(): LiveWorker | null {
  if (typeof Worker === "undefined") return null;
  if (!worker) {
    const w = new Worker(new URL("../workers/wallet-reader.worker.ts", import.meta.url), {
      type: "module",
    }) as unknown as LiveWorker;
    w.addEventListener("error", () => {
      // A crashed worker is dropped; the next read starts a fresh one.
      if (worker === w) worker = null;
    });
    worker = w;
  }
  return worker;
}

/**
 * Run `post` then wait for a matching reply. Each read is serialized on the
 * shared worker, so the listener only ever sees its own exchange. `isErr`
 * turns the worker's `error` reply into a rejection so callers see the real
 * message, not a generic timeout. The per-call timeout rejects without
 * terminating the shared worker, so subsequent reads are unaffected.
 */
function readOnce<T>(
  post: (w: LiveWorker) => void,
  match: (msg: ReaderResponse) => T | undefined,
  isErr: (msg: ReaderResponse) => string | null,
  timeoutMs: number,
): Promise<T> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error("reader unavailable"));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onMessage = (e: MessageEvent) => {
      if (settled) return;
      const msg = e.data as ReaderResponse;
      const errMsg = isErr(msg);
      if (errMsg !== null) {
        settled = true;
        cleanup();
        reject(new Error(errMsg));
        return;
      }
      const hit = match(msg);
      if (hit !== undefined) {
        settled = true;
        cleanup();
        resolve(hit);
      }
    };
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error("reader timed out"));
      }
    }, timeoutMs);
    const cleanup = () => {
      w.removeEventListener("message", onMessage);
      clearTimeout(timer);
    };
    w.addEventListener("message", onMessage);
    post(w);
  });
}

function enqueue<T>(run: () => Promise<T>): Promise<T> {
  const result = chain.then(run);
  chain = result.catch(() => undefined); // keep the chain alive past a failure
  return result;
}

/** Chain snapshot read. */
export function readSnapshotInWorker(
  address: string,
  chainId: number,
  sinceBlock: number | null,
): Promise<WalletSnapshot> {
  return enqueue(() =>
    readOnce<WalletSnapshot>(
      (w) => w.postMessage({ type: "scan", chainId, wallets: [{ id: address, address, sinceBlock }] }),
      (msg) => (msg.type === "snapshot" ? msg.snapshot : undefined),
      (msg) => (msg.type === "error" ? msg.message : null),
      30_000,
    ),
  );
}

export type VenueReadResult = { reports: VenueReport[]; actions: VenueAction[] };

/** Venue read (positions + actions). */
export function readVenuesInWorker(address: string, chainId: number): Promise<VenueReadResult> {
  return enqueue(() =>
    readOnce<VenueReadResult>(
      (w) => w.postMessage({ type: "venues", chainId, address }),
      (msg) => (msg.type === "venues" ? { reports: msg.reports, actions: msg.actions } : undefined),
      (msg) => (msg.type === "error" ? msg.message : null),
      45_000,
    ),
  );
}

/** Drop the shared worker (e.g. on tab teardown). The next read restarts it. */
export function disposeReader() {
  worker?.terminate();
  worker = null;
  chain = Promise.resolve();
}
