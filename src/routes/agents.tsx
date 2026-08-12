import { createFileRoute } from "@tanstack/react-router";
import { Brain, Eye, ImagePlus, Send, Sparkles, SquareStack, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ModelPanel } from "@/components/pot/ModelPanel";
import { Panel, Shell } from "@/components/pot/Shell";
import { useAi } from "@/hooks/useAi";
import { useDoc } from "@/hooks/useDoc";
import { relativeTime } from "@/lib/format";
import { MAX_CONTEXT_MESSAGES, MODELS, STATE_LABEL, splitThinking } from "@/lib/ai";
import { encoderState } from "@/lib/ai/encoder";
import { AGENTS, automationOn } from "@/lib/agents/registry";
import { COMMANDS, parseCommand, suggestions, type Suggestion } from "@/lib/chat/commands";
import { digestLine } from "@/lib/chat/context";
import { routeMessage, routeSemantic } from "@/lib/chat/route";
import { newMessage, type ChatMessage } from "@/lib/chat/session";
import {
  bootstrapSessions,
  contextFor,
  createSession,
  deleteSession,
  listSessions,
  readSession,
  writeSession,
  type SessionMeta,
} from "@/lib/chat/sessions";

import { SKILLS } from "@/lib/skills/registry";
import { runSkill } from "@/lib/skills/run";
import { searchCards } from "@/lib/tools/journal";
import * as ind from "@/lib/tools/indicators";
import { TOOLS, TOOL_BY_ID, TOOL_GROUPS } from "@/lib/tools/registry";
import { POLICY, needsApproval, runTool } from "@/lib/tools/types";
import { clearLogs, getDoc, setAutomation, toggleAssistantItem } from "@/lib/store";
import { cn } from "@/lib/utils";

const RAIL = [
  { id: "model", label: "Model" },
  { id: "agents", label: "Agents" },
  { id: "skills", label: "Skills" },
  { id: "tools", label: "Tools" },
  { id: "logs", label: "Log" },
] as const;

type RailTab = (typeof RAIL)[number]["id"];

