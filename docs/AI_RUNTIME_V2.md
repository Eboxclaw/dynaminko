# AI Runtime V2 — Mobile-First Adaptive Inference & Harness

Status: proposed architecture
Target: Proof of Theses / Dynaminko PWA
Primary target: Android/iOS-class mobile browsers, with desktop benefiting from the same runtime

## Executive summary

The current runtime already has the right foundations: AI orchestration is isolated in a worker, wllama is the GGUF runtime, Transformers.js owns embeddings, OPFS/Cache API provide persistence, and runtime capability detection centralizes WebGPU/WASM selection.

The next step should **not** be a bigger fixed heuristic. Build an **Inference Broker** that treats every device/model/workload combination as a measured execution problem.

Core principle:

> Do not select WebGPU because WebGPU exists. Select the cheapest execution plan that is measured to be fastest and safe for the current device, model, context and workload.

The target architecture is:

```text
UI
 │
 ▼
Agent Worker
 │
 ├── state / skills / memory / tool registry
 ├── deterministic + semantic routing
 ├── Context Compiler
 │      └── only relevant tools, memories and entities
 │
 └── Inference Broker
        ├── model routing
        ├── backend routing
        ├── context budget
        ├── batch / threads
        ├── KV policy
        ├── thermal / health state
        └── benchmark history
               │
        ┌──────┼────────┐
        ▼      ▼        ▼
     WebGPU  WASM     Cloud
        │      │
        └── wllama ────┘
```

## Current strengths

- `src/lib/ai.ts` provides a single model registry and capability-to-model mapping.
- `src/workers/ai.worker.ts` keeps model lifecycle and chat completion away from the UI thread.
- `src/lib/ai/runtime.ts` centralizes capability detection and currently computes GPU layers, threads, batch, KV cache type and flash-attention policy.
- wllama 3.5.1 is already the inference dependency; Transformers.js is used for the encoder.
- Model weights are persisted through OPFS/Cache API and model loading is intentionally isolated from cache management.

## Problems to fix

### 1. WebGPU selection is deterministic instead of empirical

Current policy is effectively `WebGPU -> WASM`. A working WebGPU adapter does not prove that WebGPU has better decode latency than WASM SIMD on a phone.

### 2. VRAM is inferred too aggressively

`maxStorageBufferBindingSize` and `navigator.deviceMemory` are useful hints, but neither should be treated as actual model-available VRAM. Mobile GPUs share memory with the system and browser/runtime overhead is substantial.

### 3. Thread count is heuristic

`cores - 1` can oversubscribe mobile CPUs, increase thermal load and reduce sustained tokens/sec. The optimal thread count for a 350M model may be materially lower than the number of reported cores.

### 4. Batch size is static

`128` for mobile is a sensible starting point, but optimal batch depends on model, backend, context and device.

### 5. KV memory estimation is too model-weight-centric

KV memory should be derived from model architecture metadata: layers, KV heads, head dimension, context and KV dtype. Model weight size is not a reliable proxy.

### 6. Harness context can dominate inference

A small local model becomes much less useful if every call receives all skills, tools, memories and history. Retrieval/context compilation must happen before generation.

### 7. Model lifecycle should distinguish residency from loading

The current fresh-handle-per-load strategy is a valid stability workaround for wllama/Emscripten lifecycle issues. Do not turn that into frequent model churn. Add explicit HOT/WARM/COLD model residency policy.

### 8. Mobile thermal state is missing

Sustained inference can throttle a phone. The runtime needs to observe inference latency over time and automatically lower context, batch, threads or model size when performance collapses.

### 9. Harness overhead is not currently a first-class metric

Inference is only one part of an agent turn. Deterministic routing, semantic retrieval, tool execution, serialization and context compilation can consume a significant fraction of total mobile latency. The runtime must measure the complete path to useful action, not only model tok/s.

---

# Phase 0 — Mobile execution instrumentation

Before changing inference knobs, instrument the full turn pipeline. This is intentionally lightweight and must not itself become a hot-path dependency.

Measure, where applicable:

```text
startup
asset / worker initialization
deterministic routing
semantic routing
tool selection
tool execution
data hydration
evidence compilation
context compilation
model load
first token / prefill
decode
final answer
```

