# Inko agent runtime — intents, commands, tools

Extends the existing architecture. No second agent stack: `/goal` is a **mode**
of the same command system, not a parallel runtime.

```
user text
   │  (encoder or keywords)
intent            what the user means
   │
command           what the app can do — semantic, argument-typed
   │
tools             deterministic reads, computes, writes
   │
result            compact CommandResult
   │
model             only when prose or judgement is required
```

## Layers

| Layer | File | Rule |
| --- | --- | --- |
| Command contract | `src/lib/commands/types.ts` | Status, reason, diagnostics, next action. |
| Registry | `src/lib/commands/registry.ts` | One line per command; all the model ever sees. |
| Executors | `src/lib/commands/{journal,portfolio}.ts` | Collect → aggregate → answer. Never return raw rows. |
| Runner | `src/lib/commands/runner.ts` | Validation, retries, timeout, cancellation, approval, logging. |
| Embeddings | `src/lib/ai/embedding.ts` | Tiered providers; the encoder facade delegates here. |

## Collect → aggregate → model

The model never scans the journal. `journal.resolve_inbox` gathers every pending
trade, aggregates what is missing, and asks **one** question that resolves many
rows. `journal.apply_answer` writes the answer back in a single batch.

## Limits

| Limit | Local | Cloud |
| --- | --- | --- |
| tool hops per turn | 5 | 5 |
| goal cycles | 2 | unbounded by count |
| calls per cycle | 5 | unbounded |
| total steps | 10 | unbounded |
| retries | 1, transient only | same |
| wall-clock deadline | 120 s | 120 s — always enforced |
| per-command timeout | 30 s | 30 s |
| cancellation | always | always |

Cloud drops the *semantic* call cap only. Deadline, per-request timeout and
cancellation stay so a malformed agent can never hang a session.

## Approval

Access level decides. `READ`/`COMPUTE` run immediately; `WRITE`/`EDIT`/`DELETE`/
`EXECUTE`/`EXTERNAL` render the intended change and wait. Every run is logged
with duration, tool count and whether a model was involved.

## Embedding

One provider: the LFM 2.5 Encoder-230M (768 dimensions, 180 MB Q8). It does
everything the old MiniLM tier did — vectors, semantics, classification — at
higher capacity, so the two-tier cheap-then-escalate design collapsed to a
single always-warm encoder. The encoder is warmed on the first message and
never goes cold; routing always has vectors when it needs them. Nothing
downloads automatically, and routing degrades to keywords when the encoder is
absent.
