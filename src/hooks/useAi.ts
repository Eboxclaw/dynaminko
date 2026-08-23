import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import {
  activeBackend,
  cachedModels,
  chat,
  chatMessages,
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
  setActiveStatusCallback,
  type AiStatus,
  type ChatOptions,
  type ModelState,
  type TurnMessage,
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
import { cloudChatMessages, zaiChatMessages, CLOUD_BY_ID, type CloudConfig } from "@/lib/ai/cloud";
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
import { toast } from "sonner";

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
  const [maxTokens, setMaxTokens] = useState(8192);
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());
  const [speed, setSpeed] = useState<{ tps: number; tokens: number } | null>(null);
  // Probed after mount so the server and the first client render agree.
  const [profile, setProfile] = useState(UNKNOWN_PROFILE);
  const [caps, setCaps] = useState<RuntimeCapabilities>(() => runtimeSnapshot());
  const [backend, setBackend] = useState<Backend>("unavailable");
  const encoder = useEncoder();
  const mounted = useRef(true);
  const cloudAbort = useRef<AbortController | null>(null);
  /** Monotonic progress tracker: keeps the highest progress seen per model so
   * wllama's per-file download reporting doesn't cause the bar to jump backward. */
  const lastProgress = useRef<Record<string, number>>({});

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
   * file, so progress can jump from 80% back to 0% mid-download when a new
   * file starts. We track the highest progress per model in a ref (outside
   * React's render cycle) to prevent regression.
   */
  const applyStatus = useCallback((s: AiStatus) => {
    if (!mounted.current) return;
    if (s.phase === "downloading" && s.modelId) {
      const prev = lastProgress.current[s.modelId] ?? 0;
      if (s.progress < prev) {
        // wllama started a new file — keep the old value
        return;
      }
      lastProgress.current[s.modelId] = s.progress;
    }
    setStatus(s);
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
        const spec = MODEL_BY_ID[modelId];
        toast.success(`${spec?.label ?? modelId} is downloaded and ready`);
        patchAssistant({ modelId, provider: "local" });
        setSettings({ aiModelId: modelId, aiEnabled: true });
        await refreshDownloaded();
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
      // Register progress callback so load progress shows in the UI
      setActiveStatusCallback(applyStatus, modelId);
      try {
        const result = await rotateToDownloadedModel(modelId, applyStatus, { nCtx: ctx });
        if (
          result.status === "install_required" ||
          result.status === "unsupported" ||
          result.status === "error"
        ) {
          throw new Error(result.message);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "the model failed to load";
        if (mounted.current) setStatus({ phase: "error", message, modelId });
        return { ok: false, error: message };
      } finally {
        setActiveStatusCallback(null, null);
      }
      if (!isReady(modelId)) return { ok: false, error: "the model did not reach a ready state" };
      setLoadedCtx(loadedContext());
      setBackend(activeBackend());
      toast.success(`${MODEL_BY_ID[modelId]?.label ?? modelId} is loaded`);
      setSettings({ aiEnabled: true, aiModelId: modelId });
      await refreshDownloaded();
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

  /** Full multi-turn form: the model's own chat template structures history. */
  const askMessages = useCallback(
    async (messages: TurnMessage[], options: ChatOptions = {}) => {
      setRunning(true);
      setOutput("");
      setSpeed(null);
      try {
if (cloudCfg) {
	          const controller = new AbortController();
	          cloudAbort.current = controller;
	          const started = performance.now();
	          const chatFn = cloudCfg.id === "zai" ? zaiChatMessages : cloudChatMessages;
	          const text = await chatFn(cloudCfg, messages, {
	            temperature: options.temperature ?? temperature,
	            maxTokens: options.maxTokens ?? maxTokens,
	            responseSchema: options.responseSchema,
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
          throw new Error(
            "No local model is loaded. Load a downloaded model from the Model panel first.",
          );
        }
        // Accumulate delta tokens and batch React updates via requestAnimationFrame
        const outputRef = { current: "" };
        const pendingRef = { current: false };
        const flush = () => {
          pendingRef.current = false;
          if (mounted.current) setOutput(outputRef.current);
        };
        const text = await chatMessages(
          messages,
          (delta) => {
            outputRef.current += delta;
            if (!pendingRef.current) {
              pendingRef.current = true;
              requestAnimationFrame(flush);
            }
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

  const ask = useCallback(
    async (prompt: { system: string; user: string }, options: ChatOptions = {}) => {
      return askMessages(
        [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        options,
      );
    },
    [askMessages],
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
   * A model that is resident in memory is by definition on this device, even
   * when the cache index has not caught up, so Download never reappears for it.
   */
  const install = useMemo(() => {
    const out: Record<string, InstallState> = {};
    for (const m of MODELS)
      out[m.id] = downloaded.has(m.id) || isReady(m.id) ? "complete" : "missing";
    return out;
  }, [downloaded, status]);

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
      const spec = MODEL_BY_ID[modelId];
      await deleteModel(modelId);
      if (!isReady(modelId) && mounted.current) {
        setStatus({ phase: "idle" });
        setBackend("unavailable");
      }
      toast.info(`${spec?.label ?? modelId} removed from device`);
      await refreshDownloaded();
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
    wake,
    /** 0..1 while the active download runs, null otherwise */
    progress: status.phase === "downloading" ? status.progress : null,
    ensure,

    select,
    stop,
    abort,
    ask,
    askMessages,
    setOutput,
    refreshDownloaded,
  };
}
