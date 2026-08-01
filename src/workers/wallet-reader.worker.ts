/// <reference lib="webworker" />
// Wallet reader worker. Keeps every chain read off the main thread; results
// stream back per wallet so the UI can paint incrementally.

import { readWallet, type WalletSnapshot } from "@/lib/chain/blockscout";

export type ReaderRequest = {
  type: "scan";
  wallets: { id: string; address: string; sinceBlock?: number | null }[];
};

export type ReaderResponse =
  | { type: "snapshot"; snapshot: WalletSnapshot }
  | { type: "error"; walletId: string; message: string }
  | { type: "done"; at: number };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener("message", async (event: MessageEvent<ReaderRequest>) => {
  const msg = event.data;
  if (msg?.type !== "scan") return;

  await Promise.all(
    msg.wallets.map(async (w) => {
      try {
        const snapshot = await readWallet(w.id, w.address, w.sinceBlock ?? null);
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
