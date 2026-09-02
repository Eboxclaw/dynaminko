// The encoder half of the assistant. It never writes prose: it turns text into
// vectors so routing, retrieval and tool discovery can be semantic without
// waking a generative model.
//
// A facade over the two providers in `embedding.ts`: the LFM2.5-Embedding
// GGUF (default) and MiniLM (fallback for devices that cannot carry it). The
// resident one is preferred; nothing resident means the cached default, then
// the fallback. It is WARMED on first message and never goes cold — routing
// always has vectors when it needs them.

import {
  DEFAULT_EMBEDDING_ID,
  FALLBACK_EMBEDDING_ID,
  cosine as cosineOf,
  downloadProvider,
  embed as embedWith,
  ensureProviderIfCached,
  lastRankStats,
  loadDownloadedProvider,
  onEmbeddingChange,
  prewarm,
  providerBackend,
  providerCached,
  providerError,
  providerProgress,
  providerReady,
  providerState,
  rankTiered,
  unloadProvider,
  type EmbeddingProviderId,
  type RankStats,
} from "@/lib/ai/embedding";

export type { RankStats };

export type EncoderState =
  | "missing"
  | "downloaded"
  | "loading"
  | "loaded"
  | "unavailable"
  | "error";

/** The provider this facade acts on, without any await: resident default,
 * resident fallback, then the default. Cache probing is async and only the
 * cached/activate paths below pay for it. */
function targetId(): EmbeddingProviderId {
  if (providerReady(DEFAULT_EMBEDDING_ID)) return DEFAULT_EMBEDDING_ID;
  if (providerReady(FALLBACK_EMBEDDING_ID)) return FALLBACK_EMBEDDING_ID;
  return DEFAULT_EMBEDDING_ID;
}

/** Which provider a download should fetch: the LFM embedder everywhere a
 * phone-class memory budget can still carry it next to a generative model. */
async function downloadId(): Promise<EmbeddingProviderId> {
  try {
    const { deviceProfile } = await import("@/lib/ai");
    const p = deviceProfile();
    if (p.mobile && (p.ramGb ?? 2) < 4) return FALLBACK_EMBEDDING_ID;
  } catch {
    /* registry unavailable: default */
  }
  return DEFAULT_EMBEDDING_ID;
}

export const onEncoderChange = onEmbeddingChange;

export function encoderState(): EncoderState {
  return providerState(targetId());
}
export function encoderError(): string | null {
  return providerError(targetId());
}
export function encoderProgress(): number {
  return providerProgress(targetId());
}
export function encoderBackend(): "webgpu" | "wasm" | null {
  return providerBackend(targetId());
}
export function encoderReady(): boolean {
  return providerReady(targetId());
}

/** Any encoder weights on device (default or fallback). */
export async function encoderCached(): Promise<boolean> {
  return (
    (await providerCached(DEFAULT_EMBEDDING_ID)) ||
    (await providerCached(FALLBACK_EMBEDDING_ID))
  );
}

export async function downloadSemanticProvider(onProgress?: (fraction: number) => void) {
  return downloadProvider(await downloadId(), onProgress);
}

/** What the Download button would actually fetch, and whether it is already
 * on device. The panel needs this so a cached fallback never hides the
 * default embedder's download. */
export async function encoderDownloadTarget(): Promise<{
  id: EmbeddingProviderId;
  cached: boolean;
}> {
  const id = await downloadId();
  return { id, cached: await providerCached(id) };
}

/** Load whichever encoder is cached: the LFM embedder when present, the
 * MiniLM fallback otherwise. Never downloads. */
export async function activateSemantic(onProgress?: (fraction: number) => void) {
  if (await providerCached(DEFAULT_EMBEDDING_ID)) {
    const lfm = await loadDownloadedProvider(DEFAULT_EMBEDDING_ID, onProgress);
    if (lfm) return lfm;
  }
  if (await providerCached(FALLBACK_EMBEDDING_ID)) {
    return loadDownloadedProvider(FALLBACK_EMBEDDING_ID, onProgress);
  }
  return null;
}

export async function ensureEncoderIfCached() {
  return ensureProviderIfCached(targetId());
}

export function unloadEncoder() {
  unloadProvider(DEFAULT_EMBEDDING_ID);
  unloadProvider(FALLBACK_EMBEDDING_ID);
}

export const cosine = cosineOf;

/** Mean-pooled, L2-normalised embeddings. Null when nothing is available. */
export async function embed(
  texts: string[],
  opts: { opportunistic?: boolean } = {},
): Promise<number[][] | null> {
  const res = await embedWith(texts, opts);
  return res?.vectors ?? null;
}

export type Ranked = { id: string; score: number };

/** Ranks candidate targets (skills, tools, commands, journal cards). Cached. */
export async function rank(
  query: string,
  targets: { id: string; text: string }[],
  opts: { opportunistic?: boolean } = {},
): Promise<Ranked[] | null> {
  const res = await rankTiered(query, targets, opts);
  return (res?.ranked as Ranked[] | undefined) ?? null;
}

/** Same rank, with the cache/timing stats the turn trace shows. */
export async function rankWithStats(
  query: string,
  targets: { id: string; text: string }[],
  opts: { opportunistic?: boolean } = {},
): Promise<{ ranked: Ranked[] | null; stats: RankStats | null }> {
  const res = await rankTiered(query, targets, opts);
  return { ranked: (res?.ranked as Ranked[] | undefined) ?? null, stats: res?.stats ?? null };
}

/** Embed texts ahead of a question. Only runs when a provider is resident. */
export function prewarmTargets(texts: string[]): Promise<number> {
  return prewarm(texts);
}

/** Stats of the last cached rank call, null when none ran. */
export function rankStats(): RankStats | null {
  return lastRankStats();
}
