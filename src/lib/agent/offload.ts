// Offload: when an observation outgrows the prompt cap, the middle is dropped
// from the model's view (clampResult / clampDataText). Instead of letting that
// data vanish, the full payload is parked in the IndexedDB cache keyed by a
// short id. The card (and, later, the model) keeps the key and can read the
// full result back.
//
// Offload is per-turn scratch space, not a store: a capped index trims old
// keys by BOTH count and total bytes, so the cache does not grow without
// bound across sessions.
//
// IDB, not OPFS: a SyncAccessHandle is worker-only and needs
// crossOriginIsolated plus a user gesture, none of which this (main-thread)
// code path can take for granted. The IDB cache already holds the other large
// payloads (wallet snapshot, venue reports, quotes). When the agent worker
// lands, this module moves with it and can switch to OPFS behind the same
// signatures.

import { MAX_OBSERVATION_CHARS } from "@/lib/agent/context";
import { uid } from "@/lib/store";
import { idbDelete, idbGet, idbSet } from "@/lib/cache/idb";

const INDEX_KEY = "offload:index";
const OFFLOAD_CAP = 100;
/** Total-byte budget for parked payloads; a single giant entry is still kept
 * (evicting the entry that was just promised a key would break its readback). */
const OFFLOAD_BYTES = 20 * 1024 * 1024;

/** One parked payload's index line. Order is park order = chronological. */
type OffloadEntry = { key: string; bytes: number; ts: number };

/** Parks still being written, by key. Readers await these before reading. */
const pending = new Map<string, Promise<void>>();

/** Parks run one at a time: the index is a read-modify-write, and two
 * interleaved trims would lose an entry (orphaning a data key forever). */
let parkQueue: Promise<unknown> = Promise.resolve();
function serialize<T>(op: () => Promise<T>): Promise<T> {
  const next = parkQueue.then(op);
  parkQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * Park the full payload if it would be truncated, and return the key to read
 * it back with. Under the cap, returns null and writes nothing. Synchronous
 * by contract: the key is needed at capture time, the write is fire-and-forget
 * (a card's "show full result" reads it back after the write has landed).
 */
export function offloadIfTruncated(value: unknown): string | null {
  return captureResult(value).offloadKey ?? null;
}

/** What one captured tool/command result produces: the payload that may ride
 * into a card or observation, plus the key to its parked full copy. */
export type CapturedResult = { clamped: unknown; offloadKey?: string };

/**
 * Measure a result once and produce everything the capture sites need from
 * that one JSON.stringify: the clamped payload plus, when it was truncated,
 * the offload key. Sites used to clamp and offload separately, serializing a
 * multi-MB result two or three times on the main thread.
 *
 * Two clamp semantics, matching the two layers that existed before:
 * - default (clampResult): under the cap the ORIGINAL value passes through.
 * - asJson (clampDataText): the payload is always the JSON string, so the
 *   bytes are identical to what the assembly layer produced before.
 * The truncation marker text is the same in both.
 */
export function captureResult(out: unknown, opts: { asJson?: boolean } = {}): CapturedResult {
  let json: string;
  try {
    json = JSON.stringify(out ?? (opts.asJson ? {} : null));
  } catch {
    return { clamped: opts.asJson ? "{}" : out };
  }
  if (json.length <= MAX_OBSERVATION_CHARS) return { clamped: opts.asJson ? json : out };
  const half = Math.floor(MAX_OBSERVATION_CHARS / 2);
  const clamped = `${json.slice(0, half)}\n[truncated: first and last ${half} of ${json.length} chars]\n${json.slice(-half)}`;
  const key = `offload:${uid()}`;
  trackPending(key, parkOffload(key, json));
  return { clamped, offloadKey: key };
}

/** Register an in-flight park so readers can wait for it, then self-remove. */
function trackPending(key: string, write: Promise<void>): void {
  pending.set(key, write);
  void write
    .catch(() => undefined)
    .finally(() => {
      pending.delete(key);
    });
}

/** Write one parked payload and keep the index trimmed. Exported for tests. */
export async function parkOffload(key: string, json: string): Promise<void> {
  await serialize(async () => {
    await idbSet(key, json);
    await trimIndex(key, json.length);
  });
}

/** Wait until every park started so far has settled (tests, clean shutdown). */
export async function flushOffloadWrites(): Promise<void> {
  await parkQueue;
}

/** Keep the index within both caps: append the key, drop the oldest past
 * the entry count or the byte budget. */
async function trimIndex(appended: string, bytes: number): Promise<void> {
  const entries = (await idbGet<OffloadEntry[]>(INDEX_KEY)) ?? [];
  if (!entries.some((e) => e.key === appended)) {
    entries.push({ key: appended, bytes, ts: Date.now() });
  }
  const { kept, evicted } = evictToFit(entries, OFFLOAD_CAP, OFFLOAD_BYTES);
  await idbSet(INDEX_KEY, kept);
  await Promise.all(evicted.map((e) => idbDelete(e.key)));
}

/** Pure split: drop the oldest entries until both caps hold. The newest entry
 * always survives, even alone above the byte budget. */
export function evictToFit(
  entries: OffloadEntry[],
  capCount: number,
  capBytes: number,
): { kept: OffloadEntry[]; evicted: OffloadEntry[] } {
  const kept = [...entries];
  const evicted: OffloadEntry[] = [];
  const totalBytes = () => kept.reduce((s, e) => s + e.bytes, 0);
  while (kept.length > 1 && (kept.length > capCount || totalBytes() > capBytes)) {
    const oldest = kept.shift();
    if (oldest) evicted.push(oldest);
  }
  return { kept, evicted };
}

export function isOffloadKey(key: string): boolean {
  return typeof key === "string" && key.startsWith("offload:");
}

/** Read back a parked payload. Null on a miss or when the key is not offload.
 * A read that races an in-flight write of the same key waits for the write. */
export async function readOffloaded(key: string): Promise<unknown> {
  if (!isOffloadKey(key)) return null;
  const write = pending.get(key);
  if (write) await write.catch(() => undefined);
  const json = await idbGet<string>(key);
  if (json == null) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
