# skill: thesis.review

Purpose: judge one thesis against everything traded under it.

Actions:
- review a thesis
- review a thesis against the journal

Tools:
- thesis.read, thesis.stats, journal.filter

AI required: yes — the qualitative half (strongest point, what would break it).
Tools do all retrieval and arithmetic first; the model receives at most ten
recent records plus the computed stats.

Flow:

```text
intent → thesis.read → thesis.stats(id) → journal.filter(thesisId, limit 10)
       → structured result → AI judgement → user
```

Output:

```json
{ "thesisId":"t1","title":"L2 fee compression","entries":6,"trades":5,
  "alignmentRate":0.8,"staleDays":41,
  "recent":[{"date":1754870000000,"ticker":"ETH","alignment":"aligned","record":"..."}] }
```

Approval: none to read. Any edit it suggests routes through `thesis.edit` with an approval preview.
Logging: skill invocation logged; mutations always logged.

Model note: if no model is downloaded, the structured result is still shown and the UI points at the Agents tab.
