// The encoder half of the assistant. It never writes prose: it turns text into
// vectors so routing, retrieval and tool discovery can be semantic without
// waking a generative model.
//
// This is a thin facade over the single LFM 2.5 Encoder-230M in
// `embedding.ts`. It is WARMED on first message and never goes cold — routing
// always has vectors when it needs them.

import {
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
  "missing" | "downloaded" | "loading" | "loaded" | "unavailable" | "error";

const LFM_ID: EmbeddingProviderId = "lfm-encoder-230m";

export const onEncoderChange = onEmbeddingChange;

export function encoderState(): EncoderState {
  return providerState(LFM_ID);
}
export function encoderError(): string | null {
  return providerError(LFM_ID);
}
export function encoderProgress(): number {
  return providerProgress(LFM_ID);
}
export function encoderBackend(): "webgpu" | "wasm" | null {
  return providerBackend(LFM_ID);
}
export function encoderReady(): boolean {
  return providerReady(LFM_ID);
}

export async function encoderCached(): Promise<boolean> {
  return providerCached(LFM_ID);
}

export async function downloadSemanticProvider(onProgress?: (fraction: number) => void) {
  return downloadProvider(LFM_ID, onProgress);
}

export async function activateSemantic(onProgress?: (fraction: number) => void) {
  return loadDownloadedProvider(LFM_ID, onProgress);
}

export async function ensureEncoderIfCached() {
  return ensureProviderIfCached(LFM_ID);
}

export function unloadEncoder() {
  unloadProvider(LFM_ID);
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
