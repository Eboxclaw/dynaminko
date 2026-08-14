# Model lifecycle fix + assistant model UI rework

## Phase A — download ends warm

`downloadModel` in `src/lib/ai.ts` currently calls `unload()` right after a successful load, so a finished download throws the model away and the user has to click again.

- Remove the `await unload()` from `downloadModel`; the module state (`instance`, `currentModel`, `activeBackendValue`) then stays set, so `isReady(modelId)` is true the moment the download ends. Update its doc comment.
- In `src/hooks/useAi.ts` `load()`: on success set `status = { phase: "ready", modelId }`, refresh `loadedCtx` and `backend`, and persist `{ aiModelId: modelId, aiEnabled: true }` instead of dropping back to `idle`. This makes `load()` leave exactly the same state as `activate()`; the only remaining difference is that `load()` may fetch weights and `activate()` refuses to.

Verification: in the running app, pick a model whose state is `missing`, click Download, and confirm the progress percentage runs and the row lands on `loaded · WEBGPU/WASM` with no second click. Reported back before Phase B lands.

## Phase B — separate Download / Load / Unload, per model

`modelState()` already distinguishes disk-cached from memory-resident correctly, so no change there.

- `src/lib/ai/capability.ts`: keep `modelAction()` for compatibility, add a small `modelActions(install, loaded, available)` returning the set of actions that apply (`download` when missing, `load` when cached and not loaded, `unload` when loaded, plus `delete` when cached).
- `src/lib/ai.ts`: add `deleteModel(modelId)` that unloads if that model is resident and removes its entries from the wllama cache manager, so "delete from cache" is a real action and `cachedModels()` reflects it.
- `src/components/pot/ModelPanel.tsx`: drop the single relabeling button at the bottom of the local tab. Each model row instead carries its own compact icon/pill controls on the right: Download, Load, Unload, Delete, wired to `ai.load(id)`, `ai.activate(id)`, `ai.stop()`, and the new delete. Progress percentage, tok/s and errors render inline on the row that is busy.

## Phase C — panel and composer UI

Model settings become sequential cards instead of one long scroll with a cut-off tab strip.

- Rail container in `src/routes/agents.tsx`: give the panel a proper flex column with its own scroll area (header pinned, body scrolls) instead of `max-h-[70vh] overflow-y-auto` on a grid, so the sub-tab strip no longer scrolls out of reach and sub-menus are not clipped. Panels get scroll-margin so opening one scrolls it into view smoothly rather than jumping.
- `ModelPanel` local tab restructured into three stacked cards:
  1. **Provider** — Local / Cloud choice and the active target line.
  2. **Models** — the list with the per-model actions from Phase B and the recommendation chip; the router encoder row moves under it as a secondary line.
  3. **Generation** — context window, temperature, max tokens, with the working-set estimate; diagnostics collapse behind a `?` (HelpDot) instead of standing prose.
- `src/components/pot/ModelSwitch.tsx`: constrain the dropdown to the viewport (max height with internal scroll, flips above/below, bottom sheet on narrow screens) so it can no longer be sized out. It keeps only: pick a local model, pick a configured cloud provider, and "Model settings" which opens the panel card.
- Composer toggles in `src/routes/agents.tsx`: Vision, Reason and Thinking default to on for whatever the active model supports, and reset to that default whenever the active model changes. Unsupported capabilities render disabled and off. No user click needed to get the model's normal behaviour.

## Notes

Purely frontend plus the two lifecycle functions above. No data model, storage or routing change.
