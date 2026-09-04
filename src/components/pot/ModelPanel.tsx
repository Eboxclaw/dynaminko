// The model harness as three sequential cards: provider, models, generation.
// Every model row carries its own download / load / unload / delete controls,
// so no single button ever relabels itself into a different meaning.

import { useEffect, useState } from "react";

import { toast } from "sonner";

import { HelpDot } from "@/components/pot/HelpDot";
import { useAi } from "@/hooks/useAi";
import { useDoc } from "@/hooks/useDoc";
import { CTX_CHOICES, MODEL_BY_ID, STATE_LABEL, memoryEstimateGb, recommendModel } from "@/lib/ai";
import {
  DEFAULT_EMBEDDING_ID,
  FALLBACK_EMBEDDING_ID,
  PROVIDER_BY_ID,
} from "@/lib/ai/embedding";
import { semanticLabel, type ModelAction } from "@/lib/ai/capability";
import {
  CLOUD_CTX_CHOICES,
  CLOUD_OUT_CHOICES,
  CLOUD_PROVIDERS,
  cloudState,
  type CloudProviderId,
} from "@/lib/ai/cloud";
import { onSecretsReady, peekSecret } from "@/lib/secrets";
import { diagnosticsRows } from "@/lib/ai/runtime";
import { patchAssistant, patchCloudCredential, patchSettings } from "@/lib/store";
import { getWebKeys, setWebKeys, type WebProviderKeys } from "@/lib/tools/web";
import { cn } from "@/lib/utils";

const BACKEND_LABEL: Record<string, string> = {
  webgpu: "WebGPU",
  wasm: "WASM SIMD",
  unavailable: "not running",
};

