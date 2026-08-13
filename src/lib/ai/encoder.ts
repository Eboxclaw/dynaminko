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
  loadCachedProvider,
  onEmbeddingChange,
  providerBackend,
  providerCached,
  providerError,
  providerProgress,
  providerReady,
  providerState,
  rankTiered,
  unloadProvider,
  type EmbeddingProviderId,
} from "@/lib/ai/embedding";

export type EncoderState =
  | "required"
  | "downloading"
  | "loading"
  | "ready"
  | "unavailable"
  | "error";

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
  return (
    (await providerCached(DEFAULT_EMBEDDING_ID)) || (await providerCached("lfm-encoder-230m"))
  );
}

export async function downloadEncoder(onProgress?: (fraction: number) => void) {
  return downloadProvider(active(), onProgress);
}

export async function loadEncoder(onProgress?: (fraction: number) => void) {
  const id = (await providerCached("lfm-encoder-230m"))
    ? "lfm-encoder-230m"
    : DEFAULT_EMBEDDING_ID;
  return loadCachedProvider(id, onProgress);
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

/** Ranks candidate targets (skills, tools, commands, journal cards). */
export async function rank(
  query: string,
  targets: { id: string; text: string }[],
  opts: { opportunistic?: boolean } = {},
): Promise<Ranked[] | null> {
  const res = await rankTiered(query, targets, opts);
  return res?.ranked ?? null;
}
