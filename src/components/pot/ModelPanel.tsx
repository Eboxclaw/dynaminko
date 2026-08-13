// The model harness: what a llama.cpp front end is expected to expose and
// nothing more — role, state, backend, context window, a RAM-aware
// recommendation, and the generation basics. Local models are the product;
// cloud endpoints are an opt-in second tab.

import { useState } from "react";

import { useAi } from "@/hooks/useAi";
import { useDoc } from "@/hooks/useDoc";
import {
  CTX_CHOICES,
  MODEL_BY_ID,
  STATE_LABEL,
  memoryEstimateGb,
  recommendModel,
} from "@/lib/ai";
import { ACTION_LABEL, semanticLabel } from "@/lib/ai/capability";
import { CLOUD_PROVIDERS, cloudState, type CloudProviderId } from "@/lib/ai/cloud";
import { diagnosticsRows } from "@/lib/ai/runtime";
import { patchAssistant, patchCloudCredential, patchSettings } from "@/lib/store";
import { cn } from "@/lib/utils";

const BACKEND_LABEL: Record<string, string> = {
  webgpu: "WebGPU",
  wasm: "WASM SIMD",
  unavailable: "not running",
};

export function ModelPanel({ ai }: { ai: ReturnType<typeof useAi> }) {
  const doc = useDoc();
  const [tab, setTab] = useState<"local" | "cloud">(
    doc.settings.assistant.provider === "cloud" ? "cloud" : "local",
  );

  return (
    <div>
      <div className="flex gap-1 border-b border-stroke px-4 py-2">
        {(["local", "cloud"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "doodle-pill px-3 py-1 text-[11px] capitalize",
              tab === t ? "bg-ink text-paper" : "text-ink-faint hover:border-ink",
            )}
          >
            {t}
          </button>
        ))}
        <span className="ml-auto self-center eyebrow">
          {ai.target.kind === "cloud" ? "cloud active" : BACKEND_LABEL[ai.backend]}
        </span>
      </div>
      {tab === "local" ? <LocalModels ai={ai} /> : <CloudModels ai={ai} />}
    </div>
  );
}

