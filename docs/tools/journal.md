# tool group: journal

Purpose: index, retrieve and mutate journal records deterministically. No model.

| tool            | access  | inputs                 | output                                           | approval | logged   |
| --------------- | ------- | ---------------------- | ------------------------------------------------ | -------- | -------- |
| journal.index   | COMPUTE | none                   | `{cards[],tickers[],motives[],theses[],builtAt}` | no       | optional |
| journal.search  | READ    | `{query,limit?}`       | `JournalCard[]`                                  | no       | optional |
| journal.filter  | READ    | `JournalFilter`        | `JournalCard[]`                                  | no       | optional |
| journal.read    | READ    | `{id}`                 | `JournalCard\|null`                              | no       | optional |
| journal.compare | COMPUTE | `{a,b: JournalFilter}` | `{a[],b[]}`                                      | no       | optional |
| journal.write   | WRITE   | `Partial<Entry>`       | `Entry`                                          | yes      | always   |
| journal.delete  | DELETE  | `{id}`                 | void                                             | explicit | always   |

`JournalCard`: `id,type,ticker,date,motive,alignment,size,state,thesisId,tradeId,value,record`

`JournalFilter`: `motive?,ticker?,alignment?,state?,thesisId?,type?,from?,to?,query?,limit?`

Example call:

```json
{ "tool": "journal.filter", "input": { "motive": "conviction", "type": "entry" } }
```

Example result:

```json
[
  {
    "id": "c1",
    "type": "entry",
    "ticker": "ETH",
    "date": 1754870000000,
    "motive": "conviction",
    "alignment": "aligned",
    "size": "starter",
    "state": "logged",
    "thesisId": "t1",
    "tradeId": "0xab:3",
    "value": 420,
    "record": "Added on the L2 fee thesis"
  }
]
```

When to use: any question about what is in the journal. Never ask a model to read cards one by one.
