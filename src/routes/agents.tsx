import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { Panel, Shell } from "@/components/pot/Shell";
import { useAi } from "@/hooks/useAi";
import { useDoc } from "@/hooks/useDoc";
import { relativeTime } from "@/lib/format";
import { AGENTS, automationOn, type AgentDef } from "@/lib/agents/registry";
import { SKILLS } from "@/lib/skills/registry";
import { runSkill, type SkillResult } from "@/lib/skills/run";
import { TOOLS, TOOL_GROUPS } from "@/lib/tools/registry";
import { POLICY } from "@/lib/tools/types";
import {
  clearLogs,
  patchAssistant,
  patchSettings,
  setAutomation,
  toggleAssistantItem,
} from "@/lib/store";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "agents", label: "Agents" },
  { id: "ask", label: "Ask" },
  { id: "models", label: "Models" },
  { id: "skills", label: "Skills" },
  { id: "tools", label: "Tools" },
  { id: "logs", label: "Log" },
] as const;

type Tab = (typeof TABS)[number]["id"];


export const Route = createFileRoute("/agents")({
  validateSearch: (s: Record<string, unknown>) => ({
    tab: (TABS.some((t) => t.id === s.tab) ? s.tab : "agents") as Tab,
  }),
  head: () => ({
    meta: [
      { title: "Agents — Proof of Thesis" },
      {
        name: "description",
        content:
          "Automation agents that read your wallet and one assistant you configure: models, skills, tools and a live log of everything they do.",
      },
      { property: "og:title", content: "Agents — Proof of Thesis" },
      {
        property: "og:description",
        content: "Automation that extracts your trades, and one assistant you control.",
      },
    ],
  }),
  component: AgentsPage,
});

function AgentsPage() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const doc = useDoc();

  return (
    <Shell
      title="Agents"
      subtitle="Automation runs on its own · the assistant only when you ask"
    >
      <nav className="mb-4 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => void navigate({ search: { tab: t.id } })}
            className={cn(
              "doodle-pill shrink-0 px-3.5 py-1.5 text-[12px] transition",
              tab === t.id ? "bg-ink text-paper" : "text-ink-soft hover:border-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "agents" && <AgentsTab automation={doc.settings.automation} />}
      {tab === "models" && <ModelsTab />}
      {tab === "skills" && <SkillsTab selected={doc.settings.assistant.skills} />}
      {tab === "tools" && <ToolsTab selected={doc.settings.assistant.tools} />}
      {tab === "logs" && <LogsTab />}
    </Shell>
  );
}

function AgentCard({
  agent,
  on,
  onToggle,
}: {
  agent: AgentDef;
  on: boolean;
  onToggle?: () => void;
}) {
  return (
    <li className="border-b border-stroke px-4 py-3 last:border-0">
      <div className="flex items-baseline gap-3">
        <span className="flex-1 text-[13px] font-medium">{agent.name}</span>
        <span className="eyebrow">{agent.live ? "wired" : "not wired yet"}</span>
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            className={cn(
              "doodle-pill px-3 py-1 text-[11px]",
              on ? "bg-ink text-paper" : "text-ink-faint",
            )}
          >
            {on ? "On" : "Off"}
          </button>
        )}
      </div>
      <p className="mt-1 text-[12px] text-ink-soft">{agent.job}</p>
      <p className="eyebrow mt-1.5">
        runs {agent.trigger} · {agent.tools.length} tools · {agent.skills.length} skills
      </p>
    </li>
  );
}

