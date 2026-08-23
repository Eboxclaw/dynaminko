# Routing

Routing uses deterministic syntax and aliases first, then ranks the shared capability catalogue with the loaded semantic encoder when available. Semantic scores are advisory. Execution still goes through command/tool policy and approval checks.

## Single encoder

One encoder does the ranking: all-MiniLM-L6-v2 (ONNX, 384-dim, ~90 MB), loaded in the browser and warm whenever resident. There is no second, heavier tier: the heavier LFM encoders were dropped from the router because they do not fit a light mobile client. The router ranks the shared capability catalogue with it; scores at or above 0.75 are strong. When no encoder is available the keyword fallback ranks and the turn carries on: the encoder is an accelerator, never a dependency.

## Hot encoder

Opening the console loads whatever encoder is already cached, in idle time. Once resident, the journal card pool prewarms (`prewarmRetrieval` via requestIdleCallback) so the first question hits warm vectors. Nothing downloads silently: with nothing cached, the first message shows a one-time chip offering the ~90 MB MiniLM install; the choice (install or not now) sticks in localStorage and never nags again. First-use cost stays flat: a fresh device answers instantly on the keyword fallback whether or not the chip is accepted.

## Vector cache

`src/lib/ai/embedding.ts` keeps an in-memory LRU (~2000 entries) keyed by `provider:text`. Only the query and never-seen target texts get embedded; everything else is a cache hit. A warm session drops routing and retrieval from ~201 embeds per turn (query plus the ~200-card journal pool) to 1 (the query). `rankTiered` reports `{hits, misses, ms, provider}` in its stats, surfaced in the `context.build` card, so cache behavior is observable per turn. The journal card pool can be prewarmed (`prewarmRetrieval`) so a session's first query already hits warm vectors. Embeddings stay derived data, never truth: a cleared cache changes nothing except speed.

This is the same idea as precomputed route embeddings in semantic-router style systems: route and target vectors are computed once and reused, only the live query is embedded per call.
