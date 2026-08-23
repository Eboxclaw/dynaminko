/// <reference lib="webworker" />
// AI orchestration worker. Owns the wllama instance — lifecycle, model loading,
// chat completion, streaming. The main thread communicates via typed messages;
// tokens stream back incrementally (same pattern as wallet-reader's per-wallet
// snapshots).
//
// wllama already runs inference in its own pthread worker; this worker manages
// the JS-side orchestration (createRuntime, loadModelInternal, chatMessages,
// downloadModel, etc.) so the main thread never waits on WASM instantiation
// or model loading.

import type { Wllama } from "@wllama/wllama/esm/index.js";
import { buildInferenceProfile, detectRuntime } from "@/lib/ai/runtime";
import { readDelta } from "@/lib/ai/stream";

// ── worker global shims ───────────────────────────────────────────────
//
// wllama resolves the WASM binary path with `document.baseURI`
// (absoluteUrl in @wllama/wllama/src/utils.ts). Web Workers have no
// document, so every runtime creation threw "document is not defined"
// and the whole download pipeline died before the first byte. Patch a
// minimal document shim in once, before wllama's dynamic import runs.
const g = globalThis as { document?: { baseURI?: string } };
if (!g.document || !g.document.baseURI) {
  g.document = Object.create(g.document ?? null) as Document;
  Object.defineProperty(g.document, "baseURI", {
    get: () => self.location.href,
    configurable: true,
  });
}

// ── model config (mirrors ai.ts MODEL_LIST) ──────────────────────────

type Capability = "encode" | "extract" | "vision" | "assist" | "reason";

interface ModelSpec {
  id: string;
  label: string;
  repo: string;
  quant: string;
  runtime: "gguf" | "transformers";
  weightsGb: number;
  nLayers: number;
  maxCtx: number;
  desktopOnly?: boolean;
  minRamGb: number;
  vision: boolean;
  mmprojQuant?: string;
  generative: boolean;
  sampling?: {
    temperature: number;
    minP: number;
    repeatPenalty: number;
    penaltyLastN: number;
  };
}

const MODEL_LIST: ModelSpec[] = [
  {
    id: "lfm2-2_6",
    label: "LFM 2.5 2.6B",
    repo: "LiquidAI/LFM2.5-2.6B-GGUF",
    quant: "QAD-Q4_0",
    runtime: "gguf",
    weightsGb: 1.59,
    nLayers: 32,
    maxCtx: 128192,
    desktopOnly: true,
    minRamGb: 6,
    vision: false,
    generative: true,
    sampling: { temperature: 0.3, minP: 0.15, repeatPenalty: 1.05, penaltyLastN: 64 },
  },
  {
    id: "lfm2-1_2-instruct",
    label: "LFM 2.5 1.2B instruct",
    repo: "LiquidAI/LFM2.5-1.2B-Instruct-GGUF",
    quant: "QAD-Q4_0",
    runtime: "gguf",
    weightsGb: 0.696,
    nLayers: 24,
    maxCtx: 32128,
    desktopOnly: false,
    minRamGb: 4,
    vision: false,
    generative: true,
    sampling: { temperature: 0.3, minP: 0.15, repeatPenalty: 1.05, penaltyLastN: 64 },
  },
  {
    id: "lfm2-350",
    label: "LFM 2.5 350M",
    repo: "LiquidAI/LFM2.5-350M-GGUF",
    quant: "QAD-Q4_0",
    runtime: "gguf",
    weightsGb: 0.219,
    nLayers: 28,
    maxCtx: 8192,
    desktopOnly: false,
    minRamGb: 1.5,
    vision: false,
    generative: true,
    sampling: { temperature: 0.3, minP: 0.15, repeatPenalty: 1.05, penaltyLastN: 64 },
  },
  {
    id: "lfm2-450-vl",
    label: "LFM 2.5 450M VL",
    repo: "LiquidAI/LFM2.5-VL-450M-GGUF",
    quant: "Q4_K_M",
    runtime: "gguf",
    weightsGb: 0.35,
    nLayers: 28,
    maxCtx: 32128,
    desktopOnly: false,
    minRamGb: 2,
    vision: true,
    mmprojQuant: "F16",
    generative: true,
    sampling: { temperature: 0.3, minP: 0.15, repeatPenalty: 1.05, penaltyLastN: 64 },
  },
  {
    id: "lfm2-1_2-thinking",
    label: "LFM 2.5 1.2B Thinking",
    repo: "LiquidAI/LFM2.5-1.2B-Thinking-GGUF",
    quant: "Q4_K_M",
    runtime: "gguf",
    weightsGb: 0.731,
    nLayers: 16,
    maxCtx: 32768,
    desktopOnly: false,
    minRamGb: 4,
    vision: false,
    generative: true,
    sampling: { temperature: 0.05, minP: 0.15, repeatPenalty: 1.05, penaltyLastN: 64 },
  },
  {
    id: "minilm-6-v2",
    label: "All MiniLM L6 v2 encoder",
    repo: "onnx-community/all-MiniLM-L6-v2-ONNX",
    quant: "fp32",
    runtime: "transformers",
    weightsGb: 0.09,
    nLayers: 6,
    maxCtx: 512,
    desktopOnly: false,
    minRamGb: 0,
    vision: false,
    generative: false,
  },
];

