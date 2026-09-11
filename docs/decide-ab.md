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

## Pending

- 230M pass needs its 150MB model downloaded on this origin (awaiting
  the user's go; no silent downloads).
- Wider question set (journal, advice, meta) on both models before
  any default flip.
