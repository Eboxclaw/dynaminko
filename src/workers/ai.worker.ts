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
import { DEFAULT_CTX, DEFAULT_MODEL_ID, MODEL_BY_ID, MODELS, budgetOutcome, expectedGgufFilename, orphanRecoveryDecision, webgpuWeightsFactor, type ModelSpec } from "@/lib/ai";
import { renderInterceptedCalls, withNativeToolTurns } from "@/lib/ai/nativeTools";

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
  | {
      type: "load";
      modelId: string;
      nCtx?: number;
      allowDownload: boolean;
      /** dev-only backend pin for the comparison protocol */
      forcedBackend?: "webgpu" | "wasm";
      /** dev-only flash-attn override for the prefill A/B */
      forcedFlashAttn?: boolean | null;
      /** dev-only prompt-cache (cache_prompt) override for the KV-reuse A/B */
      forcedCache?: boolean | null;
      /** dev-only reasoning-budget override for the budget benchmark sweep */
      forcedBudget?: number;
      /** dev-only RoPE base override for the position-encoding A/B */
      forcedRopeBase?: number;
      /** dev-only KV dtype override for the cache-quantization A/B */
      forcedKvType?: "q8_0" | "f16";
      /** override the spec's reasoning default (FAST vs REASONED reload) */
      reasoning?: boolean;
    }
  // Carries the owning load's reqId so the worker releases the guard only for
  // the request the main thread stopped waiting on, never for a newer load.
  | ({ type: "cancel-load"; modelId: string } & WithReqId)
  | { type: "chat-messages"; turns: { role: string; content: string }[]; options?: ChatOptions }
  | { type: "chat"; system: string; user: string; options?: ChatOptions }
  // Idle semantic prewarm: one silent 1-token completion over a strict byte
  // prefix of the turn prompt so the KV slot holds it before the first real
  // turn. Never posts token/done messages; skipped while a generation runs.
  | { type: "warm"; system: string }
  | { type: "stop" }
  | { type: "unload" }
  | { type: "cached-models" }
  | { type: "delete-model"; modelId: string }
  // Encoder lane. A dedicated, always-warm wllama handle separate from the
  // rotating generative instance: routing must never wait for a model swap.
  | { type: "embed-load"; modelId: string; allowDownload: boolean }
  | { type: "embed"; texts: string[] }
  | { type: "embed-unload" };

/** reqId is stamped by the main thread on requests and echoed back on the
 * responses that settle a request's promise. The "loading" progress stream is
 * the one outbound message that carries a reqId: it belongs to the in-flight
 * load so the bridge can slide that load's deadline forward on every tick. */
type WithReqId = { reqId?: number };

export type AiWorkerResponse =
  | ({ type: "ready"; modelId: string; backend: string; ctx: number } & WithReqId & {
      /** what actually engaged, for the perf trace */
      threadsRequested?: number;
      threadsEffective?: number;
      gpuLayers?: number;
      /** the chosen inference path, printed by /usage */
      batch?: number;
      cacheK?: string;
      cacheV?: string;
      flashAttn?: boolean;
      cacheReuse?: number;
    })
  | ({ type: "loading"; modelId: string; progress?: number } & WithReqId)
  | ({ type: "warm-done" } & WithReqId)
  | ({ type: "error"; modelId?: string; message: string } & WithReqId)
  | { type: "token"; text: string; speed?: { tps: number; tokens: number } }
  | { type: "done"; text: string; metrics?: GenerationMetrics }
  | ({ type: "cached-models"; ids: string[] } & WithReqId)
  | ({ type: "deleted"; modelId: string } & WithReqId)
  | { type: "unloaded" }
  | ({ type: "embed-ready"; modelId: string; backend: string } & WithReqId)
  | ({ type: "embedded"; vectors: number[][] } & WithReqId)
  | ({ type: "embed-unloaded" } & WithReqId);

type ChatOptions = {
  temperature?: number;
  maxTokens?: number;
  thinking?: boolean;
  images?: string[];
  responseSchema?: { name: string; schema: Record<string, unknown> };
  toolTurns?: { id: string; name: string; args: Record<string, unknown>; content: string }[];
  tools?: {
    type: "function";
    function: {
      name: string;
      description?: string;
      parameters?: {
        type: "object";
        properties: Record<string, { type: string }>;
        required?: string[];
      };
    };
  }[];
};

