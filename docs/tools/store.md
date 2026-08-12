# tool group: thesis + log

Purpose: direct access to the two remaining local-document collections.

| tool | access | inputs | output | approval | logged |
| --- | --- | --- | --- | --- | --- |
| thesis.read | READ | none | `Thesis[]` | no | optional |
| thesis.edit | EDIT | `{id,patch}` | void | yes | always |
| log.read | READ | none | `LogLine[]` | no | no |

`Thesis`: `id,title,body,symbols[],sector,horizon,conviction,status,createdAt,updatedAt`

Example call:

```json
{ "tool": "thesis.edit", "input": { "id": "t1", "patch": { "status": "invalidated" } } }
```

Approval preview:

```
Tool: thesis.edit
Target: t1 "L2 fee compression"
Changes: status → invalidated
Approval required: YES
```
