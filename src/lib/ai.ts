// On-device assistant bridge. The heavy orchestration (wllama lifecycle, model
// loading, chat completion) runs inside a dedicated Web Worker
// (src/workers/ai.worker.ts) so the main thread never blocks on WASM
// instantiation or model loading.
//
// This module exports the same API surface as before — every consumer imports
// from @/lib/ai and works unchanged. Synchronous accessors (isReady,
// loadedModelId, etc.) read module-level state kept in sync by worker messages.
// Static config (MODELS, MODEL_BY_ID, etc.) stays on the main thread.

import type { Wllama } from "@wllama/wllama/esm/index.js";
import { runtimeSnapshot, type Backend } from "@/lib/ai/runtime";
import type { AiWorkerRequest, AiWorkerResponse } from "@/workers/ai.worker";

// ── static config (stays on main thread) ─────────────────────────────
// This registry is the single source of truth; the AI worker imports it from
// here instead of keeping its own copy (this module has no runtime imports,
// so bundling it into the worker is safe).

export type Capability = "encode" | "extract" | "vision" | "assist" | "reason";

export type ModelSpec = {
  id: string;
  label: string;
  repo: string;
  quant: string;
  runtime: "gguf" | "transformers";
  serve: string;
  blurb: string;
  role: string;
  capabilities: Capability[];
  desktopOnly?: boolean;
  weightsGb: number;
  minRamGb: number;
  vision: boolean;
  mmprojQuant?: string;
  reasoning: boolean;
  generative: boolean;
  maxCtx: number;
  nLayers: number;
  /**
   * KV-carrying attention geometry, from the published configs. LFM2.5
   * hybrids keep their context-scaled KV cache only on the full-attention
   * blocks (conv blocks cache a short fixed window that does not scale with
   * ctx), so the budget model must know how many layers actually grow with
   * context. Absent: the budget falls back to a weights-proportional KV
   * guess and the load outcome degrades to UNCERTAIN.
   */
  kv?: { attnLayers: number; kvHeads: number; headDim: number };
  /**
   * Decide-phase tool menu format (opengrok adapter pattern): "book" renders
   * the plain-text capability list in the user message (default), "native"
   * passes the capabilities as `tools` so the LFM chat template renders its
   * own `List of tools: [...]` in the system prompt.
   */
  decideMenu?: "book" | "native";
  sampling?: {
    temperature: number;
    minP: number;
    repeatPenalty: number;
    penaltyLastN: number;
    topK?: number;
  };
  backend: { preferred: "webgpu"; fallback: "wasm" };
};

const BROWSER_BACKEND = { preferred: "webgpu", fallback: "wasm" } as const;

