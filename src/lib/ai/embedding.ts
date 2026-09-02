// Embedding abstraction.
//
// Two providers, one per runtime:
//   * lfm2-5-embed-350m (default): LiquidAI LFM2.5-Embedding-350M GGUF,
//     1024-dim dense bi-encoder, CLS-pooled by llama.cpp, loaded on the AI
//     worker's dedicated warm wllama handle. Asymmetric: queries embed with
//     a "query: " prefix, documents with "document: " (model card contract).
//   * minilm-6-v2 (fallback): all-MiniLM-L6-v2 ONNX via Transformers.js,
//     384-dim, mean-pooled, ~90 MB, for devices that cannot carry the LFM
//     weights next to a generative model.
//
// One shared runtime per kind: Transformers.js serialises ONNX sessions, the
// wllama encoder serialises through its worker RPC, so every caller goes
// through this module instead of creating its own pipeline.

export type EmbeddingProviderId = "lfm2-5-embed-350m" | "minilm-6-v2";

export type EmbeddingProviderSpec = {
  id: EmbeddingProviderId;
  label: string;
  repo: string;
  /** how the weights reach the browser */
  kind: "wllama" | "transformers";
  /** wllama kind: the GGUF quant (the ai.ts ModelSpec carries the same) */
  quant?: string;
  /** transformers kind: the ONNX dtype */
  dtype?: "q8" | "fp32";
  dimensions: number;
  sizeMb: number;
  tier: "default" | "fallback";
  /** asymmetric bi-encoders need role prefixes before embedding */
  asymmetric?: { query: string; target: string };
  blurb: string;
};

export const EMBEDDING_PROVIDERS: EmbeddingProviderSpec[] = [
  {
    id: "lfm2-5-embed-350m",
    label: "LFM 2.5 Embedding 350M",
    repo: "LiquidAI/LFM2.5-Embedding-350M-GGUF",
    kind: "wllama",
    quant: "Q4_K_M",
    dimensions: 1024,
    sizeMb: 229,
    tier: "default",
    asymmetric: { query: "query: ", target: "document: " },
    blurb: "Semantic router encoder. 1024-dim, multilingual, beats Qwen3-Embedding-0.6B.",
  },
  {
    id: "minilm-6-v2",
    label: "All MiniLM L6 v2",
    repo: "onnx-community/all-MiniLM-L6-v2-ONNX",
    kind: "transformers",
    dtype: "fp32",
    dimensions: 384,
    sizeMb: 90,
    tier: "fallback",
    blurb: "Light 6-layer BERT encoder fallback for constrained devices.",
  },
];

export const PROVIDER_BY_ID = Object.fromEntries(
  EMBEDDING_PROVIDERS.map((p) => [p.id, p]),
) as Record<EmbeddingProviderId, EmbeddingProviderSpec>;

export const DEFAULT_EMBEDDING_ID: EmbeddingProviderId = "lfm2-5-embed-350m";
export const FALLBACK_EMBEDDING_ID: EmbeddingProviderId = "minilm-6-v2";

// ── co-residency constraint ──────────────────────────────────────────────
//
// Heavy chat models (spec.encoderFallback, today the 2.6B) cannot share the
// machine with a second wllama handle. While one is the chat target, every
// selection below prefers the transformers.js MiniLM (a separate runtime)
// over the LFM embedder. Set by useAi whenever the selected model changes.

let encoderConstrained = false;
export function setEncoderConstraint(heavy: boolean): void {
  encoderConstrained = heavy;
}
export function encoderConstrainedActive(): boolean {
  return encoderConstrained;
}

