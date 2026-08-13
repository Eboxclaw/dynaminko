# Model lifecycle

Generation models keep three independent facts: selected model id, downloaded cache state, and loaded model id. Selecting a model never loads or downloads it. Chat never installs a model. Download is an explicit user action; loading and rotation require the target model to already be downloaded. Rotation unloads the resident runtime before loading the requested cached model.
