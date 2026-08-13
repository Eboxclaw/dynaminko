// On-device assistant. wllama runs llama.cpp in WebAssembly (SIMD + threads
// when the browser allows it) inside its own worker, so the UI thread never
// blocks. The encoder is a separate, much cheaper runtime (Transformers.js).
// Nothing leaves the device; weights are cached after the first download.

import type { Wllama } from "@wllama/wllama/esm/index.js";
import { detectRuntime, type Backend } from "@/lib/ai/runtime";


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
  reasoning: boolean;
  /** can generate prose at all (the encoder cannot) */
  generative: boolean;
  maxCtx: number;
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
    blurb: "Strongest and slowest. Desktop with plenty of memory.",
    role: "Heavier reasoning and generation, when it is actually needed",
    capabilities: ["assist", "reason", "extract"],
    desktopOnly: true,
    weightsGb: 1.8,
    minRamGb: 8,
    vision: false,
    reasoning: true,
    generative: true,
    maxCtx: 8192,
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
    maxCtx: 8192,
  },
  {
    id: "lfm2-450-vl",
    label: "LFM 2.5 450M VL",
    repo: "LiquidAI/LFM2.5-VL-450M-GGUF",
    quant: "Q4_K_M",
    runtime: "gguf",
    serve: "llama serve -hf LiquidAI/LFM2.5-VL-450M-GGUF:Q4_K_M",
    blurb: "Fast extraction with vision. The default assistant on phones.",
    role: "Lightweight vision and multimodal work",
    capabilities: ["vision", "extract", "assist"],
    weightsGb: 0.35,
    minRamGb: 2,
    vision: true,
    reasoning: false,
    generative: true,
    maxCtx: 4096,
  },
  {
    id: "lfm2-230-encoder",
    label: "LFM 2.5 230M encoder",
    repo: "LiquidAI/LFM2.5-Encoder-230M",
    quant: "fp32",
    runtime: "transformers",
    serve: 'AutoModelForMaskedLM.from_pretrained("LiquidAI/LFM2.5-Encoder-230M", trust_remote_code=True)',
    blurb: "Semantic routing, retrieval and tagging. Never writes prose.",
    role: "Routing, retrieval, tool and skill discovery, light classification",
    capabilities: ["encode"],
    weightsGb: 0.18,
    minRamGb: 0,
    vision: false,
    reasoning: false,
    generative: false,
    maxCtx: 2048,
  },
];

/** Strongest first — the recommendation walks down this list. */
export const MODELS: ModelSpec[] = MODEL_LIST.map((m) => ({ ...m, backend: BROWSER_BACKEND }));

export const MODEL_BY_ID: Record<string, ModelSpec> = Object.fromEntries(
  MODELS.map((m) => [m.id, m]),
);


export const DEFAULT_MODEL_ID = "lfm2-450-vl";
export const ENCODER_ID = "lfm2-230-encoder";

/** Which model each capability should prefer — cheapest first. */
export const CAPABILITY_MODELS: Record<Capability, string[]> = {
  encode: ["lfm2-230-encoder"],
  extract: ["lfm2-450-vl", "lfm2-1_2-instruct", "lfm2-2_6"],
  vision: ["lfm2-450-vl"],
  assist: ["lfm2-450-vl", "lfm2-1_2-instruct", "lfm2-2_6"],
  reason: ["lfm2-1_2-instruct", "lfm2-2_6"],
};

/** The cheapest model that can do this, preferring one already downloaded. */
export function modelFor(cap: Capability, downloaded?: Set<string>): ModelSpec | undefined {
  const ids = CAPABILITY_MODELS[cap] ?? [];
  const have = ids.find((id) => downloaded?.has(id));
  return MODEL_BY_ID[have ?? ids[0]];
}

