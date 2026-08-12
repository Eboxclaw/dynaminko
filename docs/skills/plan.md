# skill: plan.create / capture.tidy

Purpose: propose next steps, and rewrite rough notes.

Actions:
- plan.create — next steps from stale theses and unanswered signals
- capture.tidy — rewrite a note into two sentences

Tools:
- plan.create: thesis.read, signal.coverage, indicators.potIndex
- capture.tidy: none (no data access)

AI required: yes for both.

Flow:

```text
plan.create: thesis.read + signal.coverage + indicators.potIndex
           → structured result → AI proposes steps → approval preview → write
capture.tidy: note → AI rewrite → user keeps or discards
```

Output (plan.create):

```json
{ "coverage":{"signals":40,"linked":31,"inbox":9},
  "stale":[{"id":"t2","title":"Privacy basket","days":63}],"openTheses":5 }
```

Approval: nothing is written without an explicit approval preview.
Logging: skill invocation logged; every write logged.
