import { useEffect } from "react";

import { extractSignals } from "@/lib/agent/extract";
import { ingestSignals, log, walletKey } from "@/lib/store";
import { actionsToSignals } from "@/lib/venues/actions";

import { useDoc } from "./useDoc";
import { usePortfolio } from "./usePortfolio";
import { useVenues } from "./useVenues";

/** stamps already handed to the store, so re-renders never re-ingest. */
const seen = new Set<string>();

/**
 * Runs the extraction agent whenever fresh reads land. On-chain transfers
 * become wallet signals; venue actions — Nado orders and collateral events,
 * Hyperliquid fills and ledger moves — become venue signals.
 * Already-journalled moments are marked linked.
 */
export function useAgent() {
  const doc = useDoc();
  const { trades, active, fetchedAt } = usePortfolio();
  const { actions } = useVenues();

  const key = active ? walletKey(active.chainId, active.address) : null;
  const chainId = active?.chainId ?? null;
  const stamp = `${key ?? ""}:${fetchedAt ?? 0}:${trades.length}`;
  const actionStamp = `${key ?? ""}:${actions.length}:${actions[0]?.id ?? "-"}`;

  useEffect(() => {
    if (!key || chainId == null || seen.has(stamp)) return;
    seen.add(stamp);
    const fresh = extractSignals({ trades, chainId });
    if (fresh.length > 0) {
      ingestSignals(fresh);
      log("extractor", "signals extracted", {
        level: "call",
        detail: `${fresh.length} from ${trades.length} transfers`,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);

  // Venue actions. ingestSignals dedupes by id, so a growing action list only
  // files the newcomers.
  useEffect(() => {
    if (!key || actions.length === 0 || seen.has(actionStamp)) return;
    seen.add(actionStamp);
    const fresh = actionsToSignals(actions);
    if (fresh.length > 0) {
      ingestSignals(fresh);
      const byVenue = fresh.reduce<Record<string, number>>((acc, s) => {
        const v = s.venue ?? "evm";
        acc[v] = (acc[v] ?? 0) + 1;
        return acc;
      }, {});
      log("extractor", "venue actions extracted", {
        level: "call",
        detail: Object.entries(byVenue)
          .map(([v, n]) => `${n} ${v}`)
          .join(", "),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionStamp]);

  const inbox = doc.signals.filter((s) => s.state === "inbox");
  const linked = doc.signals.filter((s) => s.state === "linked");
  return { signals: doc.signals, inbox, linked, extracting: !fetchedAt && Boolean(active) };
}
