// On-device assistant. wllama runs llama.cpp in WebAssembly (SIMD + threads
// when the browser allows it) inside its own worker, so the UI thread never
// blocks. Nothing leaves the device; the model is cached after first download.

import type { Wllama } from "@wllama/wllama/esm/index.js";

export type ModelSpec = {
  id: string;
  label: string;
  repo: string;
  quant: string;
  sizeMb: number;
  blurb: string;
};

export const MODELS: ModelSpec[] = [
  {
    id: "smol-360",
    label: "Smol 360M",
    repo: "ggml-org/SmolLM2-360M-Instruct-GGUF",
    quant: "Q8_0",
    sizeMb: 386,
    blurb: "Fastest. Good for tidying up a sentence and tagging a trade.",
  },
  {
    id: "qwen-0.5",
    label: "Qwen2.5 0.5B",
    repo: "ggml-org/Qwen2.5-0.5B-Instruct-Q8_0-GGUF",
    quant: "Q8_0",
    sizeMb: 531,
    blurb: "Balanced. Better reasoning about why a trade happened.",
  },
  {
    id: "smol-1.7",
    label: "Smol 1.7B",
    repo: "ggml-org/SmolLM2-1.7B-Instruct-GGUF",
    quant: "Q4_K_M",
    sizeMb: 1060,
    blurb: "Strongest, slowest. Desktop with plenty of memory.",
  },
];

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
