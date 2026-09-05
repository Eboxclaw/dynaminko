# Engineering Principles

| Principle    | Rule                                     |
| ------------ | ---------------------------------------- |
| Architecture | Browser-first, local-first               |
| Dependencies | Prefer zero/minimal dependencies         |
| Data Flow    | Zero-copy where possible                 |
| Concurrency  | Async and worker-based where useful      |
| Performance  | Measure before optimizing                |
| Packages     | Small, composable, single responsibility |
| WASM         | Only for CPU-intensive workloads         |
| Browser APIs | Prefer native APIs over libraries        |

## Browser Philosophy

The browser is the OS. Prefer native capabilities before adding dependencies.

| Native API       | Purpose                |
| ---------------- | ---------------------- |
| Web Workers      | Parallelism            |
| Streams          | Incremental processing |
| Web Crypto       | Cryptography           |
| IndexedDB        | Metadata               |
| OPFS             | Persistent files       |
| Cache API        | Assets & model caching |
| BroadcastChannel | Cross-tab messaging    |
| WebGPU           | AI & compute           |
| WebSockets       | Realtime communication |

## Workers

```text
React UI
   │
Typed Message Bus
   │
Market / AI / Storage / Risk / Notification workers
```

| Worker       | Responsibility       |
| ------------ | -------------------- |
| Market       | Market feeds         |
| AI           | LLM, embeddings      |
| Storage      | Persistence & crypto |
| Risk         | Calculations         |
| Notification | Alerts               |

## WASM

```text
TypeScript
│
High-level orchestration
│
WebAssembly
│
GPU or CPU-intensive work
```

## Data

Never serialize large binary data between workers when a lower-copy representation is available.

```text
SharedArrayBuffer
↓
ArrayBuffer
↓
Uint8Array
↓
JSON (network / small structured messages only)
```

## Async Model

Everything should be non-blocking from the UI's point of view.

Prefer workers, streams, promises, incremental rendering, and streaming inference. Avoid synchronous heavy work on the main thread.

## Lazy Loading

```text
App Shell
↓
UI
↓
User Action
↓
Download Model
↓
Warm Model
```

Never block startup on AI models.

## TypeScript Responsibilities

TypeScript owns UI, routing, Browser APIs, workers, state, networking, service workers, PWA lifecycle, and orchestration.

## WebAssembly Responsibilities

WASM owns cryptography, parsing, SIMD workloads, compression, tokenization, numerical algorithms, and other measured performance-critical work.

## Internal Communication

| Use | Format |
| --- | --- |
| Network | JSON |
| Workers | Typed messages |
| Binary | Uint8Array / ArrayBuffer |
| Shared data | SharedArrayBuffer when isolation permits |
| Serialization | MessagePack only when measurement justifies it |

## Optimization Priorities

1. Do less work.
2. Move less data.
3. Avoid unnecessary model calls.
4. Avoid blocking the UI.
5. Reduce allocations and copies.
6. Reuse stable prompt/KV prefixes when it demonstrably helps.
7. Stream instead of buffering.
8. Lazy-load heavy resources.
9. Benchmark before introducing another runtime, model, cache, or abstraction.

# Agent Architecture — deterministic evidence, model-owned conversation

**Permanent principle:** `Extract → Parse → Index → Calculate → Retrieve → Reason/Synthesise`.

The important distinction is between **acquiring an answer's evidence** and **speaking the answer**.

| Layer | Responsibility | Model? |
| --- | --- | --- |
| Tool | Deterministic read, parse, index, filter, calculate, format, RPC or mutation primitive | Never |
| Skill | Orchestrates deterministic tools and produces compact evidence | Only when synthesis/reasoning is part of the skill |
| Router | Chooses or pre-runs the cheapest useful evidence source | Never generates the user-facing conversational answer |
| Agent / AI | Natural-language response, reasoning, interpretation, synthesis and planning | Yes when a model is available and the user is conversing with the assistant |

## Harness invariants

These rules are architectural, not suggestions.

