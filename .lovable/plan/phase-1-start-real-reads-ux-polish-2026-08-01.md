# Phase 1 start: real reads + UX polish

Goal of this pass: replace the biggest mock seams with real, read-only data (no wallet signing, no execution), and tighten the interface where it currently feels rough.

## 1. Real wallet reads on Ink (replaces `wallet-mock`)

Today every position is derived from a hash of the pasted address. Replace that with actual chain reads:

- Add `viem` and a public client built from `chains/ink.ts` (RPC `https://rpc-gel.inkonchain.com`).
- For each visible wallet, read native ETH balance plus ERC-20 balances via a batched `multicall` over a curated Ink token list.
- Keep the read in a Web Worker (per the browser-first principles) with results cached in IndexedDB, so the dashboard renders instantly from cache and refreshes in the background.
- Any address with no on-chain data renders an honest empty state instead of invented holdings. A "demo data" switch stays available so the UI can still be shown fully populated.

## 2. Real prices, real portfolio value

- Extend the existing `/api/public-data` snapshot to cover every token in the list (CoinGecko), with the existing 3-minute server cache.
- Portfolio diamond, category exposure, DeBank-style view and the balance in the top bar all compute from `balance x live price` instead of fixtures.
- xStocks with no live feed are flagged `indicative` rather than silently faked.

## 3. Real trade detection feeding the Journal

The journal inbox currently invents 2–4 trades per wallet. Replace with real transfer history:

- Pull ERC-20 Transfer logs for each visible wallet from the Ink explorer API, normalise into `TradeEvent` (ticker, side in/out, qty, timestamp, tx hash), and keep the existing pending / journaled / skipped state machine untouched.
- Journal entries continue to persist locally; each entry links to the real tx hash with an explorer link.
- Incremental sync: store the last scanned block per wallet so repeat loads are cheap.

## 4. Vault and Markets read-only live data

- Vault: Tydro/Velodrome/InkySwap TVL and APY from the DefiLlama call already in `public-data.ts`, with per-asset rows marked live vs. indicative.
- Markets: live mid price and 24h change per asset; the order book stays clearly labelled as a simulated depth view until a Nado feed is wired.

## 5. UX / UI polish

- Fix the boot sequence hydration mismatch (random session id generated during render) and make the whole boot skippable by any keypress.
- Data trust layer: every panel gets a small mono footer showing source and age (`ink rpc · 12s`), plus skeleton loading states instead of empty flashes, and retry on failure.
- Markets: keep asset context pinned when switching Spot / Swap / Long / Short, add keyboard back, and make percentage-of-balance chips work off the real balance.
- Journal wizard: progress dots, arrow-key option selection, Enter to advance, and a persisted draft so a closed wizard resumes.
- DPI: shared axis and tooltips across sub-tabs, plus an explicit "not enough data yet" state rather than empty charts.
- Global: consistent focus rings, better mobile spacing on the 8-item tab bar, and a single reusable empty-state component.

## Technical notes

- New: `src/lib/chain/client.ts` (viem public client), `src/lib/chain/tokens.ts` (Ink token list), `src/workers/wallet-reader.worker.ts`, `src/lib/cache/idb.ts`.
- Rewritten: `wallet-mock.ts` becomes `wallets.live.ts` with the mock kept behind a demo flag; `journal.ts` sync swaps its generator for explorer-log ingestion.
- Server: extend the existing `/api/public-data` route only; no new backend, no database, no wallet connect.

## Out of scope this pass

Signing, order execution, Nado/Tydro write calls, AI concierge inference, Supabase.
