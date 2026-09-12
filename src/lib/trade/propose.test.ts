import { describe, expect, it } from "vitest";

import { normalizeSide, normalizeTradeProposal } from "./propose";

describe("normalizeTradeProposal", () => {
  const base = { venue: "nado", symbol: "btc-perp", side: "long", size: 0.5 };

  it("normalizes a valid proposal and marks it non-executable", () => {
    const r = normalizeTradeProposal({ ...base, rationale: "momentum" });
    expect("problem" in r).toBe(false);
    if (!("problem" in r)) {
      expect(r.proposal.venue).toBe("nado");
      expect(r.proposal.symbol).toBe("BTC-PERP");
      expect(r.proposal.side).toBe("long");
      expect(r.proposal.size).toBe(0.5);
      expect(r.proposal.price).toBeNull();
      expect(r.proposal.executable).toBe(false);
    }
  });

  it("normalizes buy/sell aliases to long/short", () => {
    expect(normalizeSide("buy")).toBe("long");
    expect(normalizeSide("SELL")).toBe("short");
    expect(normalizeSide("sideways")).toBeNull();
  });

  it("rejects venues outside the whitelist", () => {
    const r = normalizeTradeProposal({ ...base, venue: "binance" });
    expect("problem" in r && r.problem).toContain("venue must be one of");
  });

  it("rejects junk size and price", () => {
    expect("problem" in normalizeTradeProposal({ ...base, size: -1 })).toBe(true);
    expect("problem" in normalizeTradeProposal({ ...base, size: "lots" })).toBe(true);
    const badPrice = normalizeTradeProposal({ ...base, price: 0 });
    expect("problem" in badPrice).toBe(true);
    const market = normalizeTradeProposal({ ...base, price: null });
    expect("proposal" in market).toBe(true);
  });
});