const MODEL_LIST: Omit<ModelSpec, "backend">[] = [
  {
    id: "lfm2-2_6",
    label: "LFM 2.5 2.6B",
    repo: "LiquidAI/LFM2.5-2.6B-GGUF",
    quant: "QAD-Q4_0",
    runtime: "gguf",
    serve: "llama serve -hf LiquidAI/LFM2.5-2.6B-GGUF:QAD-Q4_0",
    blurb: "Strongest and slowest. Desktop standard.",
    role: "Complex reasoning and generation, when it is actually needed",
    capabilities: ["assist", "reason", "extract"],
    desktopOnly: true,
    weightsGb: 1.59,
    minRamGb: 6,
    vision: false,
    reasoning: true,
    generative: true,
    maxCtx: 128192,
    nLayers: 32,
    kv: { attnLayers: 8, kvHeads: 8, headDim: 64 },
    // decideMenu "native" measured-and-shelved (08-30): with `tools` passed,
    // the C++ tools path zeroes generation for dot-named tools on this
    // wllama build (decide empty ~100s, no content and no intercepted
    // tool_calls). The plain-text book picked correctly in every run. The
    // helpers stay (decideTools/inputsToSchema + worker tools passthrough
    // + tool_calls recovery) as tested groundwork for a future build.
    // decideMenu: "native",
    sampling: { temperature: 0.1, minP: 0.15, repeatPenalty: 1.1, penaltyLastN: 64, topK: 50 },
  },
  {
    id: "lfm2-1_2-instruct",
    label: "LFM 2.5 1.2B instruct",
    repo: "LiquidAI/LFM2.5-1.2B-Instruct-GGUF",
    quant: "QAD-Q4_0",
    runtime: "gguf",
    serve: "llama serve -hf LiquidAI/LFM2.5-1.2B-Instruct-GGUF:QAD-Q4_0",
    blurb: "Better reasoning about why a trade happened.",
    role: "Lightweight general assistant",
    capabilities: ["assist", "reason", "extract"],
    weightsGb: 0.696,
    minRamGb: 4,
    vision: false,
    reasoning: true,
    generative: true,
    maxCtx: 32128,
    nLayers: 24,
    kv: { attnLayers: 6, kvHeads: 8, headDim: 64 },
    sampling: { temperature: 0.1, minP: 0.15, repeatPenalty: 1.05, penaltyLastN: 64, topK: 50 },
  },
  {
    id: "lfm2-350",
    label: "LFM 2.5 350M",
    repo: "LiquidAI/LFM2.5-350M-GGUF",
    quant: "QAD-Q4_0",
    runtime: "gguf",
    serve: "llama serve -hf LiquidAI/LFM2.5-350M-GGUF:QAD-Q4_0",
    blurb: "Faster than the VL model, text-only, still follows FACTS and grounded turns well.",
    role: "On-device assistant. Default model.",
    capabilities: ["assist", "extract"],
    weightsGb: 0.219,
    minRamGb: 1.5,
    vision: false,
    reasoning: false,
    generative: true,
    // Card limit 32768: the ladder is opened to the card, the memory budget
    // gate (budgetGuard) rejects what the device cannot carry.
    maxCtx: 32768,
    nLayers: 28,
    kv: { attnLayers: 6, kvHeads: 8, headDim: 64 },
    sampling: { temperature: 0.1, minP: 0.15, repeatPenalty: 1.05, penaltyLastN: 64, topK: 50 },
  },
  {
    id: "lfm2-450-vl",
    label: "LFM 2.5 450M VL",
    repo: "LiquidAI/LFM2.5-VL-450M-GGUF",
    quant: "Q4_K_M",
    runtime: "gguf",
    serve: "llama serve -hf LiquidAI/LFM2.5-VL-450M-GGUF:Q4_K_M",
    blurb: "Vision variant of the 350M. Only download if you need image input.",
    role: "Vision-capable on-device assistant.",
    capabilities: ["vision", "extract", "assist"],
    weightsGb: 0.35,
    minRamGb: 2,
    vision: true,
    mmprojQuant: "F16",
    reasoning: false,
    generative: true,
    maxCtx: 32128,
    nLayers: 28,
    sampling: { temperature: 0.1, minP: 0.15, repeatPenalty: 1.05, penaltyLastN: 64, topK: 50 },
  },
  {
    id: "lfm2-1_2-thinking",
    label: "LFM 2.5 1.2B Thinking",
    repo: "LiquidAI/LFM2.5-1.2B-Thinking-GGUF",
    quant: "Q4_K_M",
    runtime: "gguf",
    serve: "llama serve -hf LiquidAI/LFM2.5-1.2B-Thinking-GGUF:Q4_K_M",
    blurb: "Chain-of-thought for deeper reasoning on trades.",
    role: "Thoughtful analysis and reasoning",
    capabilities: ["assist", "reason", "extract"],
    weightsGb: 0.731,
    minRamGb: 4,
    vision: false,
    reasoning: true,
    generative: true,
    maxCtx: 32768,
    nLayers: 16,
    kv: { attnLayers: 6, kvHeads: 8, headDim: 64 },
    sampling: { temperature: 0.05, minP: 0.15, repeatPenalty: 1.05, penaltyLastN: 64, topK: 50 },
  },
  {
    id: "minilm-6-v2",
    label: "All MiniLM L6 v2 encoder",
    repo: "onnx-community/all-MiniLM-L6-v2-ONNX",
    quant: "fp32",
    runtime: "transformers",
    serve: 'AutoModel.from_pretrained("onnx-community/all-MiniLM-L6-v2-ONNX")',
    blurb: "Semantic routing, retrieval and tagging. Never writes prose.",
    role: "Routing, retrieval, tool and skill discovery, light classification",
    capabilities: ["encode"],
    weightsGb: 0.09,
    minRamGb: 0,
    vision: false,
    reasoning: false,
    generative: false,
    maxCtx: 512,
    nLayers: 6,
  },
];

export const MODELS: ModelSpec[] = MODEL_LIST.map((m) => ({ ...m, backend: BROWSER_BACKEND }));
export const MODEL_BY_ID: Record<string, ModelSpec> = Object.fromEntries(
  MODELS.map((m) => [m.id, m]),
);
export const DEFAULT_MODEL_ID = "lfm2-350";
export const ENCODER_ID = "minilm-6-v2";

export const CAPABILITY_MODELS: Record<Capability, string[]> = {
  encode: ["minilm-6-v2"],
  extract: ["lfm2-350", "lfm2-1_2-instruct", "lfm2-2_6"],
  vision: ["lfm2-450-vl"],
  assist: ["lfm2-350", "lfm2-1_2-thinking", "lfm2-1_2-instruct", "lfm2-2_6"],
  reason: ["lfm2-1_2-thinking", "lfm2-1_2-instruct", "lfm2-2_6"],
};

