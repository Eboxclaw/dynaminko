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

import type { Wllama, CacheManager } from "@wllama/wllama/esm/index.js";
import { buildInferenceProfile, detectRuntime } from "@/lib/ai/runtime";
import { readDelta } from "@/lib/ai/stream";
// The registry lives once, on the main thread (lib/ai.ts). This module has no
// runtime imports of its own, so it bundles into the worker cleanly.
import {
  DEFAULT_CTX,
  DEFAULT_MODEL_ID,
  MODEL_BY_ID,
  MODELS,
  type ModelSpec,
} from "@/lib/ai";

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

// ── types ────────────────────────────────────────────────────────────

export type AiWorkerRequest =
  | { type: "load"; modelId: string; nCtx?: number; allowDownload: boolean }
  // Carries the owning load's reqId so the worker releases the guard only for
  // the request the main thread stopped waiting on, never for a newer load.
  | ({ type: "cancel-load"; modelId: string } & WithReqId)
  | { type: "chat-messages"; turns: { role: string; content: string }[]; options?: ChatOptions }
  | { type: "chat"; system: string; user: string; options?: ChatOptions }
  | { type: "stop" }
  | { type: "unload" }
  | { type: "cached-models" }
  | { type: "delete-model"; modelId: string };

/** reqId is stamped by the main thread on requests and echoed back on the
 * responses that settle a request's promise. The "loading" progress stream is
 * the one outbound message that carries a reqId: it belongs to the in-flight
 * load so the bridge can slide that load's deadline forward on every tick. */
type WithReqId = { reqId?: number };

export type AiWorkerResponse =
  | ({ type: "ready"; modelId: string; backend: string; ctx: number } & WithReqId)
  | ({ type: "loading"; modelId: string; progress?: number } & WithReqId)
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
/** The reqId of the load/download in flight, or null. Guards against
 * concurrent loads desyncing the single wllama instance. The worker cannot
 * observe the main thread's deadline, so a "cancel-load" message arrives when
 * the main thread gives up waiting; it clears the guard only for the request
 * that owns it, never for a newer load that has since taken over. */
let loadInFlight: { reqId: number | undefined; modelId: string } | null = null;

function isOwnedLoad(reqId: number | undefined, modelId: string): boolean {
  return loadInFlight != null && loadInFlight.reqId === reqId && loadInFlight.modelId === modelId;
}

// ── runtime ──────────────────────────────────────────────────────────
//
// Two distinct wllama surfaces, deliberately kept apart:
//
//  * A single standalone CacheManager, created once. The OPFS cache it reads
//    and writes is origin-wide, so one manager sees exactly the same files a
//    fresh runtime would. Every cache list / delete / verify goes through it,
//    which means we NEVER have to spin up a Wllama instance just to touch the
//    cache. Spinning up throwaway Wllama instances for cache ops is what
//    previously leaked live WASM proxies ("Module is already initialized").
//
//  * A fresh Wllama inference handle per load. wllama's exit() does not always
//    fully unwind the Emscripten module, so re-loading many times on ONE
//    long-lived handle accumulated orphaned state and aborted on the 4th
//    cycle ("(ABORT)"). A clean handle per load never reaches that state, and
//    the cache is preserved because it is the shared manager, not the handle.
//
// Only one inference handle is alive at a time: load/unload/delete each exit
// the previous `instance` before creating or dropping it.

let sharedCache: CacheManager | null = null;

async function getSharedCache(): Promise<CacheManager> {
  if (sharedCache) return sharedCache;
  const mod = await import("@wllama/wllama/esm/index.js");
  sharedCache = new mod.CacheManager();
  return sharedCache;
}

async function createRuntime(parallelDownloads = 4): Promise<Wllama> {
  const mod = await import("@wllama/wllama/esm/index.js");
  // A new inference handle on every load, wired to the one shared cache.
  const cache = await getSharedCache();
  return new mod.Wllama(
    { default: "/wasm/wllama.wasm" },
    { allowOffline: true, suppressNativeLog: true, parallelDownloads, cacheManager: cache },
  );
}

/** Convert a data URL (e.g. data:image/jpeg;base64,/9j…) to an ArrayBuffer
 * for wllama's multimodal image parts. Returns an empty buffer on failure. */
function base64fromDataUrl(dataUrl: string): ArrayBuffer {
  try {
    const comma = dataUrl.indexOf(",");
    if (comma === -1) return new ArrayBuffer(0);
    const raw = atob(dataUrl.slice(comma + 1));
    const buf = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
    return buf.buffer as ArrayBuffer;
  } catch {
    return new ArrayBuffer(0);
  }
}

