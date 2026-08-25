// openPerps / perpExposure: the open-trades picture carries account-level
// margin and names the fields each venue does not report, so the model can
// answer with what the venue exposes and say the rest plainly.

import { describe, expect, it } from "vitest";

import { openPerps, perpExposure } from "./exposure";
import type { VenueReport } from "./venues/types";

function nadoReport(): VenueReport {
  return {
    venueId: "nado",
    status: "ok",
    positions: [
      {
        id: "nado-0-perp-1",
        venue: "nado",
        kind: "perp",
        symbol: "BTC-PERP",
        symbols: ["BTC"],
        label: "BTC-PERP",
        side: "long",
        size: 0.5,
        entryPrice: 100_000,
        markPrice: 105_000,
        notionalValue: 52_500,
        unrealizedPnl: 2_500,
        liquidationPrice: null,
        leverage: null,
        accountId: "sub0",
        parentAddress: "0xabc",
        detail: "long 0.5",
        metadata: { subaccount: "default", productId: 1 },
        fetchedAt: 0,
        value: 52_500,
      },
    ],
    accounts: [
      {
        id: "nado-0",
        venue: "nado",
        accountId: "sub0",
        label: "Nado · default",
        parentAddress: "0xabc",
        equity: 10_000,
        available: 4_000,
        marginUsed: 6_000,
        health: 1.2,
        detail: "cross margin",
      },
    ],
    note: null,
    fetchedAt: 0,
    stale: false,
  };
}

function hlReport(): VenueReport {
  return {
    venueId: "hyperliquid",
    status: "ok",
    positions: [
      {
        id: "hl-main-ETH",
        venue: "hyperliquid",
        kind: "perp",
        symbol: "ETH-PERP",
        symbols: ["ETH"],
        label: "ETH-PERP",
        side: "short",
        size: 10,
        entryPrice: 2_000,
        markPrice: 1_900,
        notionalValue: 19_000,
        unrealizedPnl: 1_000,
        liquidationPrice: 2_100,
        leverage: 5,
        marginUsed: 3_800,
        accountId: "main",
        parentAddress: "0xabc",
        detail: "short 10 · 5x",
        metadata: { account: "main", marginMode: "cross" },
        fetchedAt: 0,
        value: 19_000,
      },
    ],
    accounts: [
      {
        id: "hl-acct-main",
        venue: "hyperliquid",
        accountId: "main",
        label: "Hyperliquid · main",
        parentAddress: "0xabc",
        equity: 8_000,
        available: 1_000,
        marginUsed: 7_000,
        health: null,
        detail: "cross margin",
      },
    ],
    note: null,
    fetchedAt: 0,
    stale: false,
  };
}

describe("openPerps", () => {
  it("returns positions, account-level margin, and per-venue gaps", () => {
    const out = openPerps([nadoReport(), hlReport()]);
    expect(out.trades).toHaveLength(2);
    // sorted by notional desc: BTC ($52.5k) before ETH ($19k)
    expect(out.trades[0].displaySymbol).toBe("BTC-PERP");
    expect(out.trades[0].side).toBe("long");
    expect(out.trades[1].leverage).toBe(5);
    expect(out.trades[1].margin).toBe(3_800);
    expect(out.trades[1].liquidationPrice).toBe(2_100);

    // account-level margin from both venues
    expect(out.accounts.map((a) => a.venue).sort()).toEqual(["hyperliquid", "nado"]);
    const nado = out.accounts.find((a) => a.venue === "nado")!;
    expect(nado.equity).toBe(10_000);
    expect(nado.marginUsed).toBe(6_000);

    // gaps name exactly what each venue does not report
    expect(out.gaps.join(" ")).toMatch(/Nado does not report per-position leverage/);
    expect(out.gaps.join(" ")).toMatch(/Hyperliquid does not report resting TP\/SL/);
  });

  it("only lists a venue's gap when it has an open perp", () => {
    const out = openPerps([hlReport()]);
    expect(out.gaps).toHaveLength(1);
    expect(out.gaps[0]).toMatch(/Hyperliquid/);
  });

  it("keeps perpExposure returning the trades array (back-compat)", () => {
    const out = openPerps([nadoReport(), hlReport()]);
    expect(perpExposure([nadoReport(), hlReport()])).toEqual(out.trades);
  });
});
