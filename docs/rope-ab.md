# RoPE 5000 A/B · the user's lighter-footprint bet, tested

Run 2026-09-11, in-app browser, dev server localhost:8081, commit
59885d3 (the ?ropeBase= pin). The user asked to test activating RoPE
base 5000 (not for Qwen), expecting a small impact on the agents'
behavior.

## What the pin does

?ropeBase=N threads `rope_freq_base` into wllama's load params (the
same load-time surface as the forceFa and forceBudget pins). The Qwen
distill is excluded in the worker itself: its rope scheme is part of
its distillation and is never overridden. /usage prints the effective
base so a comparison run is honest about which position encoding
produced its numbers.

## Baseline arm (pin off, rope base card)

- 350M, ctx 32128, WebGPU: portfolio status prompt answered fully
  ("Your portefolio is currently concentrated in the Memes basket..."),
  advice prompt answered via the router-deterministic hop 1 with the
  model keeping the floor: answer 7188ms, ttft 5122ms, 84.3 tok/s.
- Ledger: `rope base card`.

## Rope arm (?ropeBase=5000)

- Ledger honestly shows `rope base 5000`.
- 350M, same prompts: the turn ran (route deterministic, command 50ms,
  prefill 8.8s) but generation produced ZERO answer tokens. The
  harness's honest-failure wording rendered instead: "I gathered the
  data but could not compose the full answer."
- Retried with the second prompt: same failure, and the decide hop
  picked no tool either ("no tool chosen" on decide 2/5).

## Why: the model's trained base is 1,000,000

LiquidAI's config for LFM2.5-350M sets rope_theta = 1000000 with
max_position_embeddings = 128000 (verified in the upstream config.json).
Forcing 5000 is a 200x reduction in the position-encoding base.
"Base of RoPE Bounds Context Length" (NeurIPS 2024) shows the rope base
bounds the usable context: with theta 5000 and no rescaling, the usable
window collapses far below our 32128, and relative-position quality
degrades with it. Prefill still completes; generation collapses. The
measured result matches the theory exactly.

## Verdict

REJECTED for the LFM2.5 family at base 5000: the impact is not small,
it is total generation failure, because the gap to the trained base is
200x. The user's lighter-footprint instinct points at a real knob, but
the only safe experiments are bases near the trained one (for example
500000) or proper context-extension methods (YaRN-style scaling), and
the expected win is footprint-neutral anyway: rope base does not shrink
KV or weights. The ?ropeBase= pin stays in the tree as a dev instrument
for such near-base experiments. The Qwen exclusion stands.

Inference-only note: rope base shapes position encoding at inference.
This app fine-tunes nothing, so there is no learning curve to affect;
we scored generation behavior instead.