export const Route = createFileRoute("/agents")({
  validateSearch: (s: Record<string, unknown>) => ({
    tab: (RAIL.some((t) => t.id === s.tab) ? s.tab : "model") as RailTab,
  }),
  head: () => ({
    meta: [
      { title: "Assistant — Proof of Thesis" },
      {
        name: "description",
        content:
          "An inline console over your journal: slash commands run deterministic tools first, and the on-device model only speaks when reasoning is actually needed.",
      },
      { property: "og:title", content: "Assistant — Proof of Thesis" },
      {
        property: "og:description",
        content: "Slash commands, real tools, and a local model you control.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AgentsPage,
});

function AgentsPage() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [railOpen, setRailOpen] = useState(false);
  const ai = useAi();

  const openRail = (next: RailTab) => {
    void navigate({ search: { tab: next } });
    setRailOpen(true);
  };

  return (
    <Shell
      title="Assistant"
      subtitle="tools answer first · the model only when reasoning is needed"
      action={
        <button
          type="button"
          onClick={() => setRailOpen((v) => !v)}
          className="doodle-pill px-3 py-1 text-[11px] hover:border-ink lg:hidden"
        >
          {railOpen ? "Close" : "Panels"}
        </button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <ChatConsole ai={ai} onOpenRail={openRail} />

        <aside
          className={cn(
            "grid content-start gap-4",
            !railOpen && "hidden lg:grid",
          )}
        >
          <nav className="flex gap-1 overflow-x-auto">
            {RAIL.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => void navigate({ search: { tab: t.id } })}
                className={cn(
                  "doodle-pill shrink-0 px-3 py-1 text-[11px] transition",
                  tab === t.id ? "bg-ink text-paper" : "text-ink-soft hover:border-ink",
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {tab === "model" && (
            <Panel eyebrow="Model // On this device">
              <ModelPanel ai={ai} />
            </Panel>
          )}
          {tab === "agents" && <AgentsRail />}
          {tab === "skills" && <SkillsRail />}
          {tab === "tools" && <ToolsRail />}
          {tab === "logs" && <LogsRail />}
        </aside>
      </div>
    </Shell>
  );
}

// ── the console ────────────────────────────────────────────────────────────

function ChatConsole({
  ai,
  onOpenRail,
}: {
  ai: ReturnType<typeof useAi>;
  onOpenRail: (tab: RailTab) => void;
}) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [vision, setVision] = useState(false);
  const [reasoning, setReasoning] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // One idempotent bootstrap: read the index, create a session only when empty.
  useEffect(() => {
    const boot = bootstrapSessions();
    setSessions(boot.sessions);
    setActiveId(boot.activeId);
    setMessages(readSession(boot.activeId));
  }, []);

  useEffect(() => {
    if (!activeId) return;
    writeSession(activeId, messages);
    setSessions(listSessions());
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [messages, activeId]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [busy, activeId]);

  const picks = useMemo(() => suggestions(input), [input]);
  const canSee = Boolean(ai.spec?.vision);
  const canReason = Boolean(ai.spec?.reasoning);

  const push = (m: Omit<ChatMessage, "id" | "ts">) => {
    const msg = newMessage(m);
    setMessages((prev) => [...prev, msg]);
    return msg;
  };

  const openSession = (id: string) => {
    setActiveId(id);
    setMessages(readSession(id));
  };

  const startSession = (title?: string) => {
    const meta = createSession(title || "New session");
    setSessions(listSessions());
    setActiveId(meta.id);
    setMessages([]);
  };

  const speak = async (system: string, user: string) => {
    // Chatting is itself the request to download: the model loads on demand.
    if (ai.status.phase !== "ready") {
      push({
        role: "note",
        text: `${ai.spec?.label ?? "The model"} is not running yet — starting it now. First run downloads ~${ai.spec?.weightsGb ?? "?"} GB, then it stays on this device.`,
      });
      const ok = await ai.ensure();
      if (!ok) {
        push({
          role: "note",
          text: "The model could not start. The numbers above are still computed locally.",
        });
        return;
      }
    }
    setBusy(true);
    try {
      const history = contextFor(messages, Math.floor(ai.ctx * 0.4), MAX_CONTEXT_MESSAGES);
      const raw = await ai.ask(
        { system: `${system}\n\nContext: ${digestLine()}`, user: `${history.text}\n\n${user}` },
        {
          thinking,
          images: vision && image ? [image] : undefined,
        },
      );
      const { thinking: think, answer } = splitThinking(raw);
      push({ role: "assistant", text: answer || raw, thinking: think });
      setImage(null);
    } catch (err) {
      push({
        role: "note",
        text: err instanceof Error ? err.message : "the assistant failed",
      });
    } finally {
      setBusy(false);
    }
  };


  const runSkillTurn = async (
    skillId: string,
    args: { motive?: never; thesisId?: string } = {},
  ) => {
    const result = runSkill(skillId, args);
    push({
      role: "tool",
      text: result.skill.label,
      card: {
        source: result.skill.tools.join(" → ") || result.skill.id,
        facts: result.facts,
        data: result.data,
      },
    });
    if (result.aiRequired || reasoning) {
      await speak(
        "You are a trading-journal analyst. Use only the structured result. Be concrete and brief.",
        result.prompt,
      );
    }
  };

  const runToolTurn = async (toolId: string, rest: string) => {
    const tool = TOOL_BY_ID[toolId];
    if (!tool) return push({ role: "note", text: `No tool called ${toolId}.` });
    if (!tool.live) return push({ role: "note", text: `${tool.id} is not built yet.` });
    let parsed: unknown = {};
    if (rest) {
      try {
        parsed = JSON.parse(rest);
      } catch {
        parsed = { query: rest };
      }
    }
    if (needsApproval(tool.access)) {
      return push({
        role: "tool",
        text: `${tool.label} needs your approval`,
        approval: {
          toolId: tool.id,
          access: tool.access,
          target: rest || "—",
          input: parsed,
          state: "pending",
        },
      });
    }
    const out = await runTool(tool, parsed);
    push({
      role: "tool",
      text: tool.label,
      card: {
        source: tool.id,
        facts: [summarise(out)],
        data: { result: out } as Record<string, unknown>,
      },
    });
  };

  const approve = async (id: string, ok: boolean) => {
    const msg = messages.find((m) => m.id === id);
    if (!msg?.approval) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id && m.approval
          ? { ...m, approval: { ...m.approval, state: ok ? "approved" : "rejected" } }
          : m,
      ),
    );
    if (!ok) return;
    const tool = TOOL_BY_ID[msg.approval.toolId];
    if (!tool) return;
    try {
      const out = await runTool(tool, msg.approval.input);
      push({
        role: "tool",
        text: `${tool.label} ran`,
        card: { source: tool.id, facts: [summarise(out)], data: { result: out } },
      });
    } catch (err) {
      push({ role: "note", text: err instanceof Error ? err.message : "the tool failed" });
    }
  };

  const submit = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    push({ role: "user", text });

    const cmd = parseCommand(text);
    if (cmd) {
      const { name, rest } = cmd;
      if (name === "clear") {
        setMessages([]);
        return;
      }
      if (name === "new") {
        startSession(rest);
        return;
      }
      if (name === "sessions") {
        push({
          role: "note",
          text: sessions.length
            ? sessions
                .map(
                  (s) =>
                    `${s.id === activeId ? "→" : " "} ${s.title} · ${s.turns} turns · ${relativeTime(s.updatedAt)}`,
                )
                .join("\n")
            : "No saved sessions yet.",
        });
        return;
      }
      if (name === "help") {
        push({
          role: "note",
          text: COMMANDS.map((c) => `/${c.name} ${c.args} — ${c.blurb}`).join("\n"),
        });
        return;
      }
      if (name === "models") {
        push({
          role: "note",
          text: MODELS.map(
            (m) => `${m.label} — ${m.role} · ${STATE_LABEL[ai.states[m.id]]}\n  ${m.serve}`,
          ).join("\n"),
        });
        return;
      }
      if (name === "tools") {
        push({
          role: "note",
          text: TOOLS.filter((t) => t.live)
            .map((t) => `${t.id} [${t.access}] — ${t.purpose}`)
            .join("\n"),
        });
        return;
      }
      if (name === "skills") {
        push({
          role: "note",
          text: SKILLS.map(
            (s) =>
              `${s.id} — ${s.purpose} (${s.aiRequired ? "needs a model" : "no model"})`,
          ).join("\n"),
        });
        return;
      }
      if (name === "context") {
        const n = Number(rest);
        if (Number.isFinite(n) && n > 0) {
          ai.setCtx(n);
          push({ role: "note", text: `Context window set to ${n} tokens. Reload to apply.` });
        } else {
          const used = contextFor(messages, Math.floor(ai.ctx * 0.4), MAX_CONTEXT_MESSAGES);
          push({
            role: "note",
            text: `ctx ${ai.ctx} · last ${used.turns} turns replayed · ~${used.used} tokens of history · cap ${MAX_CONTEXT_MESSAGES} messages.`,
          });
        }
        return;
      }
      if (name === "model") {
        const wanted = MODELS.find((m) => m.id === rest || m.label.toLowerCase() === rest.toLowerCase());
        if (wanted) {
          ai.select(wanted.id);
          push({ role: "note", text: `${wanted.label} selected — ${STATE_LABEL[ai.states[wanted.id]]}.` });
          return;
        }
        onOpenRail("model");
        push({ role: "note", text: "Model harness opened in the panel." });
        return;
      }

      if (name === "pot") return void runSkillTurn("journal.review");
      if (name === "skill") return void runSkillTurn(rest.split(/\s+/)[0]);
      if (name === "tool") {
        const [id, ...tail] = rest.split(/\s+/);
        return void runToolTurn(id, tail.join(" "));
      }
      if (name === "journal") {
        const cards = searchCards(rest, 12);
        push({
          role: "tool",
          text: `journal.search "${rest}"`,
          card: {
            source: "journal.search",
            facts: cards.length
              ? cards
                  .slice(0, 8)
                  .map(
                    (c) =>
                      `${new Date(c.date).toISOString().slice(0, 10)} · ${c.ticker ?? "—"} · ${c.motive ?? "no motive"} · ${c.record.slice(0, 70)}`,
                  )
              : ["Nothing in the journal matches that."],
            data: { matches: cards.length, cards: cards.slice(0, 8) },
          },
        });
        return;
      }
      if (name === "thesis") {
        const t = getDoc().theses.find((x) =>
          x.title.toLowerCase().includes(rest.toLowerCase()),
        );
        if (!t) return push({ role: "note", text: `No thesis matching "${rest}".` });
        return void runSkillTurn("thesis.review", { thesisId: t.id });
      }
      push({ role: "note", text: `Unknown command /${name}. Try /help.` });
      return;
    }

    const routed = routeMessage(text);
    if (routed.kind === "skill") {
      push({ role: "note", text: `Running ${routed.skillId} — ${routed.why}.` });
      return void runSkillTurn(routed.skillId, { thesisId: routed.thesisId });
    }
    if (routed.kind === "search") {
      const cards = searchCards(routed.query, 8);
      if (cards.length) {
        push({
          role: "tool",
          text: `journal.search "${routed.query}"`,
          card: {
            source: "journal.search",
            facts: cards.map((c) => `${c.ticker ?? "—"} · ${c.record.slice(0, 70)}`),
            data: { matches: cards.length },
          },
        });
        if (!reasoning) return;
      }
    }
    await speak(
      "You are the assistant inside a trading journal. Answer briefly. If a number is needed, say which tool would produce it instead of guessing.",
      text,
    );
  };

  const apply = (s: Suggestion) => {
    setInput(s.insert);
    inputRef.current?.focus();
  };

  return (
    <div className="grid content-start gap-3">
      <Panel eyebrow={`Session // ${messages.length} turns · ctx ${ai.ctx}`}>
        <div ref={boxRef} className="max-h-[52vh] min-h-[240px] overflow-y-auto px-4 py-3">
          {messages.length === 0 && (
            <div className="py-6 text-[13px] text-ink-soft">
              <p>Ask in plain words, or press / for a command.</p>
              <p className="eyebrow mt-3">
                {digestLine()}
              </p>
            </div>
          )}
          <ul className="grid gap-3">
            {messages.map((m) => (
              <li key={m.id}>
                {m.role === "user" && (
                  <p className="ml-auto max-w-[85%] rounded-xl bg-ink px-3 py-2 text-[13px] text-paper">
                    {m.text}
                  </p>
                )}
                {m.role === "note" && (
                  <p className="eyebrow whitespace-pre-wrap leading-relaxed">{m.text}</p>
                )}
                {m.role === "assistant" && (
                  <div className="max-w-[92%]">
                    {m.thinking && (
                      <details className="doodle-inset mb-2 px-3 py-2">
                        <summary className="eyebrow cursor-pointer">thinking</summary>
                        <p className="mt-1 whitespace-pre-wrap text-[12px] text-ink-soft">
                          {m.thinking}
                        </p>
                      </details>
                    )}
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{m.text}</p>
                  </div>
                )}
                {m.role === "tool" && (
                  <div className="doodle-inset px-3 py-2">
                    <p className="num eyebrow">{m.card?.source ?? m.approval?.toolId}</p>
                    {m.card && (
                      <ul className="mt-1 grid gap-1">
                        {m.card.facts.map((f, i) => (
                          <li key={i} className="text-[13px] leading-relaxed">
                            {f}
                          </li>
                        ))}
                      </ul>
                    )}
                    {m.approval && (
                      <div className="mt-1">
                        <p className="text-[13px]">
                          {m.text} · target {m.approval.target}
                        </p>
                        <p className="eyebrow mt-1">
                          access {m.approval.access} · approval required: YES
                        </p>
                        {m.approval.state === "pending" ? (
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => void approve(m.id, true)}
                              className="doodle-pill bg-ink px-3 py-1 text-[11px] text-paper"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => void approve(m.id, false)}
                              className="doodle-pill px-3 py-1 text-[11px]"
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <p className="eyebrow mt-1">{m.approval.state}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
            {busy && (
              <li className="eyebrow">
                {ai.output ? ai.output.slice(-160) : "thinking…"}
              </li>
            )}
          </ul>
        </div>

        {picks.length > 0 && (
          <ul className="max-h-[190px] overflow-y-auto border-t border-stroke">
            {picks.map((s) => (
              <li key={s.insert}>
                <button
                  type="button"
                  onClick={() => apply(s)}
                  className="flex w-full items-baseline gap-2 px-4 py-2 text-left hover:bg-sunken"
                >
                  <span className="num text-[12px] font-medium">{s.label}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink-soft">
                    {s.hint}
                  </span>
                  {s.badge && <span className="eyebrow">{s.badge}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-stroke px-4 py-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="Ask, or / for commands"
              className="min-h-[38px] flex-1 resize-none bg-transparent text-[13px] outline-none"
            />
            {busy ? (
              <button
                type="button"
                onClick={ai.abort}
                className="doodle-pill px-3 py-1.5 text-[11px]"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void submit()}
                aria-label="Send"
                className="doodle-pill grid h-8 w-8 place-items-center bg-ink text-paper"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Toggle
              on={vision}
              disabled={!canSee}
              onClick={() => setVision((v) => !v)}
              icon={<Eye className="h-3 w-3" />}
              label="Vision"
            />
            <Toggle
              on={reasoning}
              disabled={!modelReady}
              onClick={() => setReasoning((v) => !v)}
              icon={<Sparkles className="h-3 w-3" />}
              label="Reason"
            />
            <Toggle
              on={thinking}
              disabled={!canReason}
              onClick={() => setThinking((v) => !v)}
              icon={<Brain className="h-3 w-3" />}
              label="Thinking"
            />
            {vision && canSee && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="doodle-pill inline-flex items-center gap-1 px-2.5 py-1 text-[11px] hover:border-ink"
              >
                <ImagePlus className="h-3 w-3" /> {image ? "Image attached" : "Attach"}
              </button>
            )}
            {image && (
              <button
                type="button"
                onClick={() => setImage(null)}
                aria-label="Remove image"
                className="doodle-pill grid h-6 w-6 place-items-center"
              >
                <X className="h-3 w-3" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenRail("model")}
              className="doodle-pill num ml-auto inline-flex items-center gap-1 px-2.5 py-1 text-[11px] hover:border-ink"
            >
              <SquareStack className="h-3 w-3" />
              {ai.spec?.label ?? "no model"} · ctx {ai.ctx}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => setImage(String(reader.result));
                reader.readAsDataURL(file);
              }}
            />
          </div>
        </div>
      </Panel>
    </div>
  );
}

function Toggle({
  on,
  disabled,
  onClick,
  icon,
  label,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={disabled ? `${label} needs a model that supports it` : label}
      className={cn(
        "doodle-pill inline-flex items-center gap-1 px-2.5 py-1 text-[11px]",
        on ? "bg-ink text-paper" : "text-ink-faint hover:border-ink",
        disabled && "opacity-40",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function summarise(out: unknown): string {
  if (out == null) return "no result";
  if (Array.isArray(out)) return `${out.length} rows`;
  if (typeof out === "object") {
    const json = JSON.stringify(out);
    return json.length > 220 ? `${json.slice(0, 220)}…` : json;
  }
  return String(out);
}

// ── rail panels ────────────────────────────────────────────────────────────

function AgentsRail() {
  const doc = useDoc();
  return (
    <Panel eyebrow="Automation // Fixed jobs">
      <ul>
        {AGENTS.filter((a) => a.kind === "automation").map((a) => {
          const on = automationOn(doc.settings.automation, a.id);
          return (
            <li key={a.id} className="border-b border-stroke px-4 py-3 last:border-0">
              <div className="flex items-baseline gap-2">
                <span className="flex-1 text-[13px] font-medium">{a.name}</span>
                <button
                  type="button"
                  onClick={() => setAutomation(a.id, !on)}
                  className={cn(
                    "doodle-pill px-2.5 py-0.5 text-[11px]",
                    on ? "bg-ink text-paper" : "text-ink-faint",
                  )}
                >
                  {on ? "On" : "Off"}
                </button>
              </div>
              <p className="mt-1 text-[12px] text-ink-soft">{a.job}</p>
              <p className="eyebrow mt-1">runs {a.trigger}</p>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function SkillsRail() {
  const doc = useDoc();
  const selected = doc.settings.assistant.skills;
  return (
    <Panel eyebrow="Skills // Tool chains">
      <ul>
        {SKILLS.map((s) => (
          <li key={s.id} className="border-b border-stroke px-4 py-3 last:border-0">
            <div className="flex items-baseline gap-2">
              <span className="flex-1 text-[13px] font-medium">{s.label}</span>
              <button
                type="button"
                onClick={() => toggleAssistantItem("skills", s.id)}
                className={cn(
                  "doodle-pill px-2.5 py-0.5 text-[11px]",
                  selected.includes(s.id) ? "bg-ink text-paper" : "text-ink-faint",
                )}
              >
                {selected.includes(s.id) ? "On" : "Off"}
              </button>
            </div>
            <p className="num eyebrow mt-1">/skill {s.id}</p>
            <p className="mt-1 text-[12px] text-ink-soft">{s.purpose}</p>
            <p className="eyebrow mt-1">{s.aiRequired ? "needs a model" : "no model"}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ToolsRail() {
  return (
    <div className="grid gap-4">
      {TOOL_GROUPS.map((group, i) => (
        <Panel key={group} eyebrow={`${group} // deterministic`} delay={i * 15}>
          <ul>
            {TOOLS.filter((t) => t.group === group).map((t) => (
              <li key={t.id} className="border-b border-stroke px-4 py-2.5 last:border-0">
                <div className="flex items-baseline gap-2">
                  <span className="num flex-1 text-[12px] font-medium">{t.id}</span>
                  <span className="eyebrow">{t.access}</span>
                  <span className="eyebrow">{t.live ? "live" : "not built"}</span>
                </div>
                <p className="mt-0.5 text-[12px] text-ink-soft">{t.purpose}</p>
                <p className="eyebrow mt-0.5">
                  approval {POLICY[t.access].approval} ·{" "}
                  {POLICY[t.access].logged ? "always logged" : "log optional"}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
}

function LogsRail() {
  const doc = useDoc();
  const logs = doc.logs ?? [];
  return (
    <Panel
      eyebrow={`Log // ${logs.length} lines`}
      action={
        logs.length > 0 && (
          <button
            type="button"
            onClick={clearLogs}
            className="doodle-pill px-2.5 py-0.5 text-[11px] hover:border-ink"
          >
            Clear
          </button>
        )
      }
    >
      <ul className="max-h-[60vh] overflow-y-auto">
        {logs.map((l) => (
          <li key={l.id} className="border-b border-stroke px-4 py-2 last:border-0">
            <div className="flex items-baseline gap-2">
              <span className={cn("eyebrow", l.level === "error" && "text-loss")}>
                {l.level}
              </span>
              <span className="num flex-1 truncate text-[12px]">
                {l.agent} · {l.event}
              </span>
              <span className="eyebrow">{relativeTime(l.ts)}</span>
            </div>
          </li>
        ))}
        {logs.length === 0 && (
          <li className="px-4 py-6 text-center text-[12px] text-ink-faint">Nothing yet.</li>
        )}
      </ul>
    </Panel>
  );
}
