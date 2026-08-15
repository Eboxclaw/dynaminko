import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import {
  activeBackend,
  cachedModels,
  chat,
  deviceProfile,
  isReady,
  downloadModel,
  deleteModel,
  loadedModelId,
  rotateToDownloadedModel,
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
  activateSemantic,
  downloadSemanticProvider,
  onEncoderChange,
  unloadEncoder,
  type EncoderState,
} from "@/lib/ai/encoder";
import { cloudChat, CLOUD_BY_ID, type CloudConfig } from "@/lib/ai/cloud";
import {
  deriveCapability,
  modelAction,
  modelActions,
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
    () => "missing:0",
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
    download: downloadSemanticProvider,
    load: activateSemantic,
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
      setStatus({ phase: "ready", modelId: settings.aiModelId });
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

  /**
   * Progress only ever moves forward for the same model. wllama reports per
   * file, so a naive assignment can visibly jump back to 0 mid-download.
   */
  const applyStatus = useCallback((s: AiStatus) => {
    if (!mounted.current) return;
    setStatus((prev) =>
      s.phase === "downloading" &&
      prev.phase === "downloading" &&
      prev.modelId === s.modelId &&
      prev.progress > s.progress
        ? prev
        : s,
    );
  }, []);

  /** Download path. It may fetch weights, and it leaves the model loaded. */
  const load = useCallback(
    async (modelId = settings.aiModelId) => {
      try {
        const result = await downloadModel(modelId, applyStatus, {
          nCtx: ctx,
        });
        if (result.status !== "ready") return;
        if (mounted.current) {
          setStatus({ phase: "ready", modelId });
          setLoadedCtx(loadedContext());
          setBackend(activeBackend());
        }
        patchAssistant({ modelId, provider: "local" });
        setSettings({ aiModelId: modelId, aiEnabled: true });
        void refreshDownloaded();
      } catch {
        /* status already carries the error */
      }
    },
    [applyStatus, ctx, refreshDownloaded, settings.aiModelId, setSettings],
  );


  const stop = useCallback(async () => {
    await unload();
    setStatus({ phase: "idle" });
    setBackend("unavailable");
    setSettings({ aiEnabled: false });
  }, [setSettings]);

  /** Generation never installs implicitly. The caller must load a downloaded model first. */
  const ensure = useCallback(async () => {
    if (cloudCfg) return true;
    return isReady(settings.aiModelId) && loadedContext() === ctx;
  }, [cloudCfg, ctx, settings.aiModelId]);

  /**
   * The explicit activation boundary: select, verify, load, wait for ready,
   * then make it the answering target. Nothing "hopes the provider notices".
   */
  const activate = useCallback(
    async (modelId: string): Promise<{ ok: boolean; error?: string }> => {
      patchAssistant({ modelId, provider: "local" });
      setSettings({ aiModelId: modelId });
      try {
        const result = await rotateToDownloadedModel(modelId, applyStatus, { nCtx: ctx });
        if (result.status === "install_required" || result.status === "unsupported" || result.status === "error") {
          throw new Error(result.message);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "the model failed to load";
        if (mounted.current) setStatus({ phase: "error", message, modelId });
        return { ok: false, error: message };
      }
      if (!isReady(modelId)) return { ok: false, error: "the model did not reach a ready state" };
      setLoadedCtx(loadedContext());
      setBackend(activeBackend());
      setSettings({ aiEnabled: true, aiModelId: modelId });
      void refreshDownloaded();
      return { ok: true };
    },
    [applyStatus, ctx, refreshDownloaded, setSettings],
  );

  /**
   * Chat calls this before answering. A model already on this device is woken
   * up automatically; weights are never fetched without an explicit download.
   */
  const wake = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (cloudCfg) return { ok: true };
    const id = settings.aiModelId;
    if (isReady(id)) return { ok: true };
    const cached = await cachedModels();
    if (!cached.has(id)) return { ok: false, error: "not_downloaded" };
    return activate(id);
  }, [activate, cloudCfg, settings.aiModelId]);


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
        if (!isReady(settings.aiModelId)) {
          throw new Error("No local model is loaded. Load a downloaded model from the Model panel first.");
        }
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
    [cloudCfg, maxTokens, settings.aiModelId, temperature],
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
        loadedId: loadedModelId(),
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

  /**
   * Cache state per model, kept separate from "which model is the default".
   * A downloaded model must never be offered as a download again.
   */
  const install = useMemo(() => {
    const out: Record<string, InstallState> = {};
    for (const m of MODELS) out[m.id] = downloaded.has(m.id) ? "complete" : "missing";
    return out;
  }, [downloaded]);

  const actionFor = useCallback(
    (modelId: string): ModelAction =>
      modelAction(
        install[modelId] ?? "missing",
        isReady(modelId),
        states[modelId] !== "unavailable",
      ),
    [install, states],
  );

  const actionsFor = useCallback(
    (modelId: string): ModelAction[] =>
      modelActions(
        install[modelId] ?? "missing",
        isReady(modelId),
        states[modelId] !== "unavailable",
      ),
    [install, states],
  );

  /** Removes cached weights. Unloads first when that model is resident. */
  const remove = useCallback(
    async (modelId: string) => {
      await deleteModel(modelId);
      if (!isReady(modelId) && mounted.current) {
        setStatus({ phase: "idle" });
        setBackend("unavailable");
      }
      void refreshDownloaded();
    },
    [refreshDownloaded],
  );



  const capability = useMemo(
    () =>
      deriveCapability({
        modelId: settings.aiModelId,
        state: states[settings.aiModelId],
        status,
        cloud: Boolean(cloudCfg),
        encoder: { state: encoder.state, cached: encoder.cached },
      }),
    [cloudCfg, encoder.cached, encoder.state, settings.aiModelId, states, status],
  );

  return {
    models: MODELS,
    modelId: settings.aiModelId,
    loadedModelId: loadedModelId(),
    spec,
    install,
    actionFor,
    actionsFor,
    remove,
    capability,
    activate,
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
