// The encoder half of the assistant. It never writes prose: it turns text into
// vectors so routing, retrieval and tool discovery can be semantic without
// waking a generative model.
//
// This file is now a thin facade over the tiered embedding layer
// (`src/lib/ai/embedding.ts`): MiniLM is the cheap default, the LFM 2.5
// Encoder-230M is the recommended upgrade. It is OPTIONAL — every caller keeps
// working when nothing is downloaded, falling back to the keyword pass.

import {
  DEFAULT_EMBEDDING_ID,
  cosine as cosineOf,
  embed as embedWith,
  downloadProvider,
  loadDownloadedProvider,
  ensureProviderIfCached,
  lastRankStats,
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
  "missing" | "downloaded" | "loading" | "loaded" | "unavailable" | "error";

/** Which provider the legacy encoder API drives. */
function active(): EmbeddingProviderId {
  return providerReady("lfm-encoder-230m") ? "lfm-encoder-230m" : DEFAULT_EMBEDDING_ID;
}

export const onEncoderChange = onEmbeddingChange;

export function encoderState(): EncoderState {
  return providerState(active());
}
export function encoderError(): string | null {
  return providerError(active());
}
export function encoderProgress(): number {
  return providerProgress(active());
}
export function encoderBackend(): "webgpu" | "wasm" | null {
  return providerBackend(active());
}
export function encoderReady(): boolean {
  return providerReady("lfm-encoder-230m") || providerReady(DEFAULT_EMBEDDING_ID);
}

export async function encoderCached(): Promise<boolean> {
  return (await providerCached(DEFAULT_EMBEDDING_ID)) || (await providerCached("lfm-encoder-230m"));
}

export async function downloadSemanticProvider(onProgress?: (fraction: number) => void) {
  return downloadProvider(active(), onProgress);
}

export async function activateSemantic(onProgress?: (fraction: number) => void) {
  return loadDownloadedProvider(active(), onProgress);
}

export async function ensureEncoderIfCached() {
  return ensureProviderIfCached(active());
}

export function unloadEncoder() {
  unloadProvider("lfm-encoder-230m");
  unloadProvider(DEFAULT_EMBEDDING_ID);
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
