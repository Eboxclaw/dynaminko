// Runtime capability probe. Reports which of the browser-first substrates
// Dynaminko cares about (WASM, SIMD, SharedArrayBuffer, Workers, WebGPU,
// WebGL2, OPFS/IndexedDB, service worker) are available right now.
// This is what the "PWA + WASM + WebGPU + llama.cpp ready" surface reads.

export type Capability = {
  key: string;
  label: string;
  ok: boolean;
  detail?: string;
};

// Minimal SIMD v128 validation module — enough to know the runtime accepts it.
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0,
  1, 5, 1, 96, 0, 1, 123,
  3, 2, 1, 0,
  10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
]);

export async function probeCapabilities(): Promise<Capability[]> {
  const wasm = typeof WebAssembly === "object";
  let simd = false;
  try { simd = wasm && WebAssembly.validate(SIMD_PROBE); } catch { /* no-op */ }

  const sab = typeof SharedArrayBuffer !== "undefined";
  const workers = typeof Worker !== "undefined";
  const idb = typeof indexedDB !== "undefined";
  const sw = typeof navigator !== "undefined" && "serviceWorker" in navigator;

  let webgpu = false;
  let webgpuDetail: string | undefined;
  if (typeof navigator !== "undefined" && "gpu" in navigator) {
    try {
      const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
      const adapter = gpu ? await gpu.requestAdapter() : null;
      webgpu = !!adapter;
      const info = (adapter as { info?: { vendor?: string } } | null)?.info;
      webgpuDetail = info?.vendor ?? (webgpu ? "adapter ok" : undefined);
    } catch {
      webgpu = false;
    }
  }

  let webgl2 = false;
  try {
    if (typeof document !== "undefined") {
      webgl2 = !!document.createElement("canvas").getContext("webgl2");
    }
  } catch { /* no-op */ }

  const crossOrigin =
    typeof globalThis !== "undefined" && "crossOriginIsolated" in globalThis
      ? Boolean((globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated)
      : false;

  return [
    { key: "wasm", label: "WebAssembly", ok: wasm },
    { key: "simd", label: "Wasm SIMD (v128)", ok: simd },
    { key: "sab", label: "SharedArrayBuffer", ok: sab, detail: crossOrigin ? "cross-origin isolated" : "COOP/COEP off" },
    { key: "workers", label: "Web Workers", ok: workers },
    { key: "webgpu", label: "WebGPU", ok: webgpu, detail: webgpuDetail },
    { key: "webgl2", label: "WebGL 2", ok: webgl2 },
    { key: "idb", label: "IndexedDB", ok: idb },
    { key: "sw", label: "Service Worker (PWA)", ok: sw },
  ];
}

/** Rough go/no-go for running a llama.cpp Wasm build in-tab. */
export function llamaReadiness(caps: Capability[]): "ready" | "degraded" | "no" {
  const map = new Map(caps.map((c) => [c.key, c.ok]));
  if (!map.get("wasm")) return "no";
  const gpu = map.get("webgpu");
  const simd = map.get("simd");
  const sab = map.get("sab");
  if (gpu && simd && sab) return "ready";
  if (simd) return "degraded";
  return "no";
}
