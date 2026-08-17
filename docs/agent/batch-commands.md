# Batch commands

Batch and aggregate commands intentionally represent many low-level reads or writes as one capability. Examples include `journal.resolve_inbox`, `journal.apply_answer`, and `portfolio.snapshot`.

Every capability carries a `batchMode` (`single`, `batch`, `aggregate`, `workspace`) in the registry. That metadata is the future batching surface: one agent-visible tool call that performs several internal tool calls and returns one observation, costing a single hop against the tool budget.

## Spec only, deliberately

This is specced, not built. The deterministic command loop stays the primary execution path: agent-initiated tool hopping is out of scope until small models can carry it. Even fine-tuned ~350M tool-callers reach only 96 to 98 percent call accuracy (Distil Labs), which is fine for advisory suggestions and not fine for an execution loop. When batching lands it will wrap `runCommand` calls, inherit the same policy, approval and trace rules, and surface as one observation per batch in the turn.
