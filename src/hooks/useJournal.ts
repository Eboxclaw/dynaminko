import { useCallback, useEffect, useMemo } from "react";
import { useLocalStorage } from "./useLocalStorage";
import {
  syncTradesFromWallets,
  pendingTrades,
  type JournalEntry,
  type JournaledTrade,
} from "@/lib/journal";
import type { Wallet } from "@/lib/wallets";

export function useJournal(wallets: Wallet[]) {
  const [trades, setTrades] = useLocalStorage<JournaledTrade[]>("dyn.journal.trades", []);

  // Sync in new wallet-derived trades whenever the wallet set changes.
  useEffect(() => {
    setTrades((prev) => {
      const next = syncTradesFromWallets(prev, wallets);
      return next.length === prev.length ? prev : next;
    });
    // setTrades is stable via useLocalStorage; wallets identity is the trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets]);

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
