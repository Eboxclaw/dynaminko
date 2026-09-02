// Invariants of the embedding provider registry: which provider is the
// default, how the fallback differs, and the asymmetric prefix contract the
// rank path relies on.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_EMBEDDING_ID,
  EMBEDDING_PROVIDERS,
  FALLBACK_EMBEDDING_ID,
  PROVIDER_BY_ID,
  cosine,
} from "./embedding";

describe("embedding providers", () => {
  it("ships exactly the LFM embedder (default) and MiniLM (fallback)", () => {
    expect(EMBEDDING_PROVIDERS).toHaveLength(2);
    expect(PROVIDER_BY_ID[DEFAULT_EMBEDDING_ID].kind).toBe("wllama");
    expect(PROVIDER_BY_ID[DEFAULT_EMBEDDING_ID].tier).toBe("default");
    expect(PROVIDER_BY_ID[FALLBACK_EMBEDDING_ID].kind).toBe("transformers");
    expect(PROVIDER_BY_ID[FALLBACK_EMBEDDING_ID].tier).toBe("fallback");
  });

  it("the two providers never share a dimension: mixed vectors cannot rank", () => {
    const dims = new Set(EMBEDDING_PROVIDERS.map((p) => p.dimensions));
    expect(dims.size).toBe(EMBEDDING_PROVIDERS.length);
    // The LFM2.5-Embedding card value.
    expect(PROVIDER_BY_ID[DEFAULT_EMBEDDING_ID].dimensions).toBe(1024);
    expect(PROVIDER_BY_ID[FALLBACK_EMBEDDING_ID].dimensions).toBe(384);
  });

  it("only the asymmetric provider carries the query:/document: contract", () => {
    const lfm = PROVIDER_BY_ID[DEFAULT_EMBEDDING_ID];
    expect(lfm.asymmetric).toEqual({ query: "query: ", target: "document: " });
    expect(PROVIDER_BY_ID[FALLBACK_EMBEDDING_ID].asymmetric).toBeUndefined();
  });

  it("cosine scores unit vectors sanely across the 1024-dim space", () => {
    const a = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
    const b = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
    const c = Array.from({ length: 1024 }, (_, i) => (i === 1 ? 1 : 0));
    expect(cosine(a, b)).toBeCloseTo(1, 6);
    expect(cosine(a, c)).toBeCloseTo(0, 6);
  });
});
