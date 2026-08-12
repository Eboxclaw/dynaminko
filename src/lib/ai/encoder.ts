// The encoder half of the assistant. It never writes prose: it turns text into
// vectors so routing, retrieval and tool discovery can be semantic without
// waking a generative model.
//
// It is OPTIONAL. Every caller must keep working when it is missing: the chat
// falls back to the deterministic keyword pass. Nothing here loads on startup.

import { ENCODER_ID, MODEL_BY_ID } from "@/lib/ai";
import { encoderDevice } from "@/lib/ai/runtime";

export type EncoderState =
  | "required"
  | "downloading"
  | "ready"
  | "unavailable"
  | "error";

type Extractor = (
  input: string | string[],
  options?: Record<string, unknown>,
) => Promise<{ tolist: () => number[][] }>;

let pipe: Extractor | null = null;
let loading: Promise<Extractor | null> | null = null;
let state: EncoderState = "required";
let lastError: string | null = null;
let progress = 0;
let backend: "webgpu" | "wasm" | null = null;

const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function onEncoderChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function encoderState(): EncoderState {
  return state;
}
export function encoderError(): string | null {
  return lastError;
}
export function encoderProgress(): number {
  return progress;
}
export function encoderBackend(): "webgpu" | "wasm" | null {
  return backend;
}
export function encoderReady(): boolean {
  return pipe != null;
}

/** Is the encoder already in the browser cache? Never downloads. */
export async function encoderCached(): Promise<boolean> {
  if (pipe) return true;
  if (typeof caches === "undefined") return false;
  try {
    const repo = MODEL_BY_ID[ENCODER_ID].repo;
    for (const key of await caches.keys()) {
      if (!/transformers/i.test(key)) continue;
      const cache = await caches.open(key);
      const reqs = await cache.keys();
      if (reqs.some((r) => r.url.includes(repo))) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Loads the encoder once. Returns null when the browser cannot run it — that is
 * a normal outcome, not an error the user has to deal with.
 */
export async function ensureEncoder(
  onProgress?: (fraction: number) => void,
): Promise<Extractor | null> {
  if (pipe) return pipe;
  if (loading) return loading;
  if (typeof window === "undefined") return null;

  state = "downloading";
  progress = 0;
  lastError = null;
  emit();

  loading = (async () => {
    try {
      const spec = MODEL_BY_ID[ENCODER_ID];
      const device = await encoderDevice();
      const { pipeline } = await import("@huggingface/transformers");
      const created = (await pipeline("feature-extraction", spec.repo, {
        dtype: "q8",
        device,
        progress_callback: (p: { status?: string; progress?: number }) => {
          if (typeof p.progress === "number") {
            progress = Math.max(0, Math.min(1, p.progress / 100));
            onProgress?.(progress);
            emit();
          }
        },
      })) as unknown as Extractor;
      pipe = created;
      backend = device;
      state = "ready";
      progress = 1;
      emit();
      return created;
    } catch (err) {
      state = "unavailable";
      lastError = err instanceof Error ? err.message : "the encoder failed to load";
      emit();
      return null;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Only load if the weights are already here — used by opportunistic callers. */
export async function ensureEncoderIfCached(): Promise<Extractor | null> {
  if (pipe) return pipe;
  if (!(await encoderCached())) return null;
  return ensureEncoder();
}

export function unloadEncoder() {
  pipe = null;
  backend = null;
  state = "required";
  progress = 0;
  emit();
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

/**
 * Mean-pooled, L2-normalised embeddings. Returns null when unavailable.
 * `opportunistic` never triggers a download.
 */
export async function embed(
  texts: string[],
  opts: { opportunistic?: boolean } = {},
): Promise<number[][] | null> {
  const p = opts.opportunistic ? await ensureEncoderIfCached() : await ensureEncoder();
  if (!p) return null;
  try {
    const out = await p(texts, { pooling: "mean", normalize: true });
    return out.tolist().map(norm);
  } catch (err) {
    state = "error";
    lastError = err instanceof Error ? err.message : "embedding failed";
    emit();
    return null;
  }
}

export type Ranked = { id: string; score: number };

/** Ranks candidate targets (skills, tools, journal cards) against a query. */
export async function rank(
  query: string,
  targets: { id: string; text: string }[],
  opts: { opportunistic?: boolean } = {},
): Promise<Ranked[] | null> {
  if (targets.length === 0) return [];
  const vecs = await embed([query, ...targets.map((t) => t.text)], opts);
  if (!vecs) return null;
  const [q, ...rest] = vecs;
  return targets
    .map((t, i) => ({ id: t.id, score: cosine(q, rest[i]) }))
    .sort((a, b) => b.score - a.score);
}
