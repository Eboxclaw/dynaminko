# Model lifecycle

Generation models keep three independent facts: selected model id, downloaded cache state, and loaded model id. Selecting a model never loads or downloads it. Chat never installs a model.

Local generation uses one active runtime slot on this device:

1. **Download** stores model assets in the browser cache. It may briefly warm the runtime because the underlying WASM loader fetches through load, but completion returns to `downloaded` / `not loaded`.
2. **Load** activates an already-downloaded model for chat.
3. **Rotate** verifies the target is downloaded, unloads the resident model, loads the target, and attempts to restore the previous model when target load fails.
4. **Unload** stops the local generation runtime and keeps the selected model id.

Cloud models are never downloaded, loaded, unloaded, or rotated in the WASM sense. A configured cloud provider is an answering backend switch.

The semantic encoder is a separate runtime slot and may stay loaded at the same time as one generation model.
