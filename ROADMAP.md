# Roadmap

Sequenced from the state the code is actually in.
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
- Semantic command layer `src/lib/commands/` — typed registry, collect→aggregate→answer executors,
  bounded runner (validation, one transient retry, timeout, deadline, cancellation, approval, logging)
- Inline console `/run <command>` with approval cards and per-run traces
- Tiered embeddings `src/lib/ai/embedding.ts` — MiniLM default, LFM 2.5 Encoder-230M as the
  recommended upgrade, escalation only when the cheap tier is not confident
- Capability model `src/lib/ai/capability.ts` — generation, vision and semantic tracked separately;
  the encoder can never block a local answer, routing silently degrades to keywords
- Explicit activation boundary: verify → download → load → ready → active, driven from the cache and
  never from which model happens to be the default
- Turn lifecycle `src/lib/chat/pipeline.ts` + `useTurn` — routing, selecting, loading, generating,
  first token, completed; an empty answer is reported as a failure, errors persist until dismissed
- Flow strip above the composer (MODEL → SEMANTIC → ROUTE → TOOL → SYNTH → ANSWER) and an inline
  model switch beside the composer
- Deterministic asset classification `classifyAsset()` — user override, registry, symbol heuristic,
  each carrying source and confidence; widened baskets (BTC, ETH, store of value, stables, DeFi, AI,
  L1, L2, gaming, memes, stocks)
- Portfolio: by-basket and by-asset sorting, venue chips (perp / spot / lp / equity / notional),
  expandable position rows with the raw venue payload

## Next

1. `/goal` as a bounded mode of the same command registry (2 cycles local, unbounded call count on
   cloud but always deadline-capped and cancellable).
2. Journal-specific benchmark of MiniLM vs LFM 2.5 Encoder-230M before changing the default;
   evaluate LFM2.5-Embedding-230M (Q4_K_M, ~229 MB) as the production bi-encoder.
3. Persist the flow trace per turn so a finished answer can be re-inspected from the log tab.
4. Search providers (Tavily, DuckDuckGo) behind the EXTERNAL access level.
5. Approval previews rendered for every WRITE/EDIT/DELETE tool call from a skill.
6. Skill results wired into the reconcile wizard (pre-fill from `journal.filter`, no model).
7. Venue read tools beyond Hyperliquid (velodrome, inkyswap, nado, tydro) — read/parse/collect only.
8. Charts group: indicator series over journal history.
9. `/trade` — only after the journal loop is complete. Execution stays behind explicit approval.

## Out of scope

- MCP server
- Server-side LLM, accounts, database
- Venue execution
