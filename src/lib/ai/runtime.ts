// One place that answers "what can this device actually run?".
//
// Both the generative runtime (wllama / llama.cpp) and the encoder
// (Transformers.js) read their backend from here. Nothing else is allowed to
// sniff `navigator.gpu` on its own: WebGPU existing is not the same as WebGPU
// working, so we request an adapter and a device before believing it.

import { probeCapabilities, type Capability } from "@/lib/capabilities";

export type Backend = "webgpu" | "wasm" | "unavailable";

export type RuntimeCapabilities = {
  webgpu: boolean;
  /** WebGPU exists in the API surface but initialisation failed */
  webgpuBroken: boolean;
  wasm: boolean;
  wasmSimd: boolean;
  /** Relaxed SIMD adds hardware-specific fused instructions (dot-product etc.)
   *  used by wllama's inference kernels on the WASM CPU-fallback path. */
  relaxedSimd: boolean;
  wasmThreads: boolean;
  crossOriginIsolated: boolean;
  mobile: boolean;
  deviceMemoryGb: number | null;
  cores: number | null;
  adapter: string | null;
  backend: Backend;
  detail: string;
  // ── GPU profile fields ──────────────────────────────────────────
  memoryClassGb: number | null;
  gpuVendor: string | null;
  gpuTier: "discrete" | "integrated" | "mobile" | "unknown";
  optimalBatch: number;
  cacheTypeK: "q8_0" | "f16";
  cacheTypeV: "q8_0" | "f16";
  recommendFlashAttn: boolean;
};

const UNKNOWN: RuntimeCapabilities = {
  webgpu: false,
  webgpuBroken: false,
  wasm: false,
  wasmSimd: false,
  relaxedSimd: false,
  wasmThreads: false,
  crossOriginIsolated: false,
  mobile: false,
  deviceMemoryGb: null,
  cores: null,
  adapter: null,
  backend: "unavailable",
  detail: "not probed yet",
  memoryClassGb: null,
  gpuVendor: null,
  gpuTier: "unknown",
  optimalBatch: 128,
  cacheTypeK: "q8_0",
  cacheTypeV: "q8_0",
  recommendFlashAttn: false,
};

let cached: RuntimeCapabilities | null = null;
let inflight: Promise<RuntimeCapabilities> | null = null;

/** Server-safe snapshot. Always the same on both sides of hydration. */
export function runtimeSnapshot(): RuntimeCapabilities {
  return cached ?? UNKNOWN;
}

/**
 * The weight-residency factor the memory budget must apply for a WebGPU load:
 * under WebGPU the weights exist twice (wasm-heap ggml buffers plus GPU
 * device buffers, an upstream property). On a DISCRETE GPU the device copy
 * lives in VRAM, off the system-RAM envelope the budget guards, so the factor
 * is 1 there; on integrated/mobile GPUs both copies draw on the same RAM, so
 * it is 2. WASM keeps exactly one copy.
 */
export function webgpuWeightsFactor(caps: Pick<RuntimeCapabilities, "webgpu" | "webgpuBroken" | "gpuTier">): number {
  return caps.webgpu && !caps.webgpuBroken && caps.gpuTier !== "discrete" ? 2 : 1;
}

/** True mobile signal: coarse pointer or touch, not the user agent string. */
function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const coarse = typeof matchMedia === "function" ? matchMedia("(pointer: coarse)").matches : false;
  const touch = (navigator.maxTouchPoints ?? 0) > 1;
  const fewCores = (navigator.hardwareConcurrency ?? 8) <= 4;
  return coarse || (touch && fewCores);
}

