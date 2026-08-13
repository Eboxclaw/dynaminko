// Embedding abstraction.
//
// Two tiers, neither downloaded automatically:
//   MiniLM (23 MB)  — the cheap default semantic index for retrieval/routing.
//   LFM 2.5 Encoder-230M — the stronger, strongly recommended upgrade for
//                          semantic reasoning, classification and routing.
//
//   query → MiniLM → confident match → command
//                 └→ uncertain      → encoder → router
//
// One shared runtime: Transformers.js serialises ONNX sessions, so every caller
// goes through this module instead of creating its own pipeline.

export type EmbeddingProviderId = "minilm" | "lfm-encoder-230m";

export type EmbeddingProviderSpec = {
  id: EmbeddingProviderId;
  label: string;
  repo: string;
  dtype: "q8" | "fp32";
  dimensions: number;
  sizeMb: number;
  tier: "default" | "upgrade";
  blurb: string;
};

export const EMBEDDING_PROVIDERS: EmbeddingProviderSpec[] = [
  {
    id: "minilm",
    label: "MiniLM L6 v2",
    repo: "Xenova/all-MiniLM-L6-v2",
    dtype: "q8",
    dimensions: 384,
    sizeMb: 23,
    tier: "default",
    blurb: "Tiny semantic index. Enough for retrieval and slash routing.",
  },
  {
    id: "lfm-encoder-230m",
    label: "LFM 2.5 Encoder 230M",
    repo: "LiquidAI/LFM2.5-Encoder-230M",
    dtype: "q8",
    dimensions: 768,
    sizeMb: 180,
    tier: "upgrade",
    blurb: "Bidirectional 8k encoder. Stronger routing and classification.",
  },
];

export const PROVIDER_BY_ID = Object.fromEntries(
  EMBEDDING_PROVIDERS.map((p) => [p.id, p]),
) as Record<EmbeddingProviderId, EmbeddingProviderSpec>;

export const DEFAULT_EMBEDDING_ID: EmbeddingProviderId = "minilm";
/** Below this the cheap tier is not trusted and the upgrade tier is consulted. */
export const CONFIDENT = 0.55;

export type ProviderState = "required" | "downloading" | "ready" | "unavailable" | "error";

type Extractor = (
  input: string | string[],
  options?: Record<string, unknown>,
) => Promise<{ tolist: () => number[][] }>;

type Slot = {
  pipe: Extractor | null;
  loading: Promise<Extractor | null> | null;
  state: ProviderState;
  progress: number;
  error: string | null;
  backend: "webgpu" | "wasm" | null;
};

const slots = new Map<EmbeddingProviderId, Slot>();
const listeners = new Set<() => void>();
/** Transformers.js cannot run two sessions at once — serialise every call. */
let queue: Promise<unknown> = Promise.resolve();

function slot(id: EmbeddingProviderId): Slot {
  let s = slots.get(id);
  if (!s) {
    s = { pipe: null, loading: null, state: "required", progress: 0, error: null, backend: null };
    slots.set(id, s);
  }
  return s;
}

function emit() {
  for (const fn of listeners) fn();
}

export function onEmbeddingChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function providerState(id: EmbeddingProviderId): ProviderState {
  return slot(id).state;
}
export function providerProgress(id: EmbeddingProviderId): number {
  return slot(id).progress;
}
export function providerError(id: EmbeddingProviderId): string | null {
  return slot(id).error;
}
export function providerBackend(id: EmbeddingProviderId): "webgpu" | "wasm" | null {
  return slot(id).backend;
}
export function providerReady(id: EmbeddingProviderId): boolean {
  return slot(id).pipe != null;
}

