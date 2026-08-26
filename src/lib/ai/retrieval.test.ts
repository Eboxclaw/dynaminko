// Structured-field narrowing in retrieval: the extractors are pure and unit
// tested here; the rerank is integration tested against a mocked rank() so no
// encoder (and no WASM) is needed in node.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ingestSignals, wipe, type Signal } from "@/lib/store";
import { filterCards } from "@/lib/tools/journal";

// Controls the mocked rank() per test: null = encoder absent, array = its
// cosine ranking.
const rankState: {
  order: null | { id: string; score: number }[];
  lastTargets: null | { id: string; text: string }[];
} = { order: null, lastTargets: null };

vi.mock("@/lib/ai/encoder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/encoder")>();
  return {
    ...actual,
    rank: vi.fn(async (_query: string, targets: { id: string; text: string }[]) => {
      rankState.lastTargets = targets;
      return rankState.order ? rankState.order.map((o) => ({ id: o.id, score: o.score })) : null;
    }),
  };
});

const { matchTickers, extractVenue, extractDateWindow, retrieveContext } =
  await import("./retrieval");

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

beforeEach(() => {
  wipe();
  rankState.order = null;
  rankState.lastTargets = null;
});

describe("matchTickers", () => {
  it("matches the base of a -PERP ticker", () => {
    expect(matchTickers("how is HYPE doing", ["HYPE-PERP", "BTC"])).toEqual(["HYPE-PERP"]);
  });

  it("does not match English words that are not tickers", () => {
    expect(matchTickers("how is my portfolio doing", ["HYPE-PERP", "BTC"])).toEqual([]);
  });

  it("matches several tickers in one question, capped", () => {
    expect(
      matchTickers("compare BTC ETH SOL XVG HYPE", ["BTC", "ETH", "SOL", "XVG", "HYPE"]),
    ).toEqual(["BTC", "ETH", "SOL", "XVG"]);
  });

  it("returns nothing when the device has no tickers", () => {
    expect(matchTickers("HYPE", [])).toEqual([]);
  });

  it("matches mixed-case tickers from any query case", () => {
    expect(matchTickers("how is wGOGLX doing", ["wGOGLX", "XVELO", "BTC"])).toEqual(["wGOGLX"]);
    expect(matchTickers("how is wgoglx doing", ["wGOGLX"])).toEqual(["wGOGLX"]);
    expect(matchTickers("HOW IS WGOGLX DOING", ["wGOGLX"])).toEqual(["wGOGLX"]);
  });

  it("matches digit-first tickers but not plain numbers", () => {
    expect(matchTickers("how is 1INCH", ["1INCH"])).toEqual(["1INCH"]);
    expect(matchTickers("i bought 500 at 12", ["BTC"])).toEqual([]);
  });
});

describe("extractVenue", () => {
  it("matches venue words whole", () => {
    expect(extractVenue("what did I trade on Nado")).toBe("nado");
    expect(extractVenue("my Hyperliquid positions")).toBe("hyperliquid");
  });

  it("does not match substrings of other words", () => {
    expect(extractVenue("my portfolio doing well")).toBeNull();
  });
});

describe("extractDateWindow", () => {
  const now = Date.UTC(2026, 7, 25, 12, 0, 0); // Wed 2026-08-25

  it("maps 'today' to the local day", () => {
    const w = extractDateWindow("what happened today", now)!;
    expect(w.to).toBe(now);
    expect(w.from!).toBeLessThanOrEqual(now - 6 * 3_600_000);
    expect(now - w.from!).toBeLessThanOrEqual(24 * 3_600_000);
  });

  it("maps 'yesterday' to the previous local day", () => {
    const w = extractDateWindow("yesterday's trades", now)!;
    expect(now - w.to!).toBeLessThanOrEqual(24 * 3_600_000 + 60_000);
    expect(w.from!).toBeLessThan(w.to!);
  });

  it("maps 'last week' to the previous Mon-to-Mon span", () => {
    const w = extractDateWindow("last week", now)!;
    expect(w.to! - w.from!).toBe(7 * 86_400_000);
  });

  it("maps '3 days ago' to a 3-day span ending now", () => {
    const w = extractDateWindow("3 days ago", now)!;
    expect(now - w.from!).toBe(3 * 86_400_000);
    expect(w.to).toBe(now);
  });

  it("maps 'last month' to the true calendar month, not 30 days back", () => {
    // Local-anchored so the assertion is timezone-independent.
    const localNow = new Date(2026, 7, 25, 12, 0, 0).getTime(); // Aug 25
    const w = extractDateWindow("what did I trade last month", localNow)!;
    expect(w.from).toBe(new Date(2026, 6, 1).getTime()); // Jul 1, not Jul 2
    expect(w.to).toBe(new Date(2026, 7, 1).getTime());
  });

  it("maps '2 months ago' with calendar months, not 60-day multiples", () => {
    const localNow = new Date(2026, 7, 25, 12, 0, 0).getTime(); // Aug 25
    const w = extractDateWindow("2 months ago", localNow)!;
    expect(w.from).toBe(new Date(2026, 5, 25, 12, 0, 0).getTime()); // Jun 25
    expect(w.to).toBe(localNow);
  });

  it("returns null when nothing is named", () => {
    expect(extractDateWindow("how is my portfolio", now)).toBeNull();
  });
});

