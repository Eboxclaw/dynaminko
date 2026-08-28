import { describe, expect, it } from "vitest";

import { unverifiedNumbers } from "./grounding";

describe("unverifiedNumbers", () => {
  const FACTS =
    "wallet_holdings: 11 tokens · $1849 (wallet $1752 + venue spot $97)\n" +
    "net_worth: $1834 (wallet $1752 + venue account equity $81, incl. uPnL)\n" +
    "top_positions: BTC-PERP long 0.00355 @ 79,302 · notional $275 · uPnL -$6";

  it("passes numbers the evidence carried, in any formatting", () => {
    expect(
      unverifiedNumbers("You hold $1,849 across 11 tokens; BTC-PERP is at 79,302.", FACTS),
    ).toEqual([]);
  });

  it("flags an invented sum the data never carried", () => {
    expect(unverifiedNumbers("Both venues total 1,000.60 USD.", FACTS)).toEqual(["1,000.60"]);
  });

  it("flags a fabricated position figure", () => {
    expect(unverifiedNumbers("XMR-PERP is 439 units long.", FACTS)).toEqual(["439"]);
  });

  it("ignores numbers inside URLs", () => {
    expect(
      unverifiedNumbers("See https://example.com/page/2026?id=42 for the full data.", FACTS),
    ).toEqual([]);
  });

  it("matches after trailing-zero normalization", () => {
    expect(unverifiedNumbers("The total is 1,000.60.", "result: 1000.6 USD")).toEqual([]);
  });

  it("matches percents regardless of sign formatting", () => {
    expect(unverifiedNumbers("KBTC is down 3.2% today.", "KBTC $523 (-3.2%)")).toEqual([]);
  });

  it("never flags single-digit integers", () => {
    expect(unverifiedNumbers("I found 3 matches in 2 venues.", "no numbers here")).toEqual([]);
  });

  it("returns every miss without duplicates", () => {
    expect(unverifiedNumbers("It is 439 units and costs 5000 total, yes 439.", FACTS)).toEqual([
      "439",
      "5000",
    ]);
  });
});
