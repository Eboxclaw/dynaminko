import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  cachedModels,
  chat,
  deviceProfile,
  isReady,
  loadModel,
  loadedContext,
  modelState,
  MODELS,
  MODEL_BY_ID,
  DEFAULT_CTX,
  stopGeneration,
  unload,
  type AiStatus,
  type ChatOptions,
  type ModelState,
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
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());
  const [speed, setSpeed] = useState<{ tps: number; tokens: number } | null>(null);
  const [profile] = useState(() => deviceProfile());
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

  const refreshDownloaded = useCallback(async () => {
    const set = await cachedModels();
    if (mounted.current) setDownloaded(set);
  }, []);

  useEffect(() => {
    void refreshDownloaded();
  }, [refreshDownloaded, status.phase]);

  const load = useCallback(
    async (modelId = settings.aiModelId) => {
      try {
        await loadModel(modelId, (s) => mounted.current && setStatus(s), { nCtx: ctx });
        setLoadedCtx(loadedContext());
        setSettings({ aiEnabled: true, aiModelId: modelId });
        void refreshDownloaded();
      } catch {
        /* status already carries the error */
      }
    },
    [ctx, refreshDownloaded, settings.aiModelId, setSettings],
  );

  const stop = useCallback(async () => {
    await unload();
    setStatus({ phase: "idle" });
    setSettings({ aiEnabled: false });
  }, [setSettings]);

  /** Loads the selected model if it is not running yet. Downloads on demand. */
  const ensure = useCallback(async () => {
    if (isReady(settings.aiModelId) && loadedContext() === ctx) return true;
    await load();
    return isReady(settings.aiModelId);
  }, [ctx, load, settings.aiModelId]);

  const ask = useCallback(
    async (prompt: { system: string; user: string }, options: ChatOptions = {}) => {
      if (!isReady(settings.aiModelId)) await load();
      setRunning(true);
      setOutput("");
      setSpeed(null);
      try {
        const text = await chat(
          prompt.system,
          prompt.user,
          (partial) => {
            if (mounted.current) setOutput(partial);
          },
          {
            temperature,
            maxTokens,
            onSpeed: (tps, tokens) => mounted.current && setSpeed({ tps, tokens }),
            ...options,
          },
        );
        return text;
      } finally {
        if (mounted.current) setRunning(false);
      }
    },
    [load, maxTokens, settings.aiModelId, temperature],
  );

  const spec = MODEL_BY_ID[settings.aiModelId];

  const states = useMemo(() => {
    const out: Record<string, ModelState> = {};
    for (const m of MODELS) {
      out[m.id] = modelState(m.id, {
        downloaded,
        status,
        activeId: settings.aiModelId,
        mobile: profile.mobile,
      });
    }
    return out;
  }, [downloaded, profile.mobile, settings.aiModelId, status]);

  const select = useCallback(
    (modelId: string) => setSettings({ aiModelId: modelId }),
    [setSettings],
  );

  return {
    models: MODELS,
    modelId: settings.aiModelId,
    spec,
    enabled: settings.aiEnabled,
    status,
    states,
    downloaded,
    profile,
    speed,
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
    ensure,
    select,
    stop,
    abort: stopGeneration,
    ask,
    setOutput,
    refreshDownloaded,
  };
}