export const CTX_CHOICES = [1024, 2048, 4096, 8192] as const;
export const DEFAULT_CTX = 4096;
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
  const mobile =
    typeof matchMedia === "function" ? matchMedia("(pointer: coarse)").matches : false;
  return {
    ramGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    cores: nav.hardwareConcurrency ?? null,
    mobile,
    probed: true,
  };
}

/**
 * Mobile first. The 1.2B instruct model is the preferred general assistant on
 * anything capable; the 450M VL model is the lightweight fallback; the 2.6B is
 * never recommended automatically on a phone.
 */
const RECOMMEND_ORDER = ["lfm2-1_2-instruct", "lfm2-450-vl", "lfm2-2_6"];

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
    MODEL_BY_ID["lfm2-450-vl"] ??
    MODEL_BY_ID[DEFAULT_MODEL_ID];
  const seen =
    profile.ramGb != null
      ? `${profile.ramGb} GB reported`
      : "memory not reported by the browser";
  return {
    id: pick.id,
    reason: `${seen}${profile.mobile ? " · touch device" : ""} — ${pick.label} fits.`,
  };
}


/** Rough working-set estimate so the context slider can warn honestly. */
export function memoryEstimateGb(modelId: string, nCtx: number): number {
  const spec = MODEL_BY_ID[modelId];
  if (!spec) return 0;
  const kv = (nCtx / 1024) * spec.weightsGb * 0.25;
  return Math.round((spec.weightsGb + kv) * 10) / 10;
}

// ── model state ────────────────────────────────────────────────────────────

/**
 * The six states the UI is expected to distinguish. `required` means the app
 * wants it but the weights are not on the device yet.
 */
export type ModelState =
  | "required"
  | "downloading"
  | "downloaded"
  | "ready"
  | "unavailable"
  | "error";

export type AiStatus =
  | { phase: "idle" }
  | { phase: "downloading"; progress: number }
  | { phase: "loading" }
  | { phase: "ready" }
  | { phase: "error"; message: string };

let instance: Wllama | null = null;
let currentModel: string | null = null;
let currentCtx = DEFAULT_CTX;
let abortRun = false;
let activeBackendValue: Backend = "unavailable";

/** The backend the loaded model is actually running on, never a guess. */
export function activeBackend(): Backend {
  return activeBackendValue;
}

