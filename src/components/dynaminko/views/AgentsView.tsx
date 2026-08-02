import { useEffect, useMemo, useRef, useState } from "react";
import { DossierCard } from "../DossierCard";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { probeCapabilities, type Capability } from "@/lib/capabilities";
import {
  AGENT_KEYS,
  DEFAULT_AGENTS,
  MODELS,
  SKILLS,
  newId,
  type Agent,
  type McpServer,
  type RemoteProvider,
  type SkillId,
} from "@/lib/agents/config";
import { downloadModel, installedModels, removeModel } from "@/lib/agents/model-store";
import { Bot, Cpu, Plug, Sparkles, Trash2, Download, Check } from "lucide-react";

type Tab = "agents" | "models" | "skills" | "mcp";

const TABS: { id: Tab; label: string; icon: typeof Bot }[] = [
  { id: "agents", label: "Agents", icon: Bot },
  { id: "models", label: "Models", icon: Cpu },
  { id: "skills", label: "Skills", icon: Sparkles },
  { id: "mcp", label: "MCP", icon: Plug },
];

export function AgentsView() {
  const [tab, setTab] = useState<Tab>("agents");

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      <header className="space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-ash">
          Runtime // Agent console
        </p>
        <h1 className="font-sans text-xl text-paper">Agents, models, skills and MCP</h1>
        <p className="text-xs text-ash max-w-2xl">
          Everything on this page is local to this browser. Model weights are cached with the Cache
          API, agent profiles in local storage. No configuration leaves the device.
        </p>
      </header>

      <div className="flex gap-1 border-b border-hairline overflow-x-auto scrollbar-none">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={
                "flex items-center gap-2 px-4 h-10 font-mono text-[10px] uppercase tracking-[0.2em] border-b-2 -mb-px whitespace-nowrap transition-colors " +
                (tab === t.id
                  ? "text-lavender border-lavender"
                  : "text-ash border-transparent hover:text-paper")
              }
            >
              <Icon className="size-3.5" strokeWidth={1.5} />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "agents" && <AgentsTab />}
      {tab === "models" && <ModelsTab />}
      {tab === "skills" && <SkillsTab />}
      {tab === "mcp" && <McpTab />}
    </div>
  );
}

/* ------------------------------------------------------------------ agents */

