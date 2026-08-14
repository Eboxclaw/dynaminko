# Semantic lifecycle

The semantic encoder is optional and independent from prose generation. The definitive on-device encoder surface is LFM 2.5 Encoder 230M.

Semantic state is separate from the selected generation model:

- **Download** stores the encoder provider assets.
- **Load** activates the downloaded encoder for routing and retrieval.
- **Unload** stops only the encoder runtime.

Automatic routing may use an already-loaded provider only. It must not download or implicitly load an encoder; when none is loaded, routing falls back to deterministic aliases and keywords. Missing semantic state must never block chat session creation, deterministic command cards, cloud generation, or loaded local generation.
