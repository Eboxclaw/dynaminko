# Agents console, local AI runtime, and dashboard alignment

Built on what already exists (`src/lib/ai.ts`, `src/lib/ai/encoder.ts`, `src/hooks/useAi.ts`, `src/lib/chat/*`, `src/lib/tools/*`, `src/lib/skills/*`, `ModelPanel.tsx`). Nothing is rewritten for cleanliness; changes are additive or targeted.

Verified before planning: `public/wasm/wllama.wasm` exists (7.6 MB, single binary only), the model registry has the four LFM 2.5 entries with correct repos/quants, `MAX_CONTEXT_MESSAGES = 5` already exists, the encoder picks its backend from a bare `"gpu" in navigator` check, and generation currently has no backend reporting.

## Phase 1 — Runtime: WebGPU first, WASM SIMD fallback

New `src/lib/ai/runtime.ts` as the single capability source:
- Detects WebGPU by actually requesting an adapter and device (not `"gpu" in navigator`), WASM SIMD via a validation probe, WASM threads, `crossOriginIsolated`, device memory, cores, and coarse-pointer/touch mobile signals. Reuses the existing probe in `src/lib/capabilities.ts` instead of duplicating it.
- Exposes `selectBackend()`: WebGPU → WASM SIMD → unavailable, with automatic fallback when WebGPU initialisation throws.
- `src/lib/ai.ts` and `src/lib/ai/encoder.ts` both read from it; the encoder's inline device check is removed.
- Wllama is created with the multi-threaded binary only when cross-origin isolated, single-threaded otherwise. If the extra binaries are not present in `public/wasm/`, the single binary stays the only option and the UI says so rather than pointing at a missing file.
- Model registry gains `backend: { preferred, fallback }` metadata; no config is duplicated elsewhere.
- Actual selected backend and measured tok/s (generated tokens / elapsed generation time) are surfaced through `useAi` and shown in the console header: `LFM 2.5 1.2B · WebGPU · ctx 2.1k/8k · 43.2 tok/s`.
- Mobile-first recommendation order becomes 1.2B on capable devices, 450M VL as the lightweight fallback, 2.6B never auto-recommended on phones. Only one generative model resident: switching unloads the previous one first.
- Model states stay six-valued but become accurate: `downloaded` only when the wllama cache actually holds the weights, `required` when it does not, resume rather than restart for partial downloads.
- A collapsible "Runtime diagnostics" block (WebGPU, WASM SIMD, threads, isolation, memory, cores, selected backend) lives under the model panel, collapsed by default on mobile.

## Phase 2 — Encoder optional but recommended

- The encoder is never required to chat. When it is not downloaded or fails, routing falls back to the existing deterministic keyword pass in `src/lib/chat/route.ts` and the console shows a quiet "semantic search off — download the encoder" hint instead of an error.
- Fix the current failure: load it through the shared runtime detector, cache-check before fetching, surface the real error message, and add an explicit download button with progress.
- Every model row (encoder included) shows state: needs download / downloading %/ on device / loaded / unloaded / error, with Download, Load, Unload actions.

## Phase 3 — Models: Local and Cloud sub-tabs

- `Models` splits into `Local` (current GGUF + encoder panel) and `Cloud`.
- Cloud providers use the OpenAI-compatible chat-completions shape with a configurable base URL and key: Codex/OpenAI, OpenRouter, Engy, Claude Code, Kimi Code. Each entry is base URL + key + model id + enabled flag.
- Keys are stored locally in the existing settings store (browser-first, no server, never bundled). The app makes the request directly from the browser; a provider that blocks browser CORS is marked as such in the row rather than failing silently.
- One active generation target at a time: either a local model or a cloud model. The chat header shows which is active, and cloud rows carry an explicit "leaves this device" marker so the local-first contract stays visible.

## Phase 4 — Agents chat: deterministic cards, approval, trace

- Before running anything, the console renders a **plan card**: the chosen tool or skill, why it was chosen (keyword match, encoder score, or explicit slash command), the inputs, and its access level.
- READ/COMPUTE run immediately. WRITE/EDIT/DELETE/EXECUTE/EXTERNAL stop and render an approval prompt with the exact intended change; nothing executes until approved, and every one is written to the existing agent log.
- A collapsible **trace** under each answer lists each tool call with input, output shape, duration, and whether a model was used. When no model ran, it says so explicitly.

## Phase 5 — Slash autocomplete and searchable help

- Typing `/` opens an inline autocomplete derived from the actual command registry (`src/lib/chat/commands.ts`) plus live tools and skills — never model-generated. Keyboard navigation, fuzzy filter, arguments hinted.
- `/help` opens a searchable panel listing commands, tool groups with access levels, and skills with their purpose, filtered as you type. Selecting an entry inserts the command.

## Phase 6 — Journal and thesis context in the session

- A lazy local vector index (`id, type, embedding, createdAt, updatedAt`) in IndexedDB alongside the existing store. Embeddings are generated on demand, never on startup, and are not the source of truth.
- Retrieval path: deterministic filter → metadata narrowing → encoder similarity → top 5–10 compact records. The full journal is never sent to a model.
- `@` references theses and journal entries inline; questions like "what did I write about ETH last month" resolve through tools with no generative call.
- Model context stays capped at the last 5 session messages plus retrieved records. Older sessions remain browsable but never enter context.

## Phase 7 — Dashboard alignment

Presentation only: dashboard cards, including the Liquid fetch surfaces, share one centred max-width column with consistent gutters, and skeleton/loading states occupy the same footprint as their loaded content so nothing shifts on arrival.

## Roadmap

`ROADMAP.md` gains the local AI runtime work as sequenced items (runtime detection and backend selection, accurate cache states, cloud providers, retrieval index) with the acceptance criteria condensed to a checklist.

## Notes

- No inference server, no MCP, no second AI architecture; wllama and Transformers.js stay.
- Cross-origin isolation headers are only added if they can be set without breaking the PWA; threads remain an optimisation, not a dependency.
- The service worker keeps caching the app shell only — model weights are managed separately.
