# Portfolio Tracker — UI/UX & Flow Cleanup

## 1. Baskets / categories

Rework the sector taxonomy into the five asset classes you named, plus a fallback:

- Memes, Store of Value, DeFi, Stables, Stocks, Unsorted

The old niche list (privacy, health, defense, firearms, semis, AI) collapses into these:
tokenized equities → Stocks, DeFi tokens → DeFi, ETH/BTC/gold → Store of Value, stablecoins →
Stables, INKO and similar → Memes. Colors and labels update everywhere they are used
(dashboard ring, exposure bars, holdings rows, portfolio page).

## 2. Portfolio page

**Holdings / Detail** — grouped by the new categories with a per-category subtotal and share,
each row keeping amount, USD value and 24h change.

**Exposure / Baskets** — three sections:

- Wallet — spot balances read from the chain (current behaviour)
- Liquidity positions — Velodrome, Inkyswap
- Trading accounts — Nado, Hyperliquid

Each venue gets a small inline SVG badge. Venue adapters are added as separate read modules
with a clear "not connected / no positions" state; no invented numbers appear anywhere. Where a
public read is not available yet, the venue row shows as pending rather than faking a balance.

## 3. Theses & Journal

**Inbox**

- Copy-to-clipboard button on the transaction hash of each card.
- Checkbox on every open trade card, a selection bar with "select all", and bulk resolve:
  answer the reconcile flow once and apply it to every selected trade (one journal entry per
  trade, same thesis link and answers).
- Remove the "Not journalable" button and the dismissed-signal path.

**Reconcile flow**

- Drop the first "Trade or thesis?" question. Every card enters the trade flow, which already
  links to an existing thesis or creates a new one inline.

**Ghosts**

- A thesis with any linked entry that has a trade is excluded. An entry that is linked to a
  trade is excluded. Only truly unexecuted intents remain.

## 4. Theme

Light becomes the default; dark stays as an opt-in toggle. Stored preference wins, otherwise
light regardless of the OS setting.

## Technical notes

- `src/lib/sectors.ts`: new `SectorId` union, symbol map and palette; all consumers updated.
- `src/lib/venues/*`: one module per venue (Velodrome, Inkyswap, Nado, Hyperliquid) returning a
  typed position list, fetched in the existing worker/query layer with IndexedDB caching.
- `src/lib/store.ts`: drop `"dismissed"` from `Signal["state"]`, default `theme: "light"`.
- `src/components/pot/Reconcile.tsx`: remove the `kind` step; accept `signals: Signal[]` so one
  pass can write many entries.
- `src/routes/journal.tsx`: selection state, bulk bar, copy button, corrected ghost filter.
- `src/routes/__root.tsx`: boot script defaults to light.
