# tool group: indicators

Purpose: arithmetic over the journal index. Pure COMPUTE, never a model.

| tool                      | access  | inputs       | output                         | approval | logged   |
| ------------------------- | ------- | ------------ | ------------------------------ | -------- | -------- |
| indicators.motiveStats    | COMPUTE | `{motive}`   | `MotiveStats`                  | no       | optional |
| indicators.alignmentStats | COMPUTE | none         | `{total,buckets}`              | no       | optional |
| indicators.potIndex       | COMPUTE | none         | `PotIndex`                     | no       | optional |
| thesis.stats              | COMPUTE | `{thesisId}` | thesis performance             | no       | optional |
| signal.coverage           | COMPUTE | none         | `{signals,linked,inbox,ratio}` | no       | optional |

`MotiveStats`: `motive,trades,entries,tickers[],aligned,partial,deviated,noThesis,disciplineScore,withThesis,totalValue,firstAt,lastAt,topTickers[]`

Example call:

```json
{ "tool": "indicators.motiveStats", "input": { "motive": "fomo" } }
```

Example result:

```json
{
  "motive": "fomo",
  "entries": 7,
  "trades": 6,
  "aligned": 1,
  "partial": 2,
  "deviated": 4,
  "disciplineScore": 0.28,
  "topTickers": [{ "ticker": "PEPE", "count": 3 }]
}
```

When to use: before any qualitative answer about performance or discipline. The model receives this object, not the journal.