The master KPI is:

> **Time-to-useful-action** — elapsed time from user request to the first useful deterministic action or grounded model result.

Keep inference micro-metrics separately:

- first-token latency
- prefill tok/s
- decode tok/s
- completion latency
- prompt/context tokens

This instrumentation should exist before benchmark calibration so later measurements can distinguish an inference bottleneck from a harness bottleneck.

---

# Phase 1 — Mobile-safe runtime policy

Fix the current mobile thread conflict before collecting benchmark data.

Current behavior applies a desktop-oriented `cores - 1` policy to mobile. An 8-core mobile device can therefore receive 7 WASM threads, increasing contention and thermal load.

Use a conservative mobile cold-start policy:

```ts
function threadPolicy(cores: number | null, mobile: boolean): number {
  const c = cores ?? 4;
  if (mobile) {
    if (c <= 4) return 2;
    if (c <= 8) return c <= 6 ? 3 : 4;
    return Math.min(6, Math.floor(c / 2));
  }
  return Math.max(1, Math.min(c - 1, 12));
}
```

The desktop policy remains unchanged. After calibration, measured winners override this cold-start fallback.

Add focused tests for mobile and desktop curves at 4, 6, 8 and 12 reported cores.

This milestone must ship before benchmark calibration. Benchmark data collected under the old mobile thread policy should be considered invalid.

---

# Phase 2 — Memory Budget Model

Replace the semantic misuse of `vramGb` with a memory-budget concept such as:

```ts
memoryClassGb: number | null;
```

`navigator.deviceMemory` and adapter limits remain hints, not claims about actual free model memory. Until better telemetry exists, use a conservative estimate rather than treating total system RAM as available VRAM.

Add architecture-aware model memory estimation:

```text
weights
+ KV cache
+ temporary inference buffers
+ WebGPU buffers
+ runtime overhead
+ safety margin
= estimated peak
```

KV cache must be derived from model metadata:

```text
layers × KV heads × head dimension × context × KV dtype × K/V
```

Prefer q8_0 KV on mobile by default; allow f16 where measured performance and memory headroom justify it.

Treat the estimate as a **budget model**, not real available memory. Loading should have three outcomes:

```text
SAFE      → load normally
UNCERTAIN → conservative configuration / calibration
UNSAFE    → reject configuration before allocation
```

Observed successful loads and failures can later be used to refine the safety margin.

Add reference-value tests for at least one model at multiple context sizes.

---

# Phase 3 — Context Compiler + Workload Model

This phase may run in parallel with memory work and must happen before serious benchmark tuning because context changes prefill and KV pressure.

Create:

```text
src/lib/ai/contextCompiler.ts
```

The compiler turns an agent request into the smallest sufficient prompt:

```text
request
  ↓
intent / capability
  ↓
relevant skill
  ↓
relevant tools
  ↓
relevant memory
  ↓
relevant indexed entities
  ↓
compact evidence/context
  ↓
model
```

Never expose the complete tool registry to the 350M model unless required.

Example:

```text
50 registered tools
       ↓
semantic/tool router
       ↓
3 candidate tools
       ↓
350M
```

Reuse existing retrieval primitives where possible rather than creating duplicate indexing paths.

### WorkloadClass

Keep workload type distinct from capability:

```ts
export type WorkloadClass = "router" | "extract" | "assist" | "reason" | "vision";
```

The compiler should be able to produce a representative context profile for benchmarks, including short, normal and long-context workloads.

---

# Phase 4 — Benchmark harness

Create:

```text
src/lib/ai/benchmark.ts
src/lib/ai/benchmark-store.ts
```

Calibration runs only after the user opts into local inference or when a model is first loaded. Never benchmark on normal app startup.

### Microbenchmark

Measure the model/runtime itself:

1. WebGPU vs WASM.
2. Best backend → batch sweep: `32 → 64 → 128 → 256`.
3. WASM → bounded thread sweep using the mobile-safe policy.
4. Long-context workloads → flash attention on/off when supported.

Track prefill and decode separately.

### Harness benchmark

Also measure representative complete agent turns:

