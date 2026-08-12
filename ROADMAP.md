# Roadmap

Sequenced from the state the code is actually in (audit: `.lovable/plan/audit-and-next-steps-deterministic-tools-first-ai-last-2026-08-12.md`).
Pre-rebuild plans live in `docs/archive/` and describe a product that was replaced, not iterated on.

## Shipped

- Wallet reads (Ink Blockscout + JSON-RPC, in a Web Worker), prices, IndexedDB caching
- Local document store: theses, signals, entries, alerts, wallets, logs, settings
- Journal hub `/journal` — inbox, entries, theses, ghosts, filters, bulk resolve, reconcile wizard
- Portfolio `/portfolio` with baskets and venue positions
- POT Index `/pot` — five axes with formulas and 30-day trends
- Alerts `/alerts` + engine + service worker notifications
- Agents `/agents` — agents, models, skills, tools, log
- On-device AI (`@wllama/wllama`, LFM 2.5 family), opt-in download
- Tool layer `src/lib/tools/` and skill layer `src/lib/skills/` with access/approval/logging policy

## Next

1. Approval previews rendered for every WRITE/EDIT/DELETE tool call from a skill.
2. Skill results wired into the reconcile wizard (pre-fill from `journal.filter`, no model).
3. Venue read tools beyond Hyperliquid (velodrome, inkyswap, nado, tydro) — read/parse/collect only.
4. Charts group: indicator series over journal history.
5. `/trade` — only after the journal loop is complete. Execution stays behind explicit approval.

## Out of scope

- MCP server
- Server-side LLM, accounts, database
- Venue execution
