// On-device assistant. wllama runs llama.cpp in WebAssembly (SIMD + threads
// when the browser allows it) inside its own worker, so the UI thread never
// blocks. The encoder is a separate, much cheaper runtime (Transformers.js).
// Nothing leaves the device; weights are cached after the first download.

import type { Wllama } from "@wllama/wllama/esm/index.js";
import {
  buildInferenceProfile,
  detectRuntime,
  type Backend,
  type InferenceProfile,
} from "@/lib/ai/runtime";
import { readDelta } from "@/lib/ai/stream";

/** What a model is allowed to be used for. Cheapest capable model wins. */
export type Capability = "encode" | "extract" | "vision" | "assist" | "reason";

export type ModelSpec = {
  id: string;
  label: string;
  /** Hugging Face repository the weights actually come from */
  repo: string;
  quant: string;
  /** how the weights are loaded in this app */
  runtime: "gguf" | "transformers";
  /** the equivalent command outside the browser, shown in the UI */
  serve: string;
  blurb: string;
  role: string;
  capabilities: Capability[];
  /** heavy enough that phones should not attempt it */
  desktopOnly?: boolean;
  /** rough weights size in GB, used for the RAM recommendation */
  weightsGb: number;
  /** device memory we want to see before recommending it */
  minRamGb: number;
  vision: boolean;
  /** optional vision projector quant for multimodal GGUF models */
  mmprojQuant?: string;
  reasoning: boolean;
  /** can generate prose at all (the encoder cannot) */
  generative: boolean;
  maxCtx: number;
  /** number of transformer layers (used for per-layer VRAM calculation) */
  nLayers: number;
  /**
   * Sampling defaults for this model family. Liquid AI's LFM2 cards recommend
   * temperature 0.3, min_p 0.15, repetition_penalty 1.05; the 450M loops
   * sentences without the penalty. Callers can still override per turn.
   */
  sampling?: {
    temperature: number;
    minP: number;
    repeatPenalty: number;
    /** how many recent tokens the penalty window covers */
    penaltyLastN: number;
  };
  /** which browser backend this model prefers, and what it falls back to */
  backend: { preferred: "webgpu"; fallback: "wasm" };
};

/** Every model here runs in the browser: GPU when the device has one. */
const BROWSER_BACKEND = { preferred: "webgpu", fallback: "wasm" } as const;

const MODEL_LIST: Omit<ModelSpec, "backend">[] = [
  {
    id: "lfm2-2_6",
    label: "LFM 2.5 2.6B",
    repo: "LiquidAI/LFM2.5-2.6B-GGUF",
    quant: "Q4_K_M",
    runtime: "gguf",
    serve: "llama serve -hf LiquidAI/LFM2.5-2.6B-GGUF:Q4_K_M",
    blurb: "Strongest and slowest. Desktop standard.",
    role: "Complex reasoning and generation, when it is actually needed",
    capabilities: ["assist", "reason", "extract"],
    desktopOnly: true,
    weightsGb: 1.8,
    minRamGb: 6,
    vision: false,
    reasoning: true,
    generative: true,
    maxCtx: 128192,
    nLayers: 32,
    sampling: { temperature: 0.3, minP: 0.15, repeatPenalty: 1.05, penaltyLastN: 64 },
  },
  {
    id: "lfm2-1_2-instruct",
    label: "LFM 2.5 1.2B instruct",
    repo: "LiquidAI/LFM2.5-1.2B-Instruct-GGUF",
    quant: "Q4_K_M",
    runtime: "gguf",
    serve: "llama serve -hf LiquidAI/LFM2.5-1.2B-Instruct-GGUF:Q4_K_M",
    blurb: "Better reasoning about why a trade happened.",
    role: "Lightweight general assistant",
    capabilities: ["assist", "reason", "extract"],
    weightsGb: 0.85,
    minRamGb: 4,
    vision: false,
    reasoning: true,
    generative: true,
    maxCtx: 32128,
    nLayers: 24,
    sampling: { temperature: 0.3, minP: 0.15, repeatPenalty: 1.05, penaltyLastN: 64 },
  },
  {
    id: "lfm2-350",
    label: "LFM 2.5 350M",
    repo: "LiquidAI/LFM2.5-350M-GGUF",
    quant: "Q4_K_M",
    runtime: "gguf",
    serve: "llama serve -hf LiquidAI/LFM2.5-350M-GGUF:Q4_K_M",
    blurb: "Faster than the VL model, text-only, still follows FACTS and grounded turns well.",
    role: "On-device assistant. Default model.",
    capabilities: ["assist", "extract"],
    weightsGb: 0.28,
    minRamGb: 1.5,
    vision: false,
    reasoning: false,
    generative: true,
    maxCtx: 8192,
    nLayers: 28,
    sampling: { temperature: 0.3, minP: 0.15, repeatPenalty: 1.05, penaltyLastN: 64 },
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
    sampling: { temperature: 0.3, minP: 0.15, repeatPenalty: 1.05, penaltyLastN: 64 },
  },
  {
    id: "lfm2-230-encoder",
    label: "LFM 2.5 230M encoder",
    repo: "LiquidAI/LFM2.5-Encoder-230M",
    quant: "fp32",
    runtime: "transformers",
    serve:
      'AutoModelForMaskedLM.from_pretrained("LiquidAI/LFM2.5-Encoder-230M", trust_remote_code=True)',
    blurb: "Semantic routing, retrieval and tagging. Never writes prose.",
    role: "Routing, retrieval, tool and skill discovery, light classification",
    capabilities: ["encode"],
    weightsGb: 0.18,
    minRamGb: 0,
    vision: false,
    reasoning: false,
    generative: false,
    maxCtx: 8192,
    nLayers: 24,
  },
];

