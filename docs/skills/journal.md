# skill: journal.review / motive.performance

Purpose: answer questions about what has been journalled, using tools only.

Actions:
- journal.review — coverage, alignment mix, POT index
- motive.performance — every trade under one motive, with a discipline score

Tools:
- journal.index, journal.filter, indicators.motiveStats
- signal.coverage, indicators.alignmentStats, indicators.potIndex

AI required: no. Reasoning is optional and only interprets the structured result.

Flow:

```text
intent → journal.index → journal.filter(motive) → indicators.motiveStats
       → structured result → [optional] AI summary
```

Output:

```json
{ "motive":"conviction","entries":12,"trades":9,"disciplineScore":0.72,
  "topTickers":[{"ticker":"ETH","count":4}],"totalValue":8100 }
```

Approval: none (read/compute only). Logging: skill invocation logged, no mutations.
