// Ledger: only new transfers file, history reads back newest-first, values
// price at read time, merge dedupes, and sync bookmarks drive sinceBlock.
// The IDB layer is mocked with in-memory maps (real IndexedDB does not exist
// under the node test environment), mirroring the offload test's approach.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const stores: Record<string, Map<string, Row>> = {
  trades: new Map(),
  actions: new Map(),
  meta: new Map(),
};

vi.mock("@/lib/cache/idb", () => ({
  storePut: async (_name: string, rows: Row[]) => {
    for (const row of rows) {
      stores.trades.set(row.id as string, row);
    }
  },
  storeByIndex: async <T>(name: string, index: string, value: unknown): Promise<T[]> =>
    [...stores[name].values()].filter((r) => r[index] === value) as T[],
  metaGet: async <T>(key: string) => stores.meta.get(key) as T | undefined,
  metaSet: async (key: string, value: unknown) => {
    stores.meta.set(key, value as Row);
  },
}));

const { ingestTransfers, readLedgerTrades, withQuotes, mergeTrades, recordSync, sinceBlockFor } =
  await import("./ledger");

const t = (
  txHash: string,
  logIndex: number,
  ts: number,
  block: number | null,
  symbol = "INKO",
) => ({
  txHash,
  logIndex,
  symbol,
  decimals: 18,
  amount: 1,
  direction: "in" as const,
  counterparty: "0xabc",
  ts,
  blockNumber: block,
});

beforeEach(() => {
  for (const m of Object.values(stores)) m.clear();
});

describe("ingestTransfers", () => {
  it("files every transfer once and reports only the newcomers", async () => {
    const batch = [t("0x1", 0, 1, 10), t("0x2", 0, 2, 11)];
    const first = await ingestTransfers("w1", batch);
    expect(first.added).toBe(2);
    const second = await ingestTransfers("w1", batch);
    expect(second.added).toBe(0);
    // same transfers under another wallet are separate rows
    const other = await ingestTransfers("w2", batch);
    expect(other.added).toBe(2);
  });

  it("tracks the highest block seen within the batch", async () => {
    const high = await ingestTransfers("w1", [t("0x1", 0, 1, 500), t("0x2", 0, 2, 300)]);
    expect(high.maxBlock).toBe(500);
    // a batch with no block numbers reports none; the running max is the
    // bookmark's job (recordSync never moves it backwards)
    const low = await ingestTransfers("w1", [t("0x3", 0, 3, null)]);
    expect(low.maxBlock).toBeNull();
  });

  it("reads back newest-first per wallet", async () => {
    await ingestTransfers("w1", [t("0x1", 0, 1, 10), t("0x2", 0, 3, 11), t("0x3", 0, 2, 12)]);
    const rows = await readLedgerTrades("w1");
    expect(rows.map((r) => r.ts)).toEqual([3, 2, 1]);
  });
});

describe("withQuotes and mergeTrades", () => {
  it("prices rows from the current quote set, leaving unknowns null", async () => {
    await ingestTransfers("w1", [t("0x1", 0, 1, 10), t("0x2", 0, 2, 11, "ZZZ")]);
    const rows = await readLedgerTrades("w1");
    const priced = withQuotes(rows, [{ symbol: "inko", usd: 2, change24h: null }]);
    expect(priced.find((r) => r.symbol === "INKO")?.value).toBe(2);
    expect(priced.find((r) => r.symbol === "ZZZ")?.value).toBeNull();
  });

  it("merges on id without duplicates, newest first", () => {
    const a = { id: "0x1:0", ts: 1, symbol: "A" };
    const b = { id: "0x2:0", ts: 3, symbol: "B" };
    const merged = mergeTrades([a as never], [{ ...a } as never, b as never]);
    expect(merged.map((m) => m.id)).toEqual(["0x2:0", "0x1:0"]);
  });
});

describe("sync bookmarks", () => {
  it("returns null before the first full scan", async () => {
    expect(await sinceBlockFor("w1")).toBeNull();
  });

  it("resumes from lastBlock after a fresh full scan", async () => {
    await recordSync("w1", 500, true);
    expect(await sinceBlockFor("w1")).toBe(500);
  });

  it("forces a full scan when the last one is older than a day", async () => {
    await recordSync("w1", 500, true);
    // age the bookmark past the full-refresh window
    const meta = stores.meta.get("sync:w1") as { lastBlock: number; fullAt: number };
    meta.fullAt = Date.now() - 25 * 60 * 60 * 1000;
    expect(await sinceBlockFor("w1")).toBeNull();
  });

  it("an incremental scan never resets the full-scan timestamp", async () => {
    await recordSync("w1", 500, true);
    const meta = stores.meta.get("sync:w1") as { fullAt: number };
    const stamped = meta.fullAt;
    await recordSync("w1", 600, false);
    expect((stores.meta.get("sync:w1") as { fullAt: number }).fullAt).toBe(stamped);
    expect(await sinceBlockFor("w1")).toBe(600);
  });
});
