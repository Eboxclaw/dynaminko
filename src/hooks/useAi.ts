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
  persistedCtx,
  persistCtx,
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
import { setEncoderConstraint } from "@/lib/ai/embedding";
import {
  encoderBackend,
  encoderCached,
  encoderDownloadTarget,
  encoderError,
  encoderProgress,
  encoderState,
  activateSemantic,
  downloadSemanticProvider,
  onEncoderChange,
  unloadEncoder,
  type EncoderState,
} from "@/lib/ai/encoder";
import {
  cloudChatMessages,
  CLOUD_BY_ID,
  CLOUD_CTX_KEY,
  CLOUD_OUT_KEY,
  type CloudConfig,
} from "@/lib/ai/cloud";
import {
  deriveCapability,
  modelAction,
  modelActions,
  type InstallState,
  type ModelAction,
} from "@/lib/ai/capability";
import { patchAssistant, SECRET_MARK } from "@/lib/store";
import { onSecretsReady, peekSecret } from "@/lib/secrets";
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
  const [target, setTarget] = useState<{ id: string; cached: boolean } | null>(null);
  useEffect(() => {
    void encoderCached().then(setCached);
    void encoderDownloadTarget().then(setTarget);
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
    /** what Download would fetch, and whether that provider is on device */
    downloadTarget: target,
  };
}