export function modelFor(cap: Capability, downloaded?: Set<string>): ModelSpec | undefined {
  const ids = CAPABILITY_MODELS[cap] ?? [];
  const have = ids.find((id) => downloaded?.has(id));
  return MODEL_BY_ID[have ?? ids[0]];
}

// The full context ladder. The menu a model actually sees is
// ctxChoicesFor(spec.maxCtx): every model gets its real maximum, the 2.6B
// included (65536 is the sane in-browser ceiling for it; its spec allows
// 128192 but the KV cache at q8_0 would dwarf the weights).
export const CTX_CHOICES = [1024, 2048, 4096, 8192, 16384, 32128, 65536] as const;
export function ctxChoicesFor(maxCtx: number): number[] {
  return (CTX_CHOICES as readonly number[]).filter((c) => c <= maxCtx);
}
export const DEFAULT_CTX = 8192;

// Per-model context persistence: a /context choice survives reloads, keyed
// by model, clamped to that model's real maximum.
const CTX_KEY_PREFIX = "inko.ctx.";
export function persistCtx(modelId: string, n: number): number {
  const spec = MODEL_BY_ID[modelId];
  const clamped = spec ? Math.min(Math.max(256, Math.round(n)), spec.maxCtx) : Math.round(n);
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(CTX_KEY_PREFIX + modelId, String(clamped));
  } catch {
    /* storage unavailable: the choice stays session-only */
  }
  return clamped;
}
export function persistedCtx(modelId: string): number | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(CTX_KEY_PREFIX + modelId);
    const n = raw == null ? NaN : Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    const spec = MODEL_BY_ID[modelId];
    return spec ? Math.min(Math.round(n), spec.maxCtx) : Math.round(n);
  } catch {
    return null;
  }
}

// ── device profile (pure sync, stays on main thread) ─────────────────

export type DeviceProfile = {
  ramGb: number | null;
  cores: number | null;
  mobile: boolean;
  probed: boolean;
};

export const UNKNOWN_PROFILE: DeviceProfile = {
  ramGb: null,
  cores: null,
  mobile: false,
  probed: false,
};

export function deviceProfile(): DeviceProfile {
  if (typeof navigator === "undefined") return UNKNOWN_PROFILE;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mobile = typeof matchMedia === "function" ? matchMedia("(pointer: coarse)").matches : false;
  return {
    ramGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    cores: nav.hardwareConcurrency ?? null,
    mobile,
    probed: true,
  };
}

const RECOMMEND_ORDER = [
  "lfm2-350",
  "lfm2-1_2-thinking",
  "lfm2-1_2-instruct",
  "lfm2-450-vl",
  "lfm2-2_6",
];

export function recommendModel(profile = deviceProfile()): { id: string; reason: string } {
  if (!profile.probed) {
    return { id: DEFAULT_MODEL_ID, reason: "checking what this device can carry…" };
  }
  const assumed = profile.ramGb ?? (profile.mobile ? 2 : 4);
  const budget = profile.mobile ? assumed / 2 : assumed;
  const candidates = RECOMMEND_ORDER.map((id) => MODEL_BY_ID[id]).filter(Boolean);
  const pick =
    candidates.find(
      (m) => m.generative && budget >= m.minRamGb && !(m.desktopOnly && profile.mobile),
    ) ?? MODEL_BY_ID[DEFAULT_MODEL_ID]!;
  const seen =
    profile.ramGb != null ? `${profile.ramGb} GB reported` : "memory not reported by the browser";
  return {
    id: pick.id,
    reason: `${seen}${profile.mobile ? " · touch device" : ""} · ${pick.label} fits.`,
  };
}

// ── memory budget model (AI_RUNTIME_V2 P0.3) ─────────────────────────
//
// A budget ESTIMATE, never a claim about real free memory: weights + context-
// scaled KV + inference buffers + runtime overhead + safety margin = peak.
// Bytes come from the model's published architecture (kv.attnLayers etc.),
// not from proportionality guesses, and the device side only ever offers a
// conservative memory CLASS (runtime.ts), never total RAM.

const KV_DTYPE_BYTES: Record<string, number> = {
  f16: 2,
  q8_0: 1.0625, // 8.5 bits per element with block scales
  q4_0: 0.5625,
};

/** Context-scaled KV cache for one model, or null when its architecture
 * (KV-carrying layer count) is unknown. Defaults to q8_0 KV, the mobile
 * preference; f16 only where headroom is measured, not assumed. */
