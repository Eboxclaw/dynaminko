# Agent inference + context flow audit (2026-08-24)

Full pass over the path from user message to answered turn, on the live test
wallet (0xbb6a…ebf7). Findings are root-caused against the architecture
(`Extract → Parse → Index → Calculate → Retrieve → Reason only when necessary`,
one `buildTurn` budget, tools deterministic, model reasons last) and fixed in
the same change set. Measured: LFM 2.5 350M vs LFM 2.5 1.2B Instruct.

## What the agent actually does with a message

1. **Deterministic route** (`src/lib/chat/route.ts`) — longest-alias match over
   commands and the new read skills. No model.
2. **Semantic route** (MiniLM, when installed) — ranks the capability
   catalogue; above 0.75 it pre-runs the command/skill.
3. **`speak()` grounded turn** (`src/routes/agents.tsx`) — retrieval records,
   capability selection, one model-chosen tool hop (`decideAction`, greedy
   JSON under a GBNF schema), then `buildTurn` assembles CORE / FACTS /
   MEMORY / CAPABILITIES / OBSERVATIONS / RECORDS / HISTORY under
   `budgetTokens = ctx * 0.75`, with a shed-1/shed-2 overflow retry chain.
4. **Answer** — `createChatCompletion` in the AI worker; sampling resolved as
   `option.temperature ?? spec.sampling.temperature ?? 0.4`.

Everything below was found by walking that path with the test wallet loaded.

## Findings and fixes

### F1 — "What do you hold" answered from trade-flow, not holdings

