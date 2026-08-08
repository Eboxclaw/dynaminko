import { useEffect } from "react";

import { extractSignals } from "@/lib/agent/extract";
import { ingestSignals, walletKey } from "@/lib/store";

import { useDoc } from "./useDoc";
import { usePortfolio } from "./usePortfolio";

/** ids already handed to the store, so re-renders never re-ingest. */
const seen = new Set<string>();

/**
 * Runs the extraction agent whenever a fresh wallet read lands. New on-chain
 * moments become inbox signals; already-journalled ones are marked linked.
 */
export function useAgent() {
  const doc = useDoc();
  const { trades, active, fetchedAt } = usePortfolio();

  const key = active ? walletKey(active.chainId, active.address) : null;
  const chainId = active?.chainId ?? null;
  const stamp = `${key ?? ""}:${fetchedAt ?? 0}:${trades.length}`;

  useEffect(() => {
    if (!key || chainId == null || seen.has(stamp)) return;
    seen.add(stamp);
    const fresh = extractSignals({ trades, chainId });
    if (fresh.length > 0) ingestSignals(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);

  const inbox = doc.signals.filter((s) => s.state === "inbox");
  const linked = doc.signals.filter((s) => s.state === "linked");
  return { signals: doc.signals, inbox, linked, extracting: !fetchedAt && Boolean(active) };
}
