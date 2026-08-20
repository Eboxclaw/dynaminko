import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchHLQuotes, fetchGeckoQuotes, fetchQuotes } from "./prices";

// The real cache sits on IndexedDB, which does not exist under the node test
// environment. Swap it for an in-memory map with the same TTL semantics.
const store = new Map<string, unknown>();
vi.mock("./prices-cache", () => ({
  freshCachedQuotes: async (symbols: string[]) => {
    const key = `quotes:${[...symbols].sort().join(",")}`;
    const hit = store.get(key) as { cachedAt: number } | undefined;
    if (hit && Date.now() - hit.cachedAt <= 60_000) {
      return store.get(`quotes:${[...symbols].sort().join(",")}`);
    }
    return null;
  },
  staleCachedQuotes: async (symbols: string[]) => {
    const key = `quotes:${[...symbols].sort().join(",")}`;
    return (store.get(key) as object | undefined) ?? null;
  },
  writeQuotesCache: async (symbols: string[], quotes: unknown) => {
    const key = `quotes:${[...symbols].sort().join(",")}`;
    store.set(key, { quotes, cachedAt: Date.now(), version: "hyperliquid" });
  },
}));

beforeEach(() => {
  store.clear();
  vi.restoreAllMocks();
});

describe("fetchHLQuotes", () => {
  it("returns quotes for symbols present in allMids response", async () => {
    const mockMids = { BTC: "68258.5", ETH: "2096.53", SOL: "82.18" };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockMids,
    } as Response);

    const result = await fetchHLQuotes(["BTC", "ETH", "SOL"]);
    expect(result).toHaveLength(3);
    expect(result.find((q) => q.symbol === "BTC")!.usd).toBe(68258.5);
    expect(result.find((q) => q.symbol === "ETH")!.usd).toBe(2096.53);
    // change24h is always null for HL
    expect(result.find((q) => q.symbol === "BTC")!.change24h).toBeNull();
  });

  it("filters out symbols not present in allMids", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ BTC: "68258.5" }),
    } as Response);

    const result = await fetchHLQuotes(["BTC", "UNKNOWN_TOKEN"]);
    expect(result).toHaveLength(1);
    expect(result[0]!.symbol).toBe("BTC");
  });

  it("returns empty array for empty input", async () => {
    const result = await fetchHLQuotes([]);
    expect(result).toEqual([]);
  });

  it("throws on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 429,
    } as Response);

    await expect(fetchHLQuotes(["BTC"])).rejects.toThrow();
  });

  it("deduplicates symbols", async () => {
    const mockMids = { BTC: "68258.5" };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockMids,
    } as Response);

    const result = await fetchHLQuotes(["BTC", "btc", "Btc"]);
    expect(result).toHaveLength(1);
    expect(result[0]!.symbol).toBe("BTC");
  });
});

describe("fetchGeckoQuotes", () => {
  it("returns quotes for symbols with known CoinGecko ids", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ethereum: { usd: 2096.53, usd_24h_change: 9.55 },
        bitcoin: { usd: 68258, usd_24h_change: 5.51 },
      }),
    } as Response);

    const result = await fetchGeckoQuotes(["ETH", "BTC"]);
    expect(result).toHaveLength(2);
    expect(result.find((q) => q.symbol === "ETH")!.change24h).toBe(9.55);
    expect(result.find((q) => q.symbol === "BTC")!.change24h).toBe(5.51);
  });

  it("filters out symbols without a CoinGecko id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as Response);

    const result = await fetchGeckoQuotes(["NONEXISTENT_SYMBOL"]);
    expect(result).toEqual([]);
  });

  it("returns empty for symbols not in the coinGecko response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ethereum: { usd: 2096.53 } }),
    } as Response);

    // INK is mapped to "ink" gecko id, but gecko returns { ink: { usd: ... } }
    // Simulate INK not being in response
    const result = await fetchGeckoQuotes(["INK"]);
    // INK is mapped to "ink" id, so it IS wanted. If the response has no "ink"
    // key, row will be undefined, resulting in null -> filtered out
    expect(result).toHaveLength(0);
  });
});

