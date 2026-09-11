# HANDOVER · Inko "Proof of Thesis" · agent-reliability phase

Written 2026-09-11 so a fresh session in a fresh folder can continue with
zero prior context. Read top to bottom, then work phase by phase.

## Where things stand

- Canonical repo: https://github.com/Eboxclaw/dynaminko (main). Vercel
  auto-deploys main. This clone: /Users/cristianovb/Desktop/Inko/dynaminko
  (temporary: move it OUT of iCloud-synced Desktop, see Working rules).
- main = f0cf654 "fix(agent): small-model harness reliability". On top of
  69f4560 (PR #16 audit merge) and 84e9ab8 (roster swap + everything from
  the perf phase). 330 tests + tsc + build green at f0cf654.
- The old workspace (Desktop/Inko with the notes/ folder) was purged in
  the disk-full crisis and is NOT recoverable locally; everything
  essential is either on GitHub or in this file.
- Roster today: LFM 2.5 2.6B, Qwen3.8 2B Distill, LFM 2.5 350M,
  LFM 2.5 230M (added 09-04, verified upstream), LFM 2.5 450M VL +
  encoder pair. Thinking ABILITY lives on 2.6B + Qwen (reasoning: true);
  the standalone 350M-Thinking card was removed on purpose.

## What the reliability phase changed (all shipped, all tested by suite)

1. Same-tool hop cap is armed. hops.ts: hopKey joins with "|",
   hopToolId(key) is the ONLY sanctioned parser; the orchestrator counts
   runs through it. A junk-query loop can no longer run to the hop budget.
2. Search-input rule: tools/types.ts searchQueryProblem + isSearchTool.
   Search tools reject empty/short/no-letter queries BEFORE execution;
   the hop settles "rejected" (new StageState) and a structured
   observation redirects the planner. Rejected hops count toward the cap.
3. Routing normalization + first-class portfolio domain:
   chat/route.ts normalizeRoutingText (portefolio/potfolio typos, "how s"
   contractions) runs before ALL deterministic intent checks, and
   isPortfolioStatusQuery floors any current-holdings/exposure/net-worth
   question to portfolio.snapshot deterministically (advice and write
   intents excluded). The retrieval receipt filter reads normalized text.
   Regression test uses the EXACT failing query:
   "hello agent how s my portefolio doing ?"
4. Decide view A/B pin: #decideView=head|lean (hash, default head).
   Lean = DECIDE_SYSTEM alone + facts/portfolio riding the user turn
   beside the menu (pre-e6c1ff3 placement). Per-hop picks log to the
   agent log (view, tool, query, why) and __lastDecide keeps 10 raws.
   No default change until the A/B data says so (AGENTS.md #7 supports
   sparse context for small models).
5. Encoder residency invariant + diagnostics: selecting the 2.6B drops
   the stale LFM embedder slot + worker handle (enforceEncoderResidency);
   /usage prints an encoder line: active semantic provider, every
   resident provider with approximate MB (x2 under WebGPU), chat holder.
   Pooling finding (code-level): the worker's createEmbedding ignores the
   generic mean-pool option, so the LFM path embeds with the GGUF's own
   pooling (CLS per its card); MiniLM mean-pools per its card.

## Measured numbers worth knowing (from the purged notes, re-recorded)

- 2.6B prefill dominates: full prefill ~10ms/t single-thread WebGPU
  (IAB); turn-1 hello ttft 22591ms at ctx 32128 with no warm.
- Semantic prewarm (shipped, ee4ac2e): idle 1-token completion over a
  byte-prefix of the turn prompt. 350M: ttft 5361 -> 803ms with index
  warm (~2087t parked). 2.6B: 22591 -> 6663ms (3.4x). Prewarm cancels on
  typing/sending. Pins: #prewarm=none|tiny|core|index|head.
- KV slot reuse: turn-2 ttft 563ms on 350M; historical 4250 vs 16543ms
  on 2.6B (?forceCache=0|1 pin).
- /context prints the session ledger (window, output reserve, margin,
  CORE/MEMORY/CAPABILITY INDEX/FACTS/PORTFOLIO, EQUIPPED SKILLS/TOOLS,
  HISTORY/OBSERVATIONS/RECORDS, USER PROMPT, USED, AVAILABLE INPUT).
- Budget model: inputBudget = ctx - outputReserve(maxTokens slider) -
  5% margin (allocateContext in chat/context). Max tokens slider ceiling
  = the selected window. DEFAULT_CTX 32128. budgetGuard audits KV dtype,
  WebGPU weight residency (x2 off-VRAM), encoder co-residency, and
  escapes to CPU when only the WebGPU math overflows.

## Phase 0 · setup in the new folder (do first)

1. Clone OUTSIDE iCloud sync: git clone
   https://github.com/Eboxclaw/dynaminko.git ~/repos/inko && cd ~/repos/inko
   (iCloud Desktop sync purged the old workspace under disk pressure;
   a git repo must not live there. Also keep 20GB+ free.)
2. bun install; bun run test (expect 330 pass); bunx tsc --noEmit;
   bun run build. All must be green before anything else.
3. bun run dev (note the port from the log; 8080/8081 both seen).

## Phase 1 · in-app verification gate (the pending gate)

Run the app in a real browser (the in-app browser; test the UI always).
Load a LOCAL model in the model panel (230M or 350M first, then 2.6B),
then send the exact failing prompt:
  hello agent how s my portefolio doing ?