const MODEL_BY_ID = Object.fromEntries(MODEL_LIST.map((m) => [m.id, m])) as Record<
  string,
  ModelSpec
>;

const DEFAULT_CTX = 8192;
const DEFAULT_MODEL_ID = "lfm2-350";

// ── types ────────────────────────────────────────────────────────────

export type AiWorkerRequest =
  | { type: "load"; modelId: string; nCtx?: number; allowDownload: boolean }
  | { type: "chat-messages"; turns: { role: string; content: string }[]; options?: ChatOptions }
  | { type: "chat"; system: string; user: string; options?: ChatOptions }
  | { type: "stop" }
  | { type: "unload" }
  | { type: "cached-models" }
  | { type: "delete-model"; modelId: string };

/** reqId is stamped by the main thread on requests and echoed back on the
 * responses that settle a request's promise. Progress/streaming messages
 * (loading, token, done) carry no reqId and are not request responses. */
type WithReqId = { reqId?: number };

export type AiWorkerResponse =
  | ({ type: "ready"; modelId: string; backend: string; ctx: number } & WithReqId)
  | { type: "loading"; modelId: string; progress?: number }
  | ({ type: "error"; modelId?: string; message: string } & WithReqId)
  | { type: "token"; text: string; speed?: { tps: number; tokens: number } }
  | { type: "done"; text: string }
  | ({ type: "cached-models"; ids: string[] } & WithReqId)
  | ({ type: "deleted"; modelId: string } & WithReqId)
  | { type: "unloaded" };

type ChatOptions = {
  temperature?: number;
  maxTokens?: number;
  thinking?: boolean;
  images?: string[];
  responseSchema?: { name: string; schema: Record<string, unknown> };
};

// ── worker state ─────────────────────────────────────────────────────

let instance: Wllama | null = null;
let currentModel: string | null = null;
let currentCtx = DEFAULT_CTX;
let activeBackend = "unavailable";
let abortRun = false;
/** Model id whose load/download is in flight, or null. Guards against
 * concurrent loads desyncing the single wllama instance. */
let loadInFlight: string | null = null;

// ── runtime ──────────────────────────────────────────────────────────

async function createRuntime(parallelDownloads = 4): Promise<Wllama> {
  const { Wllama: Ctor } = await import("@wllama/wllama/esm/index.js");
  return new Ctor(
    { default: "/wasm/wllama.wasm" },
    { allowOffline: true, suppressNativeLog: true, parallelDownloads },
  );
}

function modelSpec(modelId: string): ModelSpec | undefined {
  return MODEL_BY_ID[modelId];
}

