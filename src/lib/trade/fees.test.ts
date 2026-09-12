import { describe, expect, it } from "vitest";

import {
  APP_BUILDER_BPS,
  builderFeeToTenths,
  feeBreakdown,
  swapReceiveEstimate,
} from "./fees";

describe("feeBreakdown", () => {
  it("builds the ladder for a nado perp trade at the flat 10 bps app fee", () => {
    const b = feeBreakdown({ venue: "nado", kind: "perp", notionalUsd: 1000 });
    expect(b.venueFeeUsd).toBe(1.5); // 15 bps of $1000
    expect(b.builderFeeUsd).toBe(1); // 10 bps of $1000
    expect(b.totalUsd).toBe(2.5);
    expect(b.totalBps).toBe(25);
    expect(b.rows.map((r) => r.label)).toEqual(["nado fee", "app fee", "total"]);
  });

  it("clamps the app surcharge to the venue cap", () => {
    // Hyperliquid perp caps builder fees at 10 bps: the flat 10 sits on it.
    const b = feeBreakdown({ venue: "hyperliquid", kind: "perp", notionalUsd: 500 });
    expect(b.builderFeeUsd).toBe(0.5); // 10 bps of $500
    expect(b.totalBps).toBe(55); // 45 venue + 10 app
  });

  it("handles zero and negative notionals without dividing by nothing", () => {
    const zero = feeBreakdown({ venue: "nado", kind: "spot", notionalUsd: 0 });
    expect(zero.totalUsd).toBe(0);
    const neg = feeBreakdown({ venue: "nado", kind: "spot", notionalUsd: -50 });
    expect(neg.totalUsd).toBe(0);
  });
});

describe("builder wire format", () => {
  it("converts whole bps to Hyperliquid tenths-of-a-bp integers", () => {
    expect(builderFeeToTenths(10)).toBe(100);
    expect(builderFeeToTenths(1)).toBe(10);
    expect(builderFeeToTenths(1.5)).toBe(15);
    expect(APP_BUILDER_BPS).toBe(10);
  });
});

describe("swapReceiveEstimate", () => {
  it("embeds the app fee and returns the receive amount", () => {
    const r = swapReceiveEstimate({ notionalUsd: 1000, price: 2, appBps: 25 });
    if ("problem" in r) throw new Error(r.problem);
    expect(r.feeUsd).toBe(2.5); // 25 bps of $1000
    expect(r.receiveAmount).toBeCloseTo(498.75, 4); // (1000 - 2.5) / 2
  });

  it("defaults to the flat 10 bps app fee", () => {
    const r = swapReceiveEstimate({ notionalUsd: 100, price: 1 });
    if ("problem" in r) throw new Error(r.problem);
    expect(r.feeUsd).toBe(0.1);
  });

  it("rejects junk amounts and prices", () => {
    expect(swapReceiveEstimate({ notionalUsd: 0, price: 1 })).toHaveProperty("problem");
    expect(swapReceiveEstimate({ notionalUsd: 100, price: -1 })).toHaveProperty("problem");
  });
});
