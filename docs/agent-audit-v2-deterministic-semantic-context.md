# Agent v2 audit — deterministic, semantic, skills and context

Date: 2026-08-30

This is a code-level follow-up to `docs/agent-audit-inference-context.md` and `docs/AI_RUNTIME_V2.md`. The focus here is not model quality; it is the work done **before and around inference** that can make the mobile agent slow, inconsistent, or silently choose the wrong path.

## Executive finding

The architecture is conceptually correct, but there are several duplicated/serial paths. The biggest issue is that the system currently has **three overlapping capability representations** (commands, tools, skills) and repeatedly rebuilds/ranks them per turn. Composed skills also execute their component tools sequentially even when they are independent, and several tools recompute the same underlying portfolio/venue state.

The result can be:

```text
user
 ↓
deterministic route
 ↓
semantic route
 ↓
skill
 ↓
tool A
 ↓
tool B
 ↓
tool C
 ↓
context selection
 ↓
observation serialization
 ↓
context assembly
 ↓
model
```

when the desired path is closer to:

```text
user
 ↓
fast route/cache
 ↓
one compiled capability
 ↓
parallel deterministic reads from one snapshot
 ↓
one compact evidence object
 ↓
model only if needed
```

## P0 findings

### P0-1 — Composed skills are serial when they can be parallel

`runComposedSkill()` does `await runStep(stepId)` inside a loop. `wallet.holdings` therefore waits for `portfolio.read`, then `portfolio.netWorth`, then `portfolio.positions-perps`. `inbox.review` similarly waits for two independent operations, and `trades.open` waits for positions before net worth. fileciteturn31file0

**Fix:** run independent steps with `Promise.all`, while retaining deterministic ordering in the assembled result. For steps with true data dependencies, declare the dependency explicitly instead of relying on array order.

### P0-2 — Skills duplicate expensive data reads

`wallet.holdings` asks for `portfolio.read`, `portfolio.netWorth`, and `portfolio.positions-perps`; `trades.open` asks for positions plus net worth. Those operations can read the same cached snapshots/reports and reconstruct overlapping exposure state. The better abstraction is a single `portfolio.snapshot`/`holdingsPicture` computation that produces the exact slices requested by the skill. The tool registry already describes deterministic portfolio operations as the canonical execution layer. fileciteturn23file0

**Fix:** introduce a per-turn `DataSnapshot` memo/cache keyed by source and freshness. Portfolio tools consume the same snapshot instead of independently importing/read-building it.

### P0-3 — Deterministic aliases can misroute because matching is substring-based

`includesAlias()` uses `q.includes(alias)`. This is intentionally simple, but short aliases such as `holdings`, `allocation`, `positions`, etc. can hit inside unrelated requests. The router then chooses the longest matching phrase, not the semantically best intent. fileciteturn30file0

**Fix:** normalize/tokenize the query and support boundary-aware phrase matching. Separate `strongExactPhrase` aliases from `weakLexicalAliases`. Only strong aliases should trigger execution; weak aliases should become routing candidates.

### P0-4 — Keyword routing bypasses semantic ranking completely

`selectCapabilities()` returns immediately if *any* keyword hit exists. It does not compare the strength of the keyword hit against other candidates or use semantic ranking to disambiguate multiple keyword hits. fileciteturn15file0

This is a correctness problem, not only a speed problem.

**Fix:** score deterministic hits first, but only short-circuit on an exact/strong route. Otherwise combine lexical score + semantic score and choose the winner. Do not make `q.includes(alias)` a binary gate.

### P0-5 — The capability catalogue is rebuilt repeatedly

`capabilityCatalogue()` constructs tool, skill, command and concept definitions on every call. Both deterministic/semantic routing and capability selection call it again. Semantic routing then maps every definition into search text and ranks the whole set. fileciteturn15file0 fileciteturn30file0

**Fix:** build the immutable catalogue once at module scope and expose indexes:

```ts
CAPABILITY_CATALOGUE
CAPABILITY_BY_ID
LEXICAL_INDEX
SEMANTIC_TARGETS
```

No allocations or registry traversal on every user message.

