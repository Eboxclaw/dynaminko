# tool group: alerts + notify

Purpose: price, on-chain and thesis-review triggers, and the browser notification channel.

| tool              | access   | inputs           | output            | approval | logged   |
| ----------------- | -------- | ---------------- | ----------------- | -------- | -------- |
| alerts.read       | READ     | none             | `Alert[]`         | no       | optional |
| alerts.create     | WRITE    | `Partial<Alert>` | `Alert`           | yes      | always   |
| alerts.edit       | EDIT     | `{id,patch}`     | void              | yes      | always   |
| alerts.delete     | DELETE   | `{id}`           | void              | explicit | always   |
| notify.permission | EXTERNAL | none             | `PermissionState` | explicit | always   |

`Alert`: `id,kind(price|onchain|thesis-review),symbol,direction,target,thesisId,everyDays,note,enabled,lastFiredAt,createdAt`

Example call:

```json
{
  "tool": "alerts.create",
  "input": { "kind": "price", "symbol": "ETH", "direction": "below", "target": 2000 }
}
```

Approval preview shown before running:

```
Tool: alerts.create
Target: new alert
Changes: ETH below 2000
Approval required: YES
```
