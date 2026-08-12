// On-device assistant. wllama runs llama.cpp in WebAssembly (SIMD + threads
// when the browser allows it) inside its own worker, so the UI thread never
// blocks. Nothing leaves the device; the model is cached after first download.

import type { Wllama } from "@wllama/wllama/esm/index.js";

export type ModelSpec = {
  id: string;
  label: string;
  repo: string;
  quant: string;
  /** null when the download size is not known ahead of time */
  sizeMb: number | null;
  blurb: string;
  role: string;
  /** shipped on by default */
  standard: boolean;
  /** heavy enough that phones should not attempt it */
  desktopOnly?: boolean;
  /** rough weights size in GB, used for the RAM recommendation */
  weightsGb: number;
  /** device memory we want to see before recommending it */
  minRamGb: number;
  /** accepts images */
  vision: boolean;
  /** worth asking for a reasoning / thinking pass */
  reasoning: boolean;
  /** can generate prose at all (the encoder cannot) */
  generative: boolean;
  /** largest context we allow for this model */
  maxCtx: number;
};

/** Strongest first — the recommendation walks down this list. */
export const MODELS: ModelSpec[] = [
  {
    id: "lfm2-2_6-vl",
    label: "LFM 2.5 2.6B VL",
    repo: "LiquidAI/LFM2.5-VL-2.6B-GGUF",
    quant: "Q4_K_M",
    sizeMb: null,
    blurb: "Strongest and slowest. Desktop with plenty of memory.",
    role: "Assistant · deepest reasoning",
    standard: false,
    desktopOnly: true,
    weightsGb: 1.8,
    minRamGb: 8,
    vision: true,
    reasoning: true,
    generative: true,
    maxCtx: 8192,
  },
  {
    id: "lfm2-1_2-instruct",
    label: "LFM 2.5 1.2B instruct",
    repo: "LiquidAI/LFM2.5-1.2B-Instruct-GGUF",
    quant: "Q4_K_M",
    sizeMb: null,
    blurb: "Better reasoning about why a trade happened.",
    role: "Assistant · reasoning over trades",
    standard: false,
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
    sizeMb: null,
    blurb: "Fast extraction with vision. The default assistant on phones.",
    role: "Assistant · fast extraction and vision",
    standard: true,
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
    repo: "LiquidAI/LFM2.5-230M-Encoder-GGUF",
    quant: "Q4_K_M",
    sizeMb: null,
    blurb: "Embeddings and tagging. Runs on anything, never writes prose.",
    role: "Automation · embeddings, tagging, retrieval",
    standard: true,
    weightsGb: 0.18,
    minRamGb: 0,
    vision: false,
    reasoning: false,
    generative: false,
    maxCtx: 2048,
  },
];

export const MODEL_BY_ID = Object.fromEntries(MODELS.map((m) => [m.id, m]));

export const DEFAULT_MODEL_ID = "lfm2-450-vl";

export const CTX_CHOICES = [1024, 2048, 4096, 8192] as const;
export const DEFAULT_CTX = 4096;

export type DeviceProfile = {
  /** GB reported by the browser, null when it refuses to say */
  ramGb: number | null;
  cores: number | null;
  mobile: boolean;
};

export function deviceProfile(): DeviceProfile {
  if (typeof navigator === "undefined") return { ramGb: null, cores: null, mobile: false };
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mobile =
    typeof matchMedia === "function" ? matchMedia("(pointer: coarse)").matches : false;
  return {
    ramGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    cores: nav.hardwareConcurrency ?? null,
    mobile,
  };
}

/**
 * Aim at the 2.6B VL and step down until the device can carry it.
 * When the browser hides deviceMemory we assume 4 GB on desktop, 2 on mobile.
 */
export function recommendModel(profile = deviceProfile()): {
  id: string;
  reason: string;
} {
  const assumed = profile.ramGb ?? (profile.mobile ? 2 : 4);
  const budget = profile.mobile ? assumed / 2 : assumed;
  const pick =
    MODELS.find((m) => budget >= m.minRamGb && !(m.desktopOnly && profile.mobile)) ??
    MODELS[MODELS.length - 1];
  const seen =
    profile.ramGb != null ? `${profile.ramGb} GB reported` : "memory not reported by the browser";
  return {
    id: pick.id,
    reason: `${seen}${profile.mobile ? " · touch device" : ""} — ${pick.label} fits.`,
  };
}

/** Rough working-set estimate so the context slider can warn honestly. */
export function memoryEstimateGb(modelId: string, nCtx: number): number {
  const spec = MODEL_BY_ID[modelId];
  if (!spec) return 0;
  // ~0.5 MB of KV cache per 1k tokens per 100M params, generously rounded.
  const kv = (nCtx / 1024) * spec.weightsGb * 0.25;
  return Math.round((spec.weightsGb + kv) * 10) / 10;
}



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

async function createRuntime(): Promise<Wllama> {
  const [{ Wllama: Ctor }, wasmUrl] = await Promise.all([
    import("@wllama/wllama/esm/index.js"),
    import("@wllama/wllama/esm/wasm/wllama.wasm?url").then((m) => m.default),
  ]);
  return new Ctor(
    { default: wasmUrl },
    { allowOffline: true, suppressNativeLog: true, parallelDownloads: 2 },
  );
}

export function isReady(modelId: string) {
  return instance != null && currentModel === modelId;
}

export function loadedContext() {
  return currentCtx;
}

/**
 * Which models already have their weights in the browser cache.
 * Reads the wllama cache index only — nothing is downloaded here.
 */
export async function cachedModels(): Promise<Set<string>> {
  const out = new Set<string>();
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
    for (const m of MODELS) {
      const needle = m.repo.split("/")[1]?.toLowerCase() ?? m.repo.toLowerCase();
      if (names.includes(needle)) out.add(m.id);
    }
  } catch {
    /* cache unavailable — treat everything as not downloaded */
  }
  return out;
}

export type LoadOptions = { nCtx?: number };

export async function loadModel(
  modelId: string,
  onStatus: (s: AiStatus) => void,
  options: LoadOptions = {},
): Promise<void> {
  const spec = MODELS.find((m) => m.id === modelId) ?? MODELS[0];
  const nCtx = Math.min(options.nCtx ?? DEFAULT_CTX, spec.maxCtx);
  if (isReady(modelId) && currentCtx === nCtx) {
    onStatus({ phase: "ready" });
    return;
  }
  try {
    if (instance) {
      await instance.exit().catch(() => {});
      instance = null;
      currentModel = null;
    }
    onStatus({ phase: "downloading", progress: 0 });
    const runtime = await createRuntime();
    await runtime.loadModelFromHF(
      { repo: spec.repo, quant: spec.quant },
      {
        n_ctx: nCtx,
        useCache: true,
        progressCallback: ({ loaded, total }: { loaded: number; total: number }) => {
          onStatus({ phase: "downloading", progress: total ? loaded / total : 0 });
        },
      },
    );
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
      onToken?.(out);
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
