# Fix the blank screen (infinite render loop)

## What's happening

The app crashes on load with "Maximum update depth exceeded" and shows a blank page. The cause is confirmed in the store and agent code:

- `update()` in `src/lib/store.ts` always replaces the document with a fresh deep clone and notifies every subscriber — even when the mutation changed nothing.
- `ingestSignals()` calls `update()` on every wallet read, and bails out _inside_ the mutation, so a no-op still produces a brand-new document object.
- That new object gives `usePortfolio`/`useActiveWallet` a new `active` reference, which re-triggers the effect in `src/hooks/useAgent.ts`, which calls `ingestSignals` again — an endless loop.

## The fix

1. `src/lib/store.ts` — make `update()` honest: if the mutation produced no change, keep the existing document and don't notify subscribers.
2. `src/lib/store.ts` — `ingestSignals()` computes the fresh signals first and returns before touching the store when there is nothing new.
3. `src/hooks/useAgent.ts` — key the effect on stable primitives (wallet key string, chain id, `fetchedAt`, trade count) instead of object/array identities, so a re-render of unrelated state can't re-run extraction.

## Mock data

A sweep of `src/` found no mock, demo, or seeded fixture data remaining — every number on screen comes from the Ink explorer read plus live quotes, and the journal/theses/alerts come from local storage. The only "placeholder" hits are input placeholder attributes. Nothing to remove; the plan verifies this rather than changing it.

## Verification

- Typecheck.
- Load `/` in a headless browser, confirm the dashboard renders and the console has no "Maximum update depth" error.
- Add a watch-only wallet and confirm the inbox fills once and then settles (no repeating updates).