export function kvCacheGb(
  spec: Pick<ModelSpec, "kv">,
  nCtx: number,
  kvDtype: string = "q8_0",
): number | null {
  if (!spec.kv) return null;
  const bytesPerElem = KV_DTYPE_BYTES[kvDtype] ?? KV_DTYPE_BYTES.q8_0;
  const perToken = spec.kv.attnLayers * spec.kv.kvHeads * spec.kv.headDim * bytesPerElem * 2; // K + V
  return (perToken * nCtx) / 1024 ** 3;
}

// Scratch: activation/temp buffers and WebGPU buffer slack scale with model
// size; loader/runtime overhead is a floor. The margin covers allocator
// fragmentation and the unknowns (measured loads refine it in P1).
const BUFFER_FACTOR = 0.12;
const OVERHEAD_GB = 0.15;
const SAFETY_MARGIN = 0.15;

/** Estimated peak memory for one load configuration, or null when the
 * model's KV geometry is unknown (conservative degradation). */
export function memoryBudgetGb(
  spec: Pick<ModelSpec, "kv" | "weightsGb">,
  nCtx: number,
  kvDtype: string = "q8_0",
): number | null {
  const kv = kvCacheGb(spec, nCtx, kvDtype);
  if (kv == null) return null;
  const peak = spec.weightsGb + kv + spec.weightsGb * BUFFER_FACTOR + OVERHEAD_GB;
  return peak * (1 + SAFETY_MARGIN);
}

export type BudgetOutcome = {
  verdict: "SAFE" | "UNCERTAIN" | "UNSAFE";
  /** estimated peak, null when the model architecture is unknown */
  peakGb: number | null;
  basis: string;
};

/**
 * The three loading outcomes. UNSAFE rejects the configuration BEFORE the
 * allocation that would crash the tab; UNCERTAIN proceeds (conservative
 * configuration and calibration are P1); SAFE loads normally.
 */
export function budgetOutcome(
  spec: Pick<ModelSpec, "kv" | "weightsGb" | "id" | "label">,
  nCtx: number,
  memoryClassGb: number | null,
  kvDtype: string = "q8_0",
): BudgetOutcome {
  const peak = memoryBudgetGb(spec, nCtx, kvDtype);
  if (peak == null)
    return { verdict: "UNCERTAIN", peakGb: null, basis: "model KV architecture unknown" };
  if (memoryClassGb == null)
    return { verdict: "UNCERTAIN", peakGb: peak, basis: "device memory class unreported" };
  if (peak > memoryClassGb)
    return {
      verdict: "UNSAFE",
      peakGb: peak,
      basis: `peak ${peak.toFixed(2)} GB over the ${memoryClassGb} GB class`,
    };
  if (peak > memoryClassGb * 0.7)
    return {
      verdict: "UNCERTAIN",
      peakGb: peak,
      basis: `peak ${peak.toFixed(2)} GB near the ${memoryClassGb} GB class`,
    };
  return {
    verdict: "SAFE",
    peakGb: peak,
    basis: `peak ${peak.toFixed(2)} GB of ${memoryClassGb} GB`,
  };
}

/** Display estimate for the ModelPanel: architecture-aware when the KV
 * geometry is known, weights-proportional fallback otherwise. */
export function memoryEstimateGb(modelId: string, nCtx: number): number {
  const spec = MODEL_BY_ID[modelId];
  if (!spec) return 0;
  const budget = memoryBudgetGb(spec, nCtx);
  if (budget != null) return Math.round(budget * 10) / 10;
  const kv = (nCtx / 8192) * spec.weightsGb * 0.25;
  return Math.round((spec.weightsGb + kv) * 10) / 10;
}

// ── model state (pure sync, stays on main thread) ────────────────────

export type ModelState = "missing" | "downloaded" | "loading" | "loaded" | "unavailable" | "error";

export type AiStatus =
  | { phase: "idle"; modelId?: string }
  | { phase: "downloading"; progress: number; modelId?: string }
  | { phase: "loading"; modelId?: string }
  | { phase: "ready"; modelId?: string }
  | { phase: "error"; message: string; modelId?: string };

export type LifecycleResult =
  | { status: "ready"; modelId: string }
  | { status: "already_loaded"; modelId: string }
  | { status: "install_required"; modelId: string; message: string }
  | { status: "unsupported"; modelId: string; message: string }
  | { status: "error"; modelId: string; message: string };

// ── worker bridge ────────────────────────────────────────────────────

let worker: Worker | null = null;
/** Singletons kept in sync with the AI worker's state. */
let sReady = false;
let sLoadedModelId: string | null = null;
let sLoadedContext = DEFAULT_CTX;
let sActiveBackend: Backend = "unavailable";

/**
 * Request/response correlation. Every request carries a `reqId`; the worker
 * echoes it back on the matching response. A response settles ONLY the
 * promise that requested it — an "error" for a load can never resolve a
 * concurrent "cached-models" promise, and a failed load REJECTS its promise
 * instead of resolving it with a fake success.
 */
