// journal.filter PnL side + venue/action inheritance for entries.

import { beforeEach, describe, expect, it } from "vitest";
import { addEntry, ingestSignals, wipe, type Signal } from "@/lib/store";
import { buildIndex, filterCards } from "./journal";

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

describe("journal.filter PnL side", () => {
  it("carries venue-reported realized pnl onto cards", () => {
    ingestSignals([sig({ id: "win", symbol: "BTC", meta: { pnl: 50 } }), sig({ id: "lose", symbol: "ETH", meta: { pnl: -20 } })]);
    const cards = buildIndex().cards;
    const win = cards.find((c) => c.id === "win");
    const lose = cards.find((c) => c.id === "lose");
    expect(win?.pnl).toBe(50);
    expect(lose?.pnl).toBe(-20);
  });

  it("filters to winners only with pnl: 'profit'", () => {
    ingestSignals([
      sig({ id: "w1", symbol: "BTC", meta: { pnl: 50 } }),
      sig({ id: "w2", symbol: "SOL", meta: { pnl: 10 } }),
      sig({ id: "l1", symbol: "ETH", meta: { pnl: -5 } }),
      sig({ id: "flat", symbol: "DOGE", meta: { pnl: 0 } }),
      sig({ id: "none", symbol: "AVAX" }),
    ]);
    const out = filterCards({ pnl: "profit" });
    const ids = out.map((c) => c.id).sort();
    expect(ids).toEqual(["w1", "w2"]);
  });

  it("filters to losers only with pnl: 'loss'", () => {
    ingestSignals([
      sig({ id: "l1", symbol: "ETH", meta: { pnl: -5 } }),
      sig({ id: "l2", symbol: "LTC", meta: { pnl: -100 } }),
      sig({ id: "w1", symbol: "BTC", meta: { pnl: 50 } }),
      sig({ id: "none", symbol: "AVAX" }),
    ]);
    const out = filterCards({ pnl: "loss" });
    const ids = out.map((c) => c.id).sort();
    expect(ids).toEqual(["l1", "l2"]);
  });

  it("excludes cards with no venue-reported pnl from both sides", () => {
    ingestSignals([sig({ id: "none", symbol: "AVAX" }), sig({ id: "flat", symbol: "DOGE", meta: { pnl: 0 } })]);
    expect(filterCards({ pnl: "profit" }).length).toBe(0);
    expect(filterCards({ pnl: "loss" }).length).toBe(0);
  });
});

describe("journal.index entry inheritance", () => {
  it("entries inherit venue, action and pnl from their linked signal", () => {
    ingestSignals([sig({ id: "t1", symbol: "BTC", venue: "hyperliquid", action: "trade", meta: { pnl: 42 } })]);
    addEntry({ tradeId: "t1", headline: "Bought BTC", sentiment: "conviction" });
    const card = buildIndex().cards.find((c) => c.type === "entry" && c.tradeId === "t1");
    expect(card).toBeDefined();
    expect(card?.venue).toBe("hyperliquid");
    expect(card?.action).toBe("trade");
    expect(card?.pnl).toBe(42);
  });

  it("venue filter now reaches journal entries through their linked signal", () => {
    ingestSignals([
      sig({ id: "evm", symbol: "BTC" }),
      sig({ id: "hl", symbol: "ETH", venue: "hyperliquid" }),
    ]);
    addEntry({ tradeId: "evm", headline: "Bought BTC" });
    addEntry({ tradeId: "hl", headline: "Bought ETH" });
    const hl = filterCards({ venue: "hyperliquid", type: "entry" });
    expect(hl.map((c) => c.tradeId)).toEqual(["hl"]);
  });
});
