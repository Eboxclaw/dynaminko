
## 1. Logo fix (smallest, ship first)

`src/components/dynaminko/DiamondLogo.tsx` currently draws a green mint fuse + green dot on top of the mark. Remove both the `<path>` fuse and the `<circle>` cap so the logo is pure onyx / lavender only, matching `public/dynaminko.svg`. Also swap the `BootSequence` centerpiece to render `public/dynaminko.svg` via an `<img>` (single source of truth) instead of the inline `DiamondLogo`, so the boot screen shows exactly the uploaded mark.

## 2. Basket taxonomy refactor

Replace the flat 7-sector list with a two-level, extensible taxonomy:

- **Top-level category**: `Crypto` | `xStocks`
- **Sub-category** (string, open set, easy to add): `privacy`, `health`, `goods`, `metals`, `cash`, `defense`, `memes`, `rwa`, `etfs`, `ai`, `chips`. New strings can be added on token listing without code changes elsewhere.

Data changes in `src/lib/dynaminko-data.ts`:
- `Asset` gains `category: "Crypto" | "xStocks"` and `subCategory: string` (replacing `Sector`).
- Existing tickers re-tagged: `XMR/ZEC → Crypto/privacy`, `PAXG → Crypto/metals`, `tBTC → Crypto/cash` (or `metals` — I'll place under `metals`), `FET → Crypto/ai`, `tLMT/tRTX → xStocks/defense`, `tSWBI/tSIG → xStocks/defense` (firearms folded under defense per new list; or keep as `guns` sub if you prefer — defaulting to `defense`), `tTSM/tNVDA → xStocks/chips`, `tPLTR → xStocks/ai`, `tPFE/tMRNA → xStocks/health`.
- `SECTOR_COLORS` becomes `SUBCATEGORY_COLORS` keyed by string, with a fallback tonal ash so unknown new sub-categories still render.
- `sectorTotals()` → `subCategoryTotals()` returning both category and sub, so the Category Exposure panel can group by top category with sub rows underneath.

UI changes:
- **Markets** and **Dashboard Category Exposure** show two-tier filters: top tabs `ALL / CRYPTO / XSTOCKS`, sub-chip row underneath filtered to the sub-categories present in the current top selection.
- Composer copy and empty states no longer hardcode the old seven names.

## 3. Progressive Markets UX (fix "all in one page")

Rework `MarketsView.tsx` into a two-step flow instead of a side-by-side list + ticket:

```text
Step 1: [ Category tabs ] → [ Sub-category chips ] → [ Asset list, full width ]
                                                        │ user clicks a row
                                                        ▼
Step 2: [ ← back to list ]   [ Asset header: ticker · price · 24h ]
        ┌──────────────────────────────────────────────────────────┐
        │  CLOB TICKET (dossier)         │   ORDER BOOK depth      │
        │  Buy Spot / Go Long / Swap     │                         │
        └──────────────────────────────────────────────────────────┘
```

- On mobile the two step-2 cards stack; on desktop they sit side by side, but only step 2 is on screen — the list is not competing for attention.
- Route selection via local `selected: Asset | null` state; no URL change needed this pass (single `/` route stays).
- Back control: dedicated hairline back button + Esc key.

## 4. Wallet-scoped portfolio on Dashboard

Replace the current "wallet connected boolean" on the Dashboard with a paste-an-address flow:

- New `WalletSelector` component in the top bar (desktop) and as a dossier card at the top of the Dashboard on mobile: single input for a `0x…` address, validates length + hex, remembers last used via `useLocalStorage("dyn.wallet")`.
- New `src/lib/wallet-mock.ts` derives a deterministic staged position set from the pasted address hash (simple `Math.sin(seed)` fold like the existing order book), producing per-asset balances so `PortfolioDiamond`, `CategoryExposure`, and a new `PositionsPanel` all reflect that wallet.
- New `PositionsPanel` (dossier-styled) on Dashboard: rows of `Asset · sub-category dot · qty · USD value · 24h`, grouped by `Crypto` vs `xStocks`. Placeholder empty state when no address entered ("Paste a wallet to load positions").
- All existing dashboard totals (`totalBalance`, sector totals) accept an optional positions map and fall back to the current staged data when no wallet is set, so nothing regresses.
- No live chain calls this pass (per your answer). `chains/ink.ts` stays as-is for the later live integration.

## 5. PWA — installable only

Per your answer, webpage first, installable next. No service worker, no offline.

- Keep `public/manifest.webmanifest`, but replace the maskable icon entry that points at the 1254×1254 png with a proper set: add 192×192 and 512×512 PNG icons generated from `dynaminko.svg`, plus a maskable variant with safe-area padding. Update `theme_color` / `background_color` to `#0A0A0C` (already correct) and set `id: "/"`, `scope: "/"`.
- Add head tags in `src/routes/__root.tsx`: `<link rel="manifest">`, `<meta name="theme-color">`, `<link rel="apple-touch-icon">`, `<link rel="icon">`.
- Do **not** add `vite-plugin-pwa`, `serviceWorker.register`, or any SW file. This keeps the install prompt available on Android/desktop without introducing cache-invalidation risk in Lovable preview.

## 6. README + PLAN.md progress refresh

Update the progress table in `README.md` and the phase notes so they reflect this pass:

- Dashboard row: mention paste-address wallet tracking + Positions panel.
- Markets row: mention progressive select → ticket flow (list first, ticket next), plus new two-level basket taxonomy.
- PWA row: flip to "Installable ✓ (manifest + icons + head tags); offline shell deferred".
- Design system row: note the logo is now green-free and sourced from `dynaminko.svg`.
- Quick Capture row: unchanged (still flagged as needs-fix — not in this pass unless you want it added).
- Add a short note under Roadmap Phase 0 that basket taxonomy is now open-set so new sub-categories added at token-listing time don't require a schema change.

`PLAN.md` gets a short appended "Progress log — pass 2" section summarizing the same in one paragraph, keeping the original vision untouched.

## Out of scope this pass

- No live Ink Chain RPC / viem wiring (you picked paste-address mock).
- No service worker / offline shell.
- No Quick Capture rework.
- No Status tab (still not started, tracked in README).

## Technical notes

- Files touched: `src/components/dynaminko/DiamondLogo.tsx`, `BootSequence.tsx`, `TopBar.tsx`, `views/DashboardView.tsx`, `views/MarketsView.tsx`, `CategoryExposure.tsx`, `PortfolioDiamond.tsx`, `src/lib/dynaminko-data.ts`, `src/routes/__root.tsx`, `src/routes/index.tsx`, `public/manifest.webmanifest`, `README.md`, `PLAN.md`.
- New files: `src/components/dynaminko/WalletSelector.tsx`, `src/components/dynaminko/PositionsPanel.tsx`, `src/lib/wallet-mock.ts`, `public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable-512.png`.
- No new npm dependencies.