/** Already in the browser cache? Never downloads. */
export async function providerCached(id: EmbeddingProviderId): Promise<boolean> {
  if (slot(id).pipe) return true;
  if (typeof caches === "undefined") return false;
  try {
    const repo = PROVIDER_BY_ID[id].repo;
    for (const key of await caches.keys()) {
      if (!/transformers/i.test(key)) continue;
      const cache = await caches.open(key);
      if ((await cache.keys()).some((r) => r.url.includes(repo))) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export async function ensureProvider(
  id: EmbeddingProviderId = DEFAULT_EMBEDDING_ID,
  onProgress?: (fraction: number) => void,
): Promise<Extractor | null> {
  const s = slot(id);
  if (s.pipe) return s.pipe;
  if (s.loading) return s.loading;
  if (typeof window === "undefined") return null;

  s.state = "downloading";
  s.progress = 0;
  s.error = null;
  emit();

  s.loading = (async () => {
    try {
      const spec = PROVIDER_BY_ID[id];
      const { encoderDevice } = await import("@/lib/ai/runtime");
      const device = await encoderDevice();
      const { pipeline } = await import("@huggingface/transformers");
      const created = (await pipeline("feature-extraction", spec.repo, {
        dtype: spec.dtype,
        device,
        progress_callback: (info: unknown) => {
          const p = (info as { progress?: number }).progress;
          if (typeof p === "number") {
            s.progress = Math.max(0, Math.min(1, p / 100));
            onProgress?.(s.progress);
            emit();
          }
        },
      })) as unknown as Extractor;
      s.pipe = created;
      s.backend = device;
      s.state = "ready";
      s.progress = 1;
      emit();
      return created;
    } catch (err) {
      s.state = "unavailable";
      s.error = err instanceof Error ? err.message : "this embedding model failed to load";
      emit();
      return null;
    } finally {
      s.loading = null;
    }
  })();
  return s.loading;
}

export async function ensureProviderIfCached(
  id: EmbeddingProviderId,
): Promise<Extractor | null> {
  if (slot(id).pipe) return slot(id).pipe;
  if (!(await providerCached(id))) return null;
  return ensureProvider(id);
}

export function unloadProvider(id: EmbeddingProviderId) {
  const s = slot(id);
  s.pipe = null;
  s.backend = null;
  s.state = "required";
  s.progress = 0;
  emit();
}

function norm(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const len = Math.sqrt(sum) || 1;
  return v.map((x) => x / len);
}

export function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i];
  return s;
}

/** The provider actually usable right now: upgrade tier first when resident. */
export async function activeProvider(opportunistic: boolean): Promise<EmbeddingProviderId | null> {
  const upgrade: EmbeddingProviderId = "lfm-encoder-230m";
  if (providerReady(upgrade) || (await providerCached(upgrade))) return upgrade;
  if (providerReady(DEFAULT_EMBEDDING_ID)) return DEFAULT_EMBEDDING_ID;
  if (opportunistic) return (await providerCached(DEFAULT_EMBEDDING_ID))
    ? DEFAULT_EMBEDDING_ID
    : null;
  return DEFAULT_EMBEDDING_ID;
}

export async function embed(
  texts: string[],
  opts: { opportunistic?: boolean; provider?: EmbeddingProviderId } = {},
): Promise<{ vectors: number[][]; provider: EmbeddingProviderId } | null> {
  const id = opts.provider ?? (await activeProvider(Boolean(opts.opportunistic)));
  if (!id) return null;
  const pipe = opts.opportunistic ? await ensureProviderIfCached(id) : await ensureProvider(id);
  if (!pipe) return null;
  const run = queue.then(async () => {
    const out = await pipe(texts, { pooling: "mean", normalize: true });
    return out.tolist().map(norm);
  });
  queue = run.catch(() => undefined);
  try {
    return { vectors: await run, provider: id };
  } catch (err) {
    const s = slot(id);
    s.state = "error";
    s.error = err instanceof Error ? err.message : "embedding failed";
    emit();
    return null;
  }
}

export type Ranked = { id: string; score: number };

/**
 * Cheap tier first. When its best match is not confident and the stronger
 * encoder is already on the device, re-rank with it.
 */
export async function rankTiered(
  query: string,
  targets: { id: string; text: string }[],
  opts: { opportunistic?: boolean } = {},
): Promise<{ ranked: Ranked[]; provider: EmbeddingProviderId; escalated: boolean } | null> {
  if (targets.length === 0)
    return { ranked: [], provider: DEFAULT_EMBEDDING_ID, escalated: false };

  const score = async (provider?: EmbeddingProviderId) => {
    const res = await embed([query, ...targets.map((t) => t.text)], { ...opts, provider });
    if (!res) return null;
    const [q, ...rest] = res.vectors;
    return {
      provider: res.provider,
      ranked: targets
        .map((t, i) => ({ id: t.id, score: cosine(q, rest[i]) }))
        .sort((a, b) => b.score - a.score),
    };
  };

  const first = await score();
  if (!first) return null;
  const best = first.ranked[0]?.score ?? 0;
  if (best >= CONFIDENT || first.provider === "lfm-encoder-230m")
    return { ...first, escalated: false };

  if (await providerCached("lfm-encoder-230m")) {
    const second = await score("lfm-encoder-230m");
    if (second) return { ...second, escalated: true };
  }
  return { ...first, escalated: false };
}
