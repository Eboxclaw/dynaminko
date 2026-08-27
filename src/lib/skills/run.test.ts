// runSkill: composed read skills run their declared tools/commands and hand a
// flat, rounded, model-readable digest to the model (not raw tool JSON, which
// small models give up on). Bespoke skills keep their own facts.

import { beforeEach, describe, expect, it } from "vitest";

import { wipe } from "@/lib/store";

import { digestStep, runSkill } from "./run";
import { SKILLS } from "./registry";

// node tests have no localStorage: the store degrades to an empty doc, which is
// exactly what we want to assert against (gap lines, not a crash).
beforeEach(() => wipe());

describe("composed skills", () => {
  it("wallet.holdings digests its three portfolio tools into readable lines", async () => {
    const res = await runSkill("wallet.holdings");
    expect(res.skill.composed).toBe(true);
    expect(res.skill.aiRequired).toBe(true);
    for (const step of res.skill.tools) {
      expect(Array.isArray(res.data[step])).toBe(true);
    }
    // cold cache: the digest reports the gap, not a crash
    expect((res.data["portfolio.read"] as string[]).join(" ")).toMatch(
      /no holdings cached|sync your wallet/i,
    );
    expect(res.facts.length).toBeGreaterThan(0);
    expect(res.prompt).toContain("structured result");
  });

  it("inbox.review digests the resolve_inbox command and the coverage tool", async () => {
    const res = await runSkill("inbox.review");
    expect(res.data["journal.resolve_inbox"]).toBeDefined();
    expect(res.data["signal.coverage"]).toBeDefined();
    const inbox = (res.data["journal.resolve_inbox"] as string[]).join(" ");
    expect(inbox).toMatch(/inbox/i);
    expect(inbox).toMatch(/pending|clear/i);
  });

  it("trades.open digests positions-perps and netWorth", async () => {
    const res = await runSkill("trades.open");
    const perps = (res.data["portfolio.positions-perps"] as string[]).join(" ");
    expect(perps).toMatch(/open perps/i);
    const nw = (res.data["portfolio.netWorth"] as string[]).join(" ");
    expect(nw).toMatch(/net worth/i);
  });

  it("knows every skill id in the registry", () => {
    const ids = new Set(SKILLS.map((s) => s.id));
    expect(ids.has("wallet.holdings")).toBe(true);
    expect(ids.has("inbox.review")).toBe(true);
    expect(ids.has("trades.open")).toBe(true);
  });

  it("still runs the bespoke skills (capture.tidy is a rewrite, no tools)", async () => {
    const res = await runSkill("capture.tidy");
    expect(res.skill.composed).toBeUndefined();
    expect(res.skill.tools).toEqual([]);
    expect(res.data).toEqual({ note: "" });
  });

  it("throws on an unknown skill", async () => {
    await expect(runSkill("nope.nope")).rejects.toThrow(/unknown skill/);
  });
});

describe("digestStep", () => {
  it("turns a populated positions-perps into per-trade lines with margin and gaps", () => {
    const { lines } = digestStep("portfolio.positions-perps", {
      trades: [
        {
          venue: "nado",
          displaySymbol: "BTC-PERP",
          side: "long",
          size: 0.00355,
          entryPrice: 77441.4,
          notional: 286.7,
          unrealizedPnl: 11.8,
          leverage: null,
          margin: null,
          liquidationPrice: null,
        },
        {
          venue: "hyperliquid",
          displaySymbol: "ETH-PERP",
          side: "short",
          size: 10,
          entryPrice: 2000,
          notional: 19000,
          unrealizedPnl: 1000,
          leverage: 5,
          margin: 3800,
          liquidationPrice: 2100,
        },
      ],
      accounts: [{ venue: "nado", label: "Nado · default", equity: 99.8, marginUsed: 60 }],
      gaps: ["Nado does not report per-position leverage, margin, liquidation price, or TP/SL."],
    });
    const text = lines.join("\n");
    // every field is present as a value or an explicit "not reported by <venue>"
    expect(text).toMatch(/BTC-PERP \(nado\) side long/);
    expect(text).toMatch(/entry 77,441/);
    expect(text).toMatch(/uPnL \+\$12/);
    expect(text).toMatch(/leverage not reported by nado/);
    expect(text).toMatch(/margin not reported by nado/);
    expect(text).toMatch(/liq not reported by nado/);
    // HL perp carries its leverage/margin/liq
    expect(text).toMatch(/ETH-PERP \(hyperliquid\) side short/);
    expect(text).toMatch(/5x/);
    expect(text).toMatch(/margin \$3800/);
    expect(text).toMatch(/liq 2,100/);
    // account-level margin + the honest gap
    expect(text).toMatch(/Nado · default: equity \$100/);
    expect(text).toMatch(/note: Nado does not report/);
  });

  it("digests a resolved inbox with a pending list", () => {
    const { lines } = digestStep("journal.resolve_inbox", {
      status: "needs_input",
      summary: "3 trades pending",
      data: {
        pending: 3,
        pendingList: [
          {
            ticker: "BTC",
            side: "in",
            amount: 0.5,
            valueUsd: 40000,
            venue: "nado",
            date: "2026-08-24",
          },
          {
            ticker: "ETH",
            side: "out",
            amount: 2,
            valueUsd: 4000,
            venue: "hyperliquid",
            date: "2026-08-23",
          },
        ],
      },
    });
    const text = lines.join("\n");
    expect(text).toMatch(/inbox: 3 trades pending/);
    expect(text).toMatch(/BTC in 0.5 on nado ~\$40000/);
    expect(text).toMatch(/ETH out 2 on hyperliquid ~\$4000/);
  });
});