/** One generation, measured honestly: prefill (TTFT), steady-state decode,
 *  and totals are separate numbers. tok/s is NEVER total wall clock — that
 *  mixed metric is what hid the 2.6B stall signature for days. */
export type GenerationMetrics = {
  promptTokens: number | null;
  /** true when promptTokens is a chars/4 estimate, not a tokenizer count */
  promptTokensEstimated: boolean;
  outputTokens: number;
  ttftMs: number | null;
  /** steady-state tokens/sec after the first token */
  decodeTps: number | null;
  totalMs: number;
  /** null until wllama exposes a reasoning-token count */
  reasoningTokens: number | null;
};

// ── worker state ─────────────────────────────────────────────────────

let instance: Wllama | null = null;
let currentModel: string | null = null;
let currentCtx = DEFAULT_CTX;
let activeBackend = "unavailable";
let abortRun = false;
/**
 * llama-server slot reuse for the common prompt prefix (cache_prompt), set at
 * load time. The wrapper keeps one server context whose slot persists across
 * completion tasks, so each call re-prefills only the prompt suffix past the
 * longest shared token prefix instead of the whole prompt every hop.
 */
let cachePrompt = true;
/** The reqId of the load/download in flight, or null. Guards against
 * concurrent loads desyncing the single wllama instance. The worker cannot
 * observe the main thread's deadline, so a "cancel-load" message arrives when
 * the main thread gives up waiting; it clears the guard only for the request
 * that owns it, never for a newer load that has since taken over. */
let loadInFlight: { reqId: number | undefined; modelId: string } | null = null;

function isOwnedLoad(reqId: number | undefined, modelId: string): boolean {
  return loadInFlight != null && loadInFlight.reqId === reqId && loadInFlight.modelId === modelId;
}

// ── encoder lane state ────────────────────────────────────────────────
//
// The embedding model lives on its OWN wllama handle, loaded once and kept
// warm while generative models rotate on `instance`. Two live handles cost
// the encoder's weights (~230 MB Q4_K_M); the alternative (sharing the
// generative handle) would unload the chat model on every routing call.

let embedInstance: Wllama | null = null;
let embedModel: string | null = null;
let embedBackend = "unavailable";
let embedLoadInFlight = false;

async function exitEmbedInstance(): Promise<void> {
  if (!embedInstance) return;
  const old = embedInstance;
  embedInstance = null;
  embedModel = null;
  embedBackend = "unavailable";
  try {
    await old.exit();
  } catch {
    /* already dead */
  }
}

/**
 * Load an embedding GGUF (runtime "gguf", generative false) onto the warm
 * encoder handle. Router texts are short, so n_ctx stays small: the KV cache
 * of a one-vector bi-encoder does not need card context. Pooling follows the
 * LFM2.5-Embedding card (CLS); llama.cpp also reads pooling from GGUF
 * metadata when the file declares it.
 */
