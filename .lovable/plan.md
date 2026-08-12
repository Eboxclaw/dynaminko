# Audit and next steps: deterministic tools first, AI last

Audit of the current build, a documentation cleanup, and a tool/skill layer that keeps the LLM out of work that plain code can do.

## 1. What is shipped and working

| Area | State |
| --- | --- |
| Wallet reads (Ink Blockscout + JSON-RPC, in a worker) | Working |
| Prices (CoinGecko), IndexedDB cache | Working |
| Local document store (theses, signals, entries, alerts, settings, logs) | Working |
| Journal hub `/journal` (inbox, entries, theses, ghosts, filters, bulk resolve) | Working |
| Reconcile wizard, portfolio `/portfolio` with baskets and venues | Working |
| POT Index `/pot` (5 axes, trends, formulas) | Working |
| Alerts `/alerts` + engine + notifications + service worker | Working |
| Agents `/agents` (agents, models, skills, tools, log tabs) | Working, but descriptive only |
| On-device AI (`@wllama/wllama`, LFM 2.5 family) | Loads and chats; not wired to any app task |
| `/trade` | Placeholder |

## 2. What is outdated, duplicated or contradictory

- `PLAN.md`, `ROADMAP.md`, `REVIEW.md` describe **Dynaminko** (dossier cards, Markets/AI Terminal/Vault, SQLite-WASM, Nado execution) — a product that was replaced by the Aug 5 rebuild.
- `README.md` is mostly accurate but stale in three places: it lists SmolLM2/Qwen models (now LFM 2.5), says there is no service worker (there is one), and refers to `docs/archive/` which does not exist.
- Registry duplication: `src/lib/agents/registry.ts` lists tools/skills as prose, while `src/lib/agent/extract.ts` holds the only real tool logic. Two folders (`agent/` vs `agents/`) for one concept.
- Agents tab tool toggles ("Granted"/"Denied") change stored flags nothing reads.

## 3. Documentation cleanup

- Move `PLAN.md`, `ROADMAP.md`, `REVIEW.md` to `docs/archive/` unchanged (research value, clearly marked historical).
- Rewrite `ROADMAP.md` short: sequenced from the real state below.
- Correct the three stale claims in `README.md`; add a short "Agent architecture" section pointing at the new docs.
- Add the deterministic-first principle to `AGENTS.md` (permanent project instruction):
  `Extract → Parse → Index → Calculate → Retrieve → Reason only when necessary.` Plus: AI features must be explicitly opt-in, and any surface needing a model must link the user to `/agents` to download it first.

## 4. Capability map (built as a real registry, not prose)

New `src/lib/tools/` — one module per tool group, each a plain typed function over the local store and existing libs. Every tool carries metadata: `id, group, action, access (READ|COMPUTE|WRITE|EDIT|DELETE|EXECUTE|EXTERNAL), approval, logged, inputs, output`.

Groups derived from the actual implementation:

- `journal` — index, read, search, filter, select, write, edit, delete, compare
- `thesis` — read, search, write, edit, archive, staleness
- `signal` — read, filter, link, dismiss, bulk-resolve
- `portfolio` — read holdings, read baskets, read venues, read transfers
- `market` — quote, history, refresh
- `indicators` — compute POT axes, motive stats, alignment stats, P&L, streaks
- `alerts` — create, edit, delete, trigger, read
- `notify` — permission, send
- `chain` — balance, transfers, tx (READ, EXTERNAL)
- `log` — read, write, clear

Venue groups (`velodrome`, `inkyswap`, `hyperliquid`, `nado`, `tydro`) are declared read/parse/collect only; `execute` stays out of scope and is marked `not built` in the registry, so the UI never offers an action that does not exist.

Skills (orchestration over tools, AI optional):

| Skill | Tools it drives | AI needed |
| --- | --- | --- |
| `journal.review` | journal.index/search/read + indicators | only for the summary |
| `thesis.review` | thesis.read + journal.search + indicators | yes, for the qualitative part |
| `motive.performance` | journal.filter + indicators.compute | only for interpretation |
| `plan.create` | thesis + indicators | yes |
| `charts.read/compare` | market + indicators | no |
| `capture.tidy` | none | yes |

## 5. Skill and tool docs

`docs/skills/<name>.md` and `docs/tools/<group>.md`, each compact and machine-readable using the exact format in the request (name, purpose, when to use, actions, inputs, output shape, example call, example result, approval, logging). Target: under 40 lines each, no prose essays. Generated docs stay in sync with the registry by a check that fails if a registered tool has no doc file.

## 6. Execution flow to implement

```text
User intent
  → skill resolves required actions
  → tools run deterministically (index, filter, read, compute)
  → compact structured result (never the whole journal)
  → AI only if the skill declares reasoning is required
  → answer + approval prompt for any mutation
```

Approval and logging follow the policy table: READ/COMPUTE silent-by-default (optional log), WRITE/EDIT always logged with approval when appropriate, DELETE/EXECUTE/EXTERNAL explicit approval and always logged. Approval renders as a preview card (tool, target, diff, "Approval required: YES") before anything runs.

## 7. Recommended implementation order

1. Doc cleanup and the `AGENTS.md` principle (no code risk).
2. `src/lib/tools/` registry + policy types; port existing logic (extractor, POT index, alerts, portfolio) into it without changing behavior.
3. Wire the Agents tab's Tools tab to the real registry (live/not-built flags, access badge, approval policy) and make the Log tab record actual tool calls.
4. Journal query engine: `journal.index` / `search` / `filter` / `compare` + `indicators.motiveStats` — this alone answers the example flow with zero AI.
5. Skills layer: skill definitions declaring tool chains and an `aiRequired` flag; an Ask surface that runs a skill and shows the structured result even when no model is loaded, with a link to `/agents` to download one when the reasoning step is available.
6. `docs/skills` + `docs/tools` files and the sync check.
7. Only then: extend venue read/parse tools, and revisit `/trade`.

## Technical notes

- Nothing existing is removed; tools wrap current functions so the journal, POT index and alerts keep behaving exactly as today.
- Tools are pure TS over the local store — no network beyond the chain/price readers already in use, no new dependency.
- The AI path stays opt-in: a skill with `aiRequired` returns its structured result plus a "needs a model" state instead of failing when nothing is loaded.
