# Speed research · S8 workstream (encode/decode, devices, semantic paths)

First pass 2026-09-11, per the user request: faster loads, faster
answers on Android and Mac laptops, faster and more accurate semantic
memory and deterministic paths, encode/decode studied. Research first:
every candidate change below lands as its own commit with UI tests and
the PWA constraints (no new dependencies, browser-safe code only).

## Measured baseline (this machine, in-app browser, 2026-09-11)

- 350M: answer 5.5s at 77 to 79 tok/s; warm turn 4.8s; prompt ~3511t.
- 230M: answer 20.2s (slower than 350M, unexplained, see F5).
- 2.6B at 32128: ttft 4.3s, decode 88.2 tok/s, answer 5.9s.
- 2.6B at 131072 (before the 32k start): ttft 43.1s, 20.1 tok/s. The
  UNSAFE prediction escaped to CPU-side prefill; the lighter window
  kept it on WebGPU. Load weight IS speed.
- /usage dev line: `threads 1/1`, `crossOriginIsolated no`,
  `cache f16/f16`, `cache-reuse: miss (full prefill)` on every turn.

## S8b encode/decode speed

F1 · Cross-completion KV reuse is INERT in the current wllama build,
measured 2026-09-11. A back-to-back identical prompt (common prefix
near 100 percent by construction: same head, same history, same
question) still ran full prefill: ttft 3573ms on a 3336t prompt,
1.07ms per token, exactly the full-prefill rate; the /usage heuristic
reported `prefix reuse: miss`. Theory said otherwise: the compiled
head is prefix-ordered by design (CORE, MEMORY, CAPABILITIES stable;
PORTFOLIO volatile at the tail), prewarm parks a strict byte prefix,
and cache_prompt plus n_cache_reuse ride every completion. Static
interrogation of the wllama package ended at the prebuilt wasm (the
npm cpp sources contain no cache_prompt or n_past handling), and no
KV-state API is exposed on the Wllama class. Consequences: the
decide-to-answer shared-head prefix buys nothing today, the idle
prewarm's KV park does not materialize (its recorded 3.4x on the 2.6B
was model-load warm-up, not cache), and the F1 reorder idea is moot
until reuse works at all. The fix lives upstream or below wllama's
OAI-compat layer: instrument the worker's completion path with token
counts from the native side (llama.cpp reports n_past per decode), or
patch the wasm glue, or move the answer path to a lower-level
completion API that retains n_past. Flagged for a dedicated session;
not guess-patchable from the app.

F2 · RESOLVED as a harness property, not an app gap. Interrogation
(2026-09-11): vite.config.ts already serves `Cross-Origin-Opener-Policy:
same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, confirmed
on the wire with curl (both the 307 and the 200 carry them), and the
config dates back to commit 564aec6. The ZCode in-app browser is an
Electron 146 guest that still reports `crossOriginIsolated: false` with
no SharedArrayBuffer, so the dev IAB cannot exercise wllama's pthread
path regardless of our headers. Consequence: thread-count claims must be
measured on the deployed Vercel origin (which serves the same headers)
in a real Chrome, riding the Phase 6 phone-pass protocol. The 10ms/t
prefill numbers from the handover notes were taken in this non-isolated
harness, so multi-thread wasm remains an unmeasured lever, not a spent
one.

F3 · KV dtype. The ledger shows `cache f16/f16`; q8_0 KV halves the
cache (64K about 0.57GB per the ai.ts ladder comment) with a small
quality cost. On 8GB devices a q8 KV turns the 2.6B's UNCERTAIN 4.73GB
into a comfortable SAFE and makes 65k windows realistic. Candidate:
per-device default with a panel toggle, measured against the answer
quality suite. Effort: medium.

F4 · Prefill budget. Prefill cost is prompt-length bound (~10ms/t
single-thread 2.6B IAB). The sheds (buildTurn shed levels) already
bound the prompt; the next lever after F1 is shedding the CAPABILITIES
book for turns that route deterministically (the command path never
consults it). Effort: small, measure carefully.

F5 · Open question: the 230M answered slower than the 350M (20.2s vs
8.1s). Suspects: gpu layer count per card, batch size, quant. Measure
per-card layers and decode on identical prompts before touching
anything (Phase 2's A/B harness can carry this).

F10 · Encoder lane stall caught once: a turn logged `semantic
29420ms` against the usual 8 to 350ms. The embed RPC's 25s race plus
handle drop and reload is the suspected path (the encoder was idle
through several model switches that turn). Resilience telemetry for
the embed lane belongs in S8d.

## S8c device speed (Android and Mac laptop)

Mac laptop:
- Cross-origin isolation is already configured app-side; whether the
  multi-thread wasm path engages must be measured on the deployed
  origin in real Chrome (see F2). WebGPU (metal-3) already carries the
  hot path at 32k.
- The budget escape ordering matters more than raw speed: SAFE windows
  keep full WebGPU residency (proven by the 2.6B numbers above); the
  panel's window picker should show the budget verdict live so users
  understand why 65k is slower than 32k on their machine.

Android (Chrome Android, WebGPU 121+; full protocol stays in Phase 6):
- `deviceProfile().mobile` already exists for gating; the 8GB-class
  envelope math matches mid-range Android.
- Thermal: sustained decode drops after minutes; the Phase 6 3x thermal
  series should be run at 32k (lighter) to compare.
- Batch size 256 and flash-attn are load-time knobs; sweep them on
  Android before changing defaults.

## S8d semantic memory, deterministic paths, parsing

Current shape: deterministic alias routing on normalized text (f0cf654),
encoder semantic route at 0.75 STRONG, capability keyword stage at 0.35,
2-target intent classify, retrieval top-6 with a receipt filter.

F6 · Catalogue embedding cache: confirm rank() caches the catalogue's
document embeddings per session (capabilitySearchText strings are
static). If they re-embed per call, cache them in the encoder slot.
Semantic stage measured 146 to 350ms, so the ceiling here is small but
free. Effort: small.

F7 · Deterministic coverage as a grammar, not alias lists: the
portfolio-status domain (f0cf654) normalizes then matches. The next
accuracy step is one canonical table per domain (status, holdings,
inbox, review) shared by route.ts and the catalogue aliases, so new
phrasings land in one place with one test. Prevents route.ts and
catalogue.ts drifting (they currently must be kept in step by comment).

F8 · Parsing costs are already trivial (regex, sub-ms); do not spend
here. The accuracy lever is the decide prompt and the parse fixtures
(wire-fixtures.ts), covered by Phase 2's A/B rather than this
workstream.

F9 · Semantic memory (session notes, memory.read): same tiered
embedder can index notes once on write instead of on read. Notes are
tiny today (0/2200 chars) so this is a scale preparation, not a
current bottleneck.

## Ranked next steps

1. F1 upstream-bound: instrument or patch wllama's completion path for
   real n_past reuse (dedicated session; biggest lever once it lands).
2. F5 230M anomaly measurement (rides Phase 2).
3. F3 q8 KV option with the quality suite (medium).
4. F6/F7 semantic caching and the domain grammar table (small, accuracy).
5. F10 embed-lane resilience telemetry (small).
