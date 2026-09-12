# Decide view A/B · head vs lean · first rung (350M)

Run 2026-09-11, dev server localhost:8080, fresh sessions per arm,
model freshly reinstalled through the app UI after the cache wipe.
Question (identical both arms): `what do you think about my current
setup?` — a pure-decide question with no deterministic route.

Pin: #decideView=head|lean. HEAD = compiled shared head opens the
decide system turn (prefix-shared with the answer). LEAN =
DECIDE_SYSTEM alone with facts and portfolio riding the user turn
beside the menu.

## 350M results

HEAD arm: 3 decide attempts.
1. journal.search, query = the verbatim question, limit 5
2. journal.search, query = the tool's own purpose text, limit (none)
3. journal.search, query = the verbatim question again, limit 3
Tool choice defensible; argument quality poor (question and tool
description pasted as search terms); repeat attempts burned hops.

LEAN arm: 2 decide attempts.
1. signal.coverage, query = `how many extracted trades have been
   answered`, why = none
2. signal.coverage, query = `signal.coverage (ok)` (echoed the
   observation summary), limit 4
Fewer hops; the first query was a real search term rather than pasted
text; the tool choice for this question is debatable either way.

## Read

- Both arms complete the turn; no crashes; the instrumentation
  (window.__lastDecide: view, per-hop raws) works as designed.
- LEAN trended better on attempt count and argument hygiene on this
  one question, but one question is not a measurement. No default
  change is justified yet.
- At 350M the recurring weakness is argument quality, not tool
  selection: the model pastes the question or tool text as the query.
  The search-input rule rejects the worst cases; the structural fix
  (per the NVIDIA SLM-agents method) is mining these logged raws into
  more deterministic routes.

## 230M pass

Downloaded through the app UI (0.15GB) and run through the same two
arms with the same question.

- HEAD arm: 2 decide attempts, both journal.search with the tool's
  purpose text pasted as the query (identical repeats).
- LEAN arm: 2 decide attempts, same shape — purpose text as query.
- Read: at 230M there is no head/lean difference; the model pastes the
  tool description verbatim in both views. Argument quality, not view
  placement, is the 230M's ceiling.

## F5 anomaly numbers (230M vs 350M, identical settings)

- 230M: prefill 4.6ms/token (ttft 13844ms on 2994t), decode
  72.7 tok/s, gpu layers 14 (its full count per the profile).
- 350M: prefill about 1.1ms/token, decode 77 to 88 tok/s, full layers.
- The anomaly is PREFILL only: the 230M decodes at 350M-class speed
  but prefills about 4x slower per token on this WebGPU stack, with
  full GPU placement confirmed. That is a model/runtime characteristic
  (tensor shapes and the QAD quant against the wasm WebGPU kernels),
  not a placement bug: the profile loads every layer for both.
- Practical rule (already standing): the 350M is the default for
  anything with a long prompt; the 230M suits short-prompt, decode
  bound turns. Budget for the 230M: SAFE 1.25GB, f16 KV after the
  dtype revert.

## Learning loop closed live (bd0a4cb)

The measured paste-forms became rejection rules, and the rule's
enforcement landed in the hop loop (the recovered commit had shipped
the function and its import without ever calling it). Live
verification on the 230M: the same question now runs decide, the
pasted-description query is rejected before execution (no
journal.search card renders), the structured observation is pushed,
and the rejected pick occupies the same-tool cap so the identical
re-pick is caught by the repeat guard. The turn completes with a
FACTS-only answer instead of junk search results.
