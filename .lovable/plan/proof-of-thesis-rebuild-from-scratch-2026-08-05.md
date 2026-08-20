# Proof of Thesis — rebuild from scratch

A clean rebuild. Not a terminal. An assisted journal with a portfolio attached: pearl and charcoal, hand-drawn, animated, story-first. Trading is deferred.

## The essentials, in bullets

- **Journal first.** Every screen exists to answer "why did I do this, and did it work out?"
- **Wallet is the input.** Connect or paste an address; the app reads it and builds the portfolio.
- **AI is the assistant, not the product.** It runs on-device, extracts theses from messy text, drafts reconciliation answers, summarizes.
- **Notifications matter.** Price, on-chain event, and stale-thesis triggers, delivered as PWA notifications.
- **Trading is next phase.** No order tickets in this build; a single "coming next" surface only.
- **Zero mock data.** If a real free source can't provide it, the UI shows an honest empty state.

## What gets deleted

Everything under `src/components/dynaminko/` and its `views/`, plus `dynaminko-data.ts`, `wallet-mock.ts`, and the agent-console scaffolding. The chain-read layer (`chain/blockscout.ts`, `cache/idb.ts`, `wallet-reader.worker.ts`, `chains/`) is kept and rewired. `journal.ts` keeps its types; the deterministic trade generator goes.

## Look and feel

Pearl white (`#F4F3F0`) paper, charcoal (`#1C1B1A`) ink, one warm accent, one mint/rose pair for gain/loss. Dark mode inverts to charcoal paper with pearl ink; toggle in the header, persisted locally.

Doodle language: hand-drawn SVG strokes, slightly irregular borders, soft shadow, generous whitespace, rounded pill controls. Type is a geometric sans for headings, mono only for numbers. No uppercase eyebrows, no hairline dossier frames, no "//" separators.

Motion: cards enter staggered, numbers count up, page transitions cross-fade. Everything respects `prefers-reduced-motion`.

## Screens

1. **Entry** — a short animated ink-bloom that resolves into the greeting card ("Good evening" + a one-line state of your book). Not a boot log.
2. **Home** — greeting, one hero stat, then a vertical story feed of cards: portfolio ring, what changed since last visit, theses needing attention, unanswered trades. Each card is tappable into its detail.
3. **Journal** — the core. Three views on one page: Timeline (entries + trades interleaved chronologically, the fix for "theses only, no trades"), Theses, Needs answer. One search field, filter chips.
4. **Reconcile card** — the 5-question flow, one question per animated card, thumb-reachable, skippable, with an AI "draft my answer" button on each.
5. **Portfolio** — holdings from the connected wallet, sector grouping, value over time when price history is available.
6. **Alerts** — create price / on-chain / thesis-staleness triggers; local scheduler + Notification API.
7. **Settings** — wallet, theme, AI model manager, data export, delete all.
8. **Trading** — one placeholder card describing what lands next phase.

## Real data

| Need                        | Source                                |
| --------------------------- | ------------------------------------- |
| Balances, tokens, transfers | Ink Blockscout public API (no key)    |
| Prices, 24h change, history | CoinGecko public API (no key)         |
| Block height, gas, latency  | Ink public RPC                        |
| Wallet connect              | EIP-1193 injected provider, read-only |

Every read is cached in IndexedDB and stamped with its source and fetch time. Tokenized equities have no free feed and will render price-less until one exists.

## On-device AI

`@wllama/wllama` — llama.cpp compiled to WASM, runs GGUF straight from Hugging Face, multi-threaded with SIMD, CPU fallback where threads are unavailable. WebGPU is used for the visual layer; llama.cpp WASM handles inference, and the runtime probe picks thread count and reports what the device can do before a download starts.

Model shelf in Settings, nothing downloaded until you press download:

- `LiquidAI/LFM2.5-350M-GGUF:Q4_K_M` — default, fastest
- `LiquidAI/LFM2.5-VL-450M-GGUF:Q4_K_M` — vision, for screenshot ingestion
- `LiquidAI/LFM2.5-2.6B-GGUF:Q4_K_M` — flagged experimental, desktop only
- `LiquidAI/LFM2.5-Encoder-230M` — reserved for semantic journal search, wired later

Weights are cached in the Cache API, keyed by model id, with size and progress shown. AI jobs run in a dedicated worker so the UI never blocks. Three jobs at launch: extract a thesis from free text, draft reconciliation answers for a detected trade, summarize a period.

## Three.js layer

Two moments only, both `<ClientOnly>` and lazy-loaded: the entry ink-bloom and the portfolio object on Home. WebGPU renderer with WebGL fallback, and a static hand-drawn SVG for reduced-motion or low-end mobile.

## Technical notes

- Route per section under `src/routes` (`/`, `/journal`, `/portfolio`, `/alerts`, `/settings`), each with its own `head()`. Home stays at `src/routes/index.tsx`.
- Design tokens rewritten in `src/styles.css` under `@theme`; dark via `@custom-variant`.
- Fonts via `<link>` in `__root.tsx`.
- Storage: IndexedDB for journal, theses, alerts, and chain snapshots; Cache API for model weights; localStorage only for theme and active wallet.
- Workers: chain reader, AI inference, alert scheduler. Typed message contracts.
- Navigation: bottom tab bar on mobile, slim rail on desktop — five items, no overflow menu.

## Out of scope

Order placement, Nado/Tydro wiring, MCP and skills, multi-wallet aggregation, server-side AI.