function Card({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[4px] border border-stroke">
      <header className="flex items-center gap-2 border-b border-stroke bg-ink/[0.02] px-3 py-2">
        <h3 className="eyebrow flex-1">{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function ModelPanel({ ai }: { ai: ReturnType<typeof useAi> }) {
  const doc = useDoc();
  const [tab, setTab] = useState<"local" | "cloud">(
    doc.settings.assistant.provider === "cloud" ? "cloud" : "local",
  );

  return (
    <div className="grid gap-3">
      <Card
        title="Provider"
        aside={
          <span className="eyebrow">
            {ai.target.kind === "cloud" ? "cloud active" : BACKEND_LABEL[ai.backend]}
          </span>
        }
      >
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="flex gap-1">
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
          </div>
          <span className="min-w-0 flex-1 truncate text-right text-[12px] text-ink-soft">
            {ai.target.label}
          </span>
        </div>
      </Card>
      {tab === "local" ? (
        <LocalModels ai={ai} />
      ) : (
        <Card title="Cloud endpoints">
          <CloudModels ai={ai} />
        </Card>
      )}
      <WebSearchKeys />
    </div>
  );
}

const ACTION_STYLE: Partial<Record<ModelAction, string>> = {
  download: "bg-ink text-paper",
  resume: "bg-ink text-paper",
  load: "bg-ink text-paper",
  unload: "hover:border-ink",
  delete: "text-loss hover:border-loss",
};

const STATE_TEXT: Record<string, string> = {
  missing: "not downloaded",
  downloaded: "on device",
  loading: "working",
  loaded: "active",
  error: "error",
};

function ModelRow({
  ai,
  id,
  recommended,
}: {
  ai: ReturnType<typeof useAi>;
  id: string;
  recommended: boolean;
}) {
  const m = MODEL_BY_ID[id];
  const doc = useDoc();
  // The behavior source of truth is settings.aiModelId (what useAi loads and
  // answers with); assistant.modelId is kept in sync by every writer, so the
  // two can never disagree in practice.
  const selected = doc.settings.aiModelId === id;
  const state = ai.states[id];
  const actions = ai.actionsFor(id);
  const busy = state === "loading";
  const mine = ai.status.modelId === id;
  // Only one model operation may run at a time: while a download or load
  // is in flight, disable every row's buttons so a second click can't
  // desync the runtime. The worker enforces this too.
  const opInFlight = ai.status.phase === "downloading" || ai.status.phase === "loading";
  const blocked = opInFlight && !mine;
  const pct =
    mine && ai.status.phase === "downloading" ? Math.round(ai.status.progress * 100) : null;
  const workLabel =
    busy && mine
      ? ai.status.phase === "downloading"
        ? `downloading ${pct}%`
        : "loading into memory"
      : null;

  // Delete confirmation state
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Detect quant migration: if the model spec uses QAD-Q4_0 and user has it cached
  // (from an old Q4_K_M download), show a "new version available" notice.
  const quantMigrated =
    m.runtime === "gguf" &&
    m.quant === "QAD-Q4_0" &&
    state === "downloaded" &&
    !ai.install[id]; /* show when not currently loaded */

  const run = (a: ModelAction) => {
    if (a === "download" || a === "resume") return void ai.load(id);
    if (a === "load") return void ai.activate(id);
    if (a === "unload") return void ai.stop();
    if (a === "delete") {
      if (confirmingDelete) {
        ai.remove(id);
        setConfirmingDelete(false);
      } else {
        setConfirmingDelete(true);
      }
    }
  };

  return (
    <li className="border-b border-stroke px-3 py-2.5 last:border-b-0">
      <div className="flex items-start gap-3">
        <input
          type="radio"
          name="model"
          className="mt-1 accent-[var(--ink)]"
          checked={selected}
          onChange={() => {
            patchAssistant({ modelId: id, provider: "local" });
            patchSettings({ aiModelId: id });
          }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[13px] font-medium">{m.label}</span>
            <span
              className={cn(
                "eyebrow",
                state === "loaded" && "text-gain",
                state === "downloaded" && "text-ink-soft",
                (state === "error") && "text-loss",
                state === "missing" && "text-ink-faint",
              )}
            >
              {workLabel ?? STATE_TEXT[state] ?? STATE_LABEL[state]}
              {state === "loaded" ? ` · ${BACKEND_LABEL[ai.backend]}` : ""}
            </span>
            {recommended && <span className="eyebrow">recommended</span>}
          </div>
          <p className="num eyebrow mt-0.5">
            {m.quant} · ~{m.weightsGb} GB
          </p>
          {busy && mine && (
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-ink/10">
              <div
                className={cn(
                  "h-full bg-ink transition-[width] duration-200",
                  pct === null && "w-1/3 animate-pulse",
                )}
                style={pct === null ? undefined : { width: `${Math.max(pct, 2)}%` }}
              />
            </div>
          )}
          {ai.status.phase === "error" && mine && (
            <p className="mt-1 text-[12px] text-loss">{ai.status.message}</p>
          )}
          {quantMigrated && (
            <p className="mt-1 text-[12px] text-ink-soft">
              Updated version available · delete and re-download for better quality
            </p>
          )}
          {confirmingDelete && (
            <p className="mt-1 text-[10px] text-loss">
              Delete this model's weights? It must be re-downloaded.
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {actions.map((a) =>
            a === "delete" && confirmingDelete ? (
              <span key={a} className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="doodle-pill px-2.5 py-1 text-[11px] hover:border-ink"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy || blocked}
                  onClick={() => {
                    ai.remove(id);
                    setConfirmingDelete(false);
                  }}
                  className="doodle-pill px-2.5 py-1 text-[11px] bg-loss text-paper"
                >
                  Delete
                </button>
              </span>
            ) : (
              <button
                key={a}
                type="button"
                disabled={busy || blocked}
                onClick={() => run(a)}
                className={cn(
                  "doodle-pill px-2.5 py-1 text-[11px] disabled:opacity-40",
                  ACTION_STYLE[a],
                )}
              >
                {busy && mine && (a === "download" || a === "resume" || a === "load")
                  ? pct === null
                    ? "…"
                    : `${pct}%`
                  : a[0].toUpperCase() + a.slice(1)}
              </button>
            ),
          )}
        </div>
      </div>
    </li>
  );
}

function LocalModels({ ai }: { ai: ReturnType<typeof useAi> }) {
  const doc = useDoc();
  const profile = ai.profile;
  const rec = recommendModel(profile);
  const selected = doc.settings.aiModelId;
  const spec = MODEL_BY_ID[selected];
  const budget = profile.ramGb ?? (profile.mobile ? 2 : 4);
  const estimate = memoryEstimateGb(selected, ai.ctx);
  const enc = ai.encoder;

  return (
    <>
      <Card
        title="Models // on this device"
        aside={
          <HelpDot label="About local models">
            Weights are cached in this browser. Download fetches once and leaves the model warm.
            Load brings a cached model back into memory, Unload frees it, Delete removes the cached
            weights.
          </HelpDot>
        }
      >
        <div className="flex items-center gap-2 border-b border-stroke px-3 py-2 text-[12px] text-ink-soft">
          <span className="min-w-0 flex-1">{rec.reason}</span>
          {profile.probed && rec.id !== selected && (
            <button
              type="button"
              onClick={() => {
                patchAssistant({ modelId: rec.id, provider: "local" });
                patchSettings({ aiModelId: rec.id });
              }}
              className="doodle-pill shrink-0 px-2.5 py-0.5 text-[11px] hover:border-ink"
            >
              Use {MODEL_BY_ID[rec.id]?.label}
            </button>
          )}
        </div>

        <ul>
          {ai.models
            .filter((m) => m.generative)
            .map((m) => (
              <ModelRow
                key={m.id}
                ai={ai}
                id={m.id}
                recommended={profile.probed && m.id === rec.id}
              />
            ))}
        </ul>

        <div className="flex flex-wrap items-center gap-2 border-t border-stroke px-3 py-2.5">
          <span className="min-w-0 flex-1">
            <span className="text-[13px] font-medium">Router encoder</span>
            <span className="eyebrow ml-2">
              {enc.state === "loaded"
                ? `running · ${enc.backend ?? "wasm"}`
                : enc.state === "loading"
                  ? `downloading ${Math.round(enc.progress * 100)}%`
                  : enc.cached
                    ? "on device"
                    : "optional · not downloaded"}
            </span>
            {enc.error && <span className="mt-1 block text-[12px] text-loss">{enc.error}</span>}
          </span>
          <HelpDot label="About the encoder">
            {`${PROVIDER_BY_ID[DEFAULT_EMBEDDING_ID].sizeMb} MB · ${PROVIDER_BY_ID[DEFAULT_EMBEDDING_ID].dimensions}-dim. ${PROVIDER_BY_ID[DEFAULT_EMBEDDING_ID].blurb} Constrained phones fall back to the ${PROVIDER_BY_ID[FALLBACK_EMBEDDING_ID].sizeMb} MB MiniLM. Download once, always warm on this device.`}
          </HelpDot>
          {enc.state === "loaded" ? (
            <button
              type="button"
              onClick={() => enc.unload()}
              className="doodle-pill px-2.5 py-1 text-[11px] hover:border-ink"
            >
              Unload
            </button>
          ) : enc.downloadTarget ? (
            enc.downloadTarget.cached ? (
              <button
                type="button"
                onClick={() => void enc.load()}
                className="doodle-pill bg-ink px-2.5 py-1 text-[11px] text-paper"
              >
                Load
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void enc.download()}
                className="doodle-pill bg-ink px-2.5 py-1 text-[11px] text-paper"
              >
                Download
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={() => void (enc.cached ? enc.load() : enc.download())}
              className="doodle-pill bg-ink px-2.5 py-1 text-[11px] text-paper"
            >
              {enc.cached ? "Load" : "Download"}
            </button>
          )}
        </div>
      </Card>

      <Card
        title="Generation"
        aside={
          <span className={cn("num eyebrow", ai.capability.routeFallback && "text-ink-faint")}>
            semantic {semanticLabel(ai.capability).toLowerCase()}
          </span>
        }
      >
        <div className="border-b border-stroke px-3 py-2.5">
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

        <div className="grid gap-3 px-3 py-2.5 sm:grid-cols-2">
          <label className="text-[12px]">
            <span className="eyebrow block">
              Temperature {(ai.temperature ?? MODEL_BY_ID[selected]?.sampling?.temperature ?? 0.4).toFixed(2)}
              {ai.temperature == null && <span className="ml-1 text-ink-faint">· card default</span>}
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={ai.temperature ?? MODEL_BY_ID[selected]?.sampling?.temperature ?? 0.4}
              onChange={(e) => ai.setTemperature(Number(e.target.value))}
              className="mt-2 w-full accent-[var(--ink)]"
            />
          </label>
          <label className="text-[12px]">
            <span className="eyebrow block">
              Max tokens {ai.maxTokens}
              <span className="ml-1 text-ink-faint">· output reserve of ctx {ai.ctx}</span>
            </span>
            <input
              type="range"
              min={64}
              max={ai.ctx}
              step={128}
              value={ai.maxTokens}
              onChange={(e) => ai.setMaxTokens(Number(e.target.value))}
              className="mt-2 w-full accent-[var(--ink)]"
            />
          </label>
        </div>

        <div className="flex items-center gap-2 border-t border-stroke px-3 py-2">
          <span className="eyebrow flex-1">Runtime</span>
          {ai.speed && (
            <span className="num text-[11px] text-ink-faint">{ai.speed.tps.toFixed(1)} tok/s</span>
          )}
          <HelpDot label="Runtime diagnostics">
            <span className="grid gap-0.5">
              {diagnosticsRows(ai.caps).map((row) => (
                <span key={row.label} className="flex justify-between gap-3">
                  <span className="eyebrow">{row.label}</span>
                  <span className="num">{row.detail}</span>
                </span>
              ))}
            </span>
          </HelpDot>
        </div>
      </Card>
    </>
  );
}

function CloudModels({ ai }: { ai: ReturnType<typeof useAi> }) {
  const doc = useDoc();
  const assistant = doc.settings.assistant;
  const creds = assistant.cloud ?? {};
  // Secret slots hydrate async at boot: re-read when the store is ready.
  const [, bump] = useState(0);
  useEffect(() => onSecretsReady(() => bump((v) => v + 1)), []);

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
                  value={peekSecret(`cloud.${p.id}`) ?? ""}
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
              {active && (
                <div className="mt-2">
                  <p className="eyebrow text-ink-faint">
                    context window · prompt budget basis, provider card is the ceiling
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {CLOUD_CTX_CHOICES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => ai.setCloudCtx(c)}
                        className={cn(
                          "doodle-pill num px-2.5 py-0.5 text-[11px]",
                          ai.cloudCtx === c ? "bg-ink text-paper" : "hover:border-ink",
                        )}
                      >
                        {c >= 1048576 ? `${Math.round(c / 1048576)}M` : `${Math.round(c / 1024)}K`}
                      </button>
                    ))}
                  </div>
                  <p className="eyebrow mt-2 text-ink-faint">
                    output tokens · thinking rides in this budget; auto uses the card default
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {CLOUD_OUT_CHOICES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => ai.setCloudOut(c)}
                        className={cn(
                          "doodle-pill num px-2.5 py-0.5 text-[11px]",
                          (ai.cloudOut || 0) === c ? "bg-ink text-paper" : "hover:border-ink",
                        )}
                      >
                        {c === 0 ? "auto" : c >= 1048576 ? "1M" : `${Math.round(c / 1024)}K`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
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

/** Web search works keyless through the DuckDuckGo proxy; these optional keys
 * unlock the Jina and Tavily transports. Jina stopped answering keyless
 * calls (401), so without a key here that transport is skipped in practice. */
function WebSearchKeys() {
  const [keys, setKeys] = useState<WebProviderKeys>(() => getWebKeys());
  // Secret slots hydrate async at boot: re-read when the store is ready.
  useEffect(() => onSecretsReady(() => setKeys(getWebKeys())), []);
  const patch = (next: WebProviderKeys) => {
    setKeys(next);
    setWebKeys(next);
  };
  return (
    <Card title="Web search keys">
      <p className="border-b border-stroke px-4 py-2.5 text-[12px] text-ink-soft">
        Optional. The agent searches the web keylessly by default; a Jina key enables its search
        transport (keyless calls are refused) and a Tavily key adds the most reliable one. Keys are
        sealed on this device (AES-GCM, device-bound key in IndexedDB) and never leave it except
        to the provider they belong to.
      </p>
      <div className="grid gap-2 px-4 py-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="eyebrow">Jina</span>
          <input
            type="password"
            value={keys.jina ?? ""}
            placeholder="jina_…"
            autoComplete="off"
            onChange={(e) => patch({ ...keys, jina: e.target.value || undefined })}
            className="doodle-pill w-full bg-transparent px-3 py-1 text-[12px]"
          />
        </label>
        <label className="grid gap-1">
          <span className="eyebrow">Tavily</span>
          <input
            type="password"
            value={keys.tavily ?? ""}
            placeholder="tvly-…"
            autoComplete="off"
            onChange={(e) => patch({ ...keys, tavily: e.target.value || undefined })}
            className="doodle-pill w-full bg-transparent px-3 py-1 text-[12px]"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3 px-4 pb-3">
        <a
          href="https://jina.ai/api-keys"
          target="_blank"
          rel="noreferrer"
          className="eyebrow underline"
        >
          get a jina key
        </a>
        <a
          href="https://app.tavily.com"
          target="_blank"
          rel="noreferrer"
          className="eyebrow underline"
        >
          get a tavily key
        </a>
        {(keys.jina || keys.tavily) && (
          <button
            type="button"
            onClick={() => patch({})}
            className="doodle-pill px-3 py-1 text-[11px] text-loss"
          >
            Clear keys
          </button>
        )}
      </div>
    </Card>
  );
}