async function createRuntime(): Promise<Wllama> {
  // The binary lives in public/wasm and is fetched by URL after hydration, so it
  // never enters the server bundle. One binary covers both single and
  // multi-threaded execution; wllama enables pthreads only when the page is
  // cross-origin isolated, so nothing here has to be guessed.
  const { Wllama: Ctor } = await import("@wllama/wllama/esm/index.js");
  return new Ctor(
    { default: "/wasm/wllama.wasm" },
    { allowOffline: true, suppressNativeLog: true, parallelDownloads: 2 },

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
 */
export async function cachedModels(): Promise<Set<string>> {
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

/** Resolve the six-state label for one model. */
export function modelState(
  modelId: string,
  opts: { downloaded: Set<string>; status: AiStatus; activeId: string | null; mobile?: boolean },
): ModelState {
  const spec = MODEL_BY_ID[modelId];
  if (!spec) return "unavailable";
  if (spec.desktopOnly && opts.mobile) return "unavailable";
  if (opts.activeId === modelId) {
    if (opts.status.phase === "error") return "error";
    if (opts.status.phase === "downloading") return "downloading";
    if (opts.status.phase === "loading") return "downloading";
    if (opts.status.phase === "ready") return "ready";
  }
  return opts.downloaded.has(modelId) ? "downloaded" : "required";
}

export const STATE_LABEL: Record<ModelState, string> = {
  required: "needs download",
  downloading: "downloading",
  downloaded: "on device",
  ready: "running",
  unavailable: "unavailable here",
  error: "error",
};

export type LoadOptions = { nCtx?: number };

export async function loadModel(
  modelId: string,
  onStatus: (s: AiStatus) => void,
  options: LoadOptions = {},
): Promise<void> {
  const spec = MODEL_BY_ID[modelId] ?? MODEL_BY_ID[DEFAULT_MODEL_ID];
  if (spec.runtime !== "gguf") {
    throw new Error(`${spec.label} is loaded through the encoder runtime, not the chat runtime.`);
  }
  const nCtx = Math.min(options.nCtx ?? DEFAULT_CTX, spec.maxCtx);
  if (isReady(spec.id) && currentCtx === nCtx) {
    onStatus({ phase: "ready" });
    return;
  }
  try {
    // Only one generative model is resident at a time: unload before loading.
    if (instance) {
      await instance.exit().catch(() => {});
      instance = null;
      currentModel = null;
      activeBackendValue = "unavailable";
    }
    onStatus({ phase: "downloading", progress: 0 });
    const caps = await detectRuntime();
    const runtime = await createRuntime();
    // WebGPU first; when the adapter or device never came back we run the
    // WASM SIMD path instead of pretending the GPU is in play.
    const gpuOk = caps.webgpu && runtime.isSupportWebGPU?.() !== false;
    const load = async (useGpu: boolean) =>
      runtime.loadModelFromHF(
        { repo: spec.repo, quant: spec.quant },
        {
          n_ctx: nCtx,
          useCache: true,
          n_gpu_layers: useGpu ? 99999 : 0,
          progressCallback: ({ loaded, total }: { loaded: number; total: number }) => {
            onStatus({ phase: "downloading", progress: total ? loaded / total : 0 });
          },
        } as never,
      );
    try {
      await load(gpuOk);
      activeBackendValue = gpuOk ? "webgpu" : caps.wasmSimd || caps.wasm ? "wasm" : "unavailable";
    } catch (gpuErr) {
      if (!gpuOk) throw gpuErr;
      onStatus({ phase: "loading" });
      await load(false);
      activeBackendValue = "wasm";
    }
    instance = runtime;
    currentModel = spec.id;
    currentCtx = nCtx;
    onStatus({ phase: "ready" });

  } catch (err) {
    instance = null;
    currentModel = null;
    onStatus({
      phase: "error",
      message: err instanceof Error ? err.message : "the assistant failed to start",
    });
    throw err;
  }
}

export async function unload() {
  if (!instance) return;
  await instance.exit().catch(() => {});
  instance = null;
  currentModel = null;
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
  /** live generation speed, emitted while streaming */
  onSpeed?: (tokensPerSecond: number, tokens: number) => void;
};

export async function chat(
  system: string,
  user: string,
  onToken?: (text: string) => void,
  options: ChatOptions = {},
): Promise<string> {
  if (!instance) throw new Error("assistant not loaded");
  const spec = currentModel ? MODEL_BY_ID[currentModel] : undefined;
  if (spec && !spec.generative) {
    throw new Error(`${spec.label} makes embeddings, not prose. Load an instruct or VL model.`);
  }
  const sys = options.thinking
    ? `${system}\n\nThink step by step inside <think>…</think>, then give the answer after it.`
    : system;
  const content =
    options.images?.length && spec?.vision
      ? [
          { type: "text", text: user },
          ...options.images.map((url) => ({ type: "image_url", image_url: { url } })),
        ]
      : user;

  abortRun = false;
  let out = "";
  let tokens = 0;
  const started = performance.now();
  await instance.createChatCompletion({
    messages: [
      { role: "system", content: sys },
      { role: "user", content },
    ],
    stream: true,
    nPredict: options.maxTokens ?? 320,
    sampling: { temp: options.temperature ?? 0.4, top_p: 0.9 },
    onNewToken: (_t: number, _p: unknown, piece: string, opt: { abortSignal: () => void }) => {
      out += piece;
      tokens += 1;
      onToken?.(out);
      const secs = (performance.now() - started) / 1000;
      if (secs > 0) options.onSpeed?.(tokens / secs, tokens);
      if (abortRun) opt?.abortSignal?.();
    },
  } as never);
  return out.trim();
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
