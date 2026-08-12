Proof of Thesis, by INKO

A local-first, assisted trading journal. It reads a wallet, builds a portfolio view from real on-chain data, and helps a trader write down why they traded, not just what they traded.

This document reflects the codebase as of the August 5, 2026 rebuild (.lovable/plan/proof-of-thesis-rebuild-from-scratch-2026-08-05.md), verified directly against src/ on August 12, 2026. Earlier docs (the pre-rebuild README, PLAN, ROADMAP, REVIEW) describe a different product under the name "Dynaminko," with a dossier-card design language and a Markets/AI Terminal/Vault surface. That version was replaced, not iterated on. Those docs are archived under docs/archive/ (PLAN.md, ROADMAP.md, REVIEW.md) for their still-useful Ink chain, Nado, and Tydro research, not as a current description of the app.

What this is

Most trading journals fail because logging a trade is a chore. Proof of Thesis removes the chore: connect or paste a wallet address, and every swap, send, and receive the wallet made becomes an inbox item automatically. The only manual work left is answering a short, tap-first reconciliation: what you believed, whether the trade matched it, how it felt. One sentence is a complete entry. A form is never required.

Three input layers feed one local document:

Thesis — written any time, before or independent of a trade. Lives in a watchlist until a matching trade appears, or forever as a "ghost" if none ever does.
Signal — an on-chain event (swap, send, receive) extracted from the connected wallet's transaction history. Lives in the inbox until answered or dismissed.
Entry — the result of reconciling a signal against a thesis (or logging one standalone). Carries alignment, sizing, sentiment, emotion, and optional health/finance context, each answered by tapping one of four options, never free text unless the person chooses to add notes.

The POT Index (src/lib/pot-index.ts, route /pot) is the score this produces: five axes — coverage, alignment, discipline, execution, steadiness — computed only from what the person actually wrote or the agent actually read. An empty journal shows every axis as null, not zero.

What's real right now

Verified by cloning the repository, installing dependencies, and running tsc, eslint, and vite build directly, not by reading documentation.

Area	State
TypeScript	Compiles clean, zero errors
Production build	Succeeds (SSR + client)
Wallet reads	Real. Ink Blockscout public API + JSON-RPC, no API key, runs inside a dedicated Web Worker so parsing never blocks the UI
Prices	Real. CoinGecko public API, server-cached
Trade detection	Real. Extracted from actual transfer logs, not synthesized
Local storage	Real. Single versioned document in localStorage, subscription-based, with a fixed infinite-render-loop bug (see git log, "Fix the blank screen")
Wallet connect	Real, read-only. Hand-rolled EIP-1193 listener, zero dependencies, no signing
On-device AI	Real. @wllama/wllama (llama.cpp compiled to WASM) running in-browser, lazy-loaded behind explicit user action. Ships with the LiquidAI LFM 2.5 family (230M / 450M / 1.2B / 2.6B, Q4_K_M) as selectable models, downloaded on explicit user action from /agents
Portfolio 3D ring	Real. three.js, dynamically imported so it never blocks startup, falls back cleanly under prefers-reduced-motion
PWA	Installable, with a service worker (public/sw.js) backing notifications and asset caching
Trading / execution	Not built. /trade is a single placeholder screen: "Journal first, execution second."
Server-side AI (cloud LLM)	Not built. All AI in the current build runs on-device
Nado, Tydro, inkySwap, Velodrome integration	Not built. No live DEX or lending calls anywhere in the codebase
Known issue: broken favicon reference

src/routes/__root.tsx links /pot-mark.svg as the site icon. That file was never created; the actual logo files on disk are dynaminko.svg and dynaminko-logo.png, artwork unchanged since the rebuild. This 404s on every page load. The fix is a one-line revert in __root.tsx back to /dynaminko.svg, not a file rename.

Screens

Five real routes plus one placeholder, per the Aug 5 rebuild:

Home (/) — greeting, portfolio snapshot, what changed since last visit
Journal (/journal) — the core surface: inbox of unanswered signals, entries timeline, and the theses watchlist, sharing one search/filter set
Portfolio (/portfolio) — holdings from the connected wallet, grouped by sector
POT Index (/pot) — the five-axis score described above
Alerts (/alerts) — price, on-chain, and thesis-staleness triggers
Settings (/settings) — wallet management, theme, AI model manager, data export/delete
Trade (/trade) — placeholder only, describes what's coming next phase

theses as a standalone route now redirects into /journal?tab=theses; the surfaces were merged in the rebuild.

Design language

Monochrome. Pearl paper / obsidian ink depending on theme, one accent, no color otherwise — hierarchy comes from value, weight, hairlines, and space (src/styles.css, @theme block). Hand-drawn doodle chrome (doodle-card, doodle-pill utility classes, Caveat display font for accents) rather than the sharp-edged "dossier card" language of the pre-rebuild version. IBM Plex Mono for all numbers; Outfit for UI text.

Stack

Confirmed from package.json and direct build verification, not aspirational:

TanStack Start, TanStack Router (file-based), TanStack Query
React 19, TypeScript, Vite 8, Nitro (Cloudflare Workers as the default deploy target)
Tailwind CSS v4, shadcn/ui on Radix primitives
@wllama/wllama for on-device inference, three for the portfolio ring
Recharts for charts, React Hook Form + Zod for forms
No viem, no wagmi, no chain SDK — chain reads are hand-rolled against Blockscout + JSON-RPC directly
No backend, no database, no auth — everything lives in the browser (localStorage, Cache API for model weights, IndexedDB for chain-read caching)
Package manager: npm works (verified); bun.lock/bunfig.toml are present in the repo, but bun was not available to verify in this environment. If the team runs bun, treat both lockfiles as needing reconciliation.
Engineering principles

This project follows a browser-first, local-first architecture. See AGENTS.md for the full engineering charter (worker architecture, WASM usage rules, data movement priorities, async model). The current codebase already matches this charter closely: worker-isolated chain reads, lazy-loaded heavy dependencies (AI model, three.js), zero-copy patterns in the local store, and no synchronous work on the main thread for anything expensive.

Getting started
sh
npm install
npm run dev

Other scripts: npm run build, npm run lint, npm run format. (bun install / bun run dev should also work per the committed lockfile, but confirm bun availability in your environment first.)

Where the roadmap lives

See ROADMAP.md for what's next, sequenced from this actual state rather than from the pre-rebuild plan.


Agent architecture

Tools are deterministic (src/lib/tools/), skills orchestrate them (src/lib/skills/), and a model is used only for the reasoning step — see the "Agent Architecture" section of AGENTS.md. Compact per-group and per-skill docs live in docs/tools/ and docs/skills/; node scripts/check-docs.mjs fails when a registered tool group or skill is undocumented.
