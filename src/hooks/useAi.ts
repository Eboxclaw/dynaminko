import { useCallback, useEffect, useRef, useState } from "react";

import { chat, isReady, loadModel, MODELS, unload, type AiStatus } from "@/lib/ai";
import { useSettings } from "./useDoc";

export function useAi() {
  const [settings, setSettings] = useSettings();
  const [status, setStatus] = useState<AiStatus>({ phase: "idle" });
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    if (isReady(settings.aiModelId)) setStatus({ phase: "ready" });
    return () => {
      mounted.current = false;
    };
  }, [settings.aiModelId]);

  const load = useCallback(
    async (modelId = settings.aiModelId) => {
      try {
        await loadModel(modelId, (s) => mounted.current && setStatus(s));
        setSettings({ aiEnabled: true, aiModelId: modelId });
      } catch {
        /* status already carries the error */
      }
    },
    [settings.aiModelId, setSettings],
  );

  const stop = useCallback(async () => {
    await unload();
    setStatus({ phase: "idle" });
    setSettings({ aiEnabled: false });
  }, [setSettings]);

  const ask = useCallback(
    async (prompt: { system: string; user: string }) => {
      if (!isReady(settings.aiModelId)) await load();
      setRunning(true);
      setOutput("");
      try {
        const text = await chat(prompt.system, prompt.user, (partial) => {
          if (mounted.current) setOutput(partial);
        });
        return text;
      } finally {
        if (mounted.current) setRunning(false);
      }
    },
    [load, settings.aiModelId],
  );

  return {
    models: MODELS,
    modelId: settings.aiModelId,
    enabled: settings.aiEnabled,
    status,
    output,
    running,
    load,
    stop,
    ask,
    setOutput,
  };
}