describe("retrieveContext structured rerank", () => {
  it("reorders a lower-cosine card to the top when its ticker is named", async () => {
    ingestSignals([
      sig({ id: "hype:1", symbol: "HYPE-PERP", venue: "nado", ts: Date.now() - 3_600_000 }),
      sig({ id: "btc:1", symbol: "BTC", ts: Date.now() - 3_600_000 }),
    ]);
    const cards = filterCards({ limit: 200 });
    const hype = cards.find((c) => c.ticker === "HYPE-PERP")!;
    const btc = cards.find((c) => c.ticker === "BTC")!;
    expect(hype.id && btc.id).toBeTruthy();

    // Encoder says BTC is more similar (0.4) than HYPE (0.3); the question
    // names HYPE, so HYPE must win after the ticker boost (+0.5).
    rankState.order = [
      { id: `card:${btc.id}`, score: 0.4 },
      { id: `card:${hype.id}`, score: 0.3 },
    ];
    const out = await retrieveContext("how is HYPE doing", 6);
    expect(out.how).toBe("encoder+structured");
    expect(out.lines[0]).toContain("HYPE-PERP");
    expect(out.lines[0]).not.toContain("BTC");
  });

  it("boosts a mixed-case ticker query (wGOGLX) against its uppercase card", async () => {
    ingestSignals([
      sig({ id: "wgoglx:1", symbol: "wGOGLX", ts: Date.now() - 3_600_000 }),
      sig({ id: "btc:1", symbol: "BTC", ts: Date.now() - 3_600_000 }),
    ]);
    // buildIndex uppercases signal symbols, so the card ticker is WGOGLX; the
    // question may spell it in any case and must still boost.
    const cards = filterCards({ limit: 200 });
    const wgoglx = cards.find((c) => c.ticker === "WGOGLX")!;
    const btc = cards.find((c) => c.ticker === "BTC")!;
    rankState.order = [
      { id: `card:${btc.id}`, score: 0.4 },
      { id: `card:${wgoglx.id}`, score: 0.3 },
    ];
    const out = await retrieveContext("how is wGOGLX doing", 6);
    expect(out.how).toBe("encoder+structured");
    expect(out.lines[0]).toContain("WGOGLX");
  });

  it("boosts a digit-first ticker card (1INCH) the old token regex could never match", async () => {
    ingestSignals([
      sig({ id: "inch:1", symbol: "1INCH", ts: Date.now() - 3_600_000 }),
      sig({ id: "btc:1", symbol: "BTC", ts: Date.now() - 3_600_000 }),
    ]);
    const cards = filterCards({ limit: 200 });
    const inch = cards.find((c) => c.ticker === "1INCH")!;
    const btc = cards.find((c) => c.ticker === "BTC")!;
    rankState.order = [
      { id: `card:${btc.id}`, score: 0.4 },
      { id: `card:${inch.id}`, score: 0.3 },
    ];
    const out = await retrieveContext("how is 1INCH doing", 6);
    expect(out.how).toBe("encoder+structured");
    expect(out.lines[0]).toContain("1INCH");
  });

  it("does not claim structured narrowing when no boosted card reaches the top", async () => {
    const nowTs = Date.now();
    ingestSignals([
      sig({ id: "old:1", symbol: "BTC", ts: nowTs - 40 * 86_400_000 }),
      sig({ id: "edge:1", symbol: "ETH", ts: nowTs - 3_600_000 }),
    ]);
    const old = filterCards({ limit: 200 }).find((c) => c.id === "old:1")!;
    const edge = filterCards({ limit: 200 }).find((c) => c.id === "edge:1")!;
    // The today-window boost (+0.25) lifts the edge card to exactly the floor
    // (0.25, not >0.25), so it stays excluded: a boost was computed but no
    // boosted card made the cut, and the label must stay "encoder".
    rankState.order = [
      { id: `card:${old.id}`, score: 0.4 },
      { id: `card:${edge.id}`, score: 0.0 },
    ];
    const out = await retrieveContext("what did I trade today", 6);
    expect(out.count).toBe(1);
    expect(out.how).toBe("encoder");
  });

  it("keeps how as 'encoder' when no structured field is named", async () => {
    ingestSignals([sig({ id: "btc:1", symbol: "BTC", ts: Date.now() })]);
    const card = filterCards({ limit: 200 })[0]!;
    rankState.order = [{ id: `card:${card.id}`, score: 0.4 }];
    const out = await retrieveContext("how is my portfolio doing", 6);
    expect(out.how).toBe("encoder");
    expect(out.count).toBe(1);
  });

  it("boosts cards inside a named date window over cards outside it", async () => {
    const now = Date.now();
    ingestSignals([
      sig({ id: "old:1", symbol: "BTC", ts: now - 40 * 86_400_000 }),
      sig({ id: "new:1", symbol: "ETH", ts: now - 2 * 3_600_000 }),
    ]);
    const old = filterCards({ limit: 200 }).find((c) => c.id === "old:1")!;
    const fresh = filterCards({ limit: 200 }).find((c) => c.id === "new:1")!;
    // Encoder ranks the old card higher (0.4 vs 0.3); the question names
    // "today", which only the fresh card is inside.
    rankState.order = [
      { id: `card:${old.id}`, score: 0.4 },
      { id: `card:${fresh.id}`, score: 0.3 },
    ];
    const out = await retrieveContext("what did I trade today", 6);
    expect(out.how).toBe("encoder+structured");
    expect(out.lines[0]).toContain("ETH");
  });

  it("boosts cards on a named venue over cards without one", async () => {
    ingestSignals([
      sig({ id: "onchain:1", symbol: "BTC", ts: Date.now() }),
      sig({ id: "onado:1", symbol: "SOL", venue: "nado", ts: Date.now() }),
    ]);
    const onchain = filterCards({ limit: 200 }).find((c) => c.id === "onchain:1")!;
    const onado = filterCards({ limit: 200 }).find((c) => c.id === "onado:1")!;
    rankState.order = [
      { id: `card:${onchain.id}`, score: 0.4 },
      { id: `card:${onado.id}`, score: 0.3 },
    ];
    const out = await retrieveContext("what did I trade on Nado", 6);
    expect(out.how).toBe("encoder+structured");
    expect(out.lines[0]).toContain("SOL");
  });

  it("ranks against the card text blobs", async () => {
    ingestSignals([sig({ id: "btc:1", symbol: "BTC", ts: Date.now() })]);
    rankState.order = [{ id: `card:${filterCards({ limit: 1 })[0]!.id}`, score: 0.4 }];
    await retrieveContext("hello", 4);
    expect(rankState.lastTargets?.[0]?.text).toContain("BTC");
  });

  it("falls back to deterministic search when the encoder is absent", async () => {
    rankState.order = null;
    ingestSignals([sig({ id: "btc:1", symbol: "BTC", ts: Date.now() })]);
    const out = await retrieveContext("BTC", 4);
    expect(out.how).toBe("deterministic");
    expect(out.count).toBeGreaterThan(0);
  });

  it("rescues a sub-threshold card when its ticker is named (the floor applies to the boosted score)", async () => {
    ingestSignals([
      sig({ id: "btc:1", symbol: "BTC", ts: Date.now() }),
      sig({ id: "sol:1", symbol: "SOL", ts: Date.now() }),
    ]);
    const btc = filterCards({ limit: 200 }).find((c) => c.id === "btc:1")!;
    const sol = filterCards({ limit: 200 }).find((c) => c.id === "sol:1")!;
    // Both below the 0.25 floor; naming SOL lifts it back in via +0.5.
    rankState.order = [
      { id: `card:${btc.id}`, score: 0.1 },
      { id: `card:${sol.id}`, score: 0.1 },
    ];
    const out = await retrieveContext("tell me about SOL", 6);
    expect(out.count).toBe(1);
    expect(out.lines[0]).toContain("SOL");
  });

  it("still drops cards with no structured match and a low cosine score", async () => {
    ingestSignals([sig({ id: "btc:1", symbol: "BTC", ts: Date.now() })]);
    const btc = filterCards({ limit: 200 }).find((c) => c.id === "btc:1")!;
    // "hello world" names no ticker/venue/date; 0.1 stays below the floor.
    rankState.order = [{ id: `card:${btc.id}`, score: 0.1 }];
    const out = await retrieveContext("hello world", 6);
    expect(out.count).toBe(0);
  });
});