type PendingEntry = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let nextReqId = 0;
const pending = new Map<number, PendingEntry>();

function settle(reqId: number | undefined, resolve: (v: unknown) => void, value: unknown) {
  if (reqId == null) return;
  const p = pending.get(reqId);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(reqId);
  p.resolve(value);
}

function settleError(reqId: number | undefined, message: string) {
  if (reqId == null) return;
  const p = pending.get(reqId);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(reqId);
  p.reject(new Error(message));
}

/**
 * Slides a pending request's deadline forward. Download progress ticks call
 * this so a large model on a slow link does not trip the 120s wall; a stalled
 * download (no ticks) still times out as before.
 */
function extendPending(reqId: number | undefined, ms: number) {
  if (reqId == null) return;
  const p = pending.get(reqId);
  if (!p) return;
  clearTimeout(p.timer);
  p.timer = setTimeout(() => p.reject(new Error("AI worker request timed out")), ms);
}

/** Reject everything when the worker process itself dies. */
function rejectAllPending(err: Error) {
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(err);
  }
  pending.clear();
}

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === "undefined" || typeof window === "undefined") return null; // SSR
  try {
    worker = new Worker(new URL("../workers/ai.worker.ts", import.meta.url), { type: "module" });

    worker.addEventListener("message", (event: MessageEvent<AiWorkerResponse>) => {
      const msg = event.data;
      if (!msg?.type) return;

      switch (msg.type) {
        case "ready": {
          sReady = true;
          sLoadedModelId = msg.modelId;
          sLoadedContext = msg.ctx;
          sActiveBackend = msg.backend as Backend;
          settle(msg.reqId, (v) => v, { status: "ready", modelId: msg.modelId });
          return;
        }
        case "error": {
          // The reqId tells us which request failed; a load failure must
          // REJECT its promise, not resolve it with a fake success.
          const wasPending = msg.reqId != null && pending.has(msg.reqId);
          settleError(msg.reqId, msg.message);
          // A load error also drops the global "ready" state.
          if (wasPending && (msg.modelId ? sLoadedModelId === msg.modelId : true)) {
            sReady = false;
            sActiveBackend = "unavailable";
            if (sLoadedModelId === msg.modelId) sLoadedModelId = null;
          }
          return;
        }
        case "loading": {
          // Progress notification — not a response to a request. Every tick
          // slides the owning load's deadline forward, so a large model on a
          // slow link keeps its promise alive while progress stalls it.
          if (msg.reqId != null) extendPending(msg.reqId, 60_000);
          if (activeStatusCallback && msg.modelId === activeStatusModelId) {
            activeStatusCallback({
              phase: "downloading",
              progress: msg.progress ?? 0,
              modelId: msg.modelId,
            });
          }
          return;
        }
        case "unloaded": {
          sReady = false;
          sLoadedModelId = null;
          sLoadedContext = DEFAULT_CTX;
          sActiveBackend = "unavailable";
          return;
        }
        case "cached-models": {
          settle(msg.reqId, (v) => v, new Set(msg.ids));
          return;
        }
        case "deleted": {
          const was = sLoadedModelId;
          if (was === msg.modelId) {
            sReady = false;
            sLoadedModelId = null;
            sActiveBackend = "unavailable";
          }
          settle(msg.reqId, (v) => v, undefined);
          return;
        }
        // token/done are handled via callbacks, not promises
        default:
          return;
      }
    });

    worker.addEventListener("error", (e) => {
      console.error("AI worker error:", e);
      worker?.terminate();
      worker = null;
      sReady = false;
      sLoadedModelId = null;
      sActiveBackend = "unavailable";
      rejectAllPending(new Error("AI worker crashed"));
    });
  } catch (err) {
    console.warn("AI worker creation failed:", err);
  }
  return worker;
}

/**
 * Post a message and wait for the response that carries this request's
 * reqId. No other response can settle this promise — that is the fix for
 * the old shared-pending-map bug.
 */
function postAndWait<T>(msg: AiWorkerRequest): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const w = getWorker();
    if (!w) {
      reject(new Error("AI worker unavailable (SSR or unsupported browser)"));
      return;
    }

    const reqId = nextReqId++;
    let settled = false;

    const doResolve = (v: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pending.delete(reqId);
      resolve(v as T);
    };
    const doReject = (e: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pending.delete(reqId);
      reject(e);
    };

    // Non-chat RPC keeps the flat 120s guard; chat requests get the same
    // 10-minute absolute backstop as the streaming bridge so the layers can
    // never disagree about when a slow (but alive) run must end.
    const timer = setTimeout(() => {
      if (msg.type === "load") {
        w.postMessage({
          type: "cancel-load",
          modelId: msg.modelId,
          reqId,
        } satisfies AiWorkerRequest);
      }
      doReject(new Error("AI worker request timed out"));
    }, msg.type === "chat-messages" ? 600_000 : 120_000);

    // Register before posting so a response that arrives synchronously
    // still finds its waiter.
    pending.set(reqId, { resolve: doResolve, reject: doReject, timer });

    w.postMessage({ ...msg, reqId });
  });
}