```text
request
 ↓
deterministic/semantic routing
 ↓
tool/data execution
 ↓
evidence/context compilation
 ↓
model prefill
 ↓
first token
 ↓
decode
 ↓
useful result
```

This prevents optimizing inference while ignoring a slower routing/context path.

Do not benchmark the full cross-product. Use staged search and stop when latency or memory regresses.

Persist results in IndexedDB keyed by a coarse device/runtime signature, model ID and runtime version. Do not collect identifying device information unnecessarily.

The benchmark result must distinguish:

```ts
{
  prefillTps: number;
  decodeTps: number;
  firstTokenMs: number;
  tokens: number;
  elapsedMs: number;
  peakMemoryEstimate?: number;
  backend: Backend;
  threads?: number;
  batch: number;
  flashAttn: boolean;
}
```

Add harness-level results for context size and total turn latency.

---

# Phase 5 — Inference Broker

Create:

```text
src/lib/ai/broker.ts
```

The broker answers one question:

> Given this workload, device, model and benchmark history, what execution configuration should I use?

It must not own skills, tools, retrieval or context construction.

```ts
export type InferenceWorkload = {
  capability: Capability;
  inputTokens?: number;
  expectedOutputTokens?: number;
  complexity?: "tiny" | "low" | "medium" | "high";
  requiresVision?: boolean;
  latencySensitive?: boolean;
  workloadClass?: WorkloadClass;
};

export type ExecutionPlan = {
  modelId: string;
  backend: "webgpu" | "wasm" | "cloud";
  context: number;
  threads?: number;
  batch: number;
  cacheK: "q8_0" | "f16";
  cacheV: "q8_0" | "f16";
  flashAttn: boolean;
  offloadKQV: boolean;
  reason: string;
  confidence: number;
};
```

If benchmark data exists, prefer the measured plan. Otherwise use the safe runtime/memory heuristics as a cold-start fallback.

Heuristic plans should carry lower confidence than benchmark-derived plans.

---

# Phase 6 — Model routing

Encode the model tiers already established by the project:

## 350M — local controller

Use for:

- intent classification
- tool selection
- parameter extraction
- structured extraction
- short grounded responses
- state transitions

## 1.2B — reasoning tier

Use for:

- trade interpretation
- multi-signal reasoning
- thesis consistency checks
- harder extraction

## 2.6B / cloud — escalation tier

Use for:

- deep reasoning
- large context
- complex generation
- low-confidence local tasks

Escalation is based on workload complexity and confidence, not device class alone.

Add model metadata such as:

```ts
preferredMobile: boolean;
maxMobileCtx: number;
minUsefulCtx: number;
```

The model registry remains the source of truth; do not create a second registry.

---

# Phase 7 — Model residency manager

Create:

```text
src/lib/ai/residency.ts
```

States:

```text
HOT   = currently loaded
WARM  = likely next model / retain if memory allows
COLD  = cached but unloaded
```

Target mobile state:

```text
350M → HOT
1.2B → COLD
2.6B → COLD/cloud
```

Promote 1.2B to WARM only when the memory budget shows sufficient headroom.

Preserve the current fresh wllama handle per load until lifecycle stability is proven. Residency should reduce unnecessary model churn rather than force handle reuse.

---

# Phase 8 — Thermal/performance governor

Create:

```text
src/lib/ai/governor.ts
```

Track rolling inference performance against a baseline. Use sustained decode degradation as the primary browser-compatible thermal/performance proxy rather than relying on unavailable or inconsistent browser thermal APIs.

Example:

```text
baseline: 52 tok/s
recent:   31 tok/s
ratio:    0.60
```

On sustained degradation:

1. reduce batch
2. reduce WASM threads
3. reduce context
4. downgrade 1.2B → 350M
5. switch WebGPU ↔ WASM only when benchmark history supports it
6. escalate to cloud when task importance and latency requirements justify it

Recover gradually. Do not flap back to the previous profile after one fast request.

---

# Phase 9 — Worker topology and streaming

Preserve the existing main-thread isolation and keep indexing/data work independent from inference where practical.

Target:

```text
Main UI
  │
  ▼
Agent Worker
  ├── routing
  ├── skills / tools
  ├── context compiler
  └── inference broker
          │
          ▼
    wllama inference worker
       ├── WebGPU
       └── WASM

Data/indexing worker remains independent.
```

