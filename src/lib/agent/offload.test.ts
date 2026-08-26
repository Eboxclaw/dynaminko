// Offload: only truncated payloads get parked, the parked copy round-trips,
// parks serialize so the index never loses an entry, and the index trims by
// both count and bytes. The IDB layer is mocked with an in-memory map (with a
// small write delay, so read/write races are reproducible) because real
// IndexedDB does not exist under the node test environment.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_OBSERVATION_CHARS } from "./context";

const store = new Map<string, unknown>();
let deleted: string[] = [];

vi.mock("@/lib/cache/idb", () => ({
  idbSet: async (key: string, value: unknown) => {
    await new Promise((r) => setTimeout(r, 1)); // writes land asynchronously
    store.set(key, value);
  },
  idbGet: async <T>(key: string) => store.get(key) as T | undefined,
  idbDelete: async (key: string) => {
    store.delete(key);
    deleted.push(key);
  },
}));

// Import after the mock so the module binds the fakes.
const { offloadIfTruncated, parkOffload, readOffloaded, evictToFit, isOffloadKey, flushOffloadWrites } =
  await import("./offload");

const INDEX_KEY = "offload:index";
type Entry = { key: string; bytes: number; ts: number };

// A payload whose JSON form is guaranteed to exceed the cap, sized from the cap
// itself so the test does not depend on an incidental char count.
const big = "x".repeat(MAX_OBSERVATION_CHARS * 2);

const indexKeys = () => ((store.get(INDEX_KEY) as Entry[]) ?? []).map((e) => e.key);

beforeEach(async () => {
  // Drain every park the previous test fired (the queue is part of the
  // module under test) before resetting the store, so each test starts
  // from a deterministic cache.
  await flushOffloadWrites();
  store.clear();
  deleted = [];
});

describe("offloadIfTruncated", () => {
  it("returns null and writes nothing under the cap", () => {
    expect(offloadIfTruncated({ a: 1 })).toBeNull();
  });

  it("returns a key for a payload over the cap", () => {
    expect(offloadIfTruncated({ note: big })).toMatch(/^offload:/);
  });

  it("assigns a distinct key per call", () => {
    expect(offloadIfTruncated({ note: big })).not.toBe(offloadIfTruncated({ note: big }));
  });

  it("parks the payload and the index survives the async write", async () => {
    const key = offloadIfTruncated({ note: big, id: 42 }) as string;
    await readOffloaded(key); // awaits the pending write
    expect(JSON.parse(store.get(key) as string)).toEqual({ note: big, id: 42 });
    expect(indexKeys()).toEqual([key]);
  });
});

describe("readOffloaded", () => {
  it("returns null for a miss and for a non-offload key", async () => {
    expect(await readOffloaded("offload:does-not-exist")).toBeNull();
    expect(await readOffloaded("snapshot:57073:0xabc")).toBeNull();
  });

  it("round-trips a parked payload", async () => {
    const key = `offload:${Math.random()}`;
    await parkOffload(key, JSON.stringify({ note: big }));
    expect(await readOffloaded(key)).toEqual({ note: big });
  });

  it("waits for an in-flight write instead of reporting a false miss", async () => {
    // The A4 race: the key exists before the (delayed) write lands. Reading
    // immediately must still return the payload, not null.
    const key = offloadIfTruncated({ note: big }) as string;
    expect(store.has(key)).toBe(false); // write has not landed yet
    expect(await readOffloaded(key)).toEqual({ note: big });
  });

  it("returns null for corrupt data", async () => {
    const key = "offload:corrupt";
    store.set(key, "{ not json ");
    expect(await readOffloaded(key)).toBeNull();
  });
});

describe("parkOffload", () => {
  it("records the key in the index with its byte size", async () => {
    const key = "offload:a";
    await parkOffload(key, JSON.stringify({ i: 1 }));
    const entries = store.get(INDEX_KEY) as Entry[];
    expect(entries.map((e) => e.key)).toEqual([key]);
    expect(entries[0]!.bytes).toBe(JSON.stringify({ i: 1 }).length);
  });

  it("does not duplicate an index entry when the same key is parked twice", async () => {
    await parkOffload("offload:fixed", "1");
    await parkOffload("offload:fixed", "2");
    expect(indexKeys()).toEqual(["offload:fixed"]);
    expect(store.get("offload:fixed")).toBe("2");
  });

  it("keeps both keys when two parks run concurrently (no lost update)", async () => {
    // The A3 race: unserialized read-modify-write used to leave only one key.
    await Promise.all([parkOffload("offload:A", "a"), parkOffload("offload:B", "b")]);
    expect(indexKeys().sort()).toEqual(["offload:A", "offload:B"]);
  });

  it("fires idbDelete for the oldest keys when the count cap is exceeded", async () => {
    const CAP = 100; // module default
    for (let i = 0; i < CAP; i++) await parkOffload(`offload:a${i}`, "{}");
    await parkOffload("offload:last", "{}");
    const keys = indexKeys();
    expect(keys.length).toBe(CAP);
    expect(keys[keys.length - 1]).toBe("offload:last");
    expect(deleted).toContain("offload:a0");
    expect(store.has("offload:a0")).toBe(false);
    expect(store.has("offload:last")).toBe(true);
  });
});

describe("evictToFit", () => {
  const e = (key: string, bytes: number): Entry => ({ key, bytes, ts: 0 });

  it("keeps all entries at or under both caps", () => {
    const entries = [e("a", 10), e("b", 10)];
    expect(evictToFit(entries, 3, 100)).toEqual({ kept: entries, evicted: [] });
  });

  it("drops the oldest past the count cap", () => {
    const { kept, evicted } = evictToFit([e("a", 1), e("b", 1), e("c", 1), e("d", 1)], 3, 100);
    expect(kept.map((x) => x.key)).toEqual(["b", "c", "d"]);
    expect(evicted.map((x) => x.key)).toEqual(["a"]);
  });

  it("drops the oldest past the byte budget even under the count cap", () => {
    const { kept, evicted } = evictToFit([e("big-old", 80), e("small", 30), e("new", 10)], 10, 100);
    expect(kept.map((x) => x.key)).toEqual(["small", "new"]);
    expect(evicted.map((x) => x.key)).toEqual(["big-old"]);
  });

  it("never evicts the newest entry even when it alone exceeds the byte budget", () => {
    const { kept, evicted } = evictToFit([e("old", 1), e("giant-new", 500)], 10, 100);
    expect(kept.map((x) => x.key)).toEqual(["giant-new"]);
    expect(evicted.map((x) => x.key)).toEqual(["old"]);
  });
});

describe("isOffloadKey", () => {
  it("accepts only offload-prefixed keys", () => {
    expect(isOffloadKey("offload:abc")).toBe(true);
    expect(isOffloadKey("venues:57073:0xabc")).toBe(false);
    expect(isOffloadKey("")).toBe(false);
  });
});
