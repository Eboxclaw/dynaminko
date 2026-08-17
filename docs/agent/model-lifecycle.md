# Model lifecycle

Generation models keep three independent facts: selected model id, downloaded cache state, and loaded model id. Selecting a model never loads or downloads it. Chat never installs a model. Download is an explicit user action; loading and rotation require the target model to already be downloaded. Rotation unloads the resident runtime before loading the requested cached model.

## Context window choices

`CTX_CHOICES` is `1024, 2048, 4096, 8192, 16384, 32128`. Each choice is capped per model by `spec.maxCtx`: the 450M VL and 1.2B top out at 32128 (their real ceiling), the 2.6B allows far more, the 230M encoder stays at 8192. Choices above a model's ceiling render disabled in the ModelPanel. The default stays 8192 for mobile safety; 16384 and 32128 exist because the sectioned turn builder can actually use them (a 60-turn history is about 8k tokens). The panel's working-set estimate (`memoryEstimateGb`) turns red when the estimate exceeds what the device reports, and a ctx change on a loaded model needs a reload to apply.
