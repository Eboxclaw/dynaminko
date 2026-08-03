# Proof of Thesis, by INKO — rename + UX refactor

Sequenced exactly as the brief's build order. Everything stays local-first, read-only, PWA. No real order execution, no AI wiring in this pass.

## 1. Rename + header

- Product name becomes **Proof of Thesis**, short form **POT**, byline **by INKO**. Logo mark unchanged.
- Update `package.json` name, `public/manifest.webmanifest` (name / short_name / description), the root route title and meta, plus the wordmarks in `TopBar.tsx` and `Sidebar.tsx`. Docs (README, PLAN, REVIEW, ROADMAP) get the running product name swapped only.
- Header rebuild: larger diamond mark as its own block, two-line lockup ("PROOF OF THESIS" / "by INKO"), and the hardcoded "Trading Journal // Ink Chain" eyebrow replaced with a mono badge `POT // <active venue>` driven by the active wallet's venue/chain — never a hardcoded string.
- Right side keeps status dot, Quick Capture, balance + mask, and gains the new wallet switcher. Mobile collapses to mark + "POT".

## 2. Wallet model: one active wallet

Today every wallet with `visible: true` is aggregated. That model is replaced by a single `activeWalletId`.

- Keep all wallet CRUD, drop the visibility set. Header control becomes a chip (short address, READ/SIGNED badge, chain tag) opening a single-select switcher.
- Selecting a wallet reloads every dashboard-bound surface against that wallet alone: Portfolio Diamond, Category Exposure, positions list, Journal Inbox, POT Performance.
- Connecting/signing a live wallet immediately becomes active and unloads the previous read wallet, announced by a toast.
- A disabled "All wallets (aggregated) — Coming soon" row sits at the bottom of the switcher.
- Roster management (add/remove/rename/revoke) moves to Settings.

## 3. Five-question reconciliation card

`JournalWizard.tsx` goes from 4 steps to 5, same chrome (step indicator, dossier review, skip, Esc to dismiss):

1. Which thesis is this? — link existing / write one line / no thesis (impulse)
2. Did this match your plan? — aligned / partial / full deviation / no thesis (new, tap-only)
3. What role did this trade play? — conviction / reactive / hedge / FOMO / rebalance
4. How does this size compare to your usual? — starter / full size / adding / oversized (new, tap-only)
5. How did you feel? — calm / anxious / excited / uncertain + confidence slider

Review screen unchanged plus optional notes. `JournalEntry` gains `alignment` and `sizing`, wired into the performance schema's `thesis` and `financial` axes. One card, two entry points (wallet-detected trade, or thesis-first execution confirm).

## 4. Journal Hub

Merge `JournalInbox`, `ThesesView`, and the ghost logic into one "Journal" nav item with four tabs sharing one search bar and filter set:

- **Inbox** — detected trades/swaps/LP deposits awaiting an answer; drives the nav badge.
- **Entries** — completed entries, newest first, filterable by ticker, basket, venue, sentiment, emotion, alignment, date; substring search now, embedding search later.
- **Theses** — watchlist of intent, current ThesesView treatment.
- **Ghosts** — both directions: ghost thesis (no trade) and ghost trade (skipped past a staleness window, never journaled).

Reads the existing local stores only — no second source of truth.

## 5. Navigation trim + sealed sections

- Desktop sidebar mirrors mobile: primary group = Dashboard, Markets, Journal, POT Performance. Divider, then AI Terminal, Agents, Vault, Settings.
- AI Terminal / Agents / Vault get an ash "SOON" tag and route to a short dossier-styled sealed reveal (what it does, which phase unlocks it). Existing views stay in the codebase behind a dev flag.

## 6. Settings reorg

Collapsible named groups: Wallets & Accounts · Venues & Data · Journal & Alerts · Privacy & Storage (export, delete-all, encryption status, default balance hide) · AI Concierge (SOON — reuses the runtime capability probe) · Command Line & Agents (SOON) · Vault (SOON) · About (POT, by INKO, version, links).

## 7. Dashboard compositor + venue labeling

- `DashboardView` binds to the active wallet; empty state points at the switcher.
- `CategoryExposure` becomes facet-tabbed with the same flat bars: Basket · Provider · Type · Category · Chain. Portfolio Diamond untouched.
- Markets ticket gains a venue selector next to the Spot/Swap/Long/Short toggle, with a `ROUTING // NADO` style mono badge. Labeling only; execution stays staged.

## 8. POT Performance

Rename DPI to "POT Performance" (nav short: Score). Keep the headline strip + sub-tabs, add a one-line definition ("conviction weighted against execution"). Ghosts tab covers both directions and both feed the discipline stat. Discipline and Sentiment panels read the new alignment/sizing fields.

## Technical notes

- Wallet state: `activeWalletId` in the wallet store, consumed via `useChain`; the reader worker and IndexedDB snapshot keys stay keyed by chain + address.
- New journal fields are additive and optional so existing local entries keep loading.
- Sealed screens reuse `DossierCard`; no new diamondmorphism surfaces.
- Hyperliquid Info API (public POST endpoint) is the only new data source, added for venue metadata and venue tagging; Nado read scope confirmed before wiring. Swap aggregator vendor left open.

## Out of scope

Real order placement, on-device model / LoRAs / MCP skills, Nado builder-code monetization, Tydro vault read/write, multi-wallet aggregation.
