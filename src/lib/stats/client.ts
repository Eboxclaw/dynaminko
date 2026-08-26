// Aggregate usage counters. Events are names only: no addresses, no content,
// no session ids ever leave the browser. If /api/stats is unconfigured (local
// dev, missing Upstash env) every call degrades to a silent no-op, so the
// local-first guarantee is untouched.
//
// track() never throws and never blocks the caller; a burst of calls shares
// one POST.

export const STATS_EVENTS = [
  "wallet_watched",
  "journal_entry_created",
  "agent_turn_completed",
  "attestation_signed",
] as const;

export type StatsEvent = (typeof STATS_EVENTS)[number] | `venue_read_${string}`;

const ENDPOINT = "/api/stats";
const FLUSH_MS = 1_500;
const MAX_BATCH = 32;

let enabled: boolean | null = null;
let queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function isStatsEvent(value: string): value is StatsEvent {
  return (STATS_EVENTS as readonly string[]).includes(value) || value.startsWith("venue_read_");
}

async function probe(): Promise<boolean> {
  try {
    const res = await fetch(ENDPOINT, { headers: { accept: "application/json" } });
    return ((await res.json()) as { configured?: boolean }).configured === true;
  } catch {
    return false;
  }
}

function schedule() {
  if (timer === null) timer = setTimeout(() => void flush(), FLUSH_MS);
}

async function flush(): Promise<void> {
  timer = null;
  const events = queue.splice(0, MAX_BATCH);
  if (queue.length > 0) schedule();
  if (events.length === 0) return;
  if (enabled === null) enabled = await probe();
  if (!enabled) return;
  try {
    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events }),
      keepalive: true,
    });
  } catch {
    // Counters are best-effort; losing a batch is fine.
  }
}

/** Fire-and-forget. Safe in workers (fetch only) and in tests (no-ops). */
export function track(event: StatsEvent, count = 1): void {
  if (enabled === false) return;
  if (!isStatsEvent(event) || count < 1) return;
  const n = Math.min(count, MAX_BATCH);
  for (let i = 0; i < n; i++) queue.push(event);
  if (queue.length > MAX_BATCH * 4) queue = queue.slice(-MAX_BATCH * 4);
  schedule();
}
