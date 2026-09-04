// Time-to-useful-action instrumentation (AI_RUNTIME_V2 P0.1).
//
// One lightweight trace object per app start plus one per agent turn. Pure
// Date.now()/performance.now() bookkeeping, no allocations beyond one object
// per phase, no network, no storage. The trace is the measurement layer P1
// benchmarking builds on: without it we cannot tell a harness bottleneck
// (routing, retrieval, context compile) from an inference one (load,
// prefill, decode).
//
// Phase ids (startup): navigation, firstPaint, dataReady
// Phase ids (turn):    deterministic, semantic, route, skill, command,
//                      tool (one span per executed tool), context,
//                      modelLoad, answer, prefill, decode
//
// Everything is also mirrored to window.__perf (startup) and
// window.__lastPerf (turn) so a live run can be interrogated from the
// console or automation without digging through the agent log.

type Phase = Record<string, { ms?: number; note?: string }>;

export type PerfTrace = {
  startedAt: number;
  /** startup: navigation -> firstPaint -> dataReady */
  startup: Phase;
  /** one agent turn */
  turn?: {
    question: string;
    model: string;
    backend?: string;
    phases: Phase;
    /** what the load actually engaged (P1 telemetry: requested vs effective) */
    runtime?: {
      backend?: string;
      threadsRequested?: number;
      threadsEffective?: number;
      gpuLayers?: number;
      nCtx?: number;
      batch?: number;
      cacheK?: string;
      cacheV?: string;
      flashAttn?: boolean;
      cacheReuse?: number;
    };
    /** the answer generation's own measurements, when a model answered */
    generation?: {
      promptTokens: number | null;
      promptTokensEstimated?: boolean;
      outputTokens: number;
      ttftMs: number | null;
      decodeTps: number | null;
      totalMs: number;
      reasoningTokens: number | null;
    };
    /** timestamp when the first useful deterministic result appeared */
    firstUsefulActionAt?: number;
    /** timestamp when the grounded answer text landed */
    answerDoneAt?: number;
    /** total ms from turn start to first useful action */
    timeToUsefulActionMs?: number;
    /** total ms from turn start to answered */
    totalMs?: number;
    /** set when the turn failed before an answer landed; carries the reason */
    failed?: string;
    /** internal turn-start clock, not part of the public trace shape */
    _t0?: number;
  };
  /** snapshot of the most recently finished turn, stable across beginTurn */
  completed?: PerfTrace["turn"];
};

export type PerfPhase =
  | "deterministic"
  | "semantic"
  | "route"
  | "skill"
  | "command"
  | "tool"
  | "context"
  | "modelLoad"
  | "decide"
  | "answer"
  | "prefill"
  | "decode";

// ── process-global singleton ──────────────────────────────────────────

const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
const perf: PerfTrace = { startedAt: t0, startup: {} };

function markStartup(name: "navigation" | "firstPaint" | "dataReady", note?: string) {
  perf.startup[name] = { ms: Math.round((performance.now() - t0) * 10) / 10, note };
  mirror();
}

export { markStartup };

/** Start a new agent-turn trace. No-op re-starts are safe; the clock runs
 * from the first `beginTurn` of the turn until `markAnswerDone`. */
export function beginTurn() {
  perf.turn = {
    question: "",
    model: "",
    backend: undefined,
    phases: {},
    firstUsefulActionAt: undefined,
    answerDoneAt: undefined,
    timeToUsefulActionMs: undefined,
    totalMs: undefined,
    _t0: Date.now(),
  };
  mirror();
}

export function tagTurn(question: string) {
  if (perf.turn && !perf.turn.question) perf.turn.question = question;
}

export function tagModel(model: string, backend?: string) {
  if (!perf.turn) return;
  if (!perf.turn.model) perf.turn.model = model;
  if (backend) perf.turn.backend = backend;
}

/** What the load actually engaged (merge: later fields win, earlier survive). */
export function tagRuntime(rt: NonNullable<NonNullable<PerfTrace["turn"]>["runtime"]>) {
  if (!perf.turn) return;
  perf.turn.runtime = { ...perf.turn.runtime, ...rt };
  mirror();
}

/** The answer generation's measurements (last write wins: decide hops share
 *  the turn, the final answer is what the trace should keep). */
export function tagGeneration(g: NonNullable<NonNullable<PerfTrace["turn"]>["generation"]>) {
  if (!perf.turn) return;
  perf.turn.generation = g;
  mirror();
}

/** ms since the active turn began. */
export function elapsed(): number {
  const t0 = perf.turn?._t0;
  return t0 != null ? Date.now() - t0 : 0;
}

/** Record a phase duration on the active turn. Calling with the same phase
 * twice sums the durations (retrieval + selection + intent all count as the
 * semantic layer). No-op outside a turn. */
export function measure(phase: PerfPhase, ms: number, note?: string) {
  if (!perf.turn) return;
  const prev = perf.turn.phases[phase];
  perf.turn.phases[phase] = {
    ms: Math.round(((prev?.ms ?? 0) + ms) * 10) / 10,
    note: prev?.note ? `${prev.note} + ${note ?? phase}` : note,
  };
}

/**
 * First useful deterministic action of the turn (a tool or command produced
 * data). Idempotent: the first call wins, later results do not shorten the
 * KPI.
 */
export function markFirstUsefulAction() {
  if (!perf.turn || perf.turn.firstUsefulActionAt != null) return;
  const ms = elapsed();
  perf.turn.firstUsefulActionAt = ms;
  perf.turn.timeToUsefulActionMs = ms;
  mirror();
}

export function markAnswerDone() {
  if (!perf.turn) return;
  const ms = elapsed();
  perf.turn.answerDoneAt = ms;
  perf.turn.totalMs = ms;
  // KPI defaults to the answer moment if no deterministic action fired first.
  if (perf.turn.timeToUsefulActionMs == null) perf.turn.timeToUsefulActionMs = ms;
  perf.completed = perf.turn;
  mirror();
}

/**
 * The active turn failed before an answer landed (runtime error, empty
 * output, model that never loaded). Freeze it as the completed snapshot
 * with the reason, so /usage reports the failure instead of silently
 * printing whatever older turn completed last. No useful-action KPI is
 * recorded: a failed turn never produced one.
 */
export function markTurnFailed(reason: string) {
  if (!perf.turn) return;
  perf.turn.failed = reason;
  if (perf.turn.totalMs == null) perf.turn.totalMs = elapsed();
  perf.completed = perf.turn;
  mirror();
}

export function getPerf(): PerfTrace {
  return perf;
}

/** Latest finished turn trace, for /usage and the agent log. */
export function lastTurn(): PerfTrace["turn"] | undefined {
  return perf.turn?.totalMs != null ? perf.turn : undefined;
}

/**
 * The last turn that actually finished, stable across the next `beginTurn`.
 * /usage reads this: by the time the /usage command handler runs, its own
 * beginTurn has already reset the active trace, so the in-flight turn can
 * never answer the question.
 */
export function completedTurn(): PerfTrace["turn"] | undefined {
  return perf.completed;
}

// ── window mirror (browser only, SSR-safe) ─────────────────────────────

function mirror() {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __perf?: unknown; __lastPerf?: unknown };
  w.__perf = perf;
  if (lastTurn()) w.__lastPerf = lastTurn();
}
