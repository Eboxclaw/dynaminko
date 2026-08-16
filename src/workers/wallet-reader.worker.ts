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

ctx.addEventListener("message", async (event: MessageEvent<ReaderRequest>) => {
  const msg = event.data;

  if (msg?.type === "venues") {
    try {
      const [reports, actions] = await Promise.all([
        readVenues(msg.address, msg.chainId),
        readVenueActions(msg.address, msg.chainId),
      ]);
      ctx.postMessage({ type: "venues", reports, actions } satisfies ReaderResponse);
    } catch (err) {
      ctx.postMessage({
        type: "error",
        walletId: msg.address,
        message: err instanceof Error ? err.message : "venue read failed",
      } satisfies ReaderResponse);
    }
    ctx.postMessage({ type: "done", at: Date.now() } satisfies ReaderResponse);
    return;
  }

  if (msg?.type !== "scan") return;

  await Promise.all(
    msg.wallets.map(async (w) => {
      try {
        const snapshot = await readWallet(w.id, w.address, msg.chainId, w.sinceBlock ?? null);
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
});
