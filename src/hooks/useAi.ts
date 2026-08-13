import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import {
  activeBackend,
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
  UNKNOWN_PROFILE,
  type AiStatus,
  type ChatOptions,
  type ModelState,
} from "@/lib/ai";
import {
  detectRuntime,
  runtimeSnapshot,
  type Backend,
  type RuntimeCapabilities,
} from "@/lib/ai/runtime";
import {
  encoderBackend,
  encoderCached,
  encoderError,
  encoderProgress,
  encoderState,
  ensureEncoder,
  onEncoderChange,
  unloadEncoder,
  type EncoderState,
} from "@/lib/ai/encoder";
import { cloudChat, CLOUD_BY_ID, type CloudConfig } from "@/lib/ai/cloud";
import {
  deriveCapability,
  modelAction,
  type InstallState,
  type ModelAction,
} from "@/lib/ai/capability";
import { patchAssistant } from "@/lib/store";
import { useSettings } from "./useDoc";
import { useDoc } from "./useDoc";

/** Subscribes to the encoder without polling. */
function useEncoder() {
  // The snapshot carries the progress too, otherwise a download that only
  // moves the percentage never re-renders.
  const snap = useSyncExternalStore(
    onEncoderChange,
    () => `${encoderState()}:${Math.round(encoderProgress() * 100)}`,
    () => "required:0",
  );
  const [state, pct] = snap.split(":");
  const [cached, setCached] = useState(false);
  useEffect(() => {
    void encoderCached().then(setCached);
  }, [snap]);
  return {
    state: state as EncoderState,
    cached,
    progress: Number(pct) / 100,
    error: encoderError(),
    backend: encoderBackend(),
    load: ensureEncoder,
    unload: unloadEncoder,
  };
}

export function useAi() {
  const [settings, setSettings] = useSettings();
  const doc = useDoc();
  const [status, setStatus] = useState<AiStatus>({ phase: "idle" });
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [ctx, setCtx] = useState(DEFAULT_CTX);
  const [loadedCtx, setLoadedCtx] = useState(DEFAULT_CTX);
  const [temperature, setTemperature] = useState(0.4);
  const [maxTokens, setMaxTokens] = useState(320);
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());
  const [speed, setSpeed] = useState<{ tps: number; tokens: number } | null>(null);
  // Probed after mount so the server and the first client render agree.
  const [profile, setProfile] = useState(UNKNOWN_PROFILE);
  const [caps, setCaps] = useState<RuntimeCapabilities>(() => runtimeSnapshot());
  const [backend, setBackend] = useState<Backend>("unavailable");
  const encoder = useEncoder();
  const mounted = useRef(true);
  const cloudAbort = useRef<AbortController | null>(null);

  const assistant = doc.settings.assistant;
  const cloudId = assistant.cloudId;
  const cloudCfg: CloudConfig | null =
    assistant.provider === "cloud" && cloudId && assistant.cloud?.[cloudId]?.apiKey
      ? { id: cloudId as CloudConfig["id"], ...assistant.cloud[cloudId] }
      : null;

  useEffect(() => {
    mounted.current = true;
    setProfile(deviceProfile());
    void detectRuntime().then((c) => {
      if (mounted.current) setCaps(c);
    });
    if (isReady(settings.aiModelId)) {
      setStatus({ phase: "ready" });
      setLoadedCtx(loadedContext());
      setBackend(activeBackend());
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
        setBackend(activeBackend());
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
    setBackend("unavailable");
    setSettings({ aiEnabled: false });
  }, [setSettings]);

  /** Loads the selected model if it is not running yet. Downloads on demand. */
  const ensure = useCallback(async () => {
    if (cloudCfg) return true;
    if (isReady(settings.aiModelId) && loadedContext() === ctx) return true;
    await load();
    return isReady(settings.aiModelId);
  }, [cloudCfg, ctx, load, settings.aiModelId]);

  /**
   * The explicit activation boundary: select, verify, load, wait for ready,
   * then make it the answering target. Nothing "hopes the provider notices".
   */
  const activate = useCallback(
    async (modelId: string): Promise<{ ok: boolean; error?: string }> => {
      patchAssistant({ modelId, provider: "local" });
      setSettings({ aiModelId: modelId });
      try {
        await loadModel(modelId, (s) => mounted.current && setStatus(s), { nCtx: ctx });
      } catch (err) {
        const message = err instanceof Error ? err.message : "the model failed to load";
        if (mounted.current) setStatus({ phase: "error", message });
        return { ok: false, error: message };
      }
      if (!isReady(modelId)) return { ok: false, error: "the model did not reach a ready state" };
      setLoadedCtx(loadedContext());
      setBackend(activeBackend());
      setSettings({ aiEnabled: true, aiModelId: modelId });
      void refreshDownloaded();
      return { ok: true };
    },
    [ctx, refreshDownloaded, setSettings],
  );

  const ask = useCallback(
    async (prompt: { system: string; user: string }, options: ChatOptions = {}) => {
      setRunning(true);
      setOutput("");
      setSpeed(null);
      try {
        if (cloudCfg) {
          const controller = new AbortController();
          cloudAbort.current = controller;
          const started = performance.now();
          const text = await cloudChat(cloudCfg, prompt.system, prompt.user, {
            temperature,
            maxTokens,
            signal: controller.signal,
            onToken: (partial) => {
              if (!mounted.current) return;
              setOutput(partial);
              const secs = (performance.now() - started) / 1000;
              const tokens = Math.ceil(partial.length / 4);
              if (secs > 0.2) setSpeed({ tps: tokens / secs, tokens });
            },
          });
          return text;
        }
        if (!isReady(settings.aiModelId)) await load();
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
        cloudAbort.current = null;
        if (mounted.current) setRunning(false);
      }
    },
    [cloudCfg, load, maxTokens, settings.aiModelId, temperature],
  );

  const abort = useCallback(() => {
    cloudAbort.current?.abort();
    stopGeneration();
  }, []);

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

  /** What is actually answering: the local model or a configured cloud model. */
  const target = cloudCfg
    ? {
        kind: "cloud" as const,
        label: `${CLOUD_BY_ID[cloudCfg.id].label} · ${cloudCfg.model || CLOUD_BY_ID[cloudCfg.id].model}`,
        backend: "cloud" as const,
      }
    : {
        kind: "local" as const,
        label: spec?.label ?? "no model",
        backend,
      };

  return {
    models: MODELS,
    modelId: settings.aiModelId,
    spec,
    enabled: settings.aiEnabled,
    status,
    states,
    downloaded,
    profile,
    caps,
    backend,
    encoder,
    cloud: cloudCfg,
    target,
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
    abort,
    ask,
    setOutput,
    refreshDownloaded,
  };
}