function AgentsTab() {
  const [agents, setAgents] = useLocalStorage<Agent[]>(AGENT_KEYS.agents, DEFAULT_AGENTS);
  const [activeId, setActiveId] = useLocalStorage<string>(
    AGENT_KEYS.activeAgent,
    DEFAULT_AGENTS[0].id,
  );
  const [providers] = useLocalStorage<RemoteProvider[]>(AGENT_KEYS.providers, []);
  const [selected, setSelected] = useState<string>(activeId);

  const agent = agents.find((a) => a.id === selected) ?? agents[0];

  const patch = (next: Partial<Agent>) =>
    setAgents((prev) => prev.map((a) => (a.id === agent.id ? { ...a, ...next } : a)));

  const addAgent = () => {
    const created: Agent = {
      id: newId(),
      name: "New agent",
      role: "Untitled role",
      systemPrompt: "",
      model: MODELS[0].id,
      temperature: 0.3,
      skills: ["read-portfolio"],
      mcpServers: [],
    };
    setAgents((prev) => [...prev, created]);
    setSelected(created.id);
  };

  if (!agent) {
    return (
      <button onClick={addAgent} className="btn-ghost">
        Create the first agent
      </button>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-4 space-y-2">
        {agents.map((a) => (
          <div
            key={a.id}
            className={
              "border border-hairline p-3 flex items-start gap-3 " +
              (a.id === agent.id ? "border-lavender/40 bg-lavender/[0.04]" : "")
            }
          >
            <button onClick={() => setSelected(a.id)} className="flex-1 text-left">
              <p className="font-sans text-sm text-paper">{a.name}</p>
              <p className="text-[11px] text-ash">{a.role}</p>
              <p className="font-mono text-[10px] text-ash/70 mt-1 uppercase tracking-[0.16em]">
                {a.model} · {a.skills.length} skills
              </p>
            </button>
            <div className="flex flex-col items-end gap-2">
              <button
                onClick={() => setActiveId(a.id)}
                className={
                  "font-mono text-[9px] uppercase tracking-[0.18em] " +
                  (activeId === a.id ? "text-mint" : "text-ash hover:text-paper")
                }
              >
                {activeId === a.id ? "Active" : "Set active"}
              </button>
              {agents.length > 1 && (
                <button
                  onClick={() => {
                    setAgents((prev) => prev.filter((x) => x.id !== a.id));
                    if (selected === a.id) setSelected(agents[0].id);
                  }}
                  aria-label={`Delete ${a.name}`}
                  className="text-ash hover:text-rose"
                >
                  <Trash2 className="size-3.5" strokeWidth={1.5} />
                </button>
              )}
            </div>
          </div>
        ))}
        <button
          onClick={addAgent}
          className="w-full border border-dashed border-hairline h-11 font-mono text-[10px] uppercase tracking-[0.2em] text-ash hover:text-paper hover:border-lavender/40 transition-colors"
        >
          + New agent
        </button>
      </div>

      <div className="lg:col-span-8">
        <DossierCard label="Agent" index={agent.name} className="[&>div:last-child]:p-4">
          <div className="space-y-4">
            <Field label="Name">
              <input
                value={agent.name}
                onChange={(e) => patch({ name: e.target.value })}
                className="input-line"
              />
            </Field>
            <Field label="Role">
              <input
                value={agent.role}
                onChange={(e) => patch({ role: e.target.value })}
                className="input-line"
              />
            </Field>
            <Field label="System prompt">
              <textarea
                value={agent.systemPrompt}
                onChange={(e) => patch({ systemPrompt: e.target.value })}
                rows={5}
                className="input-line resize-y"
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Model">
                <select
                  value={agent.model}
                  onChange={(e) => patch({ model: e.target.value })}
                  className="input-line"
                >
                  <optgroup label="Local">
                    {MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label} · {m.quant}
                      </option>
                    ))}
                  </optgroup>
                  {providers.length > 0 && (
                    <optgroup label="Remote">
                      {providers.map((p) => (
                        <option key={p.id} value={`remote:${p.id}`}>
                          {p.label} · {p.model}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </Field>
              <Field label={`Temperature · ${agent.temperature.toFixed(2)}`}>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={agent.temperature}
                  onChange={(e) => patch({ temperature: Number(e.target.value) })}
                  className="w-full accent-lavender"
                />
              </Field>
            </div>
            <Field label="Skills">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SKILLS.map((s) => {
                  const on = agent.skills.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() =>
                        patch({
                          skills: on
                            ? agent.skills.filter((x) => x !== s.id)
                            : [...agent.skills, s.id as SkillId],
                        })
                      }
                      className={
                        "text-left border border-hairline p-2.5 transition-colors " +
                        (on ? "border-lavender/40 bg-lavender/[0.04]" : "hover:border-ash/30")
                      }
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={
                            "size-3 border " + (on ? "bg-lavender border-lavender" : "border-ash/50")
                          }
                        />
                        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-paper">
                          {s.label}
                        </span>
                        {s.writes && (
                          <span className="ml-auto font-mono text-[9px] text-amber-300/80">
                            approval
                          </span>
                        )}
                      </span>
                      <span className="block text-[11px] text-ash mt-1">{s.description}</span>
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
        </DossierCard>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ models */

function ModelsTab() {
  const [caps, setCaps] = useState<Capability[] | null>(null);
  const [installed, setInstalled] = useState<string[]>([]);
  const [progress, setProgress] = useState<Record<string, { got: number; total: number | null }>>(
    {},
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [providers, setProviders] = useLocalStorage<RemoteProvider[]>(AGENT_KEYS.providers, []);
  const aborts = useRef<Record<string, AbortController>>({});

  useEffect(() => {
    void probeCapabilities().then(setCaps);
    void installedModels().then(setInstalled);
  }, []);

  const start = async (id: string, url: string) => {
    const controller = new AbortController();
    aborts.current[id] = controller;
    setErrors((p) => ({ ...p, [id]: "" }));
    try {
      await downloadModel(
        id,
        url,
        (p) => setProgress((prev) => ({ ...prev, [id]: { got: p.receivedMb, total: p.totalMb } })),
        controller.signal,
      );
      setInstalled(await installedModels());
    } catch (err) {
      setErrors((p) => ({
        ...p,
        [id]: err instanceof Error ? err.message : "download failed",
      }));
    } finally {
      setProgress((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      delete aborts.current[id];
    }
  };

  return (
    <div className="space-y-6">
      <DossierCard label="Runtime" index="Capabilities" className="[&>div:last-child]:p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Cap label="WebGPU" ok={capOk(caps, "webgpu")} />
          <Cap label="WASM SIMD" ok={capOk(caps, "simd")} />
          <Cap label="Threads" ok={capOk(caps, "sab")} />
          <Cap label="Cache API" ok={typeof caches !== "undefined"} />
        </div>
        <p className="text-[11px] text-ash mt-4">
          Local inference runs llama.cpp compiled to WebAssembly, with WebGPU offload when the
          device exposes it. Weights download once and are served from the cache on later visits.
        </p>
      </DossierCard>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {MODELS.map((m) => {
          const isInstalled = installed.includes(m.id);
          const p = progress[m.id];
          const pct = p?.total ? Math.round((p.got / p.total) * 100) : null;
          const blocked = m.runtime === "webgpu" && caps != null && capOk(caps, "webgpu") === false;
          return (
            <DossierCard key={m.id} eyebrow={`Model // ${m.params}`}>
              <div className="space-y-3">
                <div>
                  <p className="font-sans text-sm text-paper">{m.label}</p>
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ash mt-1">
                    {m.quant} · {m.sizeMb} MB · {m.runtime}
                  </p>
                </div>
                <p className="text-[11px] text-ash">{m.note}</p>
                {blocked && (
                  <p className="font-mono text-[10px] text-amber-300/80">
                    requires WebGPU — unavailable here
                  </p>
                )}
                {errors[m.id] && (
                  <p className="font-mono text-[10px] text-rose">{errors[m.id]}</p>
                )}
                {p ? (
                  <div className="space-y-1">
                    <div className="h-1 bg-hairline">
                      <div
                        className="h-full bg-lavender transition-[width]"
                        style={{ width: `${pct ?? 5}%` }}
                      />
                    </div>
                    <div className="flex justify-between font-mono text-[10px] text-ash">
                      <span>
                        {p.got} / {p.total ?? "?"} MB
                      </span>
                      <button
                        onClick={() => aborts.current[m.id]?.abort()}
                        className="hover:text-rose"
                      >
                        cancel
                      </button>
                    </div>
                  </div>
                ) : isInstalled ? (
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-mint">
                      <Check className="size-3.5" strokeWidth={2} /> cached
                    </span>
                    <button
                      onClick={async () => {
                        await removeModel(m.id);
                        setInstalled(await installedModels());
                      }}
                      className="font-mono text-[10px] uppercase tracking-[0.16em] text-ash hover:text-rose"
                    >
                      remove
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => void start(m.id, m.url)}
                    className="w-full h-9 border border-hairline hover:border-lavender/50 flex items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper transition-colors"
                  >
                    <Download className="size-3.5" strokeWidth={1.5} /> download
                  </button>
                )}
              </div>
            </DossierCard>
          );
        })}
      </div>

      <DossierCard label="Model" index="Remote providers" className="[&>div:last-child]:p-4">
        <p className="text-[11px] text-ash mb-3">
          Optional. Keys stay in this browser and are only sent to the endpoint you name.
        </p>
        <div className="space-y-3">
          {providers.map((p, i) => (
            <div key={p.id} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-center">
              <input
                value={p.label}
                placeholder="Label"
                onChange={(e) =>
                  setProviders((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                  )
                }
                className="input-line"
              />
              <input
                value={p.baseUrl}
                placeholder="https://…/v1"
                onChange={(e) =>
                  setProviders((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, baseUrl: e.target.value } : x)),
                  )
                }
                className="input-line"
              />
              <input
                value={p.model}
                placeholder="model id"
                onChange={(e) =>
                  setProviders((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, model: e.target.value } : x)),
                  )
                }
                className="input-line"
              />
              <div className="flex gap-2">
                <input
                  value={p.apiKey}
                  type="password"
                  placeholder="api key"
                  onChange={(e) =>
                    setProviders((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, apiKey: e.target.value } : x)),
                    )
                  }
                  className="input-line flex-1"
                />
                <button
                  onClick={() => setProviders((prev) => prev.filter((_, j) => j !== i))}
                  aria-label="Remove provider"
                  className="text-ash hover:text-rose"
                >
                  <Trash2 className="size-3.5" strokeWidth={1.5} />
                </button>
              </div>
            </div>
          ))}
          <button
            onClick={() =>
              setProviders((prev) => [
                ...prev,
                { id: newId(), label: "", baseUrl: "", model: "", apiKey: "" },
              ])
            }
            className="border border-dashed border-hairline h-9 px-4 font-mono text-[10px] uppercase tracking-[0.2em] text-ash hover:text-paper"
          >
            + Add provider
          </button>
        </div>
      </DossierCard>
    </div>
  );
}

/* ------------------------------------------------------------------ skills */

function SkillsTab() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {SKILLS.map((s) => (
        <DossierCard key={s.id} eyebrow={`Skill // ${s.writes ? "write" : "read"}`}>
          <p className="font-sans text-sm text-paper">{s.label}</p>
          <p className="text-[11px] text-ash mt-1">{s.description}</p>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] mt-3 text-ash">
            {s.writes ? (
              <span className="text-amber-300/80">proposal → approval required</span>
            ) : (
              <span className="text-mint">read-only</span>
            )}
          </p>
        </DossierCard>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------------- mcp */

function McpTab() {
  const [servers, setServers] = useLocalStorage<McpServer[]>(AGENT_KEYS.mcp, []);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");

  const valid = useMemo(() => {
    try {
      return new URL(url).protocol === "https:";
    } catch {
      return false;
    }
  }, [url]);

  const add = () => {
    if (!valid) return;
    setServers((prev) => [
      ...prev,
      {
        id: newId(),
        label: label || new URL(url).hostname,
        url,
        transport: "http",
        enabled: true,
        state: "unknown",
        tools: [],
        lastError: null,
      },
    ]);
    setUrl("");
    setLabel("");
  };

  return (
    <div className="space-y-4">
      <DossierCard label="MCP" index="Add server" className="[&>div:last-child]:p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label"
            className="input-line"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://server.example.com/mcp"
            className="input-line sm:col-span-2"
          />
        </div>
        <div className="flex items-center justify-between mt-3">
          <p className="font-mono text-[10px] text-ash">
            {url && !valid ? "https urls only" : "streamable http transport"}
          </p>
          <button
            onClick={add}
            disabled={!valid}
            className="h-9 px-5 border border-hairline hover:border-lavender/50 disabled:opacity-40 font-mono text-[10px] uppercase tracking-[0.18em] text-paper"
          >
            Register
          </button>
        </div>
      </DossierCard>

      {servers.length === 0 ? (
        <p className="font-mono text-[11px] text-ash">
          No MCP servers registered. Agents run with local skills only.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {servers.map((s) => (
            <DossierCard key={s.id} eyebrow={`MCP // ${s.state}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-sans text-sm text-paper truncate">{s.label}</p>
                  <p className="font-mono text-[10px] text-ash truncate">{s.url}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() =>
                      setServers((prev) =>
                        prev.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)),
                      )
                    }
                    className={
                      "font-mono text-[10px] uppercase tracking-[0.16em] " +
                      (s.enabled ? "text-mint" : "text-ash")
                    }
                  >
                    {s.enabled ? "enabled" : "disabled"}
                  </button>
                  <button
                    onClick={() => setServers((prev) => prev.filter((x) => x.id !== s.id))}
                    aria-label="Remove server"
                    className="text-ash hover:text-rose"
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.5} />
                  </button>
                </div>
              </div>
              {s.lastError && <p className="font-mono text-[10px] text-rose mt-2">{s.lastError}</p>}
            </DossierCard>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ atoms */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ash">{label}</span>
      {children}
    </label>
  );
}

function capOk(caps: Capability[] | null, key: string): boolean | undefined {
  if (!caps) return undefined;
  return caps.find((c) => c.key === key)?.ok ?? false;
}

function Cap({ label, ok }: { label: string; ok?: boolean }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ash">{label}</p>
      <p className={"font-mono text-sm mt-1 " + (ok ? "text-mint" : "text-rose")}>
        {ok == null ? "…" : ok ? "available" : "absent"}
      </p>
    </div>
  );
}
