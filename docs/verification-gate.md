# Verification gate · Phase 1 (HANDOVER.md)

Run 2026-09-11, in-app browser, dev server on localhost:8081.
Commit under test: 63988b0 on top of f0cf654 (reliability phase) and
9fe7557 (handover). The 63988b0 change is the answer-always fix: a routed
command turn now reaches the answering model after the command card
(AGENTS.md invariant 1), so every run below ends in a spoken answer.

Settings: Reason off for 350M and 230M (no reasoning ability), the Qwen
comparison run had Reason on. Thinking per roster defaults. No pins.

Exact failing prompt, verbatim: `hello agent how s my portefolio doing ?`

## Results

| model | route | command | answer | decode | verdict |
|---|---|---|---|---|---|
| LFM 2.5 350M (standard first) | deterministic, matched "how is my portfolio" | portfolio.snapshot 37ms | 8120ms | 77.5 tok/s | PASS |
| LFM 2.5 230M | deterministic, matched "how is my portfolio" | portfolio.snapshot 40ms | 20174ms | n/a (not captured) | PASS |
| LFM 2.5 2.6B | deterministic, matched "how is my portfolio" | portfolio.snapshot 46ms | 47863ms | 20.1 tok/s | PASS |
| Qwen3.8 2B Distill (pre-gate sanity run, Reason on) | deterministic | portfolio.snapshot 53ms | 79343ms incl. wake 8842ms | 14.0 tok/s | PASS |

GOOD criteria met on every model: portfolio.snapshot ran
deterministically and the answer carried real holdings numbers
($2,05x across 5 baskets, 15 open perps, net worth $2,03x).
BAD criteria never appeared: no journal.search, no receipts presented
as holdings.

Also verified: a second phrasing, `what is my net worth right now ?`,
routes deterministically to portfolio.snapshot (first-class
portfolio-status domain) and answers the same way.

## /usage encoder lines (per model, as required)

- 350M: `semantic: lfm2-5-embed-350m · resident lfm2-5-embed-350m
  webgpu ~458MB · chat LFM 2.5 350M (webgpu)`. Budget ledger names the
  +0.25GB resident encoder. Exactly one resident semantic provider.
- 230M: same shape (LFM embedder resident).
- 2.6B: `semantic: minilm (not loaded; 2.6B co-residency) · chat
  LFM 2.5 2.6B (webgpu)`. The enforceEncoderResidency invariant is
  visible in the UI: the status strip flipped to "semantic · not
  loaded · fallback active" the moment the 2.6B was selected.

Runtime and budget lines print on all three.

## Observations (flag, not gate failures)

1. 2.6B budget ledger reads UNSAFE honestly: peak 6.46GB over the 6.4GB
   integrated class (3.18GB weights x2 webgpu + 2.00GB KV at the
   131072 window). The load and the turn still completed on WebGPU.
   The ledger says what it sees; the guard policy let it run.
2. 2.6B prefill dominates: ttft 43130ms on a 4660t prompt, prefix
   reuse miss (full prefill). This is the known prewarm/KV-reuse
   territory, not a routing problem.
3. Small-model answers append the grounding note
   `(not found in this turn's data: ...)` verbatim and the 350M echoed
   the user's typo "portefolio" back. Quality noise, not routing.
4. Assistant answers render raw markdown (##, **, tables) in the chat
   bubble. Cosmetic; separate fix if wanted.
5. Warm-turn speed on 350M (KV already resident): 4793ms answer,
   79.1 tok/s, prompt shrank to 3511t. Prefix reuse still reported
   miss on that turn (history section differs), so the 563ms turn-2
   ttft from the handover notes needs a same-prefix repeat to show.

## Verdict

Phase 1 gate: PASS on 350M, 230M, 2.6B. Next per HANDOVER.md: Phase 2,
the decide A/B (head vs lean) on 230M and 350M.
