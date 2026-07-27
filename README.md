# Dynaminko

A trigger first, thesis driven trading journal for Ink Chain. It watches a wallet and reconciles thesis against trades automatically in a Status tab, where sentiment, trading performance, and accountability merge into one number we call Dynamic Performance, and routes execution through dexes like inkySwap, Velodrome, and Nado, and through Tydro, once that phase is reached.

## What this is

Most trading journals are built analytics first and habit second, so they get abandoned. Dynaminko inverts that: the retention loop comes first, the metrics engine comes second. Three input layers feed one journal: a manual thesis written any time, an automatic trade ledger (accountability) pulled straight from the chain with zero re-typing, and an AI concierge that reconciles the loop across thesis, journal, and trade accounting, asking for a one tap confirmation instead of a form.

Once confirmed, entries feed a five axis Dynamic Performance engine (Performance, Thesis, Sentiment, Financial, Psychological), surfaced on the Status tab. Performance and Thesis pull their signal automatically from the ledger. The other three axes get theirs from a short tap flow after a trade reconciles: one question per axis, four selectable answers each, never a free text field. Psychological already has its four: calm, FOMO, revenge, boredom. Sentiment and Financial each need their own four option question in the same spirit before this ships. The flagship number is thesis-aligned win rate versus thesis-less win rate, since that tells a trader exactly which behavior to change instead of just that they need to do better.

INKO is the existing meme brand and community on Ink Chain, used as the initial low stakes distribution wedge before the product expands to serious traders. Dynaminko is the working product name.

## Ecosystem

- **Ink Chain** (chain id 57073), Kraken's OP Stack Layer 2, part of the Optimism Superchain.
- **Nado**, the unified spot, perpetuals, and margin DEX native to Ink Chain. Trading routes through its CLOB, and a Nado Builder Code lets the app earn a fee share on volume it routes.
- **Tydro**, a white label Aave V3 deployment on Ink Chain, the Vault tab's home for idle capital. Note: on chain explorers like DeBank this shows up labeled "Aave V3", that's Tydro under its base protocol name, not a separate integration.
- **inkySwap** and **Velodrome V3**, the simple swap and LP/farming venues on Ink Chain, starting with a whitelisted asset list, new tokens added later through a form/PR process.

## Stack

Aiming to be a PWA powered by WebGPU, TypeScript, WebAssembly, and Rust.

Template starts with:
- TanStack Start, TanStack Router (file based, currently a single `/` route with client side view switching), TanStack Query
- React 19, TypeScript, Vite
- Tailwind CSS v4, shadcn/ui on Radix primitives
- Recharts for charts, React Hook Form plus Zod for forms
- IBM Plex Sans and IBM Plex Mono
- Bun as the package manager (`bun.lock`, `bunfig.toml`)
- No wallet library, no chain SDK, and no backend wired in yet, this is a frontend-first pass on staged data throughout

## Design language

Onyx and obsidian surfaces, hairline borders, a single lavender accent reserved for primary actions and focus states, mint for gains, a muted rose for losses. The signature surface is the dossier card, a hairline bordered panel with a small monospace case file header, used for reconciliation items, theses, trade tickets, and terminal proposals, and nowhere else, so the restraint stays legible. The brand mark is a faceted "dynamite candle" diamond, doubling as the boot sequence centerpiece and the portfolio breakdown visualization.

## Progress

| Part | Status | Notes |
|---|---|---|
| Design system | Done | Color tokens, type pairing, dossier card, diamond mark all in place. Logo is now green-free and sourced from `public/dynaminko.svg` end to end (boot centerpiece included) |
| Boot sequence | Done | Terminal handshake, faceted centerpiece rendered from the uploaded SVG, scan line, skippable, session gated |
| Dashboard | Done, mock data | Portfolio Breakdown, Category Exposure grouped by top-level category with sub-basket bars, Concierge feed, plus a paste-address Wallet selector and a DeBank-style Positions panel that reflects the tracked wallet (deterministic staged positions per address, no chain calls yet) |
| Basket taxonomy | Done | Two-tier, open-set: top level `Crypto` / `xStocks`, sub-baskets `privacy · cash · metals · ai · memes · rwa · defense · chips · health · goods · etfs`. New sub-baskets added at token-listing time no longer require a schema change |
| Markets | Done, mock data | Progressive flow — category tab → sub-basket chip → asset list, then a dedicated CLOB ticket + order book on the next step (back via button or Esc). Ends the old all-in-one wall of controls |
| AI Terminal | Done, mock data | Slash commands with autocomplete, JSON/table toggle, natural language parsing, approve/edit/discard proposal cards. Responses are canned, not live |
| Theses | Done, mock data | List and detail view, manual and AI guided composer, aligned/drifted/pending status |
| Status tab | Not started | Home for the Dynamic Performance composite score, still queued |
| Vault | Done, mock data | Tydro style supply/borrow cards with APY and position |
| Settings | Done, mock data | Wallet tracking now embeds the paste-address selector, notification preferences, permissionless alert setup |
| Quick Capture | Needs a fix | Still routes to other screens instead of capturing inline |
| PWA layer | Installable | Manifest + SVG icons + head tags shipped, installs to home screen on Android/desktop. Offline service worker deliberately deferred (kept out of Lovable preview) |
| Real chain and wallet | Not started | No wallet library, no live Nado, Tydro, inkySwap, or Velodrome calls, everything above runs on staged data |

## Roadmap

| Phase | Goal | Exit criteria |
|---|---|---|
| 0. Foundation | Prove capture friction is solved before building anything else | A thesis captured in under 10 seconds from any screen, measured |
| 1. Automatic ledger | Remove manual trade entry | Every trade on the connected wallet appears in the ledger with zero manual input |
| 2. Assisted journal | Turn the ledger into narrative | Most new trades get a linked reflection without opening a form |
| 3. Dynamic Performance v1 | Ship the insight layer and the Status tab that houses it | Thesis-aligned versus thesis-less win rate surfaces an insight a spreadsheet couldn't |
| 4. Full Dynamic Performance | Add Sentiment and Financial as four answer tap questions, alongside the existing Psychological one | All five axes populate for active users with enough sample size |
| 5. Ecosystem integration | Move from tracking to executing | A user goes from thesis to executed trade to journaled entry without leaving the app |
| 6. Expansion | Scale beyond the INKO wedge | Evaluate a native Tauri shell, other chains, and white label, decided from real usage data |

This build is UI first across several of these phases at once (Markets and Vault already have their full visual chrome, on staged data, well ahead of when they go live), which is deliberate: get the aesthetic and interaction model right before wiring anything real.

## Getting started

```sh
bun install
bun run dev
```

Other scripts: `bun run build`, `bun run lint`, `bun run format`.