async function computeCachedModels(): Promise<Set<string>> {
  const out = new Set<string>();
  const gguf = MODEL_LIST.filter((m) => m.runtime === "gguf");
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
    /* cache unavailable */
  }
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      for (const key of keys) {
        if (!/transformers/i.test(key)) continue;
        const cache = await caches.open(key);
        const reqs = await cache.keys();
        const encoder = MODEL_BY_ID["minilm-6-v2"];
        if (reqs.some((r) => r.url.includes(encoder.repo))) out.add("minilm-6-v2");
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

async function loadModelInternal(
  modelId: string,
  allowDownload: boolean,
): Promise<{ ok: true; backend: string; ctx: number } | { ok: false; error: string }> {
  const spec = modelSpec(modelId) ?? modelSpec(DEFAULT_MODEL_ID)!;
  if (spec.runtime !== "gguf") {
    return {
      ok: false,
      error: `${spec.label} is loaded through the encoder, not the chat runtime.`,
    };
  }

  const nCtx = currentCtx;

  if (!allowDownload) {
    const cached = await computeCachedModels();
    if (!cached.has(spec.id)) {
      return { ok: false, error: `${spec.label} is not downloaded. Download it first.` };
    }
  }

  try {
    if (instance) await instance.exit().catch(() => {});
    instance = null;

    const ctx = self as unknown as DedicatedWorkerGlobalScope;
    ctx.postMessage({ type: "loading", modelId: spec.id } satisfies AiWorkerResponse);

    const caps = await detectRuntime();
    const profile = buildInferenceProfile(caps, spec.weightsGb, spec.nLayers, nCtx);
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
            if (allowDownload && total) {
              const ctx2 = self as unknown as DedicatedWorkerGlobalScope;
              ctx2.postMessage({
                type: "loading",
                modelId: spec.id,
                progress: loaded / total,
              } satisfies AiWorkerResponse);
            }
          },
        } as never,
      );
    };

    try {
      await load(gpuOk);
      activeBackend = gpuOk ? "webgpu" : caps.wasmSimd || caps.wasm ? "wasm" : "unavailable";
    } catch (gpuErr) {
      if (!gpuOk) throw gpuErr;
      await load(false);
      activeBackend = "wasm";
    }

    instance = runtime;
    currentModel = spec.id;
    currentCtx = nCtx;

    return { ok: true, backend: activeBackend, ctx: nCtx };
  } catch (err) {
    instance = null;
    currentModel = null;
    activeBackend = "unavailable";
    return {
      ok: false,
      error: err instanceof Error ? err.message : "the assistant failed to start",
    };
  }
}

async function chatMessages(
  turns: { role: string; content: string }[],
  options: ChatOptions = {},
): Promise<string> {
  if (!instance) throw new Error("assistant not loaded");
  const spec = currentModel ? MODEL_BY_ID[currentModel] : undefined;
  if (spec && !spec.generative) {
    throw new Error(`${spec.label} makes embeddings, not prose.`);
  }

  const systemText = turns
    .filter((t) => t.role === "system")
    .map((t) => t.content)
    .join("\n\n");
  const sys = options.thinking
    ? `${systemText}\n\nThink step by step inside  thinking… response, then give the answer after it.`
    : systemText;

  const dialogue = turns.filter((t) => t.role !== "system");
  const messages: Array<{ role: string; content: unknown }> = [
    { role: "system", content: sys },
    ...dialogue.map((t) => ({ role: t.role, content: t.content })),
  ];

  abortRun = false;
  const abortController = new AbortController();
  let out = "";
  let tokens = 0;
  const started = performance.now();

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
      const ctx = self as unknown as DedicatedWorkerGlobalScope;
      const secs = (performance.now() - started) / 1000;
      ctx.postMessage({
        type: "token",
        text: piece,
        ...(secs > 0 ? { speed: { tps: Math.round((tokens / secs) * 10) / 10, tokens } } : {}),
      } satisfies AiWorkerResponse);
      if (abortRun) abortController.abort();
    },
  });

  return out.trim();
}

