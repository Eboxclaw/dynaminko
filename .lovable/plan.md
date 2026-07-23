## FUstore — Swiss Obsidian Cipher build plan

Elite dark command-center for trading tokenized assets on Ink Chain, built as a single-page dashboard at `/` with the chosen visual language (obsidian/onyx surfaces, neon mint + ink purple accents, JetBrains Mono for data, Inter for UI).

### Scope (frontend only, placeholder data)

1. **Boot loader** — full-screen classified terminal boot overlay: "SECURE ENCLAVE / BIOMETRIC / KRAKEN SDK / DECRYPTING NADO PROTOCOL" with progress bar; fades out after ~3.5s.
2. **Shell** — icon rail sidebar (Dashboard, Markets, CLI, Theses, Vault, Settings) + sticky header with Ink Chain indicator, total balance with privacy (asterisk) toggle, wallet chip.
3. **Portfolio Breakdown** — SVG conic pie chart with sector slices (Privacy, Defense, Chips, AI, Health, SoV, Firearms) + legend.
4. **Category Exposure Basket** — 2-col grid of sector exposure tiles.
5. **Premium Selection / Nado CLOB market list** — table of tokenized assets grouped by sector (tLMT, tRTX, tSIG, XMR, ZEC, PAXG, tPFE, tMRNA, tTSM, tNVDA, tPLTR, FET) with price, 24h, sector tag, and three actions: BUY SPOT, GO LONG, PREDICT. Selecting an asset updates the CLOB order-book side panel.
6. **Nado CLOB order book** — bid/ask ladder with depth bars for the selected asset.
7. **Kraken CLI terminal** — slide-out right drawer with mock command history, blinking caret, input field that echoes typed commands and returns canned responses (`kraken trade …`, `nado clob list …`, `ink status`).
8. **Thesis engine** — textarea list persisted to `localStorage` with add/delete; tie each thesis to an asset ticker.
9. **Notification center** — small panel to create price / on-chain / thesis-validation alerts, listed with enable toggles, stored in `localStorage`. PWA wiring is out of scope this pass (per the PWA skill — manifest-only only if requested).

### Technical

- Replace `src/routes/index.tsx` placeholder with the full dashboard. Keep home at `/`.
- Add fonts (Inter, JetBrains Mono) via `<link>` in `src/routes/__root.tsx` head; register `--font-sans` / `--font-mono` in `@theme` in `src/styles.css`. Add semantic dark tokens (`--color-obsidian`, `--color-onyx`, `--color-steel`, `--color-neon-mint`, `--color-ink-purple`) in `@theme` — no hardcoded hex in components.
- Force dark palette globally (override `:root` background/foreground to obsidian/slate) so no theme toggle needed.
- Update `__root.tsx` head with FUstore-specific title / description / og tags.
- Components under `src/components/fustore/`: `BootLoader`, `Sidebar`, `TopBar`, `PortfolioPie`, `CategoryExposure`, `MarketTable`, `OrderBook`, `KrakenTerminal`, `ThesisPanel`, `AlertsPanel`.
- State: local `useState` for selected asset, balance-privacy toggle, terminal open/closed, terminal history. `localStorage`-backed hooks for theses and alerts.
- Placeholder data in `src/lib/fustore-data.ts` (assets by sector, seeded order-book rows).
- No backend, no Supabase, no server functions.

### Out of scope this pass

- Real Kraken/Nado API integration (visual mock only).
- Wallet connection / signing.
- PWA install manifest and push notifications (can be a follow-up).
- Auth / user accounts.
