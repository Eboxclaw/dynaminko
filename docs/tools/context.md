# tool group: context

Purpose: read back data that outgrew an observation. No model.

When a tool or command result is bigger than the observation cap
(`MAX_OBSERVATION_CHARS`), its middle is dropped from what the model sees and
the full payload is parked in the IndexedDB cache under a short key. The key
rides on the tool card as `offloadKey` and, later, on the observation. This
group reads it back.

| tool | access | inputs | output | approval | logged |
| --- | --- | --- | --- | --- | --- |
| context.readOffload | READ | `{ key }` | `unknown` | no | optional |

`context.readOffload({ key })` → the full parked payload, or `null` when the
key is not an offload key, is missing, or the payload no longer exists on this
device. Offload is per-turn scratch space: a capped index trims the oldest
keys, so very old keys may have been evicted.

Example call:

```json
{ "tool": "context.readOffload", "input": { "key": "offload:9f3a…" } }
```

Example result:

```json
{ "cards": [ "…the complete, untruncated result…" ] }
```

When to use: when a tool card shows a truncated result and the full payload is
needed. Reach it via `/tool context.readOffload {key}`; it is not offered on the
model-chosen hop while there is no hop loop to act on a key in the prompt.