/** Strongest first — the recommendation walks down this list. */
export const MODELS: ModelSpec[] = MODEL_LIST.map((m) => ({ ...m, backend: BROWSER_BACKEND }));

export const MODEL_BY_ID: Record<string, ModelSpec> = Object.fromEntries(
  MODELS.map((m) => [m.id, m]),
);

export const DEFAULT_MODEL_ID = "lfm2-350";
export const ENCODER_ID = "lfm2-230-encoder";

/** Which model each capability should prefer — cheapest first. */
export const CAPABILITY_MODELS: Record<Capability, string[]> = {
  encode: ["lfm2-230-encoder"],
  extract: ["lfm2-350", "lfm2-1_2-instruct", "lfm2-2_6"],
  vision: ["lfm2-450-vl"],
  assist: ["lfm2-350", "lfm2-1_2-instruct", "lfm2-2_6"],
  reason: ["lfm2-1_2-instruct", "lfm2-2_6"],
};

/** The cheapest model that can do this, preferring one already downloaded. */
export function modelFor(cap: Capability, downloaded?: Set<string>): ModelSpec | undefined {
  const ids = CAPABILITY_MODELS[cap] ?? [];
  const have = ids.find((id) => downloaded?.has(id));
  return MODEL_BY_ID[have ?? ids[0]];
}

export const CTX_CHOICES = [1024, 2048, 4096, 8192, 16384, 32128] as const;
export const DEFAULT_CTX = 8192;
/** Never send more than this many turns of the active session to a model. */
export const MAX_CONTEXT_MESSAGES = 5;

export type DeviceProfile = {
  ramGb: number | null;
  cores: number | null;
  mobile: boolean;
  /** false until the browser has actually been probed (SSR-safe) */
  probed: boolean;
};

/** Same value on the server and on the first client render — no mismatch. */
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

/**
 * The 350M is the default for every device: it follows FACTS and grounded
 * turns well, loads fast, and fits on phones. The 1.2B instruct is the
 * reasoning upgrade when the user enables it; the 2.6B is desktop-only.
 */
const RECOMMEND_ORDER = ["lfm2-350", "lfm2-1_2-instruct", "lfm2-450-vl", "lfm2-2_6"];

