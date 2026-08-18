# Batch commands

Batch and aggregate commands intentionally represent many low-level reads or writes as one capability. Examples include `journal.resolve_inbox`, `journal.apply_answer`, and `portfolio.snapshot`.

Every capability carries a `batchMode` (`single`, `batch`, `aggregate`, `workspace`) in the registry. That metadata is the future batching surface: one agent-visible tool call that performs several internal tool calls and returns one observation, costing a single hop against the tool budget.

## v1 shipped, batching still spec

The single-hop agent loop shipped (Phase 4a): one grammar-constrained tool choice per grounded turn, read-only capabilities only, see docs/agent/context.md. That is deliberately not batching. This file's batching surface (one agent-visible call performing several internal `runCommand` calls, one observation per batch) stays specced only: the deterministic command loop remains the primary execution path, and write-tier work still requires explicit approval.