function AgentsTab({ automation }: { automation: Record<string, boolean> }) {
  const doc = useDoc();
  const assistant = AGENTS.find((a) => a.kind === "assistant")!;
  const jobs = AGENTS.filter((a) => a.kind === "automation");
  const cfg = doc.settings.assistant;

  return (
    <div className="grid gap-4">
      <Panel eyebrow="Automation // Fixed jobs, no conversation">
        <ul>
          {jobs.map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              on={automationOn(automation, a.id)}
              onToggle={() => setAutomation(a.id, !automationOn(automation, a.id))}
            />
          ))}
        </ul>
      </Panel>

      <Panel eyebrow="Assistant // The one you configure" delay={60}>
        <ul>
          <AgentCard agent={assistant} on />
        </ul>
        <div className="grid gap-3 border-t border-stroke px-4 py-3 sm:grid-cols-2">
          <label className="text-[12px]">
            <span className="eyebrow block">Provider</span>
            <select
              value={cfg.provider}
              onChange={(e) =>
                patchAssistant({ provider: e.target.value as "local" | "cloud" })
              }
              className="doodle-inset mt-1.5 w-full bg-transparent px-3 py-2 text-[13px] outline-none"
            >
              <option value="local">On this device (WebAssembly)</option>
              <option value="cloud" disabled>
                Cloud — not connected
              </option>
            </select>
          </label>
          <div className="text-[12px]">
            <span className="eyebrow block">Enabled skills</span>
            <p className="mt-1.5 text-[13px]">
              {cfg.skills.length} skills · {cfg.tools.length} tools
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function ModelsTab() {
  const ai = useAi();
  const doc = useDoc();

  return (
    <Panel eyebrow="Models // Local, downloaded once and cached">
      <ul>
        {ai.models.map((m) => {
          const active = doc.settings.assistant.modelId === m.id;
          return (
            <li key={m.id} className="border-b border-stroke px-4 py-3 last:border-0">
              <label className="flex items-start gap-3">
                <input
                  type="radio"
                  name="model"
                  className="mt-1"
                  checked={active}
                  onChange={() => {
                    patchAssistant({ modelId: m.id });
                    patchSettings({ aiModelId: m.id });
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[13px] font-medium">{m.label}</span>
                    <span className="num text-[11px] text-ink-faint">{m.quant}</span>
                    {m.standard && <span className="eyebrow">standard</span>}
                    {m.desktopOnly && <span className="eyebrow">desktop</span>}
                  </span>
                  <span className="mt-1 block text-[12px] text-ink-soft">{m.blurb}</span>
                  <span className="eyebrow mt-1 block">{m.role}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2 border-t border-stroke px-4 py-3">
        <button
          type="button"
          onClick={() => void ai.load(doc.settings.assistant.modelId)}
          className="doodle-pill bg-ink px-4 py-1.5 text-[12px] font-medium text-paper"
        >
          {ai.status.phase === "ready" ? "Loaded" : "Download & start"}
        </button>
        {ai.status.phase === "ready" && (
          <button
            type="button"
            onClick={() => void ai.stop()}
            className="doodle-pill px-4 py-1.5 text-[12px]"
          >
            Unload
          </button>
        )}
        {ai.status.phase === "downloading" && (
          <span className="num text-[12px] text-ink-faint">
            {Math.round(ai.status.progress * 100)}%
          </span>
        )}
        {ai.status.phase === "error" && (
          <span className="text-[12px] text-loss">{ai.status.message}</span>
        )}
      </div>
    </Panel>
  );
}

function SkillsTab({ selected }: { selected: string[] }) {
  return (
    <Panel eyebrow="Skills // What an agent knows how to do">
      <ul>
        {SKILLS.map((s) => {
          const assistantSkill = s.agents.includes("assistant");
          return (
            <li key={s.id} className="border-b border-stroke px-4 py-3 last:border-0">
              <div className="flex items-baseline gap-3">
                <span className="flex-1 text-[13px] font-medium">{s.label}</span>
                {assistantSkill ? (
                  <button
                    type="button"
                    onClick={() => toggleAssistantItem("skills", s.id)}
                    className={cn(
                      "doodle-pill px-3 py-1 text-[11px]",
                      selected.includes(s.id) ? "bg-ink text-paper" : "text-ink-faint",
                    )}
                  >
                    {selected.includes(s.id) ? "On" : "Off"}
                  </button>
                ) : (
                  <span className="eyebrow">automation</span>
                )}
              </div>
              <p className="mt-1 text-[12px] text-ink-soft">{s.blurb}</p>
              <p className="eyebrow mt-1.5">used by {s.agents.join(", ")}</p>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function ToolsTab({ selected }: { selected: string[] }) {
  return (
    <Panel eyebrow="Tools // What an agent may touch">
      <ul>
        {TOOLS.map((t) => (
          <li key={t.id} className="border-b border-stroke px-4 py-3 last:border-0">
            <div className="flex items-baseline gap-3">
              <span className="flex-1 text-[13px] font-medium">{t.label}</span>
              <span className="eyebrow">{t.access}</span>
              <button
                type="button"
                onClick={() => toggleAssistantItem("tools", t.id)}
                className={cn(
                  "doodle-pill px-3 py-1 text-[11px]",
                  selected.includes(t.id) ? "bg-ink text-paper" : "text-ink-faint",
                )}
              >
                {selected.includes(t.id) ? "Granted" : "Denied"}
              </button>
            </div>
            <p className="mt-1 text-[12px] text-ink-soft">{t.blurb}</p>
            {!t.live && <p className="eyebrow mt-1.5">not wired yet</p>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function LogsTab() {
  const doc = useDoc();
  const logs = doc.logs ?? [];

  return (
    <Panel
      eyebrow={`Log // ${logs.length} lines on this device`}
      action={
        logs.length > 0 && (
          <button
            type="button"
            onClick={clearLogs}
            className="doodle-pill px-3 py-1 text-[11px] hover:border-ink"
          >
            Clear
          </button>
        )
      }
    >
      <ul className="max-h-[60vh] overflow-y-auto">
        {logs.map((l) => (
          <li key={l.id} className="border-b border-stroke px-4 py-2.5 last:border-0">
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  "eyebrow",
                  l.level === "error" && "text-loss",
                  l.level === "warn" && "text-ink",
                )}
              >
                {l.level}
              </span>
              <span className="num flex-1 truncate text-[12px]">
                {l.agent} · {l.event}
              </span>
              <span className="eyebrow">{relativeTime(l.ts)}</span>
            </div>
            {l.detail && <p className="num mt-1 text-[11px] text-ink-faint">{l.detail}</p>}
          </li>
        ))}
        {logs.length === 0 && (
          <li className="px-4 py-8 text-center text-[13px] text-ink-faint">
            Nothing yet. Watch a wallet and the extractor will start writing here.
          </li>
        )}
      </ul>
    </Panel>
  );
}