export function recommendModel(profile = deviceProfile()): { id: string; reason: string } {
  if (!profile.probed) {
    return {
      id: DEFAULT_MODEL_ID,
      reason: "checking what this device can carry…",
    };
  }
  const assumed = profile.ramGb ?? (profile.mobile ? 2 : 4);
  const budget = profile.mobile ? assumed / 2 : assumed;
  const candidates = RECOMMEND_ORDER.map((id) => MODEL_BY_ID[id]).filter(Boolean);
  const pick =
    candidates.find(
      (m) => m.generative && budget >= m.minRamGb && !(m.desktopOnly && profile.mobile),
    ) ??
    MODEL_BY_ID[DEFAULT_MODEL_ID] ??
    MODEL_BY_ID[DEFAULT_MODEL_ID];
  const seen =
    profile.ramGb != null ? `${profile.ramGb} GB reported` : "memory not reported by the browser";
  return {
    id: pick.id,
    reason: `${seen}${profile.mobile ? " · touch device" : ""} · ${pick.label} fits.`,
  };
}

/** Rough working-set estimate so the context slider can warn honestly. */
export function memoryEstimateGb(modelId: string, nCtx: number): number {
  const spec = MODEL_BY_ID[modelId];
  if (!spec) return 0;
  const kv = (nCtx / 8192) * spec.weightsGb * 0.25;
  return Math.round((spec.weightsGb + kv) * 10) / 10;
}

// ── model state ────────────────────────────────────────────────────────────

/**
 * The six states the UI is expected to distinguish. `required` means the app
 * wants it but the weights are not on the device yet.
 */
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

let instance: Wllama | null = null;
let currentModel: string | null = null;
let currentCtx = DEFAULT_CTX;
let abortRun = false;
let activeBackendValue: Backend = "unavailable";

/** memoized cachedModels() result, recomputed after download/delete */
let cachedDownloaded: Promise<Set<string>> | null = null;

/** The backend the loaded model is actually running on, never a guess. */
export function activeBackend(): Backend {
  return activeBackendValue;
}

async function createRuntime(parallelDownloads = 4): Promise<Wllama> {
  // The binary lives in public/wasm and is fetched by URL after hydration, so it
  // never enters the server bundle. One binary covers both single and
  // multi-threaded execution; wllama enables pthreads only when the page is
  // cross-origin isolated, so nothing here has to be guessed.
  const { Wllama: Ctor } = await import("@wllama/wllama/esm/index.js");
  return new Ctor(
    { default: "/wasm/wllama.wasm" },
    { allowOffline: true, suppressNativeLog: true, parallelDownloads },
  );
}

export function isReady(modelId: string) {
  return instance != null && currentModel === modelId;
}

export function loadedModelId() {
  return currentModel;
}

export function loadedContext() {
  return currentCtx;
}

/**
 * Which models already have their weights on this device. GGUF models are read
 * from the wllama cache index, the encoder from the Transformers.js cache.
 * Nothing is downloaded here.
 *
 * The result is memoized and computed once per page load: wllama's IndexedDB
 * cache manager may not be initialized on the first microtick after a reload,
 * and creating a fresh runtime to list it every time is wasteful. Call
 * invalidateCachedModels() after downloading or deleting a model.
 */
export function invalidateCachedModels() {
  cachedDownloaded = null;
}

export async function cachedModels(): Promise<Set<string>> {
  if (cachedDownloaded) return cachedDownloaded;
  cachedDownloaded = computeCachedModels();
  return cachedDownloaded;
}

