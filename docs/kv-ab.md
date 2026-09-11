# KV dtype A/B · q8_0 vs f16 on the WebGPU path

Run 2026-09-11, in-app browser, dev server localhost:8081, commit
0948766. The hybrid-model learning material claimed q8_0 KV halves the
cache at negligible quality cost; this repo could test that directly
because the dtype rides the load profile.

## What changed

recommendedCacheType briefly defaulted 8GB integrated machines to
q8_0; ?kvType=q8_0|f16 overrides for honest A/B runs. The ledger prints
the engaged dtype (cache q8_0/q8_0 or f16/f16).

## Measurements (350M, ctx 32128, WebGPU)

| arm | KV | peak budget | ttft | decode | answers |
|---|---|---|---|---|---|
| f16 (baseline, several runs) | 0.37GB | 1.42GB SAFE | 3.6 to 5.1s | 72 to 88 tok/s | grounded, correct numbers |
| q8_0, run 1 | 0.20GB | 1.22GB SAFE | 7930ms | 30.1 tok/s | zero-length generation risk observed as an 8.8s stall, then honest-failure wording |
| q8_0, run 2 | 0.20GB | 1.22GB SAFE | 6107ms | 39.2 tok/s | coherent and grounded ($2012, 15 open, basket values correct) |

## Verdict

- The memory claim holds: KV halves exactly, and the ledger moves
  accordingly (on the 2.6B at 32k that is 0.49GB to about 0.25GB).
- Quality holds: both q8_0 answers kept correct, grounded numbers and
  sensible advice.
- Speed does not: decode drops 2.3x (72 to 88 down to 30 to 39 tok/s)
  and ttft grows 1.4 to 2x. On an interactive assistant that is the
  user-facing metric, so the DEFAULT reverts to f16 wherever the model
  fits the device.
- q8_0 remains the recommendation for the memory-starved classes
  (small phones, large windows, heavy co-residency) where the
  alternative is an UNSAFE load or a CPU escape: there the 2.3x decode
  cost buys feasibility, a good trade. ?kvType= stays as the pin.

Separate finding in the same run: a 103s encoder-lane stall
(semantic stage), second occurrence this session (F10 in
docs/speed-research.md). Independent of KV dtype.