// ── exported API (thunks over the worker) ────────────────────────────

export function isReady(modelId: string): boolean {
  return sReady && sLoadedModelId === modelId;
}

export function loadedModelId(): string | null {
  return sLoadedModelId;
}

export function loadedContext(): number {
  return sLoadedContext;
}

export function activeBackend(): Backend {
  return sActiveBackend;
}

export function invalidateCachedModels() {
  // No-op: the worker's cache is independent of the main thread
}

export function cachedModels(): Promise<Set<string>> {
  return postAndWait<Set<string>>({ type: "cached-models" });
}

export async function deleteModel(modelId: string): Promise<void> {
  await postAndWait<void>({ type: "delete-model", modelId });
}

// ── download progress (non-promise, callback-based) ─────────────────

/**
 * The onStatus callback for the currently-loading model, if any.
 * Set before posting a "load" message; cleared when "ready" or "error" arrives.
 * The worker's progressCallback fires "loading" messages that this handler invokes.
 */
let activeStatusCallback: ((s: AiStatus) => void) | null = null;
let activeStatusModelId: string | null = null;

export async function downloadModel(
  modelId: string,
  onStatus: (s: AiStatus) => void,
  options: { nCtx?: number } = {},
): Promise<LifecycleResult> {
  const spec = MODEL_BY_ID[modelId] ?? MODEL_BY_ID[DEFAULT_MODEL_ID];
  const guard = budgetGuard(spec, options.nCtx);
  if (guard) return guard;
  onStatus({ phase: "downloading", progress: 0, modelId });

  // Register the status callback so "loading" progress messages route to it
  activeStatusCallback = onStatus;
  activeStatusModelId = modelId;

  try {
    await postAndWait<{ status: string; modelId: string }>({
      type: "load",
      modelId,
      allowDownload: true,
      nCtx: options.nCtx,
    });
    onStatus({ phase: "ready", modelId });
    return { status: "ready", modelId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "download failed";
    onStatus({ phase: "error", message, modelId });
    return { status: "error", modelId, message };
  } finally {
    activeStatusCallback = null;
    activeStatusModelId = null;
  }
}

/** Also exported for useAi's load callback (non-download load path). */
export function setActiveStatusCallback(
  cb: ((s: AiStatus) => void) | null,
  modelId: string | null,
) {
  activeStatusCallback = cb;
  activeStatusModelId = modelId;
}

/**
 * The pre-allocation gate (P0.3): an UNSAFE budget prediction rejects the
 * load configuration BEFORE the worker allocates and crashes the tab.
 * UNCERTAIN proceeds: conservative configuration and calibration are P1.
 * Null when the prediction does not block.
 */
function budgetGuard(spec: ModelSpec, nCtx?: number): LifecycleResult | null {
  const ctx = nCtx ?? persistedCtx(spec.id) ?? DEFAULT_CTX;
  const { verdict, basis } = budgetOutcome(spec, ctx, runtimeSnapshot().memoryClassGb);
  if (verdict !== "UNSAFE") return null;
  return {
    status: "unsupported",
    modelId: spec.id,
    message: `${spec.label} at ctx ${ctx} is predicted not to fit on this device (${basis}). Lower the context or pick a smaller model.`,
  };
}

export async function loadDownloadedModel(
  modelId: string,
  onStatus: (s: AiStatus) => void,
  options: { nCtx?: number } = {},
): Promise<LifecycleResult> {
  const spec = MODEL_BY_ID[modelId] ?? MODEL_BY_ID[DEFAULT_MODEL_ID];
  if (spec.desktopOnly && deviceProfile().mobile) {
    return { status: "unsupported", modelId: spec.id, message: "This model is unavailable here." };
  }
  const guard = budgetGuard(spec, options.nCtx);
  if (guard) return guard;
  onStatus({ phase: "loading", modelId });
  try {
    await postAndWait<void>({ type: "load", modelId, allowDownload: false, nCtx: options.nCtx });
    onStatus({ phase: "ready", modelId });
    return { status: "ready", modelId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "load failed";
    onStatus({ phase: "error", message, modelId });
    return { status: "error", modelId, message };
  }
}

export async function rotateToDownloadedModel(
  modelId: string,
  onStatus: (s: AiStatus) => void,
  options: { nCtx?: number } = {},
): Promise<LifecycleResult> {
  if (isReady(modelId)) return { status: "already_loaded", modelId };
  return loadDownloadedModel(modelId, onStatus, options);
}

export async function loadModel(
  modelId: string,
  onStatus: (s: AiStatus) => void,
  options: { nCtx?: number } = {},
): Promise<void> {
  const result = await loadDownloadedModel(modelId, onStatus, options);
  if (
    result.status === "install_required" ||
    result.status === "unsupported" ||
    result.status === "error"
  ) {
    throw new Error(result.message);
  }
}

export async function unload() {
  const w = worker;
  if (!w) return;
  w.postMessage({ type: "unload" } satisfies AiWorkerRequest);
  // Immediately clear local state
  sReady = false;
  sLoadedModelId = null;
  sLoadedContext = DEFAULT_CTX;
  sActiveBackend = "unavailable";
}

export function stopGeneration() {
  worker?.postMessage({ type: "stop" } satisfies AiWorkerRequest);
}

export type ChatOptions = {
  temperature?: number;
  maxTokens?: number;
  thinking?: boolean;
  images?: string[];
  responseSchema?: { name: string; schema: Record<string, unknown> };
  onSpeed?: (tps: number, tokens: number) => void;
  /**
   * Native tool protocol (LFM chat template): one assistant message carrying
   * these calls, then one role:"tool" response per call. Delivering tool
   * results this way is what tells a tool-trained model "your call was
   * answered"; prose observations inside the system prompt leave the model
   * re-issuing the call (the 2.6B loop). Arguments stay a mapping: the
   * template raises on JSON-encoded strings.
   */
  toolTurns?: NativeToolTurn[];
  /**
   * Native tool menu (decide phase, LFM template): rendered as
   * `List of tools: [...]` inside the system prompt. Only meaningful with
   * a model whose spec sets decideMenu "native".
   */
  tools?: import("@/lib/ai/nativeTools").NativeToolSpec[];
};

export type NativeToolTurn = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  content: string;
};

export type ChatRole = "system" | "user" | "assistant";
export type TurnMessage = { role: ChatRole; content: string };

/**
 * Multi-turn chat via the AI worker. Tokens stream back via onToken;
 * the worker sends "token" messages, which the bridge reassembles.
 */
export function chatMessages(
  turns: TurnMessage[],
  onToken?: (text: string) => void,
  options: ChatOptions = {},
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const w = getWorker();
    if (!w) {
      reject(new Error("AI worker unavailable"));
      return;
    }

    let out = "";
    let lastSpeed: { tps: number; tokens: number } | null = null;

    const handler = (event: MessageEvent<AiWorkerResponse>) => {
      const msg = event.data;
      if (!msg?.type) return;

      switch (msg.type) {
        case "token": {
          out += msg.text;
          (handler as unknown as { rearmOnToken?: () => void }).rearmOnToken?.();
          onToken?.(msg.text);
          if ((msg as { speed?: unknown }).speed) {
            const s = (msg as { speed: { tps: number; tokens: number } }).speed;
            lastSpeed = s;
            options.onSpeed?.(s.tps, s.tokens);
          }
          return;
        }
        case "done": {
          worker?.removeEventListener("message", handler);
          // Final speed update
          resolve(out);
          return;
        }
        case "error": {
          worker?.removeEventListener("message", handler);
          reject(new Error(msg.message));
          return;
        }
      }
    };

    worker!.addEventListener("message", handler);

    w.postMessage({
      type: "chat-messages",
      turns: turns.map((t) => ({ role: t.role, content: t.content })),
      options: {
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        thinking: options.thinking,
        images: options.images,
        responseSchema: options.responseSchema,
        toolTurns: options.toolTurns,
        tools: options.tools,
      },
    } satisfies AiWorkerRequest);

    // Idle-based deadline: a model that is still producing tokens is never
    // cut, however slowly it thinks (the 2.6B measured 0.4 tok/s mid-think;
    // the old total-wall timer killed it ~80 tokens in). Only silence ends
    // the run: 75s covers cold prefill on multi-thousand-token prompts, and
    // a 10-minute absolute backstop still bounds a wedged stream.
    const IDLE_MS = 75_000;
    const BACKSTOP_MS = 600_000;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let backstop: ReturnType<typeof setTimeout> | null = null;
    const settle = (withPartial: boolean) => {
      if (idleTimer) clearTimeout(idleTimer);
      if (backstop) clearTimeout(backstop);
      worker?.removeEventListener("message", handler);
      if (withPartial && out) resolve(out);
      else reject(new Error("chat timed out"));
    };
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => settle(true), IDLE_MS);
    };
    backstop = setTimeout(() => settle(true), BACKSTOP_MS);
    armIdle();
    (handler as unknown as { rearmOnToken?: () => void }).rearmOnToken = armIdle;
  });
}

