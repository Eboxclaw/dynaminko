# Research survey · a light on-device agent via elegant system design

First pass 2026-09-11. The user asked for the latest NVIDIA and Google
research that can help deliver a light version of what dynaminko wants
to be (a local-first, tools-first trading journal agent on small
models) through more elegant system design rather than brute force.
Each entry: the claim, the mapping onto this repo, and the verdict
(adopt now, defer, or reference).

## NVIDIA · Small Language Models are the Future of Agentic AI
arXiv 2506.02153 (June 2025), NVIDIA Research (Belcak et al).
- Claim: agentic workloads exercise a narrow slice of what LLMs can do;
  small models tuned per scenario deliver the same agentic utility at
  10 to 30x lower cost, latency and hardware footprint. The paper
  sketches a migration path: study the agent's trajectories, distill
  the scenario-specific capability, deploy the SLM, and plan for the
  SLMs of the future to absorb more.
- Mapping: this repo already runs the thesis (LFM2.5-only roster,
  router and tools first, one answer call baseline). The adoptable
  idea is the distillation step: our deterministic router plus decide
  logs (window.__lastDecide, the agent log) are exactly the trajectory
  corpus the paper says to mine. Turning recurring decide patterns
  into more deterministic routes shrinks the model's job without a
  retrain.
- Verdict: adopt the method (mine decide logs, grow the deterministic
  table per domain); it composes with the Phase 2 decide A/B.

## Google · Gemma 3n: Per-Layer Embeddings and MatFormer (2025)
Google AI for Developers docs; MatFormer arXiv 2310.07707 (NeurIPS
2023); Gemma 4 technical report (2026) continues the lineage.
- Claim 1, PLE: per-layer embedding parameters are decoupled from the
  core model and cached off the accelerator, fetched only when their
  layer runs. RAM footprint decouples from parameter count (5B and 8B
  models run in 2 to 3GB).
- Claim 2, MatFormer: nested transformers give elastic sub-models for
  free; Mix-n-Match extracts custom sizes, and the small nested model
  serves as the speculative-decoding draft for the large one.
- Mapping: PLE is the same problem our budgetGuard solves (weights x2
  under WebGPU residency, the UNSAFE ledger on the 2.6B); a layer
  streaming or weight-offload design is the elegant version of the
  CPU-escape we do today, but wllama would have to expose it. MatFormer
  speculative decoding maps to our roster: the 230M/350M drafting for
  the 2.6B is the biggest decode-speed lever available, and it needs a
  draft-model API in the wasm runtime (same upstream dependency class
  as the F1 KV-reuse fix).
- Verdict: reference and upstream ask; defer implementation until the
  runtime exposes the hooks.

## RoPE position encoding · YaRN and Base of RoPE
YaRN arXiv 2309.00071; Base of RoPE Bounds Context Length (NeurIPS
2024); EleutherAI's position-interpolation walkthrough.
- Claim: the RoPE base bounds the usable context window; NTK-aware
  methods raise the base to extend it, and lower bases collapse
  long-range quality.
- Mapping: this governed the RoPE 5000 A/B (docs/rope-ab.md): the
  LFM2.5 family trains at rope_theta 1000000, so 5000 collapsed
  generation outright, exactly as the theory predicts. Any future
  window raise above 32k must move the base with NTK-by-parts or YaRN
  scaling, never pin it low.
- Verdict: adopted as the standing rule for window experiments; the
  ?ropeBase= pin stays as the instrument.

## Pending sweep (next session)
- KV prefix-caching and prompt-cache literature (the search timed out):
  RadixAttention/SGLang as the slot-reuse design reference, and
  llama.cpp server's slot semantics that wllama's OAI layer mimics.
  This is the upstream evidence base for the F1 fix (measured inert in
  docs/speed-research.md).
- NVIDIA and Google work on agent-harness distillation and test-time
  compute for small models, to feed the Phase 2 decide A/B design.

## Sources
- NVIDIA SLM-agents: https://research.nvidia.com/labs/lpr/slm-agents/
  and https://arxiv.org/pdf/2506.02153
- Gemma 3n overview: https://ai.google.dev/gemma/docs/gemma-3n
- MatFormer: https://arxiv.org/abs/2310.07707
- Gemma 3n developer guide:
  https://developers.googleblog.com/en/introducing-gemma-3n-developer-guide/
- YaRN: https://arxiv.org/html/2309.00071v3
- Base of RoPE Bounds Context Length:
  https://neurips.cc/virtual/2024/poster/96017
- EleutherAI on extending RoPE: https://blog.eleuther.ai/yarn/

## Hybrid-model learning material (Claude Code, 2026-09-11) · counter-research

Learning material from a parallel assistant, counter-researched against
this repo. Boundary first: the Petologic handover inside the same
material belongs to a DIFFERENT project (Koog plus LFM2.5 on Android
via llama.cpp bindings); none of its tasks enter dynaminko's plan.

1. Decoupled top-K distillation, cross-layer PEFT (LoRA on conv plus
   attention projections), difficulty-ordered curriculum, GRPO/DPO
   post-training: all training-time, offline, shipped as a GGUF.
   dynaminko runs inference only. Verdict: reference for a future
   offline effort.
2. RoPE isolated to attention layers, pre-RoPE statistics for token
   pruning, dynamic frequency scaling during a training tail:
   architecture-level or training-time. The frequency-scaling item
   independently confirms the RoPE 5000 inference-time verdict in
   docs/rope-ab.md. Verdict: reference.
3. Hybrid-layer KV asymmetry (70 to 80 percent recurrent or
   convolution layers, KV only on the GQA subset): ALREADY modeled
   here. ModelSpec carries kv.attnLayers per card (2.6B: 8 of 32;
   350M and 230M: 6 of 16) and kvCacheGb counts only those layers.
   Verdict: validated, no change.
4. q8_0 KV quantization of the residual cache: the one directly
   implementable item. kvCacheGb already documents q8_0 as the mobile
   preference, but recommendedCacheType hands 8GB integrated machines
   f16, so the runtime never engages it. Verdict: implement and A/B
   (see docs/kv-ab.md).
5. Training-free eviction (kvpress style) and recurrent-state
   streaming across chunks: the same runtime-hook class as the F1
   wllama limitation in docs/speed-research.md. Verdict: defer
   upstream alongside it. The modality-decoupling item validates the
   existing separate encoder lane.
