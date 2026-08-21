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
import type { Backend } from "@/lib/ai/runtime";
import type { AiWorkerRequest, AiWorkerResponse } from "@/workers/ai.worker";

// ── static config (stays on main thread) ─────────────────────────────

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
  sampling?: {
    temperature: number;
    minP: number;
    repeatPenalty: number;
    penaltyLastN: number;
  };
  backend: { preferred: "webgpu"; fallback: "wasm" };
};

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

export const MODELS: ModelSpec[] = MODEL_LIST.map((m) => ({ ...m, backend: BROWSER_BACKEND }));
export const MODEL_BY_ID: Record<string, ModelSpec> = Object.fromEntries(
  MODELS.map((m) => [m.id, m]),
);
export const DEFAULT_MODEL_ID = "lfm2-350";
export const ENCODER_ID = "lfm2-230-encoder";

export const CAPABILITY_MODELS: Record<Capability, string[]> = {
  encode: ["lfm2-230-encoder"],
  extract: ["lfm2-350", "lfm2-1_2-instruct", "lfm2-2_6"],
  vision: ["lfm2-450-vl"],
  assist: ["lfm2-350", "lfm2-1_2-instruct", "lfm2-2_6"],
  reason: ["lfm2-1_2-instruct", "lfm2-2_6"],
};

export function modelFor(cap: Capability, downloaded?: Set<string>): ModelSpec | undefined {
  const ids = CAPABILITY_MODELS[cap] ?? [];
  const have = ids.find((id) => downloaded?.has(id));
  return MODEL_BY_ID[have ?? ids[0]];
}

export const CTX_CHOICES = [1024, 2048, 4096, 8192, 16384, 32128] as const;
export const DEFAULT_CTX = 8192;
export const MAX_CONTEXT_MESSAGES = 5;

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

const RECOMMEND_ORDER = ["lfm2-350", "lfm2-1_2-instruct", "lfm2-450-vl", "lfm2-2_6"];

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

export function memoryEstimateGb(modelId: string, nCtx: number): number {
  const spec = MODEL_BY_ID[modelId];
  if (!spec) return 0;
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

let nextId = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

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
          // Resolve any pending load request
          for (const [, p] of pending) p.resolve({ status: "ready", modelId: msg.modelId });
          pending.clear();
          return;
        }
        case "error": {
          for (const [, p] of pending) p.reject(new Error(msg.message));
          pending.clear();
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
          for (const [, p] of pending) p.resolve(new Set(msg.ids));
          pending.clear();
          return;
        }
        case "deleted": {
          const was = sLoadedModelId;
          if (was === msg.modelId) {
            sReady = false;
            sLoadedModelId = null;
            sActiveBackend = "unavailable";
          }
          for (const [, p] of pending) p.resolve(undefined);
          pending.clear();
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
      for (const [, p] of pending) p.reject(new Error("AI worker crashed"));
      pending.clear();
    });
  } catch (err) {
    console.warn("AI worker creation failed:", err);
  }
  return worker;
}

function postAndWait<T>(msg: AiWorkerRequest): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const w = getWorker();
    if (!w) {
      reject(new Error("AI worker unavailable (SSR or unsupported browser)"));
      return;
    }
    const id = nextId++;
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage(msg);

    // Timeout to prevent hanging (matches the wall-clock deadline in AGENTS.md)
    setTimeout(() => {
      const p = pending.get(id);
      if (p) {
        pending.delete(id);
        p.reject(new Error("AI worker request timed out"));
      }
    }, 120_000);
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

export async function downloadModel(
  modelId: string,
  onStatus: (s: AiStatus) => void,
  _options: { nCtx?: number } = {},
): Promise<LifecycleResult> {
  onStatus({ phase: "downloading", progress: 0, modelId });
  try {
    await postAndWait<void>({ type: "load", modelId, allowDownload: true });
    onStatus({ phase: "ready", modelId });
    return { status: "ready", modelId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "download failed";
    onStatus({ phase: "error", message, modelId });
    return { status: "error", modelId, message };
  }
}

export async function loadDownloadedModel(
  modelId: string,
  onStatus: (s: AiStatus) => void,
  _options: { nCtx?: number } = {},
): Promise<LifecycleResult> {
  const spec = MODEL_BY_ID[modelId] ?? MODEL_BY_ID[DEFAULT_MODEL_ID];
  if (spec.desktopOnly && deviceProfile().mobile) {
    return { status: "unsupported", modelId: spec.id, message: "This model is unavailable here." };
  }
  onStatus({ phase: "loading", modelId });
  try {
    await postAndWait<void>({ type: "load", modelId, allowDownload: false });
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

    const id = nextId++;
    let out = "";
    let lastSpeed: { tps: number; tokens: number } | null = null;

    const handler = (event: MessageEvent<AiWorkerResponse>) => {
      const msg = event.data;
      if (!msg?.type) return;

      switch (msg.type) {
        case "token": {
          out += msg.text;
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
      },
    } satisfies AiWorkerRequest);

    // Timeout safeguard
    setTimeout(() => {
      worker?.removeEventListener("message", handler);
      if (out) resolve(out);
      else reject(new Error("chat timed out"));
    }, 120_000);
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
  const m = / thinking([\s\S]*?)(?:<\/think>|$)/i.exec(text);
  if (!m) return { thinking: null, answer: text };
  return {
    thinking: m[1].trim(),
    answer: text.slice(m.index + m[0].length).trim(),
  };
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