export function useAi() {
  const [settings, setSettings] = useSettings();
  const doc = useDoc();
  const [status, setStatus] = useState<AiStatus>({ phase: "idle" });
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  // The context choice persists per model: a /context command survives a
  // reload, and switching models restores that model's own choice instead of
  // silently resetting to the default (which made ctx-dependent tests lie).
  const [localCtx, setLocalCtxState] = useState(
    () => persistedCtx(settings.aiModelId) ?? Math.min(DEFAULT_CTX, MODEL_BY_ID[settings.aiModelId]?.maxCtx ?? DEFAULT_CTX),
  );
  const setCtx = useCallback(
    (n: number) => setLocalCtxState(persistCtx(settings.aiModelId, n)),
    [settings.aiModelId],
  );
  const [loadedCtx, setLoadedCtx] = useState(DEFAULT_CTX);
  // Co-residency: a heavy chat model (the 2.6B) cannot share the machine
  // with a second wllama handle, so routing must use the transformers.js
  // encoder while it is selected. Pure main-thread bookkeeping.
  useEffect(() => {
    setEncoderConstraint(MODEL_BY_ID[settings.aiModelId]?.encoderFallback === true);
  }, [settings.aiModelId]);
  // Cloud context is tuned manually (the provider card decides the real
  // ceiling); persisted under a synthetic id so it survives reloads.
  const [cloudCtx, setCloudCtxState] = useState(() => persistedCtx(CLOUD_CTX_KEY) ?? 32768);
  const setCloudCtx = useCallback((n: number) => setCloudCtxState(persistCtx(CLOUD_CTX_KEY, n)), []);
  /** Manual cloud output-token override; 0 means "auto" (card default). */
  const [cloudOut, setCloudOutState] = useState(() => persistedCtx(CLOUD_OUT_KEY) ?? 0);
  const setCloudOut = useCallback(
    (n: number) => setCloudOutState(persistCtx(CLOUD_OUT_KEY, n)),
    [],
  );
  /** Reasoning stream from providers that expose it (GLM reasoning_content). */
  const [thinkingText, setThinkingText] = useState<string | null>(null);
  // null until the user touches the slider: the model's own card sampling
  // (0.2 standard local, provider cards in cloud) must be the default, not a
  // hardcoded session value silently overriding every spec.
  const [temperature, setTemperature] = useState<number | null>(null);
  const [maxTokens, setMaxTokens] = useState(8192);
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());
  /** Models with an in-flight or interrupted download: the cache index says
   * "missing" but progress says "started", which is exactly "partial". */
  const [partial, setPartial] = useState<Set<string>>(new Set());
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
  /** True while a load/download/activate is running. Prevents a second
   * model op from starting while one is in flight (fast double-click). */
  const opInFlight = useRef(false);

  const assistant = doc.settings.assistant;
  const cloudId = assistant.cloudId;
  // Secret slots hydrate async at boot; without this, a cloud session that
  // reloads would silently fall back to local until the next full load.
  // The boolean feeds the cloudCfg memo deps: a plain re-render would not
  // recompute it (useMemo keeps the stale null).
  const [secretsReady, setSecretsReady] = useState(false);
  useEffect(() => onSecretsReady(() => setSecretsReady(true)), []);
  const cloudCfg: CloudConfig | null = useMemo(() => {
    if (assistant.provider !== "cloud" || !cloudId) return null;
    const cred = assistant.cloud?.[cloudId];
    if (!cred) return null;
    // The apiKey lives sealed in the device secret store; the doc only marks
    // its presence. Legacy plaintext (pre-migration docs) still works.
    const apiKey =
      cred.apiKey === SECRET_MARK || !cred.apiKey ? peekSecret(`cloud.${cloudId}`) : cred.apiKey;
    if (!apiKey) return null;
    return { id: cloudId as CloudConfig["id"], apiKey, baseUrl: cred.baseUrl, model: cred.model };
  }, [assistant.provider, cloudId, assistant.cloud, secretsReady]);

  /** The window every consumer budgets against: the cloud ladder when a
   * cloud provider is active, the local model's ctx otherwise. */
  const ctx = cloudCfg ? cloudCtx : localCtx;

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
    setLocalCtxState(
      persistedCtx(settings.aiModelId) ??
        Math.min(DEFAULT_CTX, MODEL_BY_ID[settings.aiModelId]?.maxCtx ?? DEFAULT_CTX),
    );
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

  // A model that just finished downloading is complete from the cache's point
  // of view; drop it from the partial set so Resume does not linger.
  useEffect(() => {
    setPartial((p) => {
      const next = new Set([...p].filter((id) => !downloaded.has(id)));
      return next.size === p.size ? p : next;
    });
  }, [downloaded]);

  /**
   * Progress only ever moves forward for the same model. wllama reports per
   * file, so progress can jump from 80% back to 0% mid-download when a new
   * file starts. We track the highest progress per model in a ref (outside
   * React's render cycle) to prevent regression. While any model shows a
   * non-zero progress fraction it also joins the "partial" set: if that
   * download then fails, the model is not in the cache but the user knows a
   * download was started, so the UI offers Resume instead of Download.
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
      setPartial((p) => (p.has(s.modelId!) ? p : new Set(p).add(s.modelId!)));
    }
    setStatus(s);
  }, []);

  /** Download path. It may fetch weights, and it leaves the model loaded. */
  const load = useCallback(
    async (modelId = settings.aiModelId) => {
      // Never start a second op while one is running: two downloads would
      // fight over the single wllama instance and corrupt the cache index.
      if (opInFlight.current) return;
      opInFlight.current = true;
      try {
        const result = await downloadModel(modelId, applyStatus, {
          nCtx: localCtx,
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
      } finally {
        opInFlight.current = false;
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
    return isReady(settings.aiModelId) && loadedContext() === localCtx;
  }, [cloudCfg, localCtx, settings.aiModelId]);

  /**
   * The explicit activation boundary: select, verify, load, wait for ready,
   * then make it the answering target. Nothing "hopes the provider notices".
   */
  const activate = useCallback(
    async (modelId: string): Promise<{ ok: boolean; error?: string }> => {
      // Never start a second op while one is running (see load above).
      if (opInFlight.current) return { ok: false, error: "another model operation is in progress" };
      opInFlight.current = true;
      patchAssistant({ modelId, provider: "local" });
      setSettings({ aiModelId: modelId });
      // Register progress callback so load progress shows in the UI
      setActiveStatusCallback(applyStatus, modelId);
      try {
        const result = await rotateToDownloadedModel(modelId, applyStatus, { nCtx: localCtx });
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
        opInFlight.current = false;
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
          if (mounted.current) setThinkingText(null);
          // The thinking toggle maps onto provider reasoning modes: off is a
          // real "disabled" (decides and speed-first answers), on is enabled,
          // and absent keeps the provider default (GLM-5: enabled).
          const thinkingMode =
            options.thinking == null
              ? CLOUD_BY_ID[cloudCfg.id]?.thinking
              : options.thinking
                ? "enabled"
                : "disabled";
          // Answers never inherit the LOCAL slider: the provider card decides
          // the output budget (thinking included) unless the user tuned chips.
          const cloudMax =
            cloudOut || CLOUD_BY_ID[cloudCfg.id]?.defaultOutputTokens || maxTokens;
          const clampedOut = Math.min(
            cloudMax,
            CLOUD_BY_ID[cloudCfg.id]?.maxOutputTokens ?? cloudMax,
          );
          // Every cloud provider is OpenAI-compatible (Z.ai included), so the
          // shared client covers all of them. No per-provider branching.
          // temperature stays undefined until the user sets the slider, so
          // the provider card default (zai 0.6) applies.
          const text = await cloudChatMessages(cloudCfg, messages, {
            temperature: options.temperature ?? temperature ?? undefined,
            maxTokens: options.maxTokens ?? clampedOut,
            responseSchema: options.responseSchema,
            images: options.images,
            toolTurns: options.toolTurns,
            ...(thinkingMode ? { thinking: thinkingMode } : {}),
            signal: controller.signal,
            onToken: (partial) => {
              if (!mounted.current) return;
              setOutput(partial);
              const secs = (performance.now() - started) / 1000;
              const tokens = Math.ceil(partial.length / 4);
              if (secs > 0.2) setSpeed({ tps: tokens / secs, tokens });
            },
            onThinking: (partial) => {
              if (mounted.current) setThinkingText(partial);
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
            // undefined until the user tunes the slider: the model spec's
            // sampling (the 0.2 local standard) is the real default.
            temperature: temperature ?? undefined,
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
  }, [downloaded, profile.mobile, status]);

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
   * "Partial" means this session started a download that did not finish: the
   * cache holds no whole model, but the user has already paid for most of it,
   * so the panel offers Resume instead of Download.
   */
  const install = useMemo(() => {
    const out: Record<string, InstallState> = {};
    for (const m of MODELS) {
      if (downloaded.has(m.id) || isReady(m.id)) out[m.id] = "complete";
      else if (partial.has(m.id)) out[m.id] = "partial";
      else out[m.id] = "missing";
    }
    return out;
  }, [downloaded, partial]);

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
      // Don't delete a model's file while wllama is writing it.
      if (opInFlight.current) return;
      const spec = MODEL_BY_ID[modelId];
      try {
        await deleteModel(modelId);
      } catch (err) {
        // The worker verifies the delete against the cache before reporting
        // success; a rejection means the weights are still there.
        toast.error(
          `${spec?.label ?? modelId}: ${err instanceof Error ? err.message : "delete failed"}`,
        );
        return;
      }
      if (mounted.current) {
        setPartial((p) => {
          if (!p.has(modelId)) return p;
          const next = new Set(p);
          next.delete(modelId);
          return next;
        });
        if (!isReady(modelId)) {
          setStatus({ phase: "idle" });
          setBackend("unavailable");
        }
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
    cloudCtx,
    setCloudCtx,
    cloudOut,
    setCloudOut,
    /** reasoning stream from providers that expose it, null outside a turn */
    thinkingText,
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