Acceptance, per model:
- GOOD: portfolio.snapshot runs deterministically (router pick, "how is
  my portfolio" or "portfolio-status domain"), or hop 1 is
  portfolio.read; the answer carries real holdings numbers.
- BAD (must not happen): journal.search runs, or runs twice+; receipts
  ("Received ... XVELO") presented as holdings.
Also check /usage: the encoder line names exactly one resident semantic
provider (LFM embedder for 230M/350M; "minilm fallback" note for 2.6B),
and the runtime/budget lines print. Repeat on 230M, 350M, 2.6B with
identical settings. Record results in docs/ (create
docs/verification-gate.md) and flag anything that fails instead of
looping.

## Phase 2 · decide A/B (small models)

With #decideView=lean and =head, run the same portfolio + journal
questions on 230M and 350M. Compare tool selection AND arguments
(agent log "agent · decide" entries + __lastDecide.picks). Only if lean
measurably picks better on small models, propose flipping the default
as its own change with the data attached.

## Phase 3 · pooling live probe

Dev probe: same fixed query/corpus fixture embedded by both providers;
record provider, vector dimensions (LFM 1024, MiniLM 384), top-k
rankings. Confirms the CLS-vs-mean finding live and separates
orchestration problems from embedding-quality problems.

## Phase 4 · output-reservation benchmark

Max tokens (the output reserve) arms: 2048 / 4096 / 8192 / dynamic.
Measure TTFT, retained context (shedding per /context), answer quality,
failure rate on a fixed question set. No default change without data.

## Phase 5 · reasoning-budget sweep

?forceBudget=256..16384 overrides the registry budget at load. Sweep
512/1024/1536/2048/3072/4096/6144 per reasoning model (2.6B, Qwen 2B)
with a fixed suite (a greeting, a portfolio read, a journal search, an
advice question). Score correctness, tool-selection, TTFT, timeouts.
NEVER go below 2048 (user rule) unless the user approves it; pick the
smallest budget that holds quality. Suite sketch in the git history of
the old notes was lost; rebuild it as docs/budget-sweep.md.

## Phase 6 · phone pass

notes/12 protocol was purged with the old tree; the essentials: test the
DEPLOYED https://proof-of-theses.vercel.app (secure context required for
WebGPU; it serves COOP/COEP), Android via adb + chrome_devtools_remote
CDP (adb installed via brew), iOS via safaridriver (safari:deviceUDID),
fallback = 3-minute manual paste protocol (prompts A "hello" /
B "summarize my portfolio in three bullets" / C "why did I buy INKO?",
/usage after each, background/foreground survival, 3x thermal series).
Fill a fresh docs/phone-pass.md.

## Phase 7 · Nado + HyperLiquid MCPs (research first)

Indexed MCP surface: compact index + small dedicated calls, well
categorized, so even the 230M/350M can pick correctly; equip-on-decide.
Research before code; document in docs/mcp-research.md.

## Working rules (standing, from the user)

- Test through the UI always. For zai (cloud) tests use glm-5-turbo; if
  zai calls fail, check the implementation or the model name first, the
  key itself is verified good.
- Phase by phase; flag and move on instead of looping on something the
  user did not ask to fix; never take rushed conclusions after a fix.
- Fetch before every push; ask before pushing unless the user said
  ship-as-tested (current standing instruction: ship once tested).
- Commits: eitherbox@proton.me / Eboxclaw. NEVER use em or en dashes in
  any writing. Explain any deletion before doing it.
- No new dependencies in the PWA without need; browser-safe code only.
- The in-app browser (IAB) is a correctness harness only, never a perf
  source. 2048 reasoning budget floor until a sweep says otherwise.
- Test wallet 0xBb6a...ebf7 is never hardcoded.
- Code is the source of truth over docs; blast-radius check every
  change; UI-touching changes get a real-browser screenshot pass.

## Diagnostics cheat sheet

- /usage: perf phases, runtime path (backend, threads, gpu layers, ctx,
  batch, cache k/v, flash-attn, cache-reuse), device line, budget
  ledger, semantic/encoder line, gen line (ttft/decode/reuse).
- /context: the session allocation ledger table.
- window.__lastDecide: last decide pick(s) with raw outputs; window.__perf.
- Pins: ?forceDecide=1, ?forceBackend=webgpu|wasm, ?forceFa=0|1,
  ?forceCache=0|1, ?forceBudget=N, #prewarm=..., #decideView=head|lean.

## Added 2026-09-11 · speed and footprint workstream (user request)

Standing additions to the plan, research first, PWA and infra constraints
apply to every change. First pass findings: docs/speed-research.md.

- S8a lighter loads: SHIPPED in 278e05f. Every local model starts at a
  32k window (inko.ctx.v2 retires stale maxima; users raise from the
  panel), Reason and Thinking cold-start OFF. Measured: the 2.6B went
  from UNSAFE 6.46GB, 43s ttft, 20.1 tok/s to 4.73GB, 4.3s ttft,
  88.2 tok/s on the same prompt.
- S8b encode/decode speed: study and improve prefill, decode, KV reuse
  (the cross-turn prefix miss is the first suspect).
- S8c device speed: Android and Mac laptop paths (threads, COOP/COEP,
  KV dtype, gpu layers, thermal).
- S8d semantic memory and deterministic paths: faster and more accurate
  routing, parsing and indexing for the registries we have.
- Test order stays 350M first; answers tested with Reason and Thinking
  off (the new default).