// ── message handler ──────────────────────────────────────────────────

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener("message", async (event: MessageEvent<AiWorkerRequest & { reqId?: number }>) => {
  const msg = event.data;
  if (!msg?.type) return;
  const reqId = msg.reqId;

  switch (msg.type) {
    case "load": {
      if (loadInFlight) {
        // Never start a second load while one is in progress: two loads would
        // fight over the single wllama instance and desync the cache.
        ctx.postMessage({
          type: "error",
          reqId,
          modelId: msg.modelId,
          message: "a model operation is already in progress, try again in a moment",
        } satisfies AiWorkerResponse);
        return;
      }
      loadInFlight = msg.modelId;
      let result;
      try {
        result = await loadModelInternal(msg.modelId, msg.allowDownload);
      } finally {
        loadInFlight = null;
      }
      if (result.ok) {
        ctx.postMessage({
          type: "ready",
          reqId,
          modelId: msg.modelId,
          backend: result.backend,
          ctx: result.ctx,
        } satisfies AiWorkerResponse);
      } else {
        ctx.postMessage({
          type: "error",
          reqId,
          modelId: msg.modelId,
          message: result.error,
        } satisfies AiWorkerResponse);
      }
      return;
    }

    case "chat-messages": {
      try {
        const text = await chatMessages(msg.turns, msg.options);
        ctx.postMessage({ type: "done", text } satisfies AiWorkerResponse);
      } catch (err) {
        ctx.postMessage({
          type: "error",
          message: err instanceof Error ? err.message : "chat failed",
        } satisfies AiWorkerResponse);
      }
      return;
    }

    case "chat": {
      try {
        const text = await chatMessages(
          [
            { role: "system", content: msg.system },
            { role: "user", content: msg.user },
          ],
          msg.options,
        );
        ctx.postMessage({ type: "done", text } satisfies AiWorkerResponse);
      } catch (err) {
        ctx.postMessage({
          type: "error",
          message: err instanceof Error ? err.message : "chat failed",
        } satisfies AiWorkerResponse);
      }
      return;
    }

    case "stop": {
      abortRun = true;
      return;
    }

    case "unload": {
      if (instance) await instance.exit().catch(() => {});
      instance = null;
      currentModel = null;
      currentCtx = DEFAULT_CTX;
      activeBackend = "unavailable";
      ctx.postMessage({ type: "unloaded" } satisfies AiWorkerResponse);
      return;
    }

    case "cached-models": {
      try {
        const cached = await computeCachedModels();
        ctx.postMessage({
          type: "cached-models",
          reqId,
          ids: [...cached],
        } satisfies AiWorkerResponse);
      } catch (err) {
        ctx.postMessage({
          type: "error",
          reqId,
          message: err instanceof Error ? err.message : "cached-models failed",
        } satisfies AiWorkerResponse);
      }
      return;
    }

case "delete-model": {
      // Never delete mid-download: it would remove the very file wllama is
      // writing and corrupt the cache entry.
      if (loadInFlight) {
        ctx.postMessage({
          type: "error",
          reqId,
          modelId: msg.modelId,
          message: "a model is still downloading or loading, wait for it to finish",
        } satisfies AiWorkerResponse);
        return;
      }
      try {
        const spec = MODEL_BY_ID[msg.modelId];
        if (!spec) {
          ctx.postMessage({
            type: "error",
            reqId,
            message: `unknown model: ${msg.modelId}`,
          } satisfies AiWorkerResponse);
          return;
        }
        const needle = (spec.repo.split("/")[1] ?? spec.repo).toLowerCase();

        // Unload if this model is loaded
        if (currentModel === spec.id && instance) {
          await instance.exit().catch(() => {});
          instance = null;
          currentModel = null;
          activeBackend = "unavailable";
        }

        // Clear cached weights. We need a wllama instance for its cache
        // manager, so reuse the live one or create a short-lived runtime.
        if (spec.runtime === "gguf") {
          const matchEntry = (e: unknown) => {
            const rec = e as { name?: string; url?: string };
            return (rec.url ?? rec.name ?? "").toLowerCase().includes(needle);
          };
          type CacheMgr = { deleteMany?: (pred: (e: unknown) => boolean) => Promise<void> };
          let mgr: CacheMgr | undefined = instance
            ? (instance as unknown as { cacheManager?: CacheMgr }).cacheManager
            : undefined;
          let temp: Wllama | null = null;
          if (!mgr) {
            // No active instance — create a throwaway runtime to access the cache manager
            try {
              const { Wllama: Ctor } = await import("@wllama/wllama/esm/index.js");
              temp = new Ctor(
                { default: "/wasm/wllama.wasm" },
                { allowOffline: true, suppressNativeLog: true, parallelDownloads: 1 },
              );
              mgr = (temp as unknown as { cacheManager?: CacheMgr }).cacheManager;
              await mgr?.deleteMany?.(matchEntry);
            } catch {
              /* fall through — caches API below is a secondary path */
            } finally {
              await temp?.exit().catch(() => {});
            }
          } else {
            await mgr.deleteMany?.(matchEntry);
          }
        }

        // Also clear from the Cache API (for ONNX/transformers models)
        if (typeof caches !== "undefined") {
          for (const key of await caches.keys()) {
            if (!/transformers/i.test(key)) continue;
            const cache = await caches.open(key);
            for (const req of await cache.keys()) {
              if (req.url.toLowerCase().includes(needle)) await cache.delete(req);
            }
          }
        }

        ctx.postMessage({ type: "deleted", reqId, modelId: msg.modelId } satisfies AiWorkerResponse);
      } catch (err) {
        ctx.postMessage({
          type: "error",
          reqId,
          message: err instanceof Error ? err.message : "delete-model failed",
        } satisfies AiWorkerResponse);
      }
      return;
    }

    default:
      ctx.postMessage({
        type: "error",
        message: `unknown request type: ${(msg as { type: string }).type}`,
      } satisfies AiWorkerResponse);
  }
});
