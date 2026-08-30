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
 │
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

---

# Phase 1 — Inference Broker

Create:

```text
src/lib/ai/broker.ts
```

The broker accepts workload requirements and returns an execution plan.

```ts
export type InferenceWorkload = {
  capability: Capability;
  inputTokens?: number;
  expectedOutputTokens?: number;
  complexity?: "tiny" | "low" | "medium" | "high";
  requiresVision?: boolean;
  latencySensitive?: boolean;
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

The broker should be deterministic once benchmark data exists, with safe heuristics as the cold-start fallback.

---

# Phase 2 — Device calibration

Create:

```text
src/lib/ai/benchmark.ts
src/lib/ai/benchmark-store.ts
```

Do a short calibration only after the user opts into local inference or when a model is first loaded.

Test a representative prompt with:

- WebGPU, if available
- WASM SIMD
- CPU threads: 1, 2, 4, and only higher counts when useful
- batch: 32, 64, 128, optionally 256
- flash attention on/off when supported

Record separately:

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

Do not benchmark every combination. Use staged search:

1. WebGPU vs WASM.
2. Best backend → batch sweep.
3. WASM only → thread sweep.
4. Long-context workloads → flash/no-flash.

Persist results keyed by a coarse device/runtime signature, model ID and relevant runtime version. Avoid collecting identifying device information.

## Prefill vs decode

Treat them as different metrics. Agent interactions with short prompts are often decode/first-token sensitive, while indexing and long context are prefill-heavy.

Do not optimize a mobile profile using a single aggregate tokens/sec number.

---

# Phase 3 — Replace VRAM guessing with a memory budget

Modify:

```text
src/lib/ai/runtime.ts
```

Keep `deviceMemory` and adapter limits as hints, but rename their semantic role from `vramGb` to something like:

```ts
memoryClassGb: number | null;
```

Add a real model memory estimator using GGUF architecture metadata where available:

```text
weights
+ KV cache
+ temporary inference buffers
+ WebGPU buffers
+ runtime overhead
+ safety margin
```

The broker should reject a configuration before loading when its estimated peak exceeds the device budget.

For mobile, prefer q8_0 KV by default. Allow f16 only when calibration and memory budget show enough headroom.

---

# Phase 4 — Adaptive CPU policy

Modify `buildInferenceProfile()` so `n_threads` is not simply `cores - 1`.

Cold-start fallback:

```text
mobile + WASM:
  <=4 reported cores → 2 threads
  6-8 cores          → 3-4 threads
  >8 cores            → 4-6 threads

desktop:
  use benchmark winner, otherwise conservative cores-1
```

After calibration, always use the measured winner for that model/backend/workload.

Never assume more threads means faster decode.

---

# Phase 5 — Adaptive batch and attention policy

Replace static:

```text
mobile → 128
integrated → 256
discrete → 512
```

with safe starting values followed by measurement.

Suggested mobile search:

```text
32 → 64 → 128 → 256
```

Stop when latency/memory gets worse.

Flash attention should remain enabled for long-context workloads when supported, but its benefit should be benchmarked rather than assumed solely from `nCtx > 4096`.

---

# Phase 6 — Context Compiler

Create:

```text
src/lib/ai/contextCompiler.ts
```

The compiler turns an agent request into the smallest sufficient prompt.

```text
request
  ↓
intent / capability
  ↓
retrieve relevant skill
  ↓
retrieve relevant tools
  ↓
retrieve relevant memory
  ↓
retrieve relevant indexed entities
  ↓
compile compact context
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

Likewise, retrieve only the journal objects needed for the current task.

This should reduce both prompt latency and KV pressure.

---

# Phase 7 — Model routing

Change the role of the 350M model from "small general chatbot" to **local controller**.

## 350M

Use for:

- intent classification
- tool selection
- parameter extraction
- structured extraction
- short grounded responses
- state transitions

## 1.2B

Use for:

- trade interpretation
- multi-signal reasoning
- thesis consistency checks
- harder extraction

## 2.6B / cloud

Use for:

- deep reasoning
- large context
- complex generation
- tasks where local confidence is low

The router should escalate based on task complexity and confidence, not merely device capability.

---

# Phase 8 — Model residency manager

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

If memory is abundant, 1.2B can become WARM.

Keep the current fresh-handle-per-load safety behavior until wllama lifecycle stability is proven. The residency manager should reduce unnecessary loads rather than forcing handle reuse.

---

# Phase 9 — Thermal/performance governor

Create:

```text
src/lib/ai/governor.ts
```

Track rolling inference performance:

```text
cold → warm → hot → throttled
```

A practical signal is sustained decode degradation rather than attempting to rely on browser APIs that are unavailable or inconsistent across mobile platforms.