Extend worker events beyond token/done to support:

```text
STATE
ROUTING
TOOL_INTENT
TOOL_START
TOOL_RESULT
TOKEN
DONE
ERROR
```

When a valid tool intent is emitted, deterministic work may begin immediately rather than waiting for full prose generation.

---

# Future — Native mobile agent layer

When Dynaminko eventually drives other mobile applications, prefer deterministic capabilities before GUI reasoning:

```text
1. deterministic local operation
2. native app capability / App Function / App Intent
3. accessibility / semantic UI tree
4. deterministic UI automation
5. screenshot/vision agent
6. human approval
```

Vision should remain a fallback because it is more expensive and less deterministic.

---

# Concrete file changes

## `src/lib/ai/runtime.ts`

Refactor:

- `vramGb` → memory budget semantics.
- mobile-safe thread policy.
- `computeGpuLayers()` → memory-budget aware decision.
- `buildInferenceProfile()` → accepts measured profile when available.
- `optimalBatch()` → cold-start fallback only.
- `recommendedCacheType()` → memory-budget based.
- `recommendFlashAttn()` → capability + benchmark aware.
- expose runtime version/signature for benchmark cache.

## `src/workers/ai.worker.ts`

Add broker integration, benchmark execution hooks, execution-plan telemetry, adaptive profile selection, residency/governor hooks and richer streaming events.

Preserve the fresh wllama handle-per-load safety behavior.

## `src/lib/ai.ts`

Keep the existing model registry and capability mappings. Add `WorkloadClass` and per-model mobile/context constraints without creating a second model registry.

## New files

```text
src/lib/ai/contextCompiler.ts
src/lib/ai/benchmark.ts
src/lib/ai/benchmark-store.ts
src/lib/ai/broker.ts
src/lib/ai/residency.ts
src/lib/ai/governor.ts
```

---

# Recommended implementation order

```text
P0
1. Instrument end-to-end mobile turn latency
2. Fix mobile-safe thread defaults
3. Implement memory budget model
4. Build Context Compiler + WorkloadClass

P1
5. Build micro + harness benchmark
6. Build Inference Broker
7. Encode 350M / 1.2B / 2.6B routing
8. Add adaptive batch/KV/attention policies

P2
9. Model residency
10. Thermal/performance governor
11. Rich streaming protocol
12. Worker topology refinements

P3
13. Native mobile capabilities
14. Cloud escalation refinement
15. Optional anonymous fleet-level calibration
```

Do not change batch/thread/WebGPU heuristics blindly before instrumentation and the mobile-safe baseline exist.

---

# Success metrics

Measure both runtime and harness performance:

- time-to-useful-action
- first-token latency
- sustained decode tok/s
- prefill tok/s
- total completion latency
- deterministic routing latency
- semantic routing latency
- tool-call latency
- context compilation latency
- prompt token count
- context tokens actually used
- model load time
- model switch frequency
- failed WebGPU initializations
- OOM/load failures
- fallback frequency
- sustained performance degradation

The most important mobile KPI is **time-to-useful-action**, not raw tokens/sec.

Example:

```text
User request
 ↓
router 40ms
 ↓
tool retrieval 5ms
 ↓
350M first token 180ms
 ↓
tool executes 60ms
 ↓
final 350M response 250ms

≈535ms to useful action
```

---

# Final architecture principle

Dynaminko should become an **adaptive local-first agent runtime**, not merely a browser LLM wrapper.

The winning loop is:

```text
UNDERSTAND TASK
      ↓
MINIMIZE CONTEXT
      ↓
SELECT WORKLOAD
      ↓
SELECT MODEL
      ↓
SELECT BACKEND
      ↓
SELECT EXECUTION PROFILE
      ↓
EXECUTE
      ↓
MEASURE
      ↓
UPDATE DEVICE PROFILE
      ↓
NEXT REQUEST IS BETTER
```

The runtime should optimize the entire mobile agent turn. WebGPU is not automatically the winner, more CPU threads are not automatically better, and a faster model is not automatically a faster agent. The system wins by minimizing unnecessary work first, then selecting the cheapest measured inference path capable of completing the task.
