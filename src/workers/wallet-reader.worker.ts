/// <reference lib="webworker" />
// Wallet reader worker. Keeps every chain read off the main thread; results
// stream back per wallet so the UI can paint incrementally. It also serves
// venue reads (Nado, Hyperliquid, Velodrome), whose RPC decoding is the most
// expensive parsing the app does.

import { readWallet, type WalletSnapshot } from "@/lib/chain/blockscout";
import { readVenueActions, type VenueAction } from "@/lib/venues/actions";
import { readVenues, type VenueReport } from "@/lib/venues";

export type ReaderRequest =
  | {
      type: "scan";
      chainId: number;
      wallets: { id: string; address: string; sinceBlock?: number | null }[];
    }
  | { type: "venues"; chainId: number; address: string };

export type ReaderResponse =
  | { type: "snapshot"; snapshot: WalletSnapshot }
  | { type: "venues"; reports: VenueReport[]; actions: VenueAction[] }
  | { type: "error"; walletId: string; message: string }
  | { type: "done"; at: number };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/**
 * AbortSignal.timeout is not in every webview this app runs in, so build the
 * same thing by hand: one signal that fires after `ms`. Callers must invoke
 * done() once their batch settles, or the stray timer lingers for up to ms.
 */
function timeoutSignal(ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

ctx.addEventListener("message", async (event: MessageEvent<ReaderRequest>) => {
  const msg = event.data;

  if (msg?.type === "venues") {
    // Every fetch inside both reads gets this signal, so one hanging
    // endpoint (typically a Nado archive POST) can no longer stall the whole
    // batch past the hook's outer timeout and freeze the UI on stale cache.
    const { signal, done } = timeoutSignal(20_000);
    try {
      const [reportsR, actionsR] = await Promise.allSettled([
        readVenues(msg.address, msg.chainId, signal),
        // Actions are a nicety: their failure must never block position reports.
        readVenueActions(msg.address, msg.chainId, signal),
      ]);
      if (reportsR.status === "fulfilled") {
        ctx.postMessage({
          type: "venues",
          reports: reportsR.value,
          actions: actionsR.status === "fulfilled" ? actionsR.value : [],
        } satisfies ReaderResponse);
      } else {
        ctx.postMessage({
          type: "error",
          walletId: msg.address,
          message: reportsR.reason instanceof Error ? reportsR.reason.message : "venue read failed",
        } satisfies ReaderResponse);
      }
      ctx.postMessage({ type: "done", at: Date.now() } satisfies ReaderResponse);
    } finally {
      done();
    }
    return;
  }

  if (msg?.type !== "scan") return;

  // Same guard as the venues branch: no fetch may outlive the message.
  const { signal, done } = timeoutSignal(20_000);
  try {
    await Promise.all(
      msg.wallets.map(async (w) => {
        try {
          const snapshot = await readWallet(
            w.id,
            w.address,
            msg.chainId,
            w.sinceBlock ?? null,
            signal,
          );
          ctx.postMessage({ type: "snapshot", snapshot } satisfies ReaderResponse);
        } catch (err) {
          ctx.postMessage({
            type: "error",
            walletId: w.id,
            message: err instanceof Error ? err.message : "read failed",
          } satisfies ReaderResponse);
        }
      }),
    );

    ctx.postMessage({ type: "done", at: Date.now() } satisfies ReaderResponse);
  } finally {
    done();
  }
});
