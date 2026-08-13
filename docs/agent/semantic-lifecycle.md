# Semantic lifecycle

Semantic encoders use the same separation as generation models: selected provider, downloaded cache state, and loaded provider. Automatic routing may use an already-loaded provider only. It must not download or implicitly load an encoder; when none is loaded, routing falls back to deterministic aliases and keywords.