describe("fetchQuotes (multi-source)", () => {
  it("returns empty array for empty input", async () => {
    const result = await fetchQuotes([]);
    expect(result).toEqual([]);
  });

  it("fills gaps and lets CoinGecko override HL with 24h change", async () => {
    // HL prices BTC/ETH/HYPE; CoinGecko (queried for known ids incl. INK)
    // returns rows with 24h change that override HL for those symbols.
    vi.spyOn(globalThis, "fetch")
      // Call 1: HL allMids — no INK
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ BTC: "68258", ETH: "2096", HYPE: "34.5" }),
      } as Response)
      // Call 2: CoinGecko for the geckoable subset
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          bitcoin: { usd: 68260, usd_24h_change: 5.5 },
          ethereum: { usd: 2097, usd_24h_change: 9.5 },
          ink: { usd: 0.000029, usd_24h_change: -1.2 },
        }),
      } as Response);

    const result = await fetchQuotes(["BTC", "ETH", "HYPE", "INK"]);
    expect(result).toHaveLength(4);
    // gecko rows win for known ids (they carry change24h)
    expect(result.find((q) => q.symbol === "BTC")).toEqual({
      symbol: "BTC",
      usd: 68260,
      change24h: 5.5,
    });
    expect(result.find((q) => q.symbol === "INK")).toEqual({
      symbol: "INK",
      usd: 0.000029,
      change24h: -1.2,
    });
    // HL-only symbol keeps the HL price with null change
    expect(result.find((q) => q.symbol === "HYPE")).toEqual({
      symbol: "HYPE",
      usd: 34.5,
      change24h: null,
    });
  });

  it("still prices HL-only symbols when CoinGecko fails", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ HYPE: "34.5", BTC: "68258" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
      } as Response);

    const result = await fetchQuotes(["HYPE", "BTC"]);
    expect(result).toHaveLength(2);
    // gecko failed, HL prices stand (change24h null)
    expect(result.find((q) => q.symbol === "BTC")!.usd).toBe(68258);
    expect(result.find((q) => q.symbol === "HYPE")!.usd).toBe(34.5);
  });

  it("serves the stale cache when every live source fails", async () => {
    // Prime the cache with a successful fetch
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ BTC: "68258" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
      } as Response);
    await fetchQuotes(["BTC"]);

    // Age the entry past the fresh-window so only the stale path can serve it
    const key = "quotes:BTC";
    const entry = store.get(key) as { cachedAt: number };
    entry.cachedAt = Date.now() - 120_000;
    store.set(key, entry);

    // Now both sources fail
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
      } as Response);

    const result = await fetchQuotes(["BTC"]);
    expect(result).toHaveLength(1);
    expect(result[0]!.symbol).toBe("BTC");
    expect(result[0]!.usd).toBe(68258);
  });
});