export async function chat(
  system: string,
  user: string,
  onToken?: (text: string) => void,
  options: ChatOptions = {},
): Promise<string> {
  return chatMessages(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    onToken,
    options,
  );
}

export function splitThinking(text: string): { thinking: string | null; answer: string } {
  // Proper tag first: <think>…</think>, lenient about whitespace, tolerant of
  // an unterminated block (the model died or is still mid-think).
  let m = /<\s*think\s*>([\s\S]*?)(?:<\/\s*think\s*>|$)/i.exec(text);
  if (!m) {
    // Degraded form: detokenization sometimes delivers the opener as a bare
    // " thinking" at the very start of the output, glued to its content
    // ("thinkingplan…"). Only the anchored form counts, so prose that merely
    // contains the word is never chopped.
    m = /^\s*think([\s\S]*?)(?:<\/\s*think\s*>|$)/i.exec(text);
  }
  if (!m) return { thinking: null, answer: text };
  return {
    thinking: m[1].trim(),
    answer: (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim(),
  };
}

// Small models sometimes echo the tool-call syntax they see in the prompt
// (a tool card in history) straight into the answer, e.g.
// "<tool_call_start>portfolio.read()</tool_call_end>". The tool has already
// run by the time the answer is written, so the tag is pure noise: strip it
// before the text is shown or replayed. Only invoked when the text actually
// contains "tool_call", so ordinary answers are never touched.
const TOOL_CALL_PAIRS = [
  /<tool_call_start\b[^>]*>[\s\S]*?<\/tool_call_end\s*>/gi,
  /<tool_call\b[^>]*>[\s\S]*?<\/tool_call\s*>/gi,
  // Pipe-delimited dialect (LFM2 chat-template tokens leaking into output).
  // It usually arrives unterminated at the end of an answer, so an unclosed
  // opener cuts the rest of the text.
  /<\|tool_call_start\|>[\s\S]*?(?:<\|tool_call_end\|>|$)/gi,
];
const STRAY_TOOL_CALL_TAG = /<\/?tool_call(?:_start|_end)?\b[^>]*>/g;
const STRAY_PIPE_TAG = /<\|\/?tool_call(?:_start|_end)?\|>/g;

export function stripToolCallMarkup(text: string): string {
  if (!/tool_call/i.test(text)) return text;
  let out = text;
  for (const re of TOOL_CALL_PAIRS) out = out.replace(re, " ");
  out = out.replace(STRAY_TOOL_CALL_TAG, " ");
  out = out.replace(STRAY_PIPE_TAG, " ");
  if (out === text) return text; // mentioned "tool_call" in prose, nothing to strip
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── model state derivation (pure sync, stays on main thread) ─────────

export function modelState(
  modelId: string,
  opts: { downloaded: Set<string>; status: AiStatus; loadedId: string | null; mobile?: boolean },
): ModelState {
  const spec = MODEL_BY_ID[modelId];
  if (!spec) return "unavailable";
  if (spec.desktopOnly && opts.mobile) return "unavailable";
  if (opts.status.modelId === modelId) {
    if (opts.status.phase === "error") return "error";
    if (opts.status.phase === "downloading" || opts.status.phase === "loading") return "loading";
  }
  if (opts.loadedId === modelId && isReady(modelId)) return "loaded";
  return opts.downloaded.has(modelId) ? "downloaded" : "missing";
}

export const STATE_LABEL: Record<ModelState, string> = {
  missing: "missing",
  loading: "loading",
  downloaded: "downloaded",
  loaded: "loaded",
  unavailable: "unavailable here",
  error: "error",
};

// ── prompt recipes ───────────────────────────────────────────────────

export const PROMPTS = {
  tidy: (raw: string) => ({
    system:
      "You are a terse trading-journal editor. Rewrite the user's rough note into two clear sentences in first person. No preamble, no bullet points, no advice.",
    user: raw,
  }),
  reason: (trade: string, theses: string) => ({
    system:
      "You help a trader reconcile an on-chain transaction with the thesis behind it. Reply with one short paragraph: what likely happened, and which listed thesis it maps to. If none fit, say so plainly.",
    user: `Transaction: ${trade}\n\nOpen theses:\n${theses || "(none written yet)"}`,
  }),
  review: (thesis: string, context: string) => ({
    system:
      "You stress-test an investment thesis. Give exactly two lines: 'Strongest point:' and 'What would break it:'. Be concrete and brief.",
    user: `Thesis: ${thesis}\n\nPortfolio context: ${context}`,
  }),
};
