// factLines digest lines: realized PnL, investment motives and venue PnL count
// must surface so the model answers "how did my winning trades do" without a
// tool hop.

import { beforeEach, describe, expect, it } from "vitest";
import { addEntry, ingestSignals, wipe, type Signal } from "@/lib/store";
import { allocateContext, digest, factLines } from "./context";

describe("allocateContext", () => {
  it("splits the window into input budget, output reserve and margin", () => {
    const a = allocateContext(32128, 8192);
    expect(a.outputReserve).toBe(8192);
    expect(a.safetyMargin).toBe(Math.floor(32128 * 0.05));
    expect(a.inputBudget).toBe(32128 - 8192 - a.safetyMargin);
  });

  it("clamps an impossible reserve to the window and never goes negative", () => {
    const a = allocateContext(4096, 8192);
    expect(a.outputReserve).toBe(4096);
    expect(a.inputBudget).toBe(0);
  });
});

function sig(over: Partial<Signal>): Signal {
  return {
    id: over.id ?? `tx-${Math.random()}`,
    txHash: "0xabc",
    symbol: "BTC",
    side: "in",
    amount: 1,
    value: 100,
    gasUsd: null,
    feeNative: null,
    counterparty: "0xdef",
    ts: Date.now(),
    extractedAt: Date.now(),
    state: "inbox",
    ...over,
  };
}

beforeEach(() => wipe());

describe("factLines PnL and motive lines", () => {
  it("reports the not-measured state when no venue has reported pnl", () => {
    ingestSignals([sig({ id: "a", symbol: "BTC" })]);
    const lines = factLines();
    expect(lines).toContain("realized_pnl: not measured yet (no venue-reported pnl)");
    expect(lines).toContain("trades_with_venue_pnl: 0");
  });

  it("sums venue-reported realized pnl with a winner count", () => {
    ingestSignals([
      sig({ id: "w", symbol: "BTC", meta: { pnl: 40 } }),
      sig({ id: "l", symbol: "ETH", meta: { pnl: -15 } }),
      sig({ id: "w2", symbol: "SOL", meta: { pnl: 10 } }),
      sig({ id: "x", symbol: "AVAX" }),
    ]);
    const d = digest();
    expect(d.realizedPnl).toEqual({ net: 35, wins: 2, measured: 3 });
    const lines = factLines();
    expect(lines).toContain("realized_pnl: +$35 over 3 measured trades (2 winners)");
    expect(lines).toContain("trades_with_venue_pnl: 3");
  });

  it("reports a negative realized net", () => {
    ingestSignals([
      sig({ id: "l", symbol: "ETH", meta: { pnl: -80 } }),
      sig({ id: "w", symbol: "BTC", meta: { pnl: 20 } }),
    ]);
    expect(factLines()).toContain("realized_pnl: -$60 over 2 measured trades (1 winners)");
  });

  it("counts entries per investment motive", () => {
    addEntry({ headline: "conviction buy", sentiment: "conviction", ghost: true });
    addEntry({ headline: "conviction add", sentiment: "conviction", ghost: true });
    addEntry({ headline: "hedge move", sentiment: "hedge", ghost: true });
    addEntry({ headline: "no motive", ghost: true });
    const lines = factLines();
    expect(lines).toContain("sentiments: conviction 2 · hedge 1");
  });

  it("says none when no entry has a motive", () => {
    addEntry({ headline: "plain entry", ghost: true });
    expect(factLines()).toContain("sentiments: none");
  });
});