### P0-6 — Semantic routing can perform multiple encoder passes for one turn

The code exposes separate semantic operations for route, discovery, intent classification and capability selection. Each uses the shared encoder queue. The embedding implementation serializes every inference through one queue and can therefore turn several apparently-small routing operations into a latency chain. fileciteturn27file0

**Fix:** make routing a **single batched semantic pass per user turn**. Embed the query once, rank against pre-embedded immutable targets, and return:

```ts
{
  intent,
  bestCapability,
  topCapabilities,
  externality,
  confidence
}
```

Cache the capability target vectors; only the query needs embedding at runtime.

### P0-7 — The 90 MB encoder is a mobile tax for simple requests

The current semantic router uses all-MiniLM-L6-v2 (~90 MB fp32) and serializes all embedding calls. It is useful, but it should not be involved in a deterministic request that already has an exact route. fileciteturn27file0

**Fix:** hard gate semantic routing:

```text
exact deterministic route → 0 encoder work
strong lexical route → 0 encoder work
ambiguous/no route → encoder
```

Also consider a quantized embedding runtime later; do not make the 90 MB encoder a mandatory part of cold mobile startup.

## P0 context bugs / waste

### P0-8 — Observation data is being serialized/clamped more than once

`commandObservation()` stores `result.data` after `clampDataText()`, which converts large JSON into a **string**. `skillObservation()` can similarly store a pre-clamped capture. Later `observationsPrompt()` calls `clampDataText(o.data)` again. Since `clampDataText()` JSON-stringifies its input, a pre-clamped string is JSON-encoded again. This can add quotes/escaping and inflate tokens; it can also make structured evidence harder for a small model to parse. fileciteturn13file0

**Fix:** clamp exactly once at the observation boundary. Keep data typed separately:

```ts
rawData?: unknown
promptData?: string
```

or keep raw data out of the observation entirely and store an offload key. `observationsPrompt()` should never serialize already-rendered prompt text.

### P0-9 — Full observations are used for cost calculation and then rendered again

`buildTurn()` estimates `observationsPrompt(input.observations)` and later calls `observationsPrompt()` again while constructing sections. This repeats JSON serialization and token estimation. The same pattern exists for selected capability text. fileciteturn13file0

**Fix:** compile each section once:

```ts
const compiled = compileObservations(observations)
// { text, estTokens, level }
```

Then use the same compiled object for budgeting and final messages.

### P0-10 — `MAX_OBSERVATION_CHARS = 6000` is huge for a 350M

6,000 characters per observation can be ~1,500 tokens before wrapper text. A skill with several observations can therefore spend thousands of prompt tokens before the model sees the actual user request. fileciteturn13file0

**Fix:** use field-aware digests, not generic character clipping. Default to ~300–800 characters per evidence block for the 350M controller, with explicit escalation when the requested answer requires detail.

### P0-11 — Character-based `length / 4` token estimation is too crude for JSON

The current estimator is intentionally cheap, but JSON with symbols, numbers, punctuation and long identifiers can tokenize very differently from normal prose. This makes context shedding less predictable. fileciteturn26file0

**Fix:** keep the cheap estimator for first-pass routing, but use the model tokenizer once when a turn is near the context boundary. Better still, make the context compiler target a token budget with a small safety margin and log actual prompt size.

### P0-12 — MEMORY is marked never-shed

`buildTurn()` deliberately never sheds memory because it is treated as persistent identity. That is risky on small contexts: a large memory block can displace current evidence, which is more important for a grounded trading answer. fileciteturn13file0

**Fix:** split memory into:

```text
IDENTITY — tiny, always present
PREFERENCES — retrieve only when relevant
HISTORY — retrieve only when relevant
```

Never make the full memory store a protected context section.

## Skills design findings

### S1 — `SkillDef.tools` is too weak a contract

A list of strings cannot express whether steps are independent, dependent, cacheable, optional, expensive, or model-required. `runComposedSkill()` therefore defaults to sequential execution. fileciteturn31file0

Replace it with a declarative execution graph:

```ts
steps: [
  { id: "portfolio.snapshot", parallelGroup: "portfolio", cache: "turn" },
  { id: "portfolio.positions-perps", parallelGroup: "portfolio", cache: "turn" },
]
```

