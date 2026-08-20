# Agent console as an inline chat, model harness settings, and a positions spec

Three pieces of work: turn `/agents` into a session-aware inline chat with slash commands, give the local model harness the settings a real harness has (context window, download detection, RAM-based recommendation, vision/reasoning toggles), and write the venue positions integration spec as a project doc. Plus a small dashboard fix.

## 1. Agents tab becomes an inline chat

Replace the five flat sub-tabs (Agents / Models / Skills / Tools / Log / Ask) with a single chat surface plus a slim right rail. Nothing in the tool or skill registry changes — the chat is a new front end over `runSkill` and the registry that already exist.

Layout:

```text
┌──────────────────────────────┬─────────────┐
│ session transcript           │ rail:       │
│  · user / assistant / tool   │  Model      │
│  · tool + skill result cards │  Agents     │
│                              │  Tools      │
├──────────────────────────────┤  Skills     │
│ > /skill motive …   [vision] │  Log        │
└──────────────────────────────┴─────────────┘
```

- The composer accepts plain text or a slash command. Typing `/` opens an inline picker listing skills and tool groups, filtered as you type, with the access badge (READ / COMPUTE / WRITE) shown next to each.
- Commands: `/skill <id>`, `/tool <group.action>`, `/journal <query>`, `/thesis <name>`, `/pot`, `/model`, `/clear`, `/help`. Arguments autocomplete from real data (thesis titles, motives, tickers) — not free text guessing.
- Every command runs its deterministic half first and renders the computed facts as a result card. The model is only invoked when the skill declares `aiRequired`, or when the user asks in prose. No model loaded means the facts still show, with a "load a model" affordance.
- Plain prose without a slash gets routed: a small deterministic router matches the message against skill keywords and journal/thesis nouns, picks the best skill, and says which one it picked before running it. If nothing matches and a model is loaded, the message goes to the model with a compact context header only.

Session and context awareness (deliberately light):

- One in-memory session per visit, persisted to the local doc store as a capped list (last N turns, trimmed by token estimate) so the tab survives navigation.
- Context header sent to the model is a compact digest, never the journal: active wallet, counts (signals / entries / theses / inbox), POT score, and the titles of open theses. Anything deeper is fetched by a tool call on demand.
- Result cards from tool calls stay in the transcript and are re-sent to the model as compact JSON, so follow-ups ("why?") work without re-running everything.
- Mutating tools (WRITE / EDIT / DELETE) render an approval card in the transcript — tool, target, changes, "Approval required" — and do nothing until confirmed. Every call is logged to the existing log store, viewable from the rail.

Rail panels are the old sub-tabs, condensed to read-only reference: current model + status, the automation agents with their on/off state, the tool registry with live/not-built flags, skills, and the activity log. They open as a side sheet on mobile.

## 2. Model harness settings

In the rail's Model panel (and reachable via `/model`):

- **Context window** — a slider (1024 / 2048 / 4096 / 8192) that actually feeds `n_ctx` at load time, instead of the hardcoded 2048. Shows an estimated memory cost and warns when the choice exceeds the device budget.
- **Already downloaded?** — check the Cache API / wllama cache for each model's files and badge it "on device" vs "download". No re-download when it's cached.
- **RAM-based recommendation** — read `navigator.deviceMemory` (plus hardware concurrency and the existing WebGPU/SIMD probe in `src/lib/capabilities.ts`) and pick the highest LFM 2.5 tier the device can carry, aiming at **2.6B VL Q4_K_M** and stepping down 1.2B → 450M VL → 230M encoder. The recommended row is marked, with a one-line reason ("8 GB reported — 2.6B VL fits").
- **Vision / Reasoning / Thinking** — three toggles in the composer, enabled only when the loaded model supports them: vision on the VL models (adds an image attach button that passes the image through wllama's multimodal path), reasoning and thinking as prompt-level modes that change the system prompt and token budget, with thinking output rendered collapsed above the answer.
- Generation basics that a harness is expected to expose and nothing more: temperature, max tokens, and a stop button on a running generation.

## 3. Dashboard card centering

Center the dashboard's card grid within its container and cap the content width so the cards do not sit left-aligned on wide viewports; keep the existing mobile stacking.

## 4. Positions integration spec doc

Add `docs/positions-integration.md` containing the Velodrome / InkySwap / Nado / Hyperliquid spec verbatim in structure: wallet model (main read wallet reused for Hyperliquid; trading-account references added as child `WalletRef`s), per-protocol verified addresses and endpoints, read paths, data-model changes (`WalletRef` parent/subaccount field, a new `Position` type with `venue` / `kind` / venue-specific ids / common notional + PnL subset), worker placement in the market worker with `Promise.allSettled` per venue, and the open questions (Sugar ABI, Ink indexer availability, InkySwap read cost, LP PnL as a later spec).

Applied where it is cheap and non-speculative now:

- Extend `src/lib/venues/index.ts` docs and the `VenueReport` shape notes to match the spec's vocabulary.
- Wire the **Nado** reader for real: subaccount discovery via the archive endpoint, then `subaccount_info` per subaccount — both are unauthenticated wallet-scoped REST reads.
- Extend the **Hyperliquid** reader with spot balances, subaccounts and vault equities alongside the existing `clearinghouseState` call.
- Velodrome and InkySwap stay `pending` with the note pointing at the spec's open questions, since both need contract-level work and an ABI check first.
- Add the corresponding registry entries and refresh `docs/tools/chain.md` so `scripts/check-docs.mjs` stays green.

## Technical notes

- Chat state lives in a new `src/lib/chat/` module (session type, router, slash command registry) so `src/routes/agents.tsx` stays a view.
- Slash commands resolve against `src/lib/tools/registry.ts` and `src/lib/skills/registry.ts` — one source of truth, no duplicated command list.
- Context digest and transcript trimming are pure functions with a token estimate, kept well under the selected `n_ctx`.
- `loadModel` gains an options argument for `n_ctx`; the cache probe is a separate helper so the UI can call it without loading anything.
- No new dependencies; everything runs on wllama, Cache API and existing browser probes.