/** Real WebGPU check: an adapter AND a device must come back. */
async function probeWebGpu(): Promise<{
  ok: boolean;
  broken: boolean;
  adapter: string | null;
  vram: number | null;
  vendor: string | null;
}> {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) {
    return { ok: false, broken: false, adapter: null, vram: null, vendor: null };
  }
  try {
    const gpu = (
      navigator as unknown as {
        gpu: {
          requestAdapter: () => Promise<{
            info?: {
              vendor?: string;
              architecture?: string;
              description?: string;
              device?: string;
            };
            limits?: { maxStorageBufferBindingSize?: number; maxBufferSize?: number };
            requestDevice: () => Promise<unknown>;
          } | null>;
        };
      }
    ).gpu;
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { ok: false, broken: true, adapter: null, vram: null, vendor: null };

    const device = await adapter.requestDevice();
    if (!device) return { ok: false, broken: true, adapter: null, vram: null, vendor: null };

    const info = adapter.info;
    const description = [info?.vendor, info?.architecture].filter(Boolean).join(" ");
    const vendor = info?.vendor ?? null;

    // Memory CAPACITY ENVELOPE (feasibility only, never performance): a
    // conservative ~80% working-set ceiling over the best capacity signal.
    // deviceMemory is a coarse, privacy-clamped CLASS (Chrome caps it at 8,
    // so a 16 GB machine reports 8 → 6.4 GB envelope); it is NOT free RAM and
    // NOT VRAM. Where it is absent (Safari), the adapter's storage-binding
    // bound is the fallback signal. This envelope gates loads (can this
    // configuration sit on this device at all); it never picks batch, cache
    // types, threads, or backend speed assumptions.
    const nav = navigator as Navigator & { deviceMemory?: number };
    const deviceMemoryGb = typeof nav.deviceMemory === "number" ? nav.deviceMemory : null;
    const limits = adapter.limits;
    let memoryClassGb: number | null = null;

    if (deviceMemoryGb != null) {
      memoryClassGb = Math.max(1, deviceMemoryGb * 0.8);
    } else if (limits?.maxStorageBufferBindingSize) {
      const maxBufGb = limits.maxStorageBufferBindingSize / 1073741824;
      if (maxBufGb >= 2) memoryClassGb = maxBufGb * 0.8;
    }

    return { ok: true, broken: false, adapter: description || "adapter", vram: memoryClassGb, vendor };
  } catch {
    return { ok: false, broken: true, adapter: null, vram: null, vendor: null };
  }
}

