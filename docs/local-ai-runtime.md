# Local AI runtime — WebGPU first, WASM SIMD fallback

One runtime, one abstraction. Everything below extends what already exists; no
second AI architecture.

## Layers

| Layer | File | Responsibility |
| --- | --- | --- |
| Capability probe | `src/lib/ai/runtime.ts` | WebGPU adapter, WASM SIMD/threads, isolation, RAM, cores. Cached, probed once. |
| Generative runtime | `src/lib/ai.ts` | wllama / llama.cpp. Model registry, load, chat, backend reporting. |
| Encoder (optional) | `src/lib/ai/encoder.ts` | Transformers.js embeddings for routing and retrieval. Never required. |
| Cloud (optional) | `src/lib/ai/cloud.ts` | OpenAI-compatible endpoints. Off by default, keys local. |
| Retrieval | `src/lib/ai/retrieval.ts` | Deterministic filter → optional encoder rank → ≤8 records. |
| Console | `src/routes/agents.tsx` | Sessions, slash commands, plan/approval/trace cards, help, `@` references. |

## Backend selection

1. Probe WebGPU: request an adapter *and* a device. An adapter that never
   yields a device counts as broken, not present.
2. WebGPU present → load with all layers offloaded (`n_gpu_layers: 99999`).
3. Load throws → retry once on WASM with zero GPU layers.
4. No WebGPU → WASM SIMD. Threads only when the page is cross-origin isolated.
5. `activeBackend()` reports what actually ran. The UI never guesses.

## Model policy (LFM 2.5 family, GGUF, Q4_K_M)

| Device | Recommendation |
| --- | --- |
| ≥ 8 GB reported, desktop | LFM2.5 1.2B Instruct |
| 4–8 GB, or touch device | LFM2.5 450M VL |
| unknown memory | 450M VL until probed |
| 2.6B | manual choice only, never auto-recommended on mobile |

Rules: one generative model resident at a time; unload before switching;
downloads are explicit or triggered by the user's own chat turn; weights are
cached by the browser and reused offline.

## States the UI must distinguish

`required` · `downloading` · `downloaded` · `ready` · `unavailable` · `error`,
each with the backend when running. The encoder carries its own state and is
labelled *optional, recommended*.

## Roadmap

- [x] Central capability probe with WebGPU device verification
- [x] WebGPU load path with verified WASM fallback and reported backend
- [x] RAM-aware, mobile-first recommendation; SSR-safe device probe
- [x] Optional encoder — routing degrades to keywords when absent
- [x] Cloud tab: OpenAI, OpenRouter, Engy, Claude Code, Kimi Code
- [x] Retrieval over journal + theses, capped and deterministic-first
- [x] Slash autocomplete, searchable help, `@` references to entries and theses
- [ ] Move generation into a dedicated worker so long turns never touch the main thread
- [ ] Persist per-session KV cache reuse between turns
- [ ] Encoder-backed embedding cache in IndexedDB, invalidated per record
- [ ] Cross-origin isolation headers to unlock WASM threads on the published site
- [ ] Vision turns for chart screenshots through the VL models
