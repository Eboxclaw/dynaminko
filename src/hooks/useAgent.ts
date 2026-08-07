import { useEffect } from "react";

import { extractSignals } from "@/lib/agent/extract";
import { ingestSignals } from "@/lib/store";

import { useDoc } from "./useDoc";
import { usePortfolio } from "./usePortfolio";

/**
 * Runs the extraction agent whenever a fresh wallet read lands. New on-chain
 * moments become inbox signals; already-journalled ones are marked linked.
 */
export function useAgent() {
  const doc = useDoc();
  const { trades, active, fetchedAt } = usePortfolio();

  useEffect(() => {
    if (!active || trades.length === 0) return;
    ingestSignals(extractSignals({ trades, chainId: active.chainId }));
  }, [active, trades, fetchedAt]);

  const inbox = doc.signals.filter((s) => s.state === "inbox");
  const linked = doc.signals.filter((s) => s.state === "linked");
  return { signals: doc.signals, inbox, linked, extracting: !fetchedAt && Boolean(active) };
}