/** Threads need both the wasm feature and a cross-origin isolated page. */
function threadsAvailable(caps: Map<string, boolean>): boolean {
  const isolated =
    typeof globalThis !== "undefined" &&
    Boolean((globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated);
  return isolated && Boolean(caps.get("sab"));
}

// ── Inference profile computation ─────────────────────────────────────

/**
 * Mobile-safe thread policy (AI_RUNTIME_V2 P0.2). Desktop keeps cores-1
 * capped at 12. Mobile over-subscribes far less: Safari's cross-origin
 * isolation failure already forces 1 thread, and when threads DO run,
 * giving a phone more than a couple of workers starves the compositor and
 * the UI thread, which reads as "clunky" even when tok/s looks fine.
 * Unknown cores assume 4. After calibration, measured winners override
 * this cold-start fallback.
 */
export function threadPolicy(cores: number | null, mobile: boolean): number {
  const c = cores ?? 4;
  if (mobile) {
    if (c <= 4) return 2;
    if (c <= 8) return c <= 6 ? 3 : 4;
    return Math.min(6, Math.floor(c / 2));
  }
  return Math.max(1, Math.min(c - 1, 12));
}

export type GpuTier = "discrete" | "integrated" | "mobile" | "unknown";

/** Guess GPU tier from vendor + memory. */
function gpuTier(vendor: string | null, memoryClassGb: number | null, mobile: boolean): GpuTier {
  if (mobile) {
    // Mobile GPUs (Qualcomm, Mali, Apple A-series) share memory with the CPU
    return "mobile";
  }
  const v = vendor?.toLowerCase() ?? "";
  if (v.includes("apple")) {
    // Apple Silicon with unified memory — acts like discrete for large memory
    return (memoryClassGb ?? 0) >= 8 ? "discrete" : "integrated";
  }
  if (v.includes("nvidia") || v.includes("amd") || v.includes("intel")) {
    // Intel Arc discrete, NVIDIA, AMD — discrete assuming >4 GB
    return (memoryClassGb ?? 0) >= 4 ? "discrete" : "integrated";
  }
  if (memoryClassGb !== null && memoryClassGb >= 4) return "discrete";
  if (memoryClassGb !== null && memoryClassGb >= 2) return "integrated";
  return "unknown";
}

/**
 * Optimal n_batch: GPU benefits from larger batches (512), CPU from smaller (128).
 * Mobile GPU should use 256 — faster than 128 but avoids OOM at 512.
 */
function optimalBatch(tier: GpuTier, memoryClassGb: number | null): number {
  if (tier === "discrete") return 512;
  if (tier === "integrated") return 256;
  if (tier === "mobile") return 128;
  return 128;
}

/**
 * KV cache quantization: f16 halves memory vs f32 with no quality loss.
 * q8_0 cuts it by 75% at tiny quality cost — use when RAM is tight.
 */
function recommendedCacheType(tier: GpuTier, deviceMemoryGb: number | null): "q8_0" | "f16" {
  if (tier === "discrete" && (deviceMemoryGb ?? 0) >= 16) return "f16";
  if (tier === "integrated" && (deviceMemoryGb ?? 0) >= 8) return "f16";
  // Everything else: save memory with q8_0
  return "q8_0";
}

/** Flash attention saves ~70% KV memory for long contexts. */
function recommendFlashAttn(nCtx: number): boolean {
  return nCtx > 4096;
}

/**
 * Capacity escape hatch ONLY: how many layers a partial GPU placement could
 * carry within the memory envelope. This is not on the normal performance
 * path — the normal path is webgpu-full or wasm-simd. Partial placement is
 * considered exclusively when the FULL GPU working set would not fit the
 * device envelope (decided by the caller via fullGpuFits=false).
 */
export function computeGpuLayers(
  memoryClassGb: number | null,
  modelWeightsGb: number,
  modelLayers: number,
  gpuOk: boolean,
  gpuBroken: boolean,
): number {
  if (!gpuOk || gpuBroken) return 0;
  if (memoryClassGb === null) {
    // No envelope signal — conservative: offload everything (assume desktop)
    return modelLayers;
  }

  // Per-layer size in GB (weights include embedding + lm_head which are 2 "virtual layers")
  const effectiveLayers = modelLayers + 2;
  const perLayerGb = modelWeightsGb / effectiveLayers;
  // Keep 1GB headroom for KV cache + runtime overhead
  const availableVram = Math.max(0, memoryClassGb - 1.0);
  const candidate = Math.floor(availableVram / perLayerGb);

  // If candidate < 4 layers, WebGPU overhead isn't worth it — stick to CPU
  if (candidate < 4) return 0;

  // Clamp to model layer count
  return Math.min(candidate, modelLayers);
}

// ── Exported buildInferenceProfile ────────────────────────────────────

export type InferenceProfile = {
  n_gpu_layers: number;
  n_threads: number;
  n_batch: number;
  cache_type_k: string;
  cache_type_v: string;
  flash_attn: boolean;
  offload_kqv: boolean;
  warmup: boolean;
  no_kv_offload: boolean;
};

// ── Measured prefill rate and the deadlines scaled from it ────────────
//
// The IAB's single-thread wasm prefills ~10x slower than threaded real
// Chrome (notes/11: ~7.2 ms/token vs well under 1), so static deadlines
// either false-fire "chat timed out" on slow devices or waste minutes on
// fast ones. These helpers turn the rolling ttft/prompt-token observations
// into deadlines. Heuristic only: a sizing hint for watchdogs, never a
// backend or quality decision source.

/**
 * Robust full-prefill rate from recent per-turn observations (ttftMs /
 * promptTokens). KV slot reuse makes cache-hit turns report a small ttft
 * over a large prompt, which drags low samples into every window; the 9th
 * decile (nearest-rank) tracks the FULL-prefill turns the deadlines must
 * actually survive. Null until at least one sample exists.
 */
export function prefillRateMsPerToken(samples: number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.floor(0.9 * (sorted.length - 1));
  const rate = sorted[idx];
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

/** Pre-first-token idle ceiling: 3 x the measured rate x the prompt
 * estimate, floored at the static 75s ceiling and capped at 240s. */
export function prefirstTokenIdleMs(rate: number | null, promptTokensEstimate: number): number {
  const FLOOR_MS = 75_000;
  const CAP_MS = 240_000;
  if (rate == null) return FLOOR_MS;
  return Math.min(CAP_MS, Math.max(FLOOR_MS, 3 * rate * promptTokensEstimate));
}

/** Hop deadline: the same 3 x rate x estimate with the static 60s
 * LIMITS.hopDeadlineMs as floor and a 180s cap. */
export function scaledHopDeadlineMs(rate: number | null, promptTokensEstimate: number): number {
  const FLOOR_MS = 60_000;
  const CAP_MS = 180_000;
  if (rate == null) return FLOOR_MS;
  return Math.min(CAP_MS, Math.max(FLOOR_MS, 3 * rate * promptTokensEstimate));
}

/**
 * Build a per-device, per-model inference profile.
 * Called once at load time, after capabilities are detected.
 *
 * Backend candidates are equals: webgpu-full when WebGPU is viable and the
 * full working set fits the capacity envelope, wasm-simd otherwise. Partial
 * GPU placement appears ONLY through the capacity escape hatch
 * (fullGpuFits=false); it is never a performance choice, and "WebGPU
 * available" never implies "WebGPU fastest" — measured winners can later
 * override this cold-start policy.
 */
export function buildInferenceProfile(
  caps: RuntimeCapabilities,
  modelWeightsGb: number,
  modelLayers: number,
  nCtx: number,
  opts: { fullGpuFits?: boolean } = {},
): InferenceProfile {
  const gpuOk = caps.webgpu && !caps.webgpuBroken;
  const gpuLayers = gpuOk
    ? opts.fullGpuFits === false
      // Capacity escape hatch: the full GPU working set would not fit.
      ? computeGpuLayers(caps.memoryClassGb, modelWeightsGb, modelLayers, gpuOk, caps.webgpuBroken)
      : modelLayers
    : 0;

  // Threads: only valuable when cross-origin isolated (SharedArrayBuffer).
  // The curve is threadPolicy: desktop keeps cores-1 (cap 12), mobile gets
  // the conservative phone-safe curve instead of the desktop one that left
  // phones unresponsive.
  const n_threads = caps.crossOriginIsolated ? threadPolicy(caps.cores, caps.mobile) : 1;

  const n_batch = optimalBatch(caps.gpuTier, caps.memoryClassGb);
  const cacheK = recommendedCacheType(caps.gpuTier, caps.deviceMemoryGb);
  const cacheV = recommendedCacheType(caps.gpuTier, caps.deviceMemoryGb);
  const flash = recommendFlashAttn(nCtx);

  // Offload KQV to GPU only when most layers are on GPU
  const offload_kqv = gpuLayers >= modelLayers * 0.7;
  // no_kv_offload forces every KV op through CPU while layers sit on the GPU;
  // with our model sizes it only ever inverts performance. Off until a real
  // VRAM constraint is measured, not guessed.
  const no_kv_offload = false;

  return {
    n_gpu_layers: gpuLayers,
    n_threads,
    n_batch,
    cache_type_k: cacheK,
    cache_type_v: cacheV,
    flash_attn: flash,
    offload_kqv: offload_kqv && gpuLayers > 0,
    warmup: true,
    no_kv_offload,
  };
}

// ── Probe ─────────────────────────────────────────────────────────────

export async function detectRuntime(force = false): Promise<RuntimeCapabilities> {
  if (cached && !force) return cached;
  if (inflight && !force) return inflight;
  // Bails only when the real runtime globals are absent (SSR). A Web Worker
  // has no `window` but does have WebAssembly, navigator and navigator.gpu,
  // so we must not gate on window: inference runs inside the worker.
  if (typeof WebAssembly === "undefined" || typeof navigator === "undefined") return UNKNOWN;

  inflight = (async () => {
    const list: Capability[] = await probeCapabilities();
    const caps = new Map(list.map((c) => [c.key, c.ok]));
    const gpu = await probeWebGpu();
    const nav = navigator as Navigator & { deviceMemory?: number };
    const isolated =
      typeof globalThis !== "undefined" &&
      Boolean((globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated);

    const wasm = Boolean(caps.get("wasm"));
    const simd = Boolean(caps.get("simd"));
    const relaxedSimd = simd && Boolean(caps.get("relaxedSimd"));
    const backend: Backend = gpu.ok ? "webgpu" : wasm && simd ? "wasm" : "unavailable";

    const dmGb = typeof nav.deviceMemory === "number" ? nav.deviceMemory : null;
    const vram = gpu.vram;
    const vendor = gpu.vendor;
    const mobile = isMobile();
    const tier = gpuTier(vendor, vram, mobile);

    const out: RuntimeCapabilities = {
      webgpu: gpu.ok,
      webgpuBroken: gpu.broken,
      wasm,
      wasmSimd: simd,
      relaxedSimd,
      wasmThreads: threadsAvailable(caps),
      crossOriginIsolated: isolated,
      mobile,
      deviceMemoryGb: dmGb,
      cores: nav.hardwareConcurrency ?? null,
      adapter: gpu.adapter,
      backend,
      detail:
        backend === "webgpu"
          ? `WebGPU · ${gpu.adapter ?? "adapter"}`
          : backend === "wasm"
            ? gpu.broken
              ? "WASM SIMD · WebGPU present but failed to initialise"
              : "WASM SIMD"
            : "no local inference backend on this device",
      memoryClassGb: vram,
      gpuVendor: vendor,
      gpuTier: tier,
      optimalBatch: optimalBatch(tier, vram),
      cacheTypeK: recommendedCacheType(tier, dmGb),
      cacheTypeV: recommendedCacheType(tier, dmGb),
      recommendFlashAttn: false, // depends on context size, computed per call
    };
    cached = out;
    return out;
  })();
  return inflight;
}

/** Deterministic: WebGPU → WASM SIMD → unavailable. */
export async function selectBackend(): Promise<Backend> {
  return (await detectRuntime()).backend;
}

/** Transformers.js device string for the encoder — same source of truth. */
export async function encoderDevice(): Promise<"webgpu" | "wasm"> {
  return (await selectBackend()) === "webgpu" ? "webgpu" : "wasm";
}

/** Rows for the diagnostics block in the model panel. */
export function diagnosticsRows(r: RuntimeCapabilities) {
  return [
    { label: "WebGPU", ok: r.webgpu, detail: r.adapter ?? (r.webgpuBroken ? "init failed" : "") },
    { label: "GPU tier", ok: r.gpuTier !== "unknown", detail: r.gpuTier },
    { label: "Memory class", ok: r.memoryClassGb != null, detail: r.memoryClassGb ? `${r.memoryClassGb} GB` : "unknown" },
    { label: "WASM SIMD", ok: r.wasmSimd, detail: "" },
    {
      label: "Relaxed SIMD",
      ok: r.relaxedSimd,
      detail: r.wasmSimd && !r.relaxedSimd ? "not supported" : "",
    },
    { label: "WASM threads", ok: r.wasmThreads, detail: r.wasmThreads ? "" : "needs isolation" },
    { label: "Isolation", ok: r.crossOriginIsolated, detail: "COOP/COEP" },
    {
      label: "Memory",
      ok: r.deviceMemoryGb != null,
      detail: r.deviceMemoryGb ? `${r.deviceMemoryGb} GB` : "not reported",
    },
    { label: "Cores", ok: (r.cores ?? 0) > 0, detail: r.cores ? String(r.cores) : "—" },
    { label: "Opt. batch", ok: true, detail: String(r.optimalBatch) },
  ];
}
