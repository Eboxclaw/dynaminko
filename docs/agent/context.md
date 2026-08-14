# Agent context

Every model turn is assembled as Inko context: identity and app rules, a compact capability catalogue, turn observations from deterministic tools and commands, retrieved workspace facts, and recent conversation. Tool and command cards and model observations are derived from the same structured results.

Small local models need an explicit budget. The 2K profile is the default planning target:

- Base contract: 150 tokens, fixed.
- Capability catalogue: 250 tokens, compressed and shortlisted.
- Workspace pack / retrieval: 500 tokens, variable.
- Tool observations: 200 tokens, variable.
- Conversation history: 300 tokens, trim oldest first.
- Generation reserve: 600 tokens minimum.

Trim order is conversation history, workspace pack, then tool observations. Do not trim the base contract or the compact catalogue below their minimum safety content.