1. **Routers do not replace assistant answers.** Deterministic or semantic routing may pre-run a READ/COMPUTE capability so the model does not have to discover/call it, but a natural-language assistant turn still reaches the answering model when one is available.
2. **Explicit command UX may be terminal.** `/run`, `/tool`, deterministic setup/approval wizards, and other explicitly command-like surfaces may return their deterministic result without an LLM. Do not apply that shortcut to ordinary natural-language questions.
3. **One routing pass per user turn.** Compute a routing/evidence plan once and pass it downstream. Do not independently re-classify the same query in deterministic routing, semantic routing, retrieval, capability selection, intent classification, and model planning when one result can be reused.
4. **One answer model call is the baseline.** A grounded local turn should normally be: route → gather compact evidence → build prompt → answer. A model-decide call is justified only when the harness genuinely cannot determine which evidence source is needed.
5. **A hop exists only to fill missing evidence.** Never call a tool the harness already ran, never re-decide a deterministic match, and never spend a hop merely to confirm information already in FACTS, PORTFOLIO, observations, or retrieved records.
6. **Embeddings are an optional accelerator.** The app must behave correctly and naturally with no embedding model downloaded. A resident encoder may improve ambiguous routing/retrieval; its absence is a normal zero-cost state, not an error mode and not a reason to change answer semantics.
7. **Small models get sparse context.** The 230M/350M lane should see compact facts, selected capability detail, relevant history, and bounded observations—not the application ontology merely because it fits in the context window.
8. **Context capacity is not a target.** A 32K model does not need a 32K prompt. Minimise prefill first; use long context when the user's task actually requires it.
9. **Prefix/KV reuse is an optimization after call elimination.** Preserve stable prefixes where useful, but do not add extra decide/prewarm calls solely to exploit a cache.
10. **Idle work must yield to the user.** Prewarm, indexing, and encoder work are opportunistic. Once a user submits a turn, background AI work must not compete with or block that turn.
11. **Generation ownership is explicit.** Only one local generation owns a wllama completion stream at a time unless the runtime explicitly supports safe parallel slots. Token/done/error events must be correlated to that generation; timeout/cancel must not leave a stale run producing events into the next turn.
12. **Measure complete turn economics.** Track routing time, evidence time, number of encoder calls, number of model calls, prompt tokens/prefill, TTFT, decode rate, total answer time, and repeated/avoided calls. A faster substage is not a win if the turn does more stages.

## Small-model performance target

For common grounded questions on the 230M/350M path, prefer this shape:

```text
USER
  ↓
cheap deterministic match / structured query
  ↓                 ↘ no confident match
pre-run bounded read   optional resident semantic rank
  ↓                     ↓
compact evidence ───────┘
  ↓
ONE prompt build
  ↓
ONE answering generation
  ↓
optional bounded follow-up hop only if evidence is still missing
```

Avoid this shape unless measurement proves every stage is necessary:

```text
deterministic route
→ semantic route
→ retrieval rank
→ capability rank
→ intent rank
→ model decide
→ tool
→ model answer
```

## Model/runtime changes

- Treat published model metadata as source data: layer count, supported context, attention/KV geometry, quant, and recommended generation parameters must be verified against the current model card/config before changing runtime math.
- Do not infer free VRAM from unrelated WebGPU API limits. Unknown capacity is `unknown`; use conservative loading and measured fallback.
- Backend availability is not backend performance. WebGPU, WASM SIMD, threads, batch size, KV dtype, flash attention, and GPU offload should be selected from measured device/runtime evidence where possible.
- A new optimization needs an A/B switch or benchmark fixture until it is proven on representative desktop and mobile devices.
- Keep known-good baselines. When the 350M regresses, compare call count, prompt shape, TTFT, and output quality against a previously measured commit before adding another compensating layer.

# Engineering workflow for agents

## Source of truth order

1. **Current code and tests**
2. Runtime measurements / captured traces
3. Upstream dependency and model documentation
4. Repo docs
5. Historical plans / comments

Docs describe intent but may be stale, partially implemented, or superseded. Never implement a doc promise before confirming the current code path.

## Repo audit workflow

When auditing or changing the repository:

1. Map folders and runtime entry points before editing.
2. Trace the real call path end-to-end.
3. Read tests beside the implementation.
4. Inspect recent commits when behavior reportedly regressed; use a known-good commit as a comparison baseline.
5. State assumptions separately from verified facts.
6. Prefer the smallest coherent change that removes work or fixes ownership.
7. Add a regression test for every concrete bug.
8. Run typecheck/tests/build before proposing merge.
9. Review docs only after code behavior is understood; list code↔docs discrepancies rather than silently making code match stale prose.
10. Challenge proposed changes—including user suggestions—when measurements or architecture disagree.

## Tools, skills and mutations

- A model never scans the journal card by card. Tools/indexes filter and compute; the model receives compact structured evidence.
- Every tool declares an access level. Approval and logging follow from it:
  - `READ` / `COMPUTE`: no approval, optional log.
  - `WRITE` / `EDIT`: approval when appropriate, always logged.
  - `DELETE` / `EXECUTE` / `EXTERNAL`: explicit approval, always logged.
- Mutations stop before execution and present the intended action (tool, target, changes) for approval.
- Do not silently download AI models or encoders as a prerequisite for ordinary app behavior.

Registries: `src/lib/tools/registry.ts`, `src/lib/skills/registry.ts`.
Docs: `docs/tools/*.md`, `docs/skills/*.md`. `node scripts/check-docs.mjs` checks registered groups/skills against documentation.
