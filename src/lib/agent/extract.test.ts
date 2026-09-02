// Signal extraction: tx-level classification (swap vs send vs receive) must
// be stable — the same tx never files two moments for one decision.

import { describe, expect, it } from "vitest";

import { describeSignal, extractSignals } from "./extract";
import type { Trade } from "@/lib/portfolio";

const tx = (over: Partial<Trade>): Trade => ({
  id: "0xtx:1",
  txHash: "0xtx",
  symbol: "INKO",
  side: "out",
  amount: 10,
  value: 1,
  ts: 1_000,
  counterparty: "0xrouter",
  sector: "defi",
  ...over,
});

describe("extractSignals", () => {
  it("pairs an out and in leg of one tx into a single swap signal", () => {
    const out = extractSignals({
      chainId: 57073,
      trades: [
        tx({ id: "0xtx:5", symbol: "INKO", side: "out", amount: 100, ts: 1000 }),
        tx({ id: "0xtx:9", symbol: "WETH", side: "in", amount: 0.5, ts: 1000 }),
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].action).toBe("swap");
    expect(out[0].symbol).toBe("INKO");
    expect(out[0].meta?.pair).toBe("for WETH");
  });

  it("keeps lone transfers as send and receive", () => {
    const out = extractSignals({
      chainId: 57073,
      trades: [
        tx({ id: "0xa:1", txHash: "0xa", symbol: "ETH", side: "out", amount: 1 }),
        tx({ id: "0xb:1", txHash: "0xb", symbol: "USDC", side: "in", amount: 5 }),
      ],
    });
    expect(out.map((s) => s.action).sort()).toEqual(["receive", "send"]);
  });

  it("does not classify same-symbol legs as a swap (wraps, self moves)", () => {
    const out = extractSignals({
      chainId: 57073,
      trades: [
        tx({ id: "0xc:1", symbol: "WETH", side: "out", amount: 1 }),
        tx({ id: "0xc:2", symbol: "WETH", side: "in", amount: 1 }),
      ],
    });
    expect(out.every((s) => s.action !== "swap")).toBe(true);
  });

  it("labels swap and claim moments readably", () => {
    const [swap] = extractSignals({
      chainId: 57073,
      trades: [
        tx({ id: "0xtx:5", symbol: "INKO", side: "out", amount: 100 }),
        tx({ id: "0xtx:9", symbol: "WETH", side: "in", amount: 0.5 }),
      ],
    });
    expect(describeSignal(swap)).toContain("Swapped 100 INKO for WETH");
    expect(
      describeSignal({ ...swap, action: "claim", symbol: "USDC", amount: 5 }),
    ).toContain("Claimed 5 USDC");
  });
});
