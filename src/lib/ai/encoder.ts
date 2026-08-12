// The encoder half of the assistant. It never writes prose: it turns text into
// vectors so routing, retrieval and tool discovery can be semantic without
// waking a generative model. Browser only, lazy, and cached after first use.

import { ENCODER_ID, MODEL_BY_ID } from "@/lib/ai";

export type EncoderState = "required" | "downloading" | "ready" | "unavailable" | "error";

type Extractor = (
  input: string | string[],
  options?: Record<string, unknown>,
) => Promise<{ tolist: () => number[][] }>;

let pipe: Extractor | null = null;
let loading: Promise<Extractor | null> | null = null;
let state: EncoderState = "required";
let lastError: string | null = null;

export function encoderState(): EncoderState {
  return state;
}
export function encoderError(): string | null {
  return lastError;
}

/** Loads the encoder once. Returns null when the browser cannot run it. */
export async function ensureEncoder(
  onProgress?: (fraction: number) => void,
): Promise<Extractor | null> {
  if (pipe) return pipe;
  if (loading) return loading;
  if (typeof window === "undefined") return null;

  state = "downloading";
  loading = (async () => {
    try {
      const spec = MODEL_BY_ID[ENCODER_ID];
      const { pipeline } = await import("@huggingface/transformers");
      const device =
        typeof navigator !== "undefined" && "gpu" in navigator ? "webgpu" : "wasm";
      const created = (await pipeline("feature-extraction", spec.repo, {
        dtype: "q8",
        device: device as "webgpu" | "wasm",
        progress_callback: (p: { status?: string; progress?: number }) => {
          if (typeof p.progress === "number") onProgress?.(p.progress / 100);
        },
      })) as unknown as Extractor;
      pipe = created;
      state = "ready";
      return created;
    } catch (err) {
      state = "unavailable";
      lastError = err instanceof Error ? err.message : "the encoder failed to load";
      return null;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export function unloadEncoder() {
  pipe = null;
  state = "required";
}

function norm(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const len = Math.sqrt(s) || 1;
  return v.map((x) => x / len);
}

export function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i];
  return s;
}

/** Mean-pooled, L2-normalised embeddings. Returns null when unavailable. */
export async function embed(texts: string[]): Promise<number[][] | null> {
  const p = await ensureEncoder();
  if (!p) return null;
  try {
    const out = await p(texts, { pooling: "mean", normalize: true });
    return out.tolist().map(norm);
  } catch (err) {
    state = "error";
    lastError = err instanceof Error ? err.message : "embedding failed";
    return null;
  }
}

export type Ranked = { id: string; score: number };

/** Ranks candidate targets (skills, tools, journal cards) against a query. */
export async function rank(
  query: string,
  targets: { id: string; text: string }[],
): Promise<Ranked[] | null> {
  if (targets.length === 0) return [];
  const vecs = await embed([query, ...targets.map((t) => t.text)]);
  if (!vecs) return null;
  const [q, ...rest] = vecs;
  return targets
    .map((t, i) => ({ id: t.id, score: cosine(q, rest[i]) }))
    .sort((a, b) => b.score - a.score);
}