Eventually:

```text
skill → plan → execution graph → evidence compiler
```

### S2 — `aiRequired` is ambiguous

`aiRequired: false` currently means the skill can produce facts without a model, but the skill still has an `aiRole` and can be followed by generation. This creates a conceptual distinction between "skill result" and "skill answer" that the runner must infer.

Use explicit:

```text
answerMode: deterministic | summarize | reason | rewrite
```

Then deterministic skills can end immediately without waking the LLM.

### S3 — Composed skill output duplicates `data` and `facts`

`runComposedSkill()` stores the same logical evidence twice: `data[stepId] = lines` and `facts.push(...lines)`. That is useful for UI, but it increases memory and creates opportunities for the two representations to drift. fileciteturn31file0

Use one canonical `EvidenceBlock[]` and derive UI facts from it.

### S4 — Generic skill fallback can leak raw JSON

`digestStep()`'s default branch does `JSON.stringify(out).slice(0, 200)`. That is explicitly the behavior the specialized digest was designed to avoid. fileciteturn31file0

Unknown tool output should become:

```text
<tool> returned structured data; no model-safe digest available.
```

and either invoke a typed serializer or offload the raw payload.

## Deterministic/semantic architecture I recommend

```text
                    USER
                      │
                      ▼
              Normalize + classify
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
   Exact deterministic       ambiguous
       route                    │
          │                     ▼
          │              ONE MiniLM pass
          │                     │
          └──────────┬──────────┘
                     ▼
               Capability Plan
                     │
                     ▼
              Execution Graph
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
       cache hit   tool A     tool B
                     │          │
                     └────┬─────┘
                          ▼
                    Evidence Compiler
                          │
                    minimal context
                          │
                 ┌────────┴────────┐
                 ▼                 ▼
          deterministic        model needed
             answer                │
                                   ▼
                              350M/1.2B/cloud
```

## The important optimization: turn-level memoization

A single user turn should have one shared execution cache:

```ts
TurnRuntimeCache {
  portfolioSnapshot
  venueReports
  quotes
  journalIndex
  coverage
  potIndex
  thesisIndex
}
```

Each deterministic tool can still exist independently, but when several are invoked by the same skill they consume the same computed state.

This removes the current pattern where three "different" tools repeatedly reconstruct the same picture.

## Mobile target behavior

For a simple request:

```text
"what do I hold?"
→ exact skill
→ one cached portfolio snapshot
→ deterministic compact answer OR one short 350M summary
```

For an ambiguous request:

```text
"how am I doing lately?"
→ one MiniLM query embedding
→ capability plan
→ journal/portfolio reads only
→ compact evidence
→ 350M
```

For a deep request:

```text
"compare my last 20 trades against my thesis"
→ retrieve exact records
→ 1.2B/cloud
```

No MiniLM + 350M + 3 sequential tools should be required for a straightforward deterministic question.

## Priority order

1. **Fix double observation serialization.**
2. **Parallelize composed skill steps.**
3. **Add turn-level memoization for portfolio/journal/venue reads.**
4. **Cache immutable capability catalogue + target vectors.**
5. **Make deterministic aliases boundary-aware and confidence-ranked.**
6. **Collapse semantic routing to one encoder pass per turn.**
7. **Shrink/field-compile observations.**
8. **Split MEMORY into identity vs retrieved memory.**
9. **Replace `SkillDef.tools` with an execution graph.**
10. **Only then tune the LLM backend.**

## Bottom line

I don't think your main problem is currently the 350M model itself.

There is **too much orchestration around it**.

The most suspicious mobile latency path is:

```text
semantic encoder
 → capability catalogue construction
 → skill
 → serial tool calls
 → repeated underlying reads
 → repeated JSON serialization
 → context estimation
 → context serialization
 → model
```

That should become:

```text
exact/one semantic decision
 → shared deterministic snapshot
 → one evidence compilation
 → model
```

That change should improve both **speed and reliability**, because the same duplicated work that costs milliseconds/tokens is also creating multiple representations of the same truth that can drift apart.
