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
  const coarse =
    typeof matchMedia === "function" ? matchMedia("(pointer: coarse)").matches : false;
  const touch = (navigator.maxTouchPoints ?? 0) > 1;
  const fewCores = (navigator.hardwareConcurrency ?? 8) <= 4;
  return coarse || (touch && fewCores);
}

/** Real WebGPU check: an adapter AND a device must come back. */
async function probeWebGpu(): Promise<{ ok: boolean; broken: boolean; adapter: string | null }> {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) {
    return { ok: false, broken: false, adapter: null };
  }
  try {
    const gpu = (navigator as unknown as {
      gpu: { requestAdapter: () => Promise<null | { info?: { vendor?: string; architecture?: string }; requestDevice: () => Promise<unknown> }> };
    }).gpu;
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { ok: false, broken: true, adapter: null };
    const device = await adapter.requestDevice();
    if (!device) return { ok: false, broken: true, adapter: null };
    const info = adapter.info;
    const name = [info?.vendor, info?.architecture].filter(Boolean).join(" ") || "adapter";
    return { ok: true, broken: false, adapter: name };
  } catch {
    return { ok: false, broken: true, adapter: null };
  }
}

/** Threads need both the wasm feature and a cross-origin isolated page. */
function threadsAvailable(caps: Map<string, boolean>): boolean {
  const isolated =
    typeof globalThis !== "undefined" &&
    Boolean((globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated);
  return isolated && Boolean(caps.get("sab"));
}

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

    const out: RuntimeCapabilities = {
      webgpu: gpu.ok,
      webgpuBroken: gpu.broken,
      wasm,
      wasmSimd: simd,
      wasmThreads: threadsAvailable(caps),
      crossOriginIsolated: isolated,
      mobile: isMobile(),
      deviceMemoryGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
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
    { label: "WASM SIMD", ok: r.wasmSimd, detail: "" },
    { label: "WASM threads", ok: r.wasmThreads, detail: r.wasmThreads ? "" : "needs isolation" },
    { label: "Isolation", ok: r.crossOriginIsolated, detail: "COOP/COEP" },
    { label: "Memory", ok: r.deviceMemoryGb != null, detail: r.deviceMemoryGb ? `${r.deviceMemoryGb} GB` : "not reported" },
    { label: "Cores", ok: (r.cores ?? 0) > 0, detail: r.cores ? String(r.cores) : "—" },
  ];
}
