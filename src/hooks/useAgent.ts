import { useEffect, useRef } from "react";

import { extractSignals } from "@/lib/agent/extract";
import { ingestSignals, walletKey } from "@/lib/store";

import { useDoc } from "./useDoc";
import { usePortfolio } from "./usePortfolio";

/**
 * Runs the extraction agent whenever a fresh wallet read lands. New on-chain
 * moments become inbox signals; already-journalled ones are marked linked.
 */
export function useAgent() {
  const doc = useDoc();
  const { trades, active, fetchedAt } = usePortfolio();

  const key = active ? walletKey(active.chainId, active.address) : null;
  const stamp = `${key ?? ""}:${fetchedAt ?? 0}:${trades.length}`;
  const last = useRef<string | null>(null);
  const latest = useRef(trades);
  latest.current = trades;

  useEffect(() => {
    if (!key || !active) return;
    if (latest.current.length === 0) return;
    if (last.current === stamp) return;
    last.current = stamp;
    ingestSignals(extractSignals({ trades: latest.current, chainId: active.chainId }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);

  const inbox = doc.signals.filter((s) => s.state === "inbox");
  const linked = doc.signals.filter((s) => s.state === "linked");
  return { signals: doc.signals, inbox, linked, extracting: !fetchedAt && Boolean(active) };
}
