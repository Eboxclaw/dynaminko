// Evidence digest for multi-hop tool selection.
//
// The decide call is deliberately small (96 tokens out, grammar-constrained),
// but it must SEE what earlier hops observed, or hop 2 cannot build on hop 1.
// This digest keeps that context tight: one line per observation plus the
// latest observation's data, capped, so five hops cannot drown the pick.

export type HopObservation = {
  id: string;
  status: string;
  summary?: string;
  data?: unknown;
};

const MAX_LAST_DATA_CHARS = 1200;

/** Compact evidence block for the next decide call. Empty when nothing has
 * run yet, so the prompt stays identical to the single-hop shape. */
export function hopEvidence(observations: HopObservation[]): string {
  if (observations.length === 0) return "";
  const lines = observations.map((o) => `${o.id} (${o.status}): ${o.summary ?? "no summary"}`);
  const last = observations[observations.length - 1];
  const data = typeof last.data === "string" ? last.data : JSON.stringify(last.data ?? {});
  const clipped =
    data.length > MAX_LAST_DATA_CHARS ? `${data.slice(0, MAX_LAST_DATA_CHARS)}…[clipped]` : data;
  return [...lines, `latest result data: ${clipped}`].join("\n");
}

/**
 * Whether a hop repeats one that already ran this turn (same tool, same
 * input). Repeats are how a loop spins: the pick is declined and the loop
 * ends instead of burning the budget on identical work.
 */
export function isRepeatHop(pickKey: string, executedKeys: string[]): boolean {
  return executedKeys.includes(pickKey);
}

/** Stable identity of one hop: tool id plus the arguments it would run with. */
export function hopKey(id: string, input: Record<string, unknown>): string {
  return `${id}:${JSON.stringify(input)}`;
}