`portfolio.snapshot` (the deterministic target of "what do i hold / my
portfolio / holdings / allocation") built baskets from **signal net flow**
(`doc.signals`, `side === "in" ? + : −`), i.e. how much moved, not what the
wallet holds. Real holdings live in `portfolio.read` / `buildPortfolio`.

**Fix** (`src/lib/commands/portfolio.ts`): `snapshot` and `positions` now use
one async `holdingsPicture()` built from the same source the `/portfolio`
page renders: `readCachedSnapshot` + `readCachedVenueReports` + cached quotes
→ `buildPortfolio` + `composeBaskets` + `composeNetWorth` + `openPerps`.
Same numbers, one source, zero model.

### F2 — FACTS portfolio lines were unpriced and thin

`portfolioFactLines()` priced holdings with an empty quotes array, so values
fell back to the on-chain `usd` field (null for Ink-native tokens); baskets
were then computed from null values and could vanish. It also carried no
venue margin or open-perp detail.

**Fix** (`src/lib/chat/context.ts`): price with the same quote map as the
tools, use the wallet + venue-spot merged view, and add compact lines:
`top_holdings` (8), `baskets` (6), `top_positions` (6, per position:
symbol/venue/side/size/entry/notional/uPnL plus leverage/margin/liq when the
venue reports them), `venue_margin` (account equity/available/margin used),
and `position_fields` (which venue fields are not reported). All inside the
never-shed FACTS section, kept tight.

### F3 — `quotes:latest` was a phantom cache key

The biggest data finding. The price pipeline writes
`quotes:<sorted-symbol-set>` with a 60 s TTL (`src/lib/prices-cache.ts`), but
**nothing ever wrote `quotes:latest`** — yet every agent read path
(`portfolio.read`, `portfolio.netWorth`, the new commands, FACTS) reads that
key. Result: the agent priced holdings from on-chain fallback only
(dashboard $1,514 → agent $687 net worth).

**Fix** (`src/lib/prices-cache.ts` + `src/lib/prices.ts`): `fetchQuotes` — the
single price aggregator — now also rolls every resolved quote into a
symbol-agnostic `quotes:latest` map via `mergeLatestQuotes()`. Readers
unchanged; the key finally exists. Verified live: agent now reports
$1,597 wallet / $1,617 net worth, matching the dashboard.

### F4 — Venue granularity: report what exists, name what doesn't

Nado's API exposes per-position side/size/entry/mark/notional/uPnL but **not**
leverage, margin, liquidation price, or TP/SL (margin exists only at the
account level). Hyperliquid exposes per-position leverage/margin/liq but no
resting TP/SL on open positions. The old shape (`ActiveTrade[]`) let models
silently drop `null`s and then invent numbers.

**Fix** (`src/lib/exposure.ts`): new `openPerps()` returning
`{ trades, accounts, gaps }` — account-level margin per venue plus explicit
`gaps` strings naming exactly which fields each venue does not report.
`perpExposure()` stays as a back-compat alias. `portfolio.positions-perps`
returns the new shape.

### F5 — No dedicated read skill per role; tools unreachable on the hop

The model hop could only pick **one** tool, and `DEFAULT_HOP_IDS` omitted
`portfolio.read`, so "what do you hold" could never reach the full holdings
tool when FACTS was insufficient. There were also no wallet/inbox/trades
skills at all (skills were journal/thesis only).

**Fix**: three **composed read skills** (`src/lib/skills/registry.ts` +
`run.ts`) that orchestrate the existing tools/commands and end in a grounded
model step. Each tool stays callable on its own (single-call) via `/tool` and
the hop; the skill composes them (multi-call):

- `wallet.holdings` → `portfolio.read` + `portfolio.netWorth` +
  `portfolio.positions-perps`
- `inbox.review` → `journal.resolve_inbox` + `signal.coverage`
- `trades.open` → `portfolio.positions-perps` + `portfolio.netWorth`

Routing: deterministic aliases (longest-phrase wins across commands and
skills; command beats skill on a tie) so they land without the MiniLM
encoder; aliases also feed the capability catalogue for semantic ranking.
`DEFAULT_HOP_IDS` now includes `portfolio.read` + `portfolio.positions-perps`.

### F6 — Composed skills handed raw JSON to the model; it gave up

First live 1.2B run on the Nado question: the skill returned
`portfolio.positions-perps: 1 result` and the raw nested JSON (20-digit
floats, 9 perps). The model answered "the available data does not include
details about open positions on Nado" — it literally could not parse its own
evidence.

**Fix** (`src/lib/skills/run.ts` → `digestStep`): each step's result becomes
**flat, rounded, model-readable lines** — the same `key: value` discipline as
FACTS — and per-position lines carry **every field as a value or an explicit
`not reported by <venue>`** (omission is what small models fill with
invention). Verified live: after the fix the 1.2B answered "Leverage: not
explicitly reported on Nado (only margin is available at the account
level)" instead of fabricating TP/SL.

### F7 — Inbox had no recency, no detail

`journal.resolve_inbox` returned counts + 5 unsorted examples.

**Fix** (`src/lib/commands/journal.ts`): `pendingList` (12) sorted
**newest-first** with ticker/side/amount/value/venue/date/pnl.

### F8 — Model settings were invisible per answer

Effective sampling was resolved in the worker but never logged; the UI
`temperature` slider (0.4) always shadowed the per-model spec (0.3) because
`useAi` passes it unconditionally; `top_p` is hardcoded 0.9; no `top_k`/seed.

**Fix** (`src/routes/agents.tsx`): after each grounded answer, a structured
`agent.usage` log line records model + quant, effective temperature,
top_p/min_p/repeat penalties, maxTokens, loaded ctx / model max ctx, backend,
estimated prompt tokens, estimated answer tokens, tps, and which sections
were shed. `/usage` now surfaces the last line. (The shadowed-slider point is
noted for a follow-up: make grounded turns use the spec temperature unless the
user moved the slider.)

## Measured: 350M vs 1.2B Instruct (live, test wallet, WebGPU)

Settings captured per answer via `/usage` (both quant QAD-Q4_0, both run
temp 0.2 grounded / top_p 0.9 / min_p 0.15 / repeat 1.05/64 / maxTokens 8192):

|                            | 350M           | 1.2B Instruct    |
| -------------------------- | -------------- | ---------------- |
| context loaded / model max | 8192 / 8192    | 8192 / **32128** |
| backend / tps              | WebGPU / 4.3   | WebGPU / 23.5    |
| prompt size                | ~4243t         | ~4243t           |
| answer size                | ~222t (wallet) | ~83t (wallet)    |

| Question (ground truth)                                                                                            | 350M                                                                                               | 1.2B Instruct                                                                                             |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Wallet holdings ($1,597, 11 tokens: KBTC $545, ETH $528, KRAKMASK $202, BEAST $178, USDC $55…)                     | **Correct** after F6: ~$1509, top holdings and basket split right                                  | **Correct**: $1,508, KBTC $544 / ETH $527 / KRAKMASK $201 / BEAST $177                                    |
| Inbox (200 pending, newest by signal ts: BTC in 0.00278 @ ~$204 2026-08-21, BTC out 0.00278 @ ~$202 2026-08-20, …) | Skill fires; 200 pending + recent rows, newest-first after F7                                      | Skill fires; 200 pending + recent rows                                                                    |
| Nado BTC perp (long, 0.00355, entry 77,441, notional $286, uPnL +$11; lev/TP/SL/margin not reported)               | Hallucinated lev/TP/SL/margin before F6; after F6 reads digest but still drifts (fills 350M-style) | **Correct**: long; lev/TP/SL/margin "not explicitly reported on Nado (margin available at account level)" |

Before F1–F3 the same 1.2B got $687 net worth (unpriced) — the data layer was
the binding constraint, not the model.

## Headroom ("how far can we max this out")

- **Context**: the 1.2B is loaded at 8192 of 32128. `MAX_CONTEXT_MESSAGES`
  (5) and the 0.75 budget are the real caps, not the model. Raising the
  default ctx to 16384/32128 for the 1.2B (and 2.6B) would let FACTS carry
  the full `top_positions` (12) without shedding and keep more HISTORY;
  `memoryEstimateGb` shows the working set fits an 8 GB device at 16k.
- **Sampling**: top_p is hardcoded 0.9 in the worker; no top_k/seed. Making
  top_p per-model in the spec (like `min_p`) is a one-line change.
- **Temperature**: grounded turns force 0.2, but the per-model 0.3 spec is
  shadowed by the UI 0.4 slider; unify to "spec unless the user moved it".
- **Answer reserve**: `max_tokens` default 8192 is never binding for these
  models' answers (25–290t); the 0.75 fraction leaves 25% of ctx for the
  reply, far more than used. Could be 0.8 for the 350M (revisit the 0.85
  target once answers stay short).
- **Model size**: at 4.3 tps the 350M is ~16× slower than the 1.2B on the
  same device and its JSON reading still needs the flat digest; on this
  hardware the 1.2B Instruct is the stronger default for grounded turns,
  with 350M as the phone fallback.

## Verification

- `npx tsc --noEmit` clean; `bun test` 95 pass (11 new); production build
  clean.
- Live on the test wallet: three skills route deterministically, answers
  grounded in real holdings/inbox/Nado data, gaps named explicitly.
