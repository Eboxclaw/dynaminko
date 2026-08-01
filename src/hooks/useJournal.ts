import { useCallback, useEffect, useMemo } from "react";
import { useLocalStorage } from "./useLocalStorage";
import {
  syncTradesFromWallets,
  tradesFromTransfers,
  pendingTrades,
  type JournalEntry,
  type JournaledTrade,
} from "@/lib/journal";
import type { WalletSnapshot } from "@/lib/chain/blockscout";
import type { Wallet } from "@/lib/wallets";

/**
 * Journal state. Trades come from one of two sources:
 *   - real  : ERC-20 transfers read from the Ink explorer (default)
 *   - demo  : deterministic staged trades derived from the address
 * The pending / journaled / skipped state machine is identical either way.
 */
export function useJournal(
  wallets: Wallet[],
  snapshots?: Record<string, WalletSnapshot>,
  demo = false,
) {
  const [trades, setTrades] = useLocalStorage<JournaledTrade[]>("dyn.journal.trades", []);

  const snapshotList = useMemo(
    () => Object.values(snapshots ?? {}),
    [snapshots],
  );
  const snapshotKey = snapshotList
    .map((s) => `${s.walletId}:${s.transfers.length}:${s.fetchedAt}`)
    .join("|");

  useEffect(() => {
    setTrades((prev) => {
      const next = demo
        ? syncTradesFromWallets(prev, wallets)
        : tradesFromTransfers(prev, snapshotList);
      return next.length === prev.length ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets, snapshotKey, demo]);

  const pending = useMemo(() => pendingTrades(trades), [trades]);

  const journal = useCallback(
    (tradeId: string, entry: JournalEntry) => {
      setTrades((prev) =>
        prev.map((t) =>
          t.id === tradeId ? { ...t, status: "journaled", entry } : t,
        ),
      );
    },
    [setTrades],
  );

  const skip = useCallback(
    (tradeId: string) => {
      setTrades((prev) =>
        prev.map((t) => (t.id === tradeId ? { ...t, status: "skipped" } : t)),
      );
    },
    [setTrades],
  );

  const reopen = useCallback(
    (tradeId: string) => {
      setTrades((prev) =>
        prev.map((t) =>
          t.id === tradeId ? { ...t, status: "pending", entry: undefined } : t,
        ),
      );
    },
    [setTrades],
  );

  return { trades, pending, journal, skip, reopen };
}