async function computeCachedModels(): Promise<Set<string>> {
  const out = new Set<string>();
  const gguf = MODELS.filter((m) => m.runtime === "gguf");
  try {
    const runtime = instance ?? (await createRuntime());
    const mgr = (runtime as unknown as { cacheManager?: { list?: () => Promise<unknown[]> } })
      .cacheManager;
    const list = (await mgr?.list?.()) ?? [];
    const names = list
      .map((e) => {
        const rec = e as { name?: string; url?: string };
        return (rec.url ?? rec.name ?? "").toLowerCase();
      })
      .join("\n");
    for (const m of gguf) {
      const needle = m.repo.split("/")[1]?.toLowerCase() ?? m.repo.toLowerCase();
      if (names.includes(needle)) out.add(m.id);
    }
  } catch {
    /* cache unavailable — treat GGUF weights as not downloaded */
  }
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      for (const key of keys) {
        if (!/transformers/i.test(key)) continue;
        const cache = await caches.open(key);
        const reqs = await cache.keys();
        const encoder = MODEL_BY_ID[ENCODER_ID];
        if (reqs.some((r) => r.url.includes(encoder.repo))) out.add(ENCODER_ID);
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

/**
 * Removes one model's weights from the browser cache. If that model is the
 * resident one it is unloaded first, so memory and disk agree afterwards.
 */
export async function deleteModel(modelId: string): Promise<void> {
  const spec = MODEL_BY_ID[modelId];
  if (!spec) return;
  invalidateCachedModels();
  if (currentModel === spec.id) await unload();
  const needle = (spec.repo.split("/")[1] ?? spec.repo).toLowerCase();
  if (spec.runtime === "gguf") {
    const runtime = instance ?? (await createRuntime());
    const mgr = (
      runtime as unknown as {
        cacheManager?: {
          list?: () => Promise<unknown[]>;
          deleteMany?: (pred: (e: unknown) => boolean) => Promise<void>;
        };
      }
    ).cacheManager;
    await mgr?.deleteMany?.((e) => {
      const rec = e as { name?: string; url?: string };
      return (rec.url ?? rec.name ?? "").toLowerCase().includes(needle);
    });
    return;
  }
  if (typeof caches === "undefined") return;
  for (const key of await caches.keys()) {
    if (!/transformers/i.test(key)) continue;
    const cache = await caches.open(key);
    for (const req of await cache.keys()) {
      if (req.url.toLowerCase().includes(needle)) await cache.delete(req);
    }
  }
}

/** Resolve the six-state label for one model. */
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

export type LoadOptions = { nCtx?: number };

async function loadModelInternal(
  modelId: string,
  onStatus: (s: AiStatus) => void,
  options: LoadOptions & { allowDownload: boolean } = { allowDownload: false },
): Promise<void> {
  const spec = MODEL_BY_ID[modelId] ?? MODEL_BY_ID[DEFAULT_MODEL_ID];
  if (spec.runtime !== "gguf") {
    throw new Error(`${spec.label} is loaded through the encoder runtime, not the chat runtime.`);
  }
  const nCtx = Math.min(options.nCtx ?? DEFAULT_CTX, spec.maxCtx);
  if (!options.allowDownload && !(await cachedModels()).has(spec.id)) {
    const err = new Error(`${spec.label} is not downloaded. Download it first.`);
    onStatus({ phase: "error", message: err.message, modelId: spec.id });
    throw err;
  }
  if (isReady(spec.id) && currentCtx === nCtx) {
    onStatus({ phase: "ready", modelId: spec.id });
    return;
  }
  try {
    await unload();
    onStatus(
      options.allowDownload
        ? { phase: "downloading", progress: 0, modelId: spec.id }
        : { phase: "loading", modelId: spec.id },
    );
    const caps = await detectRuntime();
    const profile: InferenceProfile = buildInferenceProfile(
      caps,
      spec.weightsGb,
      spec.nLayers,
      nCtx,
    );
    const gpuOk = caps.webgpu && profile.n_gpu_layers > 0;
    const runtime = await createRuntime(profile.n_threads > 1 ? 6 : 3);

    const load = async (useGpu: boolean) => {
      const p = { ...profile };
      if (!useGpu) {
        p.n_gpu_layers = 0;
        p.offload_kqv = false;
        p.no_kv_offload = false;
      }
      await runtime.loadModelFromHF(
        {
          repo: spec.repo,
          quant: spec.quant,
          ...(spec.mmprojQuant ? { mmprojQuant: spec.mmprojQuant } : {}),
        },
        {
          n_ctx: nCtx,
          useCache: true,
          n_gpu_layers: p.n_gpu_layers,
          n_threads: p.n_threads,
          n_batch: p.n_batch,
          cache_type_k: p.cache_type_k as never,
          cache_type_v: p.cache_type_v as never,
          flash_attn: p.flash_attn,
          offload_kqv: p.offload_kqv,
          warmup: p.warmup,
          no_kv_offload: p.no_kv_offload,
          progressCallback: ({ loaded, total }: { loaded: number; total: number }) => {
            if (options.allowDownload) {
              onStatus({
                phase: "downloading",
                progress: total ? loaded / total : 0,
                modelId: spec.id,
              });
            }
          },
        } as never,
      );
    };
    try {
      await load(gpuOk);
      activeBackendValue = gpuOk ? "webgpu" : caps.wasmSimd || caps.wasm ? "wasm" : "unavailable";
    } catch (gpuErr) {
      if (!gpuOk) throw gpuErr;
      onStatus({ phase: "loading", modelId: spec.id });
      await load(false);
      activeBackendValue = "wasm";
    }
    instance = runtime;
    currentModel = spec.id;
    currentCtx = nCtx;
    onStatus({ phase: "ready", modelId: spec.id });
  } catch (err) {
    instance = null;
    currentModel = null;
    activeBackendValue = "unavailable";
    onStatus({
      phase: "error",
      message: err instanceof Error ? err.message : "the assistant failed to start",
      modelId: spec.id,
    });
    throw err;
  }
}

/**
 * Explicit install path. It may fetch model assets, and the model stays
 * resident once the fetch completes, so a download ends ready to answer.
 */
export async function downloadModel(
  modelId: string,
  onStatus: (s: AiStatus) => void,
  options: LoadOptions = {},
): Promise<LifecycleResult> {
  const spec = MODEL_BY_ID[modelId] ?? MODEL_BY_ID[DEFAULT_MODEL_ID];
  invalidateCachedModels();
  try {
    await loadModelInternal(spec.id, onStatus, { ...options, allowDownload: true });
    return { status: "ready", modelId: spec.id };
  } catch (err) {
    return {
      status: "error",
      modelId: spec.id,
      message: err instanceof Error ? err.message : "download failed",
    };
  }
}

/** Explicit load path. It refuses to fetch assets. */
export async function loadDownloadedModel(
  modelId: string,
  onStatus: (s: AiStatus) => void,
  options: LoadOptions = {},
): Promise<LifecycleResult> {
  const spec = MODEL_BY_ID[modelId] ?? MODEL_BY_ID[DEFAULT_MODEL_ID];
  if (spec.desktopOnly && deviceProfile().mobile) {
    return { status: "unsupported", modelId: spec.id, message: "This model is unavailable here." };
  }
  if (!(await cachedModels()).has(spec.id)) {
    const message = `${spec.label} is not downloaded. Download it first.`;
    onStatus({ phase: "error", message, modelId: spec.id });
    return { status: "install_required", modelId: spec.id, message };
  }
  try {
    await loadModelInternal(spec.id, onStatus, { ...options, allowDownload: false });
    return { status: "ready", modelId: spec.id };
  } catch (err) {
    return {
      status: "error",
      modelId: spec.id,
      message: err instanceof Error ? err.message : "load failed",
    };
  }
}

export async function rotateToDownloadedModel(
  modelId: string,
  onStatus: (s: AiStatus) => void,
  options: LoadOptions = {},
): Promise<LifecycleResult> {
  const spec = MODEL_BY_ID[modelId] ?? MODEL_BY_ID[DEFAULT_MODEL_ID];
  if (isReady(spec.id)) return { status: "already_loaded", modelId: spec.id };
  return loadDownloadedModel(spec.id, onStatus, options);
}

/** Backwards-compatible name for explicit cached load. Never downloads. */
export async function loadModel(
  modelId: string,
  onStatus: (s: AiStatus) => void,
  options: LoadOptions = {},
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
  if (instance) await instance.exit().catch(() => {});
  instance = null;
  currentModel = null;
  currentCtx = DEFAULT_CTX;
  activeBackendValue = "unavailable";
}

/** Stops the generation currently streaming, if any. */
export function stopGeneration() {
  abortRun = true;
}

export type ChatOptions = {
  temperature?: number;
  maxTokens?: number;
  /** ask the model to think first; the thinking is streamed and shown collapsed */
  thinking?: boolean;
  /** data URLs of images, only used by a VL model */
  images?: string[];
  /**
   * Grammar-constrained output: wllama turns this into a GBNF grammar so even
   * a 450M cannot emit JSON that violates the schema. Optional and additive.
   */
  responseSchema?: { name: string; schema: Record<string, unknown> };
  /** live generation speed, emitted while streaming */
  onSpeed?: (tokensPerSecond: number, tokens: number) => void;
};

async function dataUrlToArrayBuffer(dataUrl: string): Promise<ArrayBuffer> {
  const res = await fetch(dataUrl);
  return res.arrayBuffer();
}

export type ChatRole = "system" | "user" | "assistant";
export type TurnMessage = { role: ChatRole; content: string };

/**
 * Multi-turn chat: the model's own chat template structures the whole
 * conversation, which small models follow far better than history pasted into
 * one user blob. Vision images attach to the final user turn.
 */
export async function chatMessages(
  turns: TurnMessage[],
  onToken?: (text: string) => void,
  options: ChatOptions = {},
): Promise<string> {
  if (!instance) throw new Error("assistant not loaded");
  const spec = currentModel ? MODEL_BY_ID[currentModel] : undefined;
  if (spec && !spec.generative) {
    throw new Error(`${spec.label} makes embeddings, not prose. Load an instruct or VL model.`);
  }

  const systemText = turns
    .filter((t) => t.role === "system")
    .map((t) => t.content)
    .join("\n\n");
  const sys = options.thinking
    ? `${systemText}\n\nThink step by step inside <think>…</think>, then give the answer after it.`
    : systemText;

  const dialogue = turns.filter((t) => t.role !== "system");
  const lastUser = [...dialogue].reverse().find((t) => t.role === "user");
  const visionContent =
    options.images?.length && spec?.vision && lastUser
      ? [
          { type: "text" as const, text: lastUser.content },
          ...(await Promise.all(
            options.images.map(async (url) => ({
              type: "image" as const,
              data: await dataUrlToArrayBuffer(url),
            })),
          )),
        ]
      : null;

  const messages: Array<{ role: string; content: unknown }> = [
    { role: "system", content: sys },
    ...dialogue.map((t) => ({ role: t.role, content: t.content })),
  ];
  if (visionContent) {
    const i = dialogue.indexOf(lastUser!) + 1;
    if (messages[i]) messages[i].content = visionContent;
  }

  abortRun = false;
  const abortController = new AbortController();
  let out = "";
  let tokens = 0;
  const started = performance.now();

  // Per-model sampling defaults (Liquid AI's LFM2 recommendation) apply
  // unless the caller overrides temperature for a specific turn.
  const sampling = spec?.sampling;

  await instance.createChatCompletion({
    messages: messages as never,
    stream: true,
    max_tokens: options.maxTokens ?? 8192,
    temperature: options.temperature ?? sampling?.temperature ?? 0.4,
    top_p: 0.9,
    ...(sampling
      ? {
          min_p: sampling.minP,
          penalty_repeat: sampling.repeatPenalty,
          penalty_last_n: sampling.penaltyLastN,
        }
      : {}),
    ...(options.responseSchema
      ? {
          response_format: {
            type: "json_schema" as const,
            json_schema: {
              name: options.responseSchema.name,
              schema: options.responseSchema.schema,
            },
          },
        }
      : {}),
    abortSignal: abortController.signal,
    onData: (chunk) => {
      const piece = readDelta(chunk);
      if (!piece) return;
      out += piece;
      tokens += 1;
      onToken?.(piece);
      const secs = (performance.now() - started) / 1000;
      if (secs > 0) options.onSpeed?.(tokens / secs, tokens);
      if (abortRun) abortController.abort();
    },
  });
  return out.trim();
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

/** Splits a thinking model's reply into its hidden reasoning and the answer. */
export function splitThinking(text: string): { thinking: string | null; answer: string } {
  const m = /<think>([\s\S]*?)(?:<\/think>|$)/i.exec(text);
  if (!m) return { thinking: null, answer: text };
  return {
    thinking: m[1].trim(),
    answer: text.slice(m.index + m[0].length).trim(),
  };
}

// ── prompt recipes ─────────────────────────────────────────────────────────

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
