// The agent side of the app. It reads the chain feed and extracts the exact
// fields a journal entry needs, then files each one as an inbox signal.
// It never writes narrative — that is the user's half of the loop.

import type { Trade } from "@/lib/portfolio";
import type { Signal } from "@/lib/store";

export type ExtractInput = {
  trades: Trade[];
  chainId: number;
  /** native token price, used to price gas when the explorer reports it */
  nativeUsd?: number | null;
};

/** Deterministic field extraction: tx id, asset, amount, time, cost. */
export function extractSignals({ trades, chainId }: ExtractInput): Signal[] {
  const now = Date.now();
  return trades.map((t) => ({
    id: t.id,
    txHash: t.txHash,
    symbol: t.symbol,
    side: t.side,
    amount: t.amount,
    value: t.value,
    gasUsd: null,
    feeNative: null,
    counterparty: t.counterparty,
    chainId,
    ts: t.ts,
    extractedAt: now,
    state: "inbox" as const,
  }));
}

/** One-line summary the inbox card shows before the user opens it. */
export function describeSignal(s: Signal): string {
  const verb = s.side === "in" ? "Received" : "Sent";
  const amount = s.amount < 0.001 ? s.amount.toExponential(2) : s.amount.toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
  return `${verb} ${amount} ${s.symbol}`;
}

/** Naive symbol match so the agent can pre-suggest a thesis to link. */
export function suggestThesis<T extends { id: string; symbols: string[]; title: string }>(
  signal: Signal,
  theses: T[],
): T | null {
  const sym = signal.symbol.toUpperCase();
  return (
    theses.find((t) => t.symbols.some((s) => s.toUpperCase() === sym)) ??
    theses.find((t) => t.title.toUpperCase().includes(sym)) ??
    null
  );
}