Example:

```text
baseline: 52 tok/s
recent:   31 tok/s
ratio:    0.60
```

If sustained degradation crosses a threshold:

1. reduce batch
2. reduce threads for WASM
3. reduce context
4. switch 1.2B → 350M
5. switch WebGPU ↔ WASM if benchmark data supports it
6. escalate to cloud when the task is important and latency is unacceptable

Recover gradually instead of immediately switching back after one fast request.

---

# Phase 10 — Worker topology

Target:

```text
Main UI Worker boundary
        │
        ▼
Agent Worker
  │
  ├── context / routing / tools
  │
  └── inference broker
          │
          ▼
    wllama inference worker
          │
          ├── WebGPU
          └── WASM pthreads

Data/indexing worker remains independent.
```

The critical rule is that indexing, wallet reads and inference should not compete for the same CPU execution budget unnecessarily.

The current AI worker already protects the main thread; preserve that boundary.

---

# Phase 11 — Streaming protocol

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

This lets the harness begin deterministic work as soon as the model emits a valid tool intent rather than waiting for a full prose response.

The UI then feels responsive even when local inference is slow.

---

# Phase 12 — Native tools before GUI reasoning

For a future mobile agent layer, use this priority:

```text
1. deterministic local operation
2. native app capability / App Function / App Intent
3. accessibility / semantic UI tree
4. deterministic UI automation
5. screenshot/vision agent
6. human approval
```

Vision should be the fallback because it is the most expensive and least deterministic path.

---

# Concrete file changes

## `src/lib/ai/runtime.ts`

Refactor:

- `vramGb` → memory class/budget semantics.
- `computeGpuLayers()` → safe memory-budget estimator.
- `buildInferenceProfile()` → accepts optional benchmark result.
- `optimalBatch()` → cold-start fallback only.
- `recommendedCacheType()` → memory-budget based.
- `recommendFlashAttn()` → capability + benchmark aware.
- `n_threads` → mobile-safe fallback + measured override.
- expose runtime version/signature for benchmark cache.

## `src/workers/ai.worker.ts`

Add:

- broker initialization
- benchmark execution
- execution-plan telemetry
- adaptive profile selection
- residency hooks
- governor hooks
- richer streaming events

Preserve the current fresh wllama handle per load until lifecycle stability is proven.

## `src/lib/ai.ts`

Keep:

- `MODEL_LIST`
- `CAPABILITY_MODELS`
- model metadata
- context persistence

Add:

```ts
export type WorkloadClass = "router" | "extract" | "assist" | "reason" | "vision";
```

and per-model constraints such as:

```ts
preferredMobile: boolean;
maxMobileCtx: number;
minUsefulCtx: number;
```

## New `src/lib/ai/benchmark.ts`

Owns microbenchmarks and result normalization.

## New `src/lib/ai/broker.ts`

Owns execution-plan selection.

## New `src/lib/ai/contextCompiler.ts`

Owns prompt/tool/memory minimization.

## New `src/lib/ai/residency.ts`

Owns HOT/WARM/COLD state.

## New `src/lib/ai/governor.ts`

Owns sustained-performance adaptation.

---

# Recommended implementation order

## P0 — Do now

1. Context Compiler
2. Inference Broker skeleton
3. Correct KV memory calculation
4. Mobile-safe thread defaults
5. Benchmark WebGPU vs WASM decode/prefill

## P1

6. Adaptive batch
7. benchmark cache in IndexedDB
8. model routing / 350M controller
9. richer worker streaming

## P2

10. model residency
11. thermal/performance governor
12. native mobile capability adapter

## P3

13. Android/iOS GUI fallback
14. cloud escalation
15. fleet-level anonymous benchmark aggregation if the product later needs population-level defaults

---

# Success metrics

The runtime should measure:

- first-token latency
- sustained decode tok/s
- prefill tok/s
- total completion latency
- tool-call latency
- prompt token count
- context tokens actually used
- model load time
- model switch frequency
- failed WebGPU initializations
- OOM/load failures
- fallback frequency
- thermal degradation proxy

The most important mobile KPI is **time-to-useful-action**, not raw tokens/sec.

For example:

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

That is more meaningful than advertising a high benchmark number while spending 1.5 seconds compiling a huge prompt.

---

# Final architecture principle

Dynaminko should become an **adaptive local-first agent runtime**, not merely a browser LLM wrapper.

The winning loop is:

```text
UNDERSTAND TASK
      ↓
MINIMIZE CONTEXT
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

This gives the PWA a genuine device-aware runtime: WebGPU when it is actually faster, WASM SIMD when it wins, cloud when local execution is inappropriate, and the smallest model/context/tool surface capable of completing the task.