async function loadEmbedModelInternal(
  modelId: string,
  allowDownload: boolean,
  reqId?: number,
): Promise<{ ok: true; backend: string } | { ok: false; error: string }> {
  const spec = MODEL_BY_ID[modelId];
  if (!spec || spec.generative || spec.runtime !== "gguf") {
    return { ok: false, error: `${modelId} is not a GGUF embedding model.` };
  }
  if (!allowDownload) {
    const cached = await computeCachedModels();
    if (!cached.has(spec.id)) {
      return { ok: false, error: `${spec.label} is not downloaded. Download it first.` };
    }
  }
  if (embedModel === spec.id && embedInstance) {
    return { ok: true, backend: embedBackend };
  }
  await exitEmbedInstance();

  const caps = await detectRuntime();
  const profile = buildInferenceProfile(caps, spec.weightsGb, spec.nLayers, 2048);
  const gpuOk = caps.webgpu && profile.n_gpu_layers > 0;

  let runtime = await createRuntime(profile.n_threads > 1 ? 6 : 3);
  embedInstance = runtime;

  const load = async (useGpu: boolean) => {
    await runtime.loadModelFromHF(
      { repo: spec.repo, quant: spec.quant },
      {
        n_ctx: 2048,
        useCache: true,
        embeddings: true,
        pooling_type: "cls",
        n_gpu_layers: useGpu ? profile.n_gpu_layers : 0,
        n_threads: profile.n_threads,
        n_batch: profile.n_batch,
        progressCallback: ({ loaded, total }: { loaded: number; total: number }) => {
          if (allowDownload && total) {
            ctx.postMessage({
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
    ctx.postMessage({ type: "loading", modelId: spec.id, reqId } satisfies AiWorkerResponse);
    // Note: a resident 2.6B cannot share the machine with a second wllama
    // handle (GPU: ABORT, CPU: wedged embeds; measured 09-01). That case is
    // handled upstream by routing such models to the transformers.js
    // encoder (spec.encoderFallback), not by downgrading this handle.
    try {
      await load(gpuOk);
      embedBackend = gpuOk ? "webgpu" : caps.wasmSimd || caps.wasm ? "wasm" : "unavailable";
    } catch (gpuErr) {
      if (!gpuOk) throw gpuErr;
      const fresh = await replaceRuntime(runtime, profile.n_threads > 1 ? 6 : 3);
      embedInstance = fresh;
      runtime = fresh;
      await load(false);
      embedBackend = "wasm";
    }
    embedModel = spec.id;
    return { ok: true, backend: embedBackend };
  } catch (err) {
    await exitEmbedInstance();
    return {
      ok: false,
      error: err instanceof Error ? err.message : "the encoder failed to start",
    };
  }
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
    if ((await cache.keys()).some((r) => r.url.toLowerCase().includes(needle))) return true;
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

/**
 * Whether this repo's weights are in the cache. null = unreadable. The match
 * is by repo needle (substring), which is deliberately looser than wllama's
 * exact-URL assembly: a stale entry from an old quant passes here while
 * wllama rejects it, which is why loadModelInternal self-heals that split.
 */
async function cacheContains(spec: ModelSpec, entries?: unknown[] | null): Promise<boolean | null> {
  const list = entries === undefined ? await listCacheEntries() : entries;
  if (list === null) return null;
  return list.some((e) => entryMatches(e, specNeedle(spec)));
}

/** Remove every cache entry that mentions this model's repo, returning the
 * purged entry names (for the honest error message). The stale-entry
 * self-heal: an entry whose stored address no longer matches the spec's
 * current URL used to strand the model row between "on device" and
 * "Model file not found" with no Download button to escape. */
async function purgeStaleEntries(spec: ModelSpec): Promise<string[]> {
  try {
    const cache = await getSharedCache();
    const entries = (await cache.list()) ?? [];
    const needle = specNeedle(spec);
    const doomed = entries.filter((e) => entryMatches(e, needle));
    if (doomed.length === 0) return [];
    await cache.deleteMany((e) => entryMatches(e, needle));
    return doomed.map((e) => (e as { name?: string }).name ?? "unnamed entry");
  } catch {
    return [];
  }
}

/** Orphaned-cache-entry recovery. An orphan is a cached GGUF whose metadata
 * sidecar is missing or unparseable, so wllama's list sees it with an empty
 * stored URL: the "already downloaded" short-circuit then never rewrites the
 * sidecar and the exact-URL assembly throws "Model file not found" forever,
 * even though the weights sit complete on disk. Locate the artifact by its
 * expected filename, prove identity against the upstream content-length, and
 * reconstruct the sidecar; an artifact we cannot prove stays on disk. */
async function recoverOrphanedEntry(
  url: string,
  spec: ModelSpec,
): Promise<{ action: "repaired" | "purged" | "preserve" | "absent"; name?: string }> {
  const filename = url.split("/").pop();
  if (!filename) return { action: "absent" };
  // Identity gate: the artifact must be the file this exact URL names, and
  // the spec must agree (guards against healing a same-stem sibling like the
  // 350M onto the Thinking model's orphan).
  if (expectedGgufFilename(spec.repo, spec.quant) !== filename.toLowerCase()) {
    return { action: "absent" };
  }
  const entries = (await listCacheEntries()) ?? [];
  const orphan = entries.find((e) => {
    const rec = e as { name?: string; metadata?: { originalURL?: string } };
    return (
      !!rec.name &&
      rec.name.toLowerCase().endsWith(`_${filename.toLowerCase()}`) &&
      !rec.metadata?.originalURL
    );
  }) as { name: string; size: number } | undefined;
  if (!orphan) return { action: "absent" };

  let upstreamLength: number | null = null;
  try {
    const head = await fetch(url, { method: "HEAD" });
    upstreamLength = Number(head.headers.get("content-length") ?? "0") || null;
  } catch {
    /* offline: decision falls to "preserve" below */
  }
  const decision = orphanRecoveryDecision(orphan.size, upstreamLength);
  if (decision === "repair") {
    try {
      const cache = await getSharedCache();
      // writeMetadata is public on the pinned 3.5.1 CacheManager but absent
      // from its d.ts; this bridge is the whole reason for the cast.
      await (
        cache as unknown as { writeMetadata: (name: string, metadata: unknown) => Promise<void> }
      ).writeMetadata(orphan.name, {
        originalURL: url,
        originalSize: orphan.size,
        etag: "",
      });
      return { action: "repaired", name: orphan.name };
    } catch {
      return { action: "preserve", name: orphan.name };
    }
  }
  if (decision === "purge") {
    try {
      const cache = await getSharedCache();
      await cache.delete(orphan.name);
      return { action: "purged", name: orphan.name };
    } catch {
      return { action: "preserve", name: orphan.name };
    }
  }
  return { action: "preserve", name: orphan.name };
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
      // ONNX/transformers-runtime encoders live in the Cache API; match each
      // by its repo, so encoder fallback swaps never need a worker change.
      const onnx = MODELS.filter((m) => m.runtime === "transformers");
      const keys = await caches.keys();
      for (const key of keys) {
        if (!/transformers/i.test(key)) continue;
        const cache = await caches.open(key);
        const reqs = await cache.keys();
        for (const m of onnx) {
          if (reqs.some((r) => r.url.toLowerCase().includes(m.repo.toLowerCase()))) out.add(m.id);
        }
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
  opts: {
    forcedBackend?: "webgpu" | "wasm";
    forcedFlashAttn?: boolean | null;
    forcedCache?: boolean | null;
    /** dev-only reasoning-budget override for the per-model benchmark sweep */
    forcedBudget?: number;
    /** dev-only RoPE base override for the position-encoding A/B */
    forcedRopeBase?: number;
    /** dev-only KV dtype override for the cache-quantization A/B */
    forcedKvType?: "q8_0" | "f16";
    reasoning?: boolean;
    /** set by the stale-entry self-heal retry so it never recurses twice */
    healRetry?: boolean;
  } = {},
): Promise<
  | { ok: true; backend: string; ctx: number; threadsRequested: number; threadsEffective: number; gpuLayers: number;
      batch: number; cacheK: string; cacheV: string; flashAttn: boolean; cacheReuse: number }
  | { ok: false; error: string }
> {
  const forcedBackend = opts.forcedBackend;
  const reasoningOverride = opts.reasoning;
  // Dev-only A/B pin (?forceCache= on the page): reuse stays on unless pinned.
  cachePrompt = opts.forcedCache ?? true;
  const spec = modelSpec(modelId) ?? modelSpec(DEFAULT_MODEL_ID)!;
  if (spec.runtime !== "gguf" || !spec.generative) {
    return {
      ok: false,
      error: `${spec.label} is not a generative GGUF model.`,
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
  // Capacity = feasibility, computed from the real KV geometry against the
  // conservative envelope (q8_0 is the smaller KV; if even q8 does not fit,
  // f16 certainly does not). Same audit factors as the main-thread
  // budgetGuard: WebGPU weight residency and the co-resident encoder. This
  // decides the escape hatch only.
  const fullGpuFits =
    budgetOutcome(spec, nCtx, caps.memoryClassGb, "q8_0", {
      weightsFactor: webgpuWeightsFactor(caps),
      coResidentGb: spec.encoderFallback ? 0.1 : 0.25,
    }).verdict !== "UNSAFE";
  const profile = (() => {
    const base = buildInferenceProfile(caps, spec.weightsGb, spec.nLayers, nCtx, {
      fullGpuFits,
    });
    // dev-only prefill A/B pin (?forceFa=0|1)
    if (opts.forcedFlashAttn == null && opts.forcedKvType == null) return base;
    return {
      ...base,
      ...(opts.forcedFlashAttn != null ? { flash_attn: opts.forcedFlashAttn } : {}),
      // Quantized KV rides flash attention; forcing f16 with FA off is the
      // honest fallback the A/B may ask for.
      ...(opts.forcedKvType != null
        ? { cache_type_k: opts.forcedKvType, cache_type_v: opts.forcedKvType }
        : {}),
    };
  })();

  // Backend candidates, equals: webgpu-full preferred when viable, wasm-simd
  // always available. `forcedBackend` (dev-only, ?forceBackend= on the page)
  // pins one for the native-vs-browser comparison; a pinned webgpu load that
  // fails does NOT silently fall back — a comparison run must be honest.
  // No partial offload on the normal path (capacity escape hatch only,
  // decided inside buildInferenceProfile).
  const forced = forcedBackend;
  const gpuOk =
    forced === "wasm" ? false : caps.webgpu && !caps.webgpuBroken && profile.n_gpu_layers > 0;

  // A fresh inference handle per load: wllama's exit() does not always fully
  // unwind the Emscripten module, so re-loading repeatedly on one handle
  // accumulated orphaned state and aborted. The cache is preserved because it
  // is the shared manager, not this handle.
  await exitInstance();
  let runtime = await createRuntime(profile.n_threads > 1 ? 6 : 3);
  instance = runtime;

  try {
    const ctx = self as unknown as DedicatedWorkerGlobalScope;
    ctx.postMessage({ type: "loading", modelId: spec.id, reqId } satisfies AiWorkerResponse);

    let usedGpuLayers = profile.n_gpu_layers;
    const load = async (useGpu: boolean) => {
      const p = { ...profile };
      if (!useGpu) {
        p.n_gpu_layers = 0;
        p.offload_kqv = false;
        p.no_kv_offload = false;
      }
      usedGpuLayers = p.n_gpu_layers;
      await runtime.loadModelFromHF(
        {
          repo: spec.repo,
          quant: spec.quant,
          ...(spec.mmprojQuant ? { mmprojQuant: spec.mmprojQuant } : {}),
        },
        {
          n_ctx: nCtx,
          useCache: true,
          // Reasoning models get the template's own thinking path with an
          // explicit budget (registry value; 2048 floor until the per-model
          // benchmark sweep says otherwise), instead of an English sentence
          // bolted onto the system prompt downstream. ?forceBudget= overrides
          // the spec for the A/B without registry edits.
          reasoning: reasoningOverride ?? spec.reasoning,
          ...(reasoningOverride ?? spec.reasoning
            ? { reasoning_budget_tokens: opts.forcedBudget ?? spec.reasoningBudget ?? 2048 }
            : {}),
          n_gpu_layers: p.n_gpu_layers,
          n_threads: p.n_threads,
          n_batch: p.n_batch,
          cache_type_k: p.cache_type_k as never,
          cache_type_v: p.cache_type_v as never,
          flash_attn: p.flash_attn,
          // dev-only position-encoding A/B pin (?ropeBase=N): overrides the
          // GGUF's own rope base at load. The Qwen distill keeps its own
          // scheme (its rope config is part of its distillation; user rule:
          // never pinned).
          ...(opts.forcedRopeBase != null && spec.id !== "qwen38-2b-distill"
            ? { rope_freq_base: opts.forcedRopeBase }
            : {}),
          // llama-server's chunk retention for non-prefix cache reuse. The
          // KV-shift machinery it drives is only sound with flash attention,
          // which small ctx buckets load without, so it rides FA only.
          ...(p.flash_attn ? { n_cache_reuse: 256 } : {}),
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
      if (!gpuOk || forced === "webgpu") throw gpuErr;
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

    // What actually engaged, for the perf trace: wllama disables pthreads
    // without SharedArrayBuffer, so effective threads are 1 in any
    // non-isolated context (the IAB) no matter what was requested.
    return {
      ok: true,
      backend: activeBackend,
      ctx: nCtx,
      threadsRequested: profile.n_threads,
      threadsEffective: caps.crossOriginIsolated ? profile.n_threads : 1,
      gpuLayers: usedGpuLayers,
      batch: profile.n_batch,
      cacheK: profile.cache_type_k,
      cacheV: profile.cache_type_v,
      flashAttn: profile.flash_attn,
      cacheReuse: profile.flash_attn ? 256 : 0,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "the assistant failed to start";
    // Clear the resident-model state so the UI reads "not loaded". The cache
    // is the shared manager, so it survives this handle being dropped.
    await exitInstance();
    currentModel = null;
    activeBackend = "unavailable";

    // Cache recovery ladder for "Model file not found". wllama's exact-URL
    // cache assembly missed. First try orphaned-cache-entry recovery: the
    // weights may be complete on disk with only their metadata sidecar gone
    // (repair beats a 1.59GB re-download). Only entries whose staleness is
    // provable get purged; an unverifiable artifact is preserved and the
    // error says so. The healRetry flag keeps the ladder from looping.
    if (/^Model file not found:/.test(message) && !opts.healRetry) {
      const url = message.match(/^Model file not found: (\S+)/)?.[1];
      if (url) {
        const recovery = await recoverOrphanedEntry(url, spec);
        if (recovery.action === "repaired") {
          return loadModelInternal(modelId, allowDownload, requestCtx, reqId, {
            ...opts,
            healRetry: true,
          });
        }
        if (recovery.action !== "absent") {
          return {
            ok: false,
            error:
              recovery.action === "purged"
                ? `${spec.label}: a corrupted cached copy was removed; press Download to fetch it again`
                : `${spec.label}: cached weights are present but could not be verified (upstream unreachable); try again online, or Delete and re-download`,
          };
        }
      }
      const purged = await purgeStaleEntries(spec);
      if (purged.length > 0) {
        if (allowDownload) {
          return loadModelInternal(modelId, true, requestCtx, reqId, { ...opts, healRetry: true });
        }
        return {
          ok: false,
          error:
            `${spec.label}: stale cached files were removed (their address no longer matches ` +
            `the current model file); press Download to fetch it again`,
        };
      }
    }
    return { ok: false, error: message };
  }
}

async function chatMessages(
  turns: { role: string; content: string }[],
  options: ChatOptions = {},
): Promise<{ text: string; metrics: GenerationMetrics }> {
  // The handle outlives the model, so "a model is loaded" means currentModel
  // is set, not that the handle exists.
  if (!instance || !currentModel) throw new Error("assistant not loaded");
  const spec = currentModel ? MODEL_BY_ID[currentModel] : undefined;
  if (spec && !spec.generative) {
    throw new Error(`${spec.label} makes embeddings, not prose.`);
  }
  generating = true;
  try {
    return await runChatMessages(turns, options, spec);
  } finally {
    generating = false;
  }
}

/** True while a real completion is decoding; the idle prewarm yields to it. */
let generating = false;

async function runChatMessages(
  turns: { role: string; content: string }[],
  options: ChatOptions,
  spec: ModelSpec | undefined,
): Promise<{ text: string; metrics: GenerationMetrics }> {

  const systemText = turns
    .filter((t) => t.role === "system")
    .map((t) => t.content)
    .join("\n\n");
  // Reasoning models manage thinking through their chat template (enabled at
  // load); appending our own instruction on top made them spend the answer
  // inside think tags and fight the template. Only plain models get the
  // explicit sentence.
  const sys =
    options.thinking && spec?.reasoning !== true
      ? `${systemText}\n\nThink step by step inside <think></think> tags, then give the answer after the closing tag.`
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
  const startedAt = performance.now();
  let firstTokenAt: number | null = null;
  let lastTokenAt = 0;
  /** OAI streams may carry usage on the final chunk; captured when present so
   *  promptTokens is a real tokenizer count whenever the backend provides it. */
  let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;
  const nativeCalls: { name: string; arguments: string }[] = [];

  const sampling = spec?.sampling;

  // Native tool protocol: when the turn ran tools on the model's behalf, the
  // dialogue closes with its calls and their role:"tool" responses (rendered
  // by the LFM template as <|tool_call_start|> ... <|im_start|>tool turns).
  const composed =
    options.toolTurns?.length
      ? withNativeToolTurns(messages as { role: string; content: unknown }[], options.toolTurns)
      : (messages as { role: string; content: unknown }[]);

  // runChatMessages runs only under chatMessages' ready guard; the local
  // binding keeps that fact visible to the type checker across the await.
  const runtime = instance;
  if (!runtime) throw new Error("assistant not loaded");
  await runtime.createChatCompletion({
    messages: composed as never,
    stream: true,
    cache_prompt: cachePrompt,
    max_tokens: options.maxTokens ?? 8192,
    temperature: options.temperature ?? sampling?.temperature ?? 0.4,
    top_p: sampling?.topP ?? 0.9,
    // Native tool menu: the LFM template renders this as
    // `List of tools: [...]` appended to the system prompt.
    ...(options.tools?.length ? { tools: options.tools } : {}),
    ...(sampling
      ? {
          min_p: sampling.minP,
          penalty_repeat: sampling.repeatPenalty,
          penalty_last_n: sampling.penaltyLastN,
          ...(sampling.topK ? { top_k: sampling.topK } : {}),
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
      const u = (chunk as { usage?: { prompt_tokens?: number; completion_tokens?: number } })
        .usage;
      if (u && (u.prompt_tokens != null || u.completion_tokens != null)) usage = u;
      // When tools are passed, llama.cpp intercepts the model's native tool
      // call out of the content stream and delivers it as tool_calls
      // fragments; content stays empty. Accumulate the fragments so the call
      // can be recovered below.
      for (const c of chunk.choices?.[0]?.delta?.tool_calls ?? []) {
        const slot = (nativeCalls[c.index] ??= { name: "", arguments: "" });
        if (c.function?.name) slot.name += c.function.name;
        if (c.function?.arguments) slot.arguments += c.function.arguments;
      }
      const piece = readDelta(chunk);
      if (!piece) return;
      out += piece;
      tokens += 1;
      if (firstTokenAt == null) firstTokenAt = performance.now();
      lastTokenAt = performance.now();
      const ctx = self as unknown as DedicatedWorkerGlobalScope;
      // Steady-state decode rate only: tokens after the first, divided by
      // the span between the first and the latest token. Prefill time lives
      // in ttftMs, never in this number.
      const decodeSecs = firstTokenAt != null ? (lastTokenAt - firstTokenAt) / 1000 : 0;
      const tps =
        tokens > 1 && decodeSecs > 0 ? Math.round(((tokens - 1) / decodeSecs) * 10) / 10 : null;
      ctx.postMessage({
        type: "token",
        text: piece,
        ...(tps != null ? { speed: { tps, tokens } } : {}),
      } satisfies AiWorkerResponse);
      if (abortRun) abortController.abort();
    },
  });

  // A tool call intercepted by the stream is re-rendered into the model's
  // own dialect so every consumer, decide parsers included, reads one
  // uniform surface.
  if (!out && nativeCalls.length) {
    const rendered = renderInterceptedCalls(nativeCalls);
    if (rendered) out = rendered;
  }

  const totalMs = Math.round(performance.now() - startedAt);
  const decodeSecs = firstTokenAt != null ? (lastTokenAt - firstTokenAt) / 1000 : 0;
  const promptChars = turns.reduce((n, t) => n + t.content.length, 0);
  // Real tokenizer count when the backend reports usage; chars/4 estimate
  // otherwise (flagged so readers know it is an estimate).
  type Usage = { prompt_tokens?: number; completion_tokens?: number };
  const u = usage as Usage | null;
  const promptTokens = u?.prompt_tokens ?? (promptChars > 0 ? Math.ceil(promptChars / 4) : null);
  const metrics: GenerationMetrics = {
    promptTokens,
    promptTokensEstimated: u?.prompt_tokens == null,
    outputTokens: u?.completion_tokens ?? tokens,
    ttftMs: firstTokenAt != null ? Math.round(firstTokenAt - startedAt) : null,
    decodeTps:
      tokens > 1 && decodeSecs > 0 ? Math.round(((tokens - 1) / decodeSecs) * 10) / 10 : null,
    totalMs,
    reasoningTokens: null,
  };
  return { text: out.trim(), metrics };
}

/** An Emscripten "(ABORT)" leaves the handle alive-but-dead: currentModel
 *  stays set, so every later call fails in milliseconds while the UI still
 *  says Ready. Drop the handle so the next ask builds a fresh one (weights
 *  stay cached; the reload is seconds). */
async function healAbortedInstance(err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (!/abort/i.test(message)) return;
  await exitInstance();
  currentModel = null;
  activeBackend = "unavailable";
}

// ── message handler ──────────────────────────────────────────────────

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener(
  "message",
  async (event: MessageEvent<AiWorkerRequest & { reqId?: number }>) => {
    const msg = event.data;
    if (!msg?.type) return;
    const reqId = msg.reqId;

    switch (msg.type) {
      case "load": {
        if (loadInFlight || embedLoadInFlight) {
          // Never start a second load while one is in progress: two loads would
          // fight over the wllama runtime and desync the cache.
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
          result = await loadModelInternal(msg.modelId, msg.allowDownload, msg.nCtx, reqId, {
            forcedBackend: msg.forcedBackend,
            forcedFlashAttn: msg.forcedFlashAttn ?? null,
            forcedCache: msg.forcedCache ?? null,
            forcedBudget: msg.forcedBudget,
            forcedRopeBase: msg.forcedRopeBase,
            forcedKvType: msg.forcedKvType,
            reasoning: msg.reasoning,
          });
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
            threadsRequested: result.threadsRequested,
            threadsEffective: result.threadsEffective,
            gpuLayers: result.gpuLayers,
            batch: result.batch,
            cacheK: result.cacheK,
            cacheV: result.cacheV,
            flashAttn: result.flashAttn,
            cacheReuse: result.cacheReuse,
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
          const { text, metrics } = await chatMessages(msg.turns, msg.options);
          ctx.postMessage({ type: "done", text, metrics } satisfies AiWorkerResponse);
        } catch (err) {
          await healAbortedInstance(err);
          ctx.postMessage({
            type: "error",
            message: err instanceof Error ? err.message : "chat failed",
          } satisfies AiWorkerResponse);
        }
        return;
      }

      case "chat": {
        try {
          const { text, metrics } = await chatMessages(
            [
              { role: "system", content: msg.system },
              { role: "user", content: msg.user },
            ],
            msg.options,
          );
          ctx.postMessage({ type: "done", text, metrics } satisfies AiWorkerResponse);
        } catch (err) {
          await healAbortedInstance(err);
          ctx.postMessage({
            type: "error",
            message: err instanceof Error ? err.message : "chat failed",
          } satisfies AiWorkerResponse);
        }
        return;
      }

      case "warm": {
        // Skip silently while a real generation runs; a load exiting the
        // instance mid-warm rejects and is swallowed below. One token, no
        // streaming; the slot gains the prefix and a quiet ack settles the
        // caller's promise.
        if (generating || !instance || !currentModel) {
          ctx.postMessage({ type: "warm-done", reqId } satisfies AiWorkerResponse);
          return;
        }
        try {
          const spec = MODEL_BY_ID[currentModel];
          const sampling = spec?.sampling;
          await instance.createChatCompletion({
            messages: [{ role: "system", content: msg.system }] as never,
            stream: false,
            cache_prompt: cachePrompt,
            max_tokens: 1,
            ...(sampling
              ? {
                  temperature: sampling.temperature,
                  top_p: sampling.topP ?? 0.9,
                  min_p: sampling.minP,
                  penalty_repeat: sampling.repeatPenalty,
                  penalty_last_n: sampling.penaltyLastN,
                  ...(sampling.topK ? { top_k: sampling.topK } : {}),
                }
              : {}),
          } as never);
        } catch {
          /* warm is best-effort by design */
        }
        ctx.postMessage({ type: "warm-done", reqId } satisfies AiWorkerResponse);
        return;
      }

      case "stop": {
        abortRun = true;
        return;
      }

      case "embed-load": {
        if (embedLoadInFlight) {
          ctx.postMessage({
            type: "error",
            reqId,
            modelId: msg.modelId,
            message: "the encoder is already loading, try again in a moment",
          } satisfies AiWorkerResponse);
          return;
        }
        embedLoadInFlight = true;
        let result;
        try {
          // Two wllama handles initializing at once (WebGPU device + OPFS
          // cache) conflict and can leave the embed handle half-alive, which
          // later surfaces as embed RPCs that never answer. The encoder load
          // waits out any generative load instead of racing it.
          const deadline = Date.now() + 60_000;
          while (loadInFlight && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 250));
          }
          result = await loadEmbedModelInternal(msg.modelId, msg.allowDownload, reqId);
        } finally {
          embedLoadInFlight = false;
        }
        if (result.ok) {
          ctx.postMessage({
            type: "embed-ready",
            reqId,
            modelId: msg.modelId,
            backend: result.backend,
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

      case "embed": {
        try {
          if (!embedInstance || !embedModel) throw new Error("encoder not loaded");
          // A wedged handle must answer with an error, not silence: race the
          // call so the main thread's 30s ceiling is rarely the one firing.
          const res = await Promise.race([
            embedInstance.createEmbedding({
              input: msg.texts,
              encoding_format: "float",
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("embedding timed out")), 25_000),
            ),
          ]);
          const vectors = res.data.map((d) => d.embedding as number[]);
          ctx.postMessage({ type: "embedded", reqId, vectors } satisfies AiWorkerResponse);
        } catch (err) {
          // Drop the failed handle so the next activation builds a fresh one
          // from cache instead of reusing a half-alive instance.
          await exitEmbedInstance();
          ctx.postMessage({
            type: "error",
            reqId,
            message: err instanceof Error ? err.message : "embedding failed",
          } satisfies AiWorkerResponse);
        }
        return;
      }

      case "embed-unload": {
        await exitEmbedInstance();
        ctx.postMessage({ type: "embed-unloaded", reqId } satisfies AiWorkerResponse);
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
          // An encoder GGUF lives on the warm embed handle instead.
          if (embedModel === spec.id) await exitEmbedInstance();

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
          ctx.postMessage({
            type: "deleted",
            reqId,
            modelId: msg.modelId,
          } satisfies AiWorkerResponse);
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
  },
);
