# Roadmap delta + execution plan

## Where the 13-phase migration actually stands

Verified against the code, not the old notes.

| Phase | Status | Evidence |
| --- | --- | --- |
| 1. Audit + command registry | Done | `src/lib/commands/registry.ts` (typed registry, access levels) |
| 2. CommandRunner + CommandResult | Done | `src/lib/commands/runner.ts` (validation, one retry, timeout, deadline, cancel, approval, logging), `types.ts` |
| 3. Low-level tools under commands | Partial | `src/lib/tools/registry.ts` still called directly from `/tool` in `agents.tsx`; journal + portfolio commands exist, chain/indicators/alerts groups do not |
| 4. AgentRuntime extracted from chat | Not started | Turn logic lives inside `src/routes/agents.tsx` (`speak`, `runSkillTurn`, `runToolTurn`) |
| 5. Five-hop loop | Partial | Bounded multi-cycle exists in `runner.ts`; not reachable from chat |
| 6. Goal mode + two cycles | Not started | No `/goal` surface |
| 7. Execution state / diagnostics | Partial | Tool cards + per-run traces exist; no staged pipeline view, no persistent error surface |
| 8. Journal commands | Done | `src/lib/commands/journal.ts` |
| 9. Tavily + DDG providers | Not started | No search provider module |
| 10. EmbeddingProvider abstraction | Done | `src/lib/ai/embedding.ts` (MiniLM default, LFM Encoder-230M upgrade), `encoder.ts` is now a facade |
| 11. Encoder benchmark | Not started | No journal-specific benchmark |
| 12. Token baskets | Partial | `src/lib/sectors.ts` + `basketOverrides` in the store and a picker in portfolio; no canonical `AssetBasket` record with source/confidence, no `ai`/`l1`/`l2`/`gaming`/`btc`/`eth` split |
| 13. Model broker + capability routing | Not started | `useAi` picks one target; no capability state, no broker |

Bugs confirmed in code, matching the brief:

- `agents.tsx` gates a local turn on `ai.status.phase !== "ready"` and then calls `ai.ensure()`; there is no explicit select→load→ready→activate boundary and no inline model switch on the composer.
- `speak()` accepts an empty completion (`answer || raw`) and pushes it as an assistant message, so zero output looks like success.
- Failures are pushed as transient `note` messages, so a load failure scrolls away instead of persisting.
- `ModelPanel` derives its action label from `ai.downloaded` plus the selected id, so "downloaded" and "default" get conflated in the button.
- The encoder is optional in the embedding layer, but the UI does not state whether the semantic pass or the keyword fallback is active.

## What we build now (P0)

1. **Capability state.** One `ModelCapabilityState` derived in `useAi`: `generation`, `vision`, `semantic` (`not_required` when nothing asked for it), plus `canAnswer` / `canRoute`. Every surface reads this instead of guessing from `status.phase`.
2. **Inline model switch on the composer.** Replaces the static provider label. Grouped Local / Cloud list with per-entry real state. Selecting runs verify → load → wait ready → activate; the composer stays disabled and shows `Loading…`, then `Local · Ready`, or `Load failed [Retry]`.
3. **Generation lifecycle.** Explicit phases: routing, selecting, loading, ready, generating, first token, completed, plus `failed`, `no output`, `cancelled`. Empty output throws instead of resolving.
4. **Persistent errors.** Load and generation failures render as a sticky error strip on the turn with a retry, not a scrolling note.
5. **Downloaded vs loaded.** `ModelPanel` and the inline switch derive the action purely from cache state: missing → Download, partial → Resume, complete+unloaded → Load, complete+loaded → Unload.
6. **Encoder never blocks chat.** Route order becomes semantic → deterministic keyword → continue. Encoder error or absence downgrades routing only. Status block shows MODEL and SEMANTIC separately, with `NOT LOADED · fallback active` when that is the truth.

## Next (P1)

7. **Execution flow visualizer.** One compact pipeline above the chat, showing only the stages that ran: model → semantic → route → skill → command → tool → answer. Active node animates, done nodes go quiet, errors go red. Fed by extending the existing trace records with a `stage` field, not a second tracking system.
8. **Basket classification.** Canonical `AssetBasket { assetId, basket, source, confidence, updatedAt }` in the store, basket set widened to stable/btc/eth/meme/defi/ai/l1/l2/gaming/other. Resolution order: registry → deterministic rules → model only when ambiguous → user override (source `user`, confidence 1, always wins). Inline basket dropdown per asset row plus asset/basket sorting.
9. **Venue card density.** Keep the compact cards. Add type chips (SPOT / PERP / MARGIN, LP with pair) and a hover popover on desktop, press-and-hold on mobile, carrying venue, type, pair, size, value, PnL, margin, leverage, status, last updated. Existing primitives and `VenueIcon` only.
10. **Panel wiring pass.** Before any engine change: single source of truth for panel state, nested scroll containers, sticky/fixed, z-index, clipping, breakpoints, and no fight between the inline selector and the panel selector.

## Roadmap (not now)

Semantic command registry expansion, `/goal` loop, AgentRuntime extraction out of React, store schema versioning and migrations, cloud/local model broker, INKO TWAP price resolver under `src/lib/market/` consumed by journal/portfolio/agent, search providers behind EXTERNAL, richer journal/market integration.

## Technical notes

- No new runtime, store, or trace system. Extend `useAi`, `src/lib/ai/embedding.ts`, `src/lib/commands/runner.ts` traces, and the existing store.
- `ROADMAP.md` is rewritten to the Shipped / P0 / P1 / Roadmap shape above so the phase list and the code stop disagreeing.
- Chat turn logic stays in `agents.tsx` for now; the lifecycle is factored into a small hook so the later AgentRuntime extraction is a move, not a rewrite.
