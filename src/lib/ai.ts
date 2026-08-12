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
};

export const MODELS: ModelSpec[] = [
  {
    id: "lfm2-230-encoder",
    label: "LFM 2.5 230M encoder",
    repo: "LiquidAI/LFM2.5-230M-Encoder-GGUF",
    quant: "Q4_K_M",
    sizeMb: null,
    blurb: "Embeddings and tagging. Runs on anything, never writes prose.",
    role: "Automation · embeddings, tagging, retrieval",
    standard: true,
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
  },
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
  },
];

export const DEFAULT_MODEL_ID = "lfm2-450-vl";


export type AiStatus =
  | { phase: "idle" }
  | { phase: "downloading"; progress: number }
  | { phase: "loading" }
  | { phase: "ready" }
  | { phase: "error"; message: string };

let instance: Wllama | null = null;
let currentModel: string | null = null;

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

export async function loadModel(
  modelId: string,
  onStatus: (s: AiStatus) => void,
): Promise<void> {
  if (isReady(modelId)) {
    onStatus({ phase: "ready" });
    return;
  }
  const spec = MODELS.find((m) => m.id === modelId) ?? MODELS[0];
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
        n_ctx: 2048,
        useCache: true,
        progressCallback: ({ loaded, total }: { loaded: number; total: number }) => {
          onStatus({ phase: "downloading", progress: total ? loaded / total : 0 });
        },
      },
    );
    instance = runtime;
    currentModel = spec.id;
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

export async function chat(
  system: string,
  user: string,
  onToken?: (text: string) => void,
): Promise<string> {
  if (!instance) throw new Error("assistant not loaded");
  let out = "";
  await instance.createChatCompletion({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    stream: true,
    nPredict: 220,
    sampling: { temp: 0.4, top_p: 0.9 },
    onNewToken: (_t: number, _p: unknown, piece: string) => {
      out += piece;
      onToken?.(out);
    },
  } as never);
  return out.trim();
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