export type ProviderState =
  | "missing"
  | "downloaded"
  | "loading"
  | "loaded"
  | "unavailable"
  | "error";

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
    s = { pipe: null, loading: null, state: "missing", progress: 0, error: null, backend: null };
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
  const spec = PROVIDER_BY_ID[id];
  if (spec.kind === "wllama") {
    // GGUF weights live in OPFS through the AI worker's shared cache manager.
    try {
      const { cachedModels } = await import("@/lib/ai");
      return (await cachedModels()).has(id);
    } catch {
      return false;
    }
  }
  if (typeof caches === "undefined") return false;
  try {
    const repo = spec.repo;
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

async function loadProviderInternal(
  id: EmbeddingProviderId = DEFAULT_EMBEDDING_ID,
  onProgress?: (fraction: number) => void,
  opts: { allowDownload: boolean } = { allowDownload: false },
): Promise<Extractor | null> {
  const s = slot(id);
  if (s.pipe) return s.pipe;
  if (s.loading) return s.loading;
  if (typeof window === "undefined") return null;
  if (!opts.allowDownload && !(await providerCached(id))) {
    s.state = "missing";
    s.error = "Download this semantic encoder before loading it.";
    emit();
    return null;
  }

  s.state = "loading";
  s.progress = 0;
  s.error = null;
  emit();

  s.loading = (async () => {
    try {
      const spec = PROVIDER_BY_ID[id];
      if (spec.kind === "wllama") {
        // The GGUF encoder loads on the AI worker's warm handle; the "pipe"
        // is a thin RPC wrapper shaped like the Transformers.js extractor.
        const ai = await import("@/lib/ai");
        const result = opts.allowDownload
          ? await ai.embedDownloadModel(id, (st) => {
              if (st.phase === "downloading") {
                s.progress = Math.max(0, Math.min(1, st.progress));
                onProgress?.(s.progress);
                emit();
              }
            })
          : await ai.embedActivateModel(id);
        if (result.status !== "ready") {
          throw new Error("message" in result ? result.message : "the encoder failed to load");
        }
        const created: Extractor = async (texts) => {
          // wllama's createEmbedding returns exactly ONE embedding per call
          // (an array input does not batch), so a batch is a per-text loop.
          // The LRU cache above means each text pays this once; the queue
          // below serializes the calls like the transformers path.
          const input = Array.isArray(texts) ? texts : [texts];
          const vectors: number[][] = [];
          for (const t of input) {
            const [v] = await ai.embedTexts([t]);
            if (v) vectors.push(v);
          }
          return { tolist: () => vectors };
        };
        s.pipe = created;
        s.backend = (await ai.embedBackend()) === "webgpu" ? "webgpu" : "wasm";
        s.state = "loaded";
        s.progress = 1;
        emit();
        return created;
      }
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
      s.state = "loaded";
      s.progress = 1;
      emit();
      return created;
    } catch (err) {
      s.state = "error";
      s.error = err instanceof Error ? err.message : "this embedding model failed to load";
      emit();
      return null;
    } finally {
      s.loading = null;
    }
  })();
  return s.loading;
}

export async function downloadProvider(
  id: EmbeddingProviderId = DEFAULT_EMBEDDING_ID,
  onProgress?: (fraction: number) => void,
): Promise<Extractor | null> {
  return loadProviderInternal(id, onProgress, { allowDownload: true });
}

export async function loadDownloadedProvider(
  id: EmbeddingProviderId = DEFAULT_EMBEDDING_ID,
  onProgress?: (fraction: number) => void,
): Promise<Extractor | null> {
  return loadProviderInternal(id, onProgress, { allowDownload: false });
}

export async function ensureProvider(
  id: EmbeddingProviderId = DEFAULT_EMBEDDING_ID,
  onProgress?: (fraction: number) => void,
): Promise<Extractor | null> {
  return loadDownloadedProvider(id, onProgress);
}

export async function ensureProviderIfCached(id: EmbeddingProviderId): Promise<Extractor | null> {
  return slot(id).pipe ?? null;
}

export function unloadProvider(id: EmbeddingProviderId) {
  const s = slot(id);
  s.pipe = null;
  s.backend = null;
  s.state = "missing";
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

/** The provider actually usable right now: the resident LFM embedder first,
 * a resident MiniLM fallback second, and for non-opportunistic callers the
 * best cached candidate (MiniLM when the LFM weights are not on device, or
 * whenever a heavy chat model forces the separate-runtime encoder). */
export async function activeProvider(opportunistic: boolean): Promise<EmbeddingProviderId | null> {
  if (encoderConstrained) {
    if (providerReady(FALLBACK_EMBEDDING_ID)) return FALLBACK_EMBEDDING_ID;
    if (opportunistic) return null;
    if (await providerCached(FALLBACK_EMBEDDING_ID)) return FALLBACK_EMBEDDING_ID;
  }
  if (providerReady(DEFAULT_EMBEDDING_ID)) return DEFAULT_EMBEDDING_ID;
  if (providerReady(FALLBACK_EMBEDDING_ID)) return FALLBACK_EMBEDDING_ID;
  if (opportunistic) return null;
  if (await providerCached(DEFAULT_EMBEDDING_ID)) return DEFAULT_EMBEDDING_ID;
  return FALLBACK_EMBEDDING_ID;
}

export async function embed(
  texts: string[],
  opts: { opportunistic?: boolean; provider?: EmbeddingProviderId } = {},
): Promise<{ vectors: number[][]; provider: EmbeddingProviderId } | null> {
  const id = opts.provider ?? (await activeProvider(Boolean(opts.opportunistic)));
  if (!id) return null;
  const pipe = opts.opportunistic
    ? await ensureProviderIfCached(id)
    : await loadDownloadedProvider(id);
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

// ── vector cache ────────────────────────────────────────────────────────────
//
// Derived data only: embeddings are never the source of truth, and the cache
// lives in memory so there is no storage quota to respect. Same provider plus
// same text must produce the same vector, so a hit skips the encoder entirely.
// LRU order: Map insertion order, refreshed on hit.

const VECTOR_CACHE_MAX = 2000;
const vectorCache = new Map<string, number[]>();

/** Stats of the most recent cached rank call, for the turn trace. */
export type RankStats = {
  hits: number;
  misses: number;
  /** wall-clock ms of the whole rank, embedding included */
  ms: number;
  provider: EmbeddingProviderId | null;
};

let lastStats: RankStats | null = null;
export function lastRankStats(): RankStats | null {
  return lastStats;
}

function cacheKey(provider: EmbeddingProviderId, text: string): string {
  return `${provider}\u0000${text}`;
}

function cacheGet(provider: EmbeddingProviderId, text: string): number[] | null {
  const key = cacheKey(provider, text);
  const hit = vectorCache.get(key) ?? null;
  if (hit) {
    vectorCache.delete(key);
    vectorCache.set(key, hit);
  }
  return hit;
}

function cachePut(provider: EmbeddingProviderId, text: string, vector: number[]) {
  const key = cacheKey(provider, text);
  vectorCache.delete(key);
  vectorCache.set(key, vector);
  while (vectorCache.size > VECTOR_CACHE_MAX) {
    const oldest = vectorCache.keys().next().value;
    if (oldest === undefined) break;
    vectorCache.delete(oldest);
  }
}

export function clearVectorCache() {
  vectorCache.clear();
  lastStats = null;
}

/** Role a text plays for an asymmetric bi-encoder: queries and documents
 * embed in different prefix spaces. Symmetric providers ignore the role. */
export type EmbedRole = "query" | "target";

function prepare(spec: EmbeddingProviderSpec, text: string, role: EmbedRole): string {
  const p = spec.asymmetric;
  if (!p) return text;
  return role === "query" ? p.query + text : p.target + text;
}

/** Vectors for texts, embedding only the ones never seen for this provider.
 * The prefix (for asymmetric providers) is part of the cache key, so a text
 * cached as a target never answers for the same text as a query. */
async function embedCached(
  texts: string[],
  opts: { opportunistic?: boolean; provider?: EmbeddingProviderId; role?: EmbedRole } = {},
): Promise<{
  vectors: number[][];
  provider: EmbeddingProviderId;
  hits: number;
  misses: number;
} | null> {
  const id = opts.provider ?? (await activeProvider(Boolean(opts.opportunistic)));
  if (!id) return null;
  const spec = PROVIDER_BY_ID[id];
  const role = opts.role ?? "target";
  const vectors: number[][] = new Array(texts.length);
  const fresh: { index: number; text: string }[] = [];
  let hits = 0;
  for (let i = 0; i < texts.length; i++) {
    const keyed = prepare(spec, texts[i], role);
    const cachedVector = cacheGet(id, keyed);
    if (cachedVector) {
      vectors[i] = cachedVector;
      hits++;
    } else {
      fresh.push({ index: i, text: keyed });
    }
  }
  if (fresh.length > 0) {
    const res = await embed(
      fresh.map((f) => f.text),
      { ...opts, provider: id },
    );
    if (!res) return null;
    fresh.forEach((f, i) => {
      const v = res.vectors[i];
      // A short result leaves the slot empty: the text stays a miss instead
      // of caching undefined.
      if (!v) return;
      vectors[f.index] = v;
      cachePut(id, f.text, v);
    });
  }
  return { vectors, provider: id, hits, misses: fresh.length };
}

/**
 * Warm the cache for texts the next question will probably rank against. Only
 * runs when a provider is already resident; never downloads anything. warmed
 * texts are targets: catalogues, skills, journal lines.
 */
export async function prewarm(
  texts: string[],
  opts: { opportunistic?: boolean } = {},
): Promise<number> {
  if (texts.length === 0) return 0;
  const res = await embedCached(texts, { opportunistic: true, role: "target", ...opts }).catch(
    () => null,
  );
  return res?.misses ?? 0;
}

/**
 * Single-provider rank: embed the query and every target once, then cosine
 * score and sort. Escalation is a non-concept with one encoder. Cached vectors
 * skip the embedding call entirely. The query embeds in the query space and
 * targets in the document space when the provider is asymmetric.
 */
export async function rankTiered(
  query: string,
  targets: { id: string; text: string }[],
  opts: { opportunistic?: boolean } = {},
): Promise<{
  ranked: Ranked[];
  provider: EmbeddingProviderId;
  escalated: boolean;
  stats: RankStats;
} | null> {
  if (targets.length === 0) {
    const empty: RankStats = { hits: 0, misses: 0, ms: 0, provider: null };
    lastStats = empty;
    return { ranked: [], provider: DEFAULT_EMBEDDING_ID, escalated: false, stats: empty };
  }

  const started = performance.now();
  let hits = 0;
  let misses = 0;

  const [qv, tv] = await Promise.all([
    embedCached([query], { ...opts, role: "query" }),
    embedCached(
      targets.map((t) => t.text),
      { ...opts, role: "target" },
    ),
  ]);
  if (!qv || !tv) {
    lastStats = null;
    return null;
  }
  hits += qv.hits + tv.hits;
  misses += qv.misses + tv.misses;
  const q = qv.vectors[0];

  // A partial provider result must degrade to "no rank", never crash the
  // caller's turn with a cosine on undefined.
  const scored = targets
    .map((t, i) => ({ id: t.id, v: tv.vectors[i] }))
    .filter((p): p is { id: string; v: number[] } => Array.isArray(p.v));
  if (!Array.isArray(q) || scored.length === 0) {
    lastStats = null;
    return null;
  }

  lastStats = {
    hits,
    misses,
    ms: Math.round((performance.now() - started) * 10) / 10,
    provider: tv.provider,
  };

  return {
    provider: tv.provider,
    escalated: false,
    stats: lastStats,
    ranked: scored
      .map((p) => ({ id: p.id, score: cosine(q, p.v) }))
      .sort((a, b) => b.score - a.score),
  };
}
