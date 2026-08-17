# Routing

Routing uses deterministic syntax and aliases first, then ranks the shared capability catalogue with the loaded semantic encoder when available. Semantic scores are advisory. Execution still goes through command/tool policy and approval checks.

## Encoder tiering

MiniLM (23 MB) embeds by default; the LFM 230M encoder escalates when the top score is below 0.55; scores at or above 0.75 are strong. When no encoder is available the keyword fallback ranks and the turn carries on: the encoder is an accelerator, never a dependency.

## Vector cache

`src/lib/ai/embedding.ts` keeps an in-memory LRU (~2000 entries) keyed by `provider:text`. Only the query and never-seen target texts get embedded; everything else is a cache hit. A warm session drops routing and retrieval from ~201 embeds per turn (query plus the ~200-card journal pool) to 1 (the query). `rankTiered` reports `{hits, misses, ms, provider}` in its stats, surfaced in the `context.build` card, so cache behavior is observable per turn. The journal card pool can be prewarmed (`prewarmRetrieval`) so a session's first query already hits warm vectors. Embeddings stay derived data, never truth: a cleared cache changes nothing except speed.

This is the same idea as precomputed route embeddings in semantic-router style systems: route and target vectors are computed once and reused, only the live query is embedded per call.
