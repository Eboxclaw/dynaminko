import { useCallback, useEffect, useRef, useState } from "react";

import {
  chat,
  isReady,
  loadModel,
  loadedContext,
  MODELS,
  MODEL_BY_ID,
  DEFAULT_CTX,
  stopGeneration,
  unload,
  type AiStatus,
  type ChatOptions,
} from "@/lib/ai";
import { useSettings } from "./useDoc";

export function useAi() {
  const [settings, setSettings] = useSettings();
  const [status, setStatus] = useState<AiStatus>({ phase: "idle" });
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [ctx, setCtx] = useState(DEFAULT_CTX);
  const [loadedCtx, setLoadedCtx] = useState(DEFAULT_CTX);
  const [temperature, setTemperature] = useState(0.4);
  const [maxTokens, setMaxTokens] = useState(320);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    if (isReady(settings.aiModelId)) {
      setStatus({ phase: "ready" });
      setLoadedCtx(loadedContext());
    }
    return () => {
      mounted.current = false;
    };
  }, [settings.aiModelId]);

  const load = useCallback(
    async (modelId = settings.aiModelId) => {
      try {
        await loadModel(modelId, (s) => mounted.current && setStatus(s), { nCtx: ctx });
        setLoadedCtx(loadedContext());
        setSettings({ aiEnabled: true, aiModelId: modelId });
      } catch {
        /* status already carries the error */
      }
    },
    [ctx, settings.aiModelId, setSettings],
  );

  const stop = useCallback(async () => {
    await unload();
    setStatus({ phase: "idle" });
    setSettings({ aiEnabled: false });
  }, [setSettings]);

  const ask = useCallback(
    async (prompt: { system: string; user: string }, options: ChatOptions = {}) => {
      if (!isReady(settings.aiModelId)) await load();
      setRunning(true);
      setOutput("");
      try {
        const text = await chat(
          prompt.system,
          prompt.user,
          (partial) => {
            if (mounted.current) setOutput(partial);
          },
          { temperature, maxTokens, ...options },
        );
        return text;
      } finally {
        if (mounted.current) setRunning(false);
      }
    },
    [load, maxTokens, settings.aiModelId, temperature],
  );

  const spec = MODEL_BY_ID[settings.aiModelId];

  return {
    models: MODELS,
    modelId: settings.aiModelId,
    spec,
    enabled: settings.aiEnabled,
    status,
    output,
    running,
    ctx,
    setCtx,
    loadedCtx,
    temperature,
    setTemperature,
    maxTokens,
    setMaxTokens,
    load,
    stop,
    abort: stopGeneration,
    ask,
    setOutput,
  };
}
