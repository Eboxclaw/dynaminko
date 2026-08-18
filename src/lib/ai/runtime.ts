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
  wasmThreads: boolean;
  crossOriginIsolated: boolean;
  mobile: boolean;
  deviceMemoryGb: number | null;
  cores: number | null;
  adapter: string | null;
  backend: Backend;
  detail: string;
  // ── GPU profile fields ──────────────────────────────────────────
  vramGb: number | null;
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
  wasmThreads: false,
  crossOriginIsolated: false,
  mobile: false,
  deviceMemoryGb: null,
  cores: null,
  adapter: null,
  backend: "unavailable",
  detail: "not probed yet",
  vramGb: null,
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

    // Estimate VRAM from deviceMemory or adapter hints
    const nav = navigator as Navigator & { deviceMemory?: number };
    const deviceMemoryGb = typeof nav.deviceMemory === "number" ? nav.deviceMemory : null;
    const limits = adapter.limits;
    let vram: number | null = null;

    // Try to infer from maxStorageBufferBindingSize (a proxy for VRAM tier)
    if (limits?.maxStorageBufferBindingSize) {
      const maxBufGb = limits.maxStorageBufferBindingSize / 1073741824;
      if (maxBufGb >= 2) vram = maxBufGb;
    }

    // Fallback: use deviceMemory as a rough proxy (system RAM ~ VRAM on unified memory)
    if (vram === null && deviceMemoryGb !== null) {
      vram = deviceMemoryGb;
    }

    // Apple Silicon unified memory: deviceMemory is accurate
    const isApple = vendor?.toLowerCase().includes("apple");
    if (isApple && deviceMemoryGb !== null) {
      vram = deviceMemoryGb;
    }

    return { ok: true, broken: false, adapter: description || "adapter", vram, vendor };
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

export type GpuTier = "discrete" | "integrated" | "mobile" | "unknown";

/** Guess GPU tier from vendor + memory. */
function gpuTier(vendor: string | null, vramGb: number | null, mobile: boolean): GpuTier {
  if (mobile) {
    // Mobile GPUs (Qualcomm, Mali, Apple A-series) share memory with the CPU
    return "mobile";
  }
  const v = vendor?.toLowerCase() ?? "";
  if (v.includes("apple")) {
    // Apple Silicon with unified memory — acts like discrete for large memory
    return (vramGb ?? 0) >= 8 ? "discrete" : "integrated";
  }
  if (v.includes("nvidia") || v.includes("amd") || v.includes("intel")) {
    // Intel Arc discrete, NVIDIA, AMD — discrete assuming >4 GB
    return (vramGb ?? 0) >= 4 ? "discrete" : "integrated";
  }
  if (vramGb !== null && vramGb >= 4) return "discrete";
  if (vramGb !== null && vramGb >= 2) return "integrated";
  return "unknown";
}

/**
 * Optimal n_batch: GPU benefits from larger batches (512), CPU from smaller (128).
 * Mobile GPU should use 256 — faster than 128 but avoids OOM at 512.
 */
function optimalBatch(tier: GpuTier, vramGb: number | null): number {
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
 * Compute ideal n_gpu_layers based on VRAM vs model weight.
 * Returns the number of transformer layers to offload to GPU.
 */
export function computeGpuLayers(
  vramGb: number | null,
  modelWeightsGb: number,
  modelLayers: number,
  gpuOk: boolean,
  gpuBroken: boolean,
): number {
  if (!gpuOk || gpuBroken) return 0;
  if (vramGb === null) {
    // No VRAM info — conservative: offload everything (assume desktop)
    return modelLayers;
  }

  // Per-layer size in GB (weights include embedding + lm_head which are 2 "virtual layers")
  const effectiveLayers = modelLayers + 2;
  const perLayerGb = modelWeightsGb / effectiveLayers;
  // Keep 1GB headroom for KV cache + runtime overhead
  const availableVram = Math.max(0, vramGb - 1.0);
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

/**
 * Build a per-device, per-model inference profile.
 * Called once at load time, after capabilities are detected.
 */
export function buildInferenceProfile(
  caps: RuntimeCapabilities,
  modelWeightsGb: number,
  modelLayers: number,
  nCtx: number,
): InferenceProfile {
  const gpuOk = caps.webgpu && !caps.webgpuBroken;
  const gpuLayers = computeGpuLayers(
    caps.vramGb,
    modelWeightsGb,
    modelLayers,
    gpuOk,
    caps.webgpuBroken,
  );

  // Threads: only valuable when cross-origin isolated (SharedArrayBuffer).
  // cores - 1 leaves the UI a thread; floor of 1 for single-core devices.
  const n_threads = caps.crossOriginIsolated ? Math.max(1, Math.min((caps.cores ?? 4) - 1, 8)) : 1;

  const n_batch = optimalBatch(caps.gpuTier, caps.vramGb);
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
  if (typeof window === "undefined") return UNKNOWN;

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
      vramGb: vram,
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
    { label: "VRAM est.", ok: r.vramGb != null, detail: r.vramGb ? `${r.vramGb} GB` : "unknown" },
    { label: "WASM SIMD", ok: r.wasmSimd, detail: "" },
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