function LocalModels({ ai }: { ai: ReturnType<typeof useAi> }) {
  const doc = useDoc();
  const profile = ai.profile;
  const rec = recommendModel(profile);
  const selected = doc.settings.assistant.modelId;
  const spec = MODEL_BY_ID[selected];
  const budget = profile.ramGb ?? (profile.mobile ? 2 : 4);
  const estimate = memoryEstimateGb(selected, ai.ctx);
  const enc = ai.encoder;
  const action = ai.actionFor(selected);

  return (
    <div>
      <p className="flex items-center gap-2 border-b border-stroke px-4 py-2.5 text-[12px] text-ink-soft">
        <span className="flex-1">{rec.reason}</span>
        {profile.probed && rec.id !== selected && (
          <button
            type="button"
            onClick={() => {
              patchAssistant({ modelId: rec.id, provider: "local" });
              patchSettings({ aiModelId: rec.id });
            }}
            className="doodle-pill ml-2 px-2.5 py-0.5 text-[11px] hover:border-ink"
          >
            Use {MODEL_BY_ID[rec.id]?.label}
          </button>
        )}
      </p>

      {/* Two independent capabilities. The encoder never gates generation. */}
      <dl className="grid grid-cols-2 gap-x-4 border-b border-stroke px-4 py-3">
        <div>
          <dt className="eyebrow">Model</dt>
          <dd className="text-[13px] font-medium">{spec?.label ?? "no model"}</dd>
          <dd className="num eyebrow">
            {ai.capability.generation === "loaded"
              ? `READY · ${BACKEND_LABEL[ai.backend]}`
              : ai.capability.generation === "downloaded"
                ? "ON DEVICE · not loaded"
                : ai.capability.generation === "error"
                  ? "ERROR"
                  : "NOT INSTALLED"}
          </dd>
        </div>
        <div>
          <dt className="eyebrow">Semantic</dt>
          <dd className="text-[13px] font-medium">Encoder 230M</dd>
          <dd
            className={cn("num eyebrow", ai.capability.routeFallback && "text-ink-faint")}
          >
            {semanticLabel(ai.capability)}
          </dd>
        </div>
      </dl>

      <ul>
        {ai.models
          .filter((m) => m.generative)
          .map((m) => {
            const active = selected === m.id;
            const state = ai.states[m.id];
            return (
              <li key={m.id} className="border-b border-stroke px-4 py-3">
                <label className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="model"
                    className="mt-1"
                    disabled={state === "unavailable"}
                    checked={active}
                    onChange={() => {
                      patchAssistant({ modelId: m.id, provider: "local" });
                      patchSettings({ aiModelId: m.id });
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-2">
                      <span className="text-[13px] font-medium">{m.label}</span>
                      <span className="num text-[11px] text-ink-faint">{m.quant}</span>
                      <span
                        className={cn(
                          "eyebrow",
                          state === "ready" && "text-gain",
                          state === "downloaded" && "text-ink-soft",
                          (state === "error" || state === "unavailable") && "text-loss",
                          state === "required" && "text-ink-faint",
                        )}
                      >
                        {STATE_LABEL[state]}
                        {state === "ready" ? ` · ${BACKEND_LABEL[ai.backend]}` : ""}
                      </span>
                      {profile.probed && m.id === rec.id && (
                        <span className="eyebrow">recommended</span>
                      )}
                    </span>
                    <span className="eyebrow mt-1 block">~{m.weightsGb} GB</span>
                  </span>
                </label>
              </li>
            );
          })}
      </ul>

      {/* Encoder: optional, recommended. Routing works without it. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-stroke px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="text-[13px] font-medium">Router encoder</span>
          <span className="eyebrow ml-2">
            {enc.state === "ready"
              ? `running · ${enc.backend ?? "wasm"}`
              : enc.state === "downloading"
                ? `downloading ${Math.round(enc.progress * 100)}%`
                : enc.cached
                  ? "on device"
                  : "optional · not downloaded"}
          </span>
          <span className="mt-1 block text-[12px] text-ink-soft">
            ~23 MB. Sharper command matching. Optional.
          </span>
          {enc.error && <span className="mt-1 block text-[12px] text-loss">{enc.error}</span>}
        </span>
        {enc.state === "ready" ? (
          <button
            type="button"
            onClick={() => enc.unload()}
            className="doodle-pill px-3 py-1 text-[11px]"
          >
            Unload
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void enc.load()}
            className="doodle-pill px-3 py-1 text-[11px] hover:border-ink"
          >
            {enc.cached ? "Load" : "Download"}
          </button>
        )}
      </div>

      <div className="border-b border-stroke px-4 py-3">
        <p className="eyebrow">Context window</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {CTX_CHOICES.map((c) => (
            <button
              key={c}
              type="button"
              disabled={spec ? c > spec.maxCtx : false}
              onClick={() => ai.setCtx(c)}
              className={cn(
                "doodle-pill num px-3 py-1 text-[11px]",
                ai.ctx === c ? "bg-ink text-paper" : "text-ink-faint hover:border-ink",
                spec && c > spec.maxCtx && "opacity-40",
              )}
            >
              {c}
            </button>
          ))}
        </div>
        <p className={cn("eyebrow mt-2", estimate > budget && "text-loss")}>
          ~{estimate} GB working set
          {estimate > budget ? " · above what this device reports" : " · fits"}
          {ai.status.phase === "ready" && ai.loadedCtx !== ai.ctx ? " · reload to apply" : ""}
        </p>
      </div>

      <div className="grid gap-3 border-b border-stroke px-4 py-3 sm:grid-cols-2">
        <label className="text-[12px]">
          <span className="eyebrow block">Temperature {ai.temperature.toFixed(2)}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={ai.temperature}
            onChange={(e) => ai.setTemperature(Number(e.target.value))}
            className="mt-2 w-full"
          />
        </label>
        <label className="text-[12px]">
          <span className="eyebrow block">Max tokens {ai.maxTokens}</span>
          <input
            type="range"
            min={64}
            max={1024}
            step={32}
            value={ai.maxTokens}
            onChange={(e) => ai.setMaxTokens(Number(e.target.value))}
            className="mt-2 w-full"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-stroke px-4 py-3">
        {/* Derived from the cache, never from which model is the default. */}
        <button
          type="button"
          disabled={action === "unavailable"}
          onClick={() => (action === "unload" ? void ai.stop() : void ai.activate(selected))}
          className="doodle-pill bg-ink px-4 py-1.5 text-[12px] font-medium text-paper disabled:opacity-40"
        >
          {action === "unload" && ai.loadedCtx !== ai.ctx ? "Reload" : ACTION_LABEL[action]}
        </button>
        {ai.status.phase === "downloading" && (
          <span className="num text-[12px] text-ink-faint">
            {Math.round(ai.status.progress * 100)}%
          </span>
        )}
        {ai.speed && (
          <span className="num text-[11px] text-ink-faint">{ai.speed.tps.toFixed(1)} tok/s</span>
        )}
        {ai.status.phase === "error" && (
          <span className="text-[12px] text-loss">{ai.status.message}</span>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 px-4 py-3">
        {diagnosticsRows(ai.caps).map((row) => (
          <div key={row.label} className="contents">
            <dt className="eyebrow">{row.label}</dt>
            <dd className="num text-[11px] text-ink-soft">{row.detail}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CloudModels({ ai }: { ai: ReturnType<typeof useAi> }) {
  const doc = useDoc();
  const assistant = doc.settings.assistant;
  const creds = assistant.cloud ?? {};

  return (
    <div>
      <p className="border-b border-stroke px-4 py-2.5 text-[12px] text-ink-soft">
        Optional. Keys are stored in this browser only and sent to the provider you configure,
        nowhere else. Every endpoint uses the OpenAI chat shape.
      </p>
      <ul>
        {CLOUD_PROVIDERS.map((p) => {
          const cred = creds[p.id];
          const state = cloudState(cred ? { id: p.id, ...cred } : undefined);
          const active = assistant.provider === "cloud" && assistant.cloudId === p.id;
          return (
            <li key={p.id} className="border-b border-stroke px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[13px] font-medium">{p.label}</span>
                <span
                  className={cn(
                    "eyebrow",
                    state === "configured" && "text-gain",
                    state === "unconfigured" && "text-ink-faint",
                  )}
                >
                  {state}
                </span>
                {p.corsRisky && <span className="eyebrow text-ink-faint">may be CORS-blocked</span>}
                {active && <span className="eyebrow text-gain">active</span>}
              </div>
              <p className="mt-1 text-[12px] text-ink-soft">{p.blurb}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <input
                  type="password"
                  value={cred?.apiKey ?? ""}
                  placeholder="API key"
                  autoComplete="off"
                  onChange={(e) => patchCloudCredential(p.id, { apiKey: e.target.value })}
                  className="doodle-pill w-full bg-transparent px-3 py-1 text-[12px]"
                />
                <input
                  type="text"
                  value={cred?.model ?? ""}
                  placeholder={p.model}
                  onChange={(e) => patchCloudCredential(p.id, { model: e.target.value })}
                  className="doodle-pill num w-full bg-transparent px-3 py-1 text-[12px]"
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={state === "unconfigured"}
                  onClick={() =>
                    patchAssistant(
                      active
                        ? { provider: "local" }
                        : { provider: "cloud", cloudId: p.id as CloudProviderId },
                    )
                  }
                  className={cn(
                    "doodle-pill px-3 py-1 text-[11px]",
                    active ? "bg-ink text-paper" : "hover:border-ink",
                    state === "unconfigured" && "opacity-40",
                  )}
                >
                  {active ? "Using this" : "Use for chat"}
                </button>
                {cred && (
                  <button
                    type="button"
                    onClick={() => patchCloudCredential(p.id, null)}
                    className="doodle-pill px-3 py-1 text-[11px] text-loss"
                  >
                    Clear key
                  </button>
                )}
                {p.keysUrl && (
                  <a
                    href={p.keysUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="eyebrow underline"
                  >
                    get a key
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="px-4 py-3 text-[12px] text-ink-soft">
        Local runs stay the default: {ai.models.find((m) => m.generative)?.label} and the rest of
        the LFM 2.5 family need no key and no network after the first download.
      </p>
    </div>
  );
}
