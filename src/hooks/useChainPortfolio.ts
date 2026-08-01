import { useCallback, useEffect, useRef, useState } from "react";
import type { WalletSnapshot } from "@/lib/chain/blockscout";
import type { ReaderRequest, ReaderResponse } from "@/workers/wallet-reader.worker";
import { idbGet, idbSet } from "@/lib/cache/idb";
import { isValidAddress } from "@/lib/wallet-mock";
import type { Wallet } from "@/lib/wallets";

const CACHE_KEY = "chain.snapshots.v1";
const REFRESH_MS = 90_000;

export type ChainPortfolio = {
  snapshots: Record<string, WalletSnapshot>;
  status: "idle" | "loading" | "ready" | "error";
  errors: Record<string, string>;
  fetchedAt: number | null;
  refresh: () => void;
};

export function useChainPortfolio(wallets: Wallet[], enabled = true): ChainPortfolio {
  const [snapshots, setSnapshots] = useState<Record<string, WalletSnapshot>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<ChainPortfolio["status"]>("idle");
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  const workerRef = useRef<Worker | null>(null);

  const targets = wallets
    .filter((w) => w.visible && isValidAddress(w.address))
    .map((w) => ({ id: w.id, address: w.address.toLowerCase() }));
  const key = targets.map((t) => `${t.id}:${t.address}`).join("|");

  // Warm from the IndexedDB cache once so the first paint isn't empty.
  useEffect(() => {
    let cancelled = false;
    void idbGet<{ at: number; data: Record<string, WalletSnapshot> }>(CACHE_KEY).then((hit) => {
      if (cancelled || !hit) return;
      setSnapshots((prev) => (Object.keys(prev).length ? prev : hit.data));
      setFetchedAt((prev) => prev ?? hit.at);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!enabled || targets.length === 0) {
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setErrors({});

    const collected: Record<string, WalletSnapshot> = {};

    const handle = (msg: ReaderResponse) => {
      if (cancelled) return;
      if (msg.type === "snapshot") {
        collected[msg.snapshot.walletId] = msg.snapshot;
        setSnapshots((prev) => ({ ...prev, [msg.snapshot.walletId]: msg.snapshot }));
      } else if (msg.type === "error") {
        setErrors((prev) => ({ ...prev, [msg.walletId]: msg.message }));
      } else {
        setFetchedAt(msg.at);
        setStatus(Object.keys(collected).length ? "ready" : "error");
        void idbSet(CACHE_KEY, { at: msg.at, data: collected });
      }
    };

    const request: ReaderRequest = { type: "scan", wallets: targets };

    if (typeof Worker !== "undefined") {
      const worker =
        workerRef.current ??
        new Worker(new URL("../workers/wallet-reader.worker.ts", import.meta.url), {
          type: "module",
        });
      workerRef.current = worker;
      const onMessage = (e: MessageEvent<ReaderResponse>) => handle(e.data);
      worker.addEventListener("message", onMessage);
      worker.postMessage(request);
      return () => {
        cancelled = true;
        worker.removeEventListener("message", onMessage);
      };
    }

    // No worker support: fall back to the main thread.
    void (async () => {
      const { readWallet } = await import("@/lib/chain/blockscout");
      for (const t of targets) {
        try {
          handle({ type: "snapshot", snapshot: await readWallet(t.id, t.address) });
        } catch (err) {
          handle({
            type: "error",
            walletId: t.id,
            message: err instanceof Error ? err.message : "read failed",
          });
        }
      }
      handle({ type: "done", at: Date.now() });
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, nonce]);

  // Background refresh on an interval + when the tab regains focus.
  useEffect(() => {
    if (!enabled) return;
    const bump = () => setNonce((n) => n + 1);
    const iv = window.setInterval(bump, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") bump();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return { snapshots, status, errors, fetchedAt, refresh };
}
