# Agent context

Every model turn is assembled by one builder, `buildTurn` in `src/lib/agent/context.ts`. It produces a native messages array (`system` first, role-per-turn history, current `user` last) instead of one concatenated string, so the model applies its own chat template (ChatML for the LFM family). Every section reports `{name, text, estTokens, truncated}` and the section table lands in the transcript as a `context.build` card, so any turn's prompt is auditable after the fact.

## Sections

Fixed order, budget-aware:

- `CORE` — Inko profile instructions plus the per-call instruction line (the analyst prompt for skill turns).
- `STATE` — the journal digest line: wallet, entries, extracted trades, theses, POT score, open theses.
- `CAPABILITIES` — the one-line-per-capability book (always, all live capabilities) plus full detail blocks for only the top 5 capabilities selected for this turn. Selection is keyword-first, then the cached encoder; the reason rides along in the `context.build` card.
- `OBSERVATIONS` — structured results from this turn's tools and commands (`ToolObservation`), the same data the transcript cards show.
- `RECORDS` — retrieved journal lines for grounded turns (a handful, never the journal).
- `HISTORY` — prior turns, compacted to fit.
- `COMPACTION` — marker row (not sent to the model) recording how many middle turns were dropped.

## Budget and compaction

Budget is the ctx setting minus a generation reserve (currently `floor(ctx * 0.75)` for the prompt). Fixed sections are spent first; history gets the remainder with head+tail compaction: the first user turn anchors the topic, the newest turns carry it, the middle collapses to one dropped-turn count. Tool cards compact to a single line each (`tool source: first fact`). If nothing fits, history becomes an explicit "transcript too large" marker so the model knows a transcript exists. At ctx 32128 a 60-turn history fits whole (~8k tokens); at ctx 8192 the middle drops.

## Where the old flow went

Before Phase 4 the console concatenated `inkoSystemPrompt` with the first 20 full capability blocks regardless of relevance, jammed history into the user string, and capped ctx at 8192. The 20-block injection (~1017 tokens for 20 capabilities) is replaced by the full 41-capability book (~988 tokens, one line each) plus 5 relevant detail blocks.

## Research notes

- Sectioned, labeled, just-in-time context and head+tail compaction follow Anthropic's effective context engineering guidance: smallest set of high-signal tokens, labeled structure, retrieve only what the turn needs.
- llama.cpp supports prompt prefix caching (`cache_prompt`) but wllama exposes no session API, so KV reuse across turns is a documented non-option for the browser runtime.
- Tool and capability descriptions stay terse by design: on small models they are a permanent context tax (Liquid tool-use guidance).