/** Free the current inference handle (if any) so at most one is alive. */
async function exitInstance(): Promise<void> {
  if (!instance) return;
  const old = instance;
  instance = null;
  try {
    await old.exit();
  } catch {
    /* already dead */
  }
}

/**
 * Exit one specific handle and hand back a brand-new one. Used after a load
 * attempt that may have half-initialized the handle's Emscripten module (the
 * GPU→CPU fallback); reusing that handle is what produced "(ABORT)". The
 * download is not repeated because the new handle shares the same cache.
 */
async function replaceRuntime(prev: Wllama, threads: number): Promise<Wllama> {
  try {
    await prev.exit();
  } catch {
    /* half-initialized: already dead */
  }
  return createRuntime(threads);
}

function modelSpec(modelId: string): ModelSpec | undefined {
  return MODEL_BY_ID[modelId];
}

/**
 * The repo basename ("lfm2.5-350m-gguf") identifies a model. It is absent from
 * the OPFS filename (which is the weight file, e.g. LFM2.5-350M-QAD-Q4_0.gguf)
 * but present in the entry's metadata.originalURL (the Hugging Face URL).
 */
function specNeedle(spec: ModelSpec): string {
  return (spec.repo.split("/")[1] ?? spec.repo).toLowerCase();
}

/** Every text field a cache entry carries, lowercased for matching. */
function entryHaystack(e: unknown): string {
  const rec = e as {
    name?: string;
    url?: string;
    metadata?: { originalURL?: string; mmprojURL?: string };
  };
  return [rec.name, rec.url, rec.metadata?.originalURL, rec.metadata?.mmprojURL]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function entryMatches(e: unknown, needle: string): boolean {
  return entryHaystack(e).includes(needle);
}

/** The encoder (and any ONNX model) lives in the browser Cache API under
 * transformers.js cache names; verify it by entry URL. */
async function onnxCacheContains(needle: string): Promise<boolean> {
  for (const key of await caches.keys()) {
    if (!/transformers/i.test(key)) continue;
    const cache = await caches.open(key);
    if ((await cache.keys()).some((r) => r.url.toLowerCase().includes(needle)))
      return true;
  }
  return false;
}

/**
 * One OPFS-backed cache listing, returned once and shared by the "which
 * models are here" question and the per-model match. null when the cache
 * could not be read at all — callers treat that as "cannot prove deletion",
 * never as "gone".
 */
async function listCacheEntries(): Promise<unknown[] | null> {
  try {
    const mgr = await getSharedCache();
    return (await mgr.list()) ?? [];
  } catch {
    return null;
  }
}

/** Whether this repo's weights are in the cache. null = unreadable. */
async function cacheContains(spec: ModelSpec, entries?: unknown[] | null): Promise<boolean | null> {
  const list = entries === undefined ? await listCacheEntries() : entries;
  if (list === null) return null;
  return list.some((e) => entryMatches(e, specNeedle(spec)));
}

async function computeCachedModels(): Promise<Set<string>> {
  const out = new Set<string>();
  const gguf = MODELS.filter((m) => m.runtime === "gguf");
  const entries = await listCacheEntries();
  if (entries !== null) {
    for (const m of gguf) if (entries.some((e) => entryMatches(e, specNeedle(m)))) out.add(m.id);
  }
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      for (const key of keys) {
        if (!/transformers/i.test(key)) continue;
        const cache = await caches.open(key);
        const reqs = await cache.keys();
        const encoder = MODEL_BY_ID["minilm-6-v2"];
        if (reqs.some((r) => r.url.toLowerCase().includes(encoder.repo))) out.add("minilm-6-v2");
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
  requestCtx?: number,
  reqId?: number,
): Promise<{ ok: true; backend: string; ctx: number } | { ok: false; error: string }> {
  const spec = modelSpec(modelId) ?? modelSpec(DEFAULT_MODEL_ID)!;
  if (spec.runtime !== "gguf") {
    return {
      ok: false,
      error: `${spec.label} is loaded through the encoder, not the chat runtime.`,
    };
  }

  // The context window is a per-load setting, not a global: the caller passes
  // the user's current choice; clamp to this model's real ceiling so a stale
  // selection from a bigger model cannot overflow this one.
  const nCtx = requestCtx && requestCtx > 0 ? Math.min(requestCtx, spec.maxCtx) : currentCtx;

  if (!allowDownload) {
    const cached = await computeCachedModels();
    if (!cached.has(spec.id)) {
      return { ok: false, error: `${spec.label} is not downloaded. Download it first.` };
    }
  }

  const caps = await detectRuntime();
  const profile = buildInferenceProfile(caps, spec.weightsGb, spec.nLayers, nCtx);
  const gpuOk = caps.webgpu && profile.n_gpu_layers > 0;

  // A fresh inference handle per load: wllama's exit() does not always fully
  // unwind the Emscripten module, so re-loading repeatedly on one handle
  // accumulated orphaned state and aborted. The cache is preserved because it
  // is the shared manager, not this handle.
  await exitInstance();
  let runtime = await createRuntime(profile.n_threads > 1 ? 6 : 3);
  instance = runtime;

  try {
    const ctx = self as unknown as DedicatedWorkerGlobalScope;
    ctx.postMessage(
      { type: "loading", modelId: spec.id, reqId } satisfies AiWorkerResponse,
    );

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
                reqId,
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
      // The failed GPU attempt may have half-initialized this handle's WASM
      // module. Swap in a fresh handle (shared cache, so no re-download)
      // rather than re-initializing the damaged one.
      const fresh = await replaceRuntime(runtime, profile.n_threads > 1 ? 6 : 3);
      instance = fresh;
      runtime = fresh;
      await load(false);
      activeBackend = "wasm";
    }

    currentModel = spec.id;
    currentCtx = nCtx;

    return { ok: true, backend: activeBackend, ctx: nCtx };
  } catch (err) {
    // Clear the resident-model state so the UI reads "not loaded". The cache
    // is the shared manager, so it survives this handle being dropped.
    await exitInstance();
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
  // The handle outlives the model, so "a model is loaded" means currentModel
  // is set, not that the handle exists.
  if (!instance || !currentModel) throw new Error("assistant not loaded");
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
  const images = options.images;
  const hasImages = !!images?.length;
  const isVision = spec?.vision === true;

  // When images are provided to a non-vision model, warn and skip them.
  // When the active model is vision-capable, build multimodal messages.
  const messages: Array<{ role: string; content: unknown }> = [
    { role: "system", content: sys },
    ...dialogue.map((t) => {
      if (!hasImages || !isVision || t.role !== "user") {
        return { role: t.role, content: t.content };
      }
      // Multimodal user message: text + images as typed content parts
      // that wllama's createChatCompletion renders into the prompt.
      const parts: Array<{ type: "text" | "image"; text?: string; data?: ArrayBuffer }> = [
        { type: "text", text: t.content },
      ];
      for (const dataUrl of images) {
        const raw = base64fromDataUrl(dataUrl);
        if (raw.byteLength > 0) parts.push({ type: "image", data: raw });
      }
      return { role: "user", content: parts };
    }),
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
      loadInFlight = { reqId, modelId: msg.modelId };
      let result;
      try {
        result = await loadModelInternal(msg.modelId, msg.allowDownload, msg.nCtx, reqId);
      } finally {
        // Only clear the guard if this request still owns it; a newer load
        // may have taken over after a cancel.
        if (loadInFlight && loadInFlight.reqId === reqId) loadInFlight = null;
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

    case "cancel-load": {
      // The main thread's deadline expired. It cannot reach the wllama
      // instance to stop a download (wllama exposes no abort API), so the
      // best we can do is release the guard for the request that owns it.
      // A newer load that started afterwards keeps its own guard intact.
      if (isOwnedLoad(reqId, msg.modelId)) loadInFlight = null;
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
      // Drop the inference handle; the shared cache manager outlives it, so
      // the weights remain "on device" and can be re-loaded or deleted.
      await exitInstance();
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
        const needle = specNeedle(spec);

        // Unload this model's inference handle if it is resident.
        if (currentModel === spec.id) {
          await exitInstance();
          currentModel = null;
          activeBackend = "unavailable";
        }

        // Delete through the shared cache manager: no Wllama instance needed,
        // so no WASM to leak or re-initialize.
        const cache = await getSharedCache();
        if (spec.runtime === "gguf") {
          await cache.deleteMany((e) => entryMatches(e, needle));
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

        // Do not claim success until the cache actually agrees.
        const stillThere =
          spec.runtime === "gguf"
            ? await cacheContains(spec)
            : typeof caches !== "undefined"
              ? await onnxCacheContains(needle)
              : null;

        if (stillThere === true) {
          ctx.postMessage({
            type: "error",
            reqId,
            modelId: msg.modelId,
            message: "delete could not remove the cached weights, try again",
          } satisfies AiWorkerResponse);
          return;
        }
        if (stillThere === null) {
          ctx.postMessage({
            type: "error",
            reqId,
            modelId: msg.modelId,
            message: "could not confirm the delete (cache unavailable), try again",
          } satisfies AiWorkerResponse);
          return;
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