describe("fetchDexQuotes - V2 pools", () => {
  it("derives price from V2 pool reserves (baseToken=0: WETH/INKO)", async () => {
    // Real data: token0=WETH (2.64 WETH), token1=INKO (227M INKO)
    const r0 = BigInt("2640000000000000000").toString(16).padStart(64, "0");
    const r1 = BigInt("227620720000000000000000000").toString(16).padStart(64, "0");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          jsonrpc: "2.0",
          id: 0,
          result: "0x" + r0 + r1 + "0".repeat(64),
        },
      ],
    } as Response);

    const { fetchDexQuotes } = await import("./prices");
    const existing = [{ symbol: "WETH", usd: 2120, change24h: null }];
    const result = await fetchDexQuotes(["INKO"], existing);
    expect(result).toHaveLength(1);
    expect(result[0]!.symbol).toBe("INKO");
    // INKO = 2.64 / 227M * 2120 ≈ $0.0000246
    expect(result[0]!.usd).toBeGreaterThan(0.00001);
    expect(result[0]!.usd).toBeLessThan(0.0001);
  });

  it("derives price from V2 pool reserves (baseToken=1: KRAKMASK/WETH)", async () => {
    // Real data: token0=KRAKMASK (~123.6M KRAKMASK), token1=WETH (~5.57 WETH)
    const r0 = BigInt("123604044000000000000000000").toString(16).padStart(64, "0");
    // 5.57 WETH = 5570000000000000000n
    const r1 = BigInt("5570000000000000000").toString(16).padStart(64, "0");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          jsonrpc: "2.0",
          id: 0,
          result: "0x" + r0 + r1 + "0".repeat(64),
        },
      ],
    } as Response);

    const { fetchDexQuotes } = await import("./prices");
    const existing = [{ symbol: "WETH", usd: 2120, change24h: null }];
    const result = await fetchDexQuotes(["KRAKMASK"], existing);
    expect(result).toHaveLength(1);
    expect(result[0]!.symbol).toBe("KRAKMASK");
    // KRAKMASK = (5.57 / 123.6M) * 2120 ≈ $0.0000955
    expect(result[0]!.usd).toBeGreaterThan(0.00001);
    expect(result[0]!.usd).toBeLessThan(0.001);
  });

  it("handles empty reserves gracefully", async () => {
    const r0 = "0".repeat(64);
    const r1 = "0".repeat(64);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          jsonrpc: "2.0",
          id: 0,
          result: "0x" + r0 + r1 + "0".repeat(64),
        },
      ],
    } as Response);

    const { fetchDexQuotes } = await import("./prices");
    const existing = [{ symbol: "WETH", usd: 2120, change24h: null }];
    const result = await fetchDexQuotes(["INKO"], existing);
    expect(result).toHaveLength(0);
  });

  it("returns empty when base token price is missing", async () => {
    const { fetchDexQuotes } = await import("./prices");
    const result = await fetchDexQuotes(["UNKNOWN_SYMBOL"], []);
    expect(result).toHaveLength(0);
  });
});

describe("fetchQuotes - pipeline includes DEX layer", () => {
  it("prices INKO via DEX pools when HL and CG miss it", async () => {
    // HL returns everything except INKO
    // CG returns nothing for INKO
    // DEX V2 pool should price INKO
    const r0 = BigInt("2640000000000000000").toString(16).padStart(64, "0");
    const r1 = BigInt("227620720000000000000000000").toString(16).padStart(64, "0");

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ETH: "2120", BTC: "68000" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ethereum: { usd: 2120, usd_24h_change: 5 } }),
      } as Response)
      // DEX RPC call for INKO V2 pool (first pool in registry is V2, second is CL)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            jsonrpc: "2.0",
            id: 0,
            result: "0x" + r0 + r1 + "0".repeat(64),
          },
        ],
      } as Response);

    const { fetchQuotes } = await import("./prices");
    const result = await fetchQuotes(["ETH", "BTC", "INKO"]);
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.some((q) => q.symbol === "INKO")).toBe(true);
    expect(result.find((q) => q.symbol === "INKO")!.usd).toBeGreaterThan(0.00001);
  });
});

describe("fetchQuotes - symbol aliases", () => {
  it("maps KBTC to BTC price", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ BTC: "68258" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ bitcoin: { usd: 68258, usd_24h_change: 5.5 } }),
      } as Response);

    const { fetchQuotes } = await import("./prices");
    const result = await fetchQuotes(["KBTC"]);
    expect(result.some((q) => q.symbol === "KBTC")).toBe(true);
    expect(result.find((q) => q.symbol === "KBTC")!.usd).toBe(68258);
  });

  it("maps WBTC and CBBTC to BTC price", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ BTC: "68258" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ bitcoin: { usd: 68258, usd_24h_change: 5.5 } }),
      } as Response);

    const { fetchQuotes } = await import("./prices");
    const result = await fetchQuotes(["WBTC", "CBBTC"]);
    expect(result.filter((q) => q.usd === 68258).length).toBeGreaterThanOrEqual(2);
    for (const s of ["WBTC", "CBBTC"]) {
      expect(result.some((q) => q.symbol === s)).toBe(true);
      expect(result.find((q) => q.symbol === s)!.usd).toBe(68258);
    }
  });
});
