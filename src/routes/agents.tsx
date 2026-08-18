import { createFileRoute } from "@tanstack/react-router";
import {
  Brain,
  Eye,
  Globe,
  HelpCircle,
  ImagePlus,
  Send,
  Sparkles,
  SquareStack,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { FlowStrip } from "@/components/pot/FlowStrip";
import { ModelPanel } from "@/components/pot/ModelPanel";
import { ModelSwitch } from "@/components/pot/ModelSwitch";
import { Panel, Shell } from "@/components/pot/Shell";
import { useAi } from "@/hooks/useAi";
import { useTurn } from "@/hooks/useTurn";
import { semanticLabel } from "@/lib/ai/capability";
import {
  buildTurn,
  clampDataText,
  commandObservation,
  MAX_OBSERVATION_CHARS,
  skillObservation,
  type ToolObservation,
} from "@/lib/agent/context";
import {
  capabilityCatalogue,
  capabilityDigest,
  DEFAULT_HOP_IDS,
  HOP_EXCLUDED_IDS,
  selectCapabilities,
  type CapabilityDefinition,
} from "@/lib/capabilities/catalogue";
import { routeMessage, routeSemantic, classifyIntent } from "@/lib/chat/route";
import { PHASE_LABEL } from "@/lib/chat/pipeline";
import { useDoc } from "@/hooks/useDoc";
import { relativeTime } from "@/lib/format";
import { MODELS, STATE_LABEL, deviceProfile, splitThinking } from "@/lib/ai";
import type { TurnMessage } from "@/lib/ai";
import {
  prewarmRetrieval,
  referenceIndex,
  retrieveContext,
  type Reference,
} from "@/lib/ai/retrieval";
import { downloadProvider, loadDownloadedProvider, providerCached } from "@/lib/ai/embedding";
import { encoderReady } from "@/lib/ai/encoder";

import { AGENTS, automationOn } from "@/lib/agents/registry";
import { COMMANDS, parseCommand, suggestions, type Suggestion } from "@/lib/chat/commands";
import { factLines } from "@/lib/chat/context";
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
import { COMMAND_BY_ID } from "@/lib/commands/registry";
import { LIMITS, commandNeedsApproval, runCommand } from "@/lib/commands/runner";
import type { CommandResult } from "@/lib/commands/types";
import { searchCards } from "@/lib/tools/journal";
import * as ind from "@/lib/tools/indicators";
import { TOOLS, TOOL_BY_ID, TOOL_GROUPS } from "@/lib/tools/registry";
import { POLICY, needsApproval, runTool } from "@/lib/tools/types";
import {
  addMemory,
  clearLogs,
  getDoc,
  memoryPrompt,
  memoryStats,
  setAutomation,
  toggleAssistantItem,
} from "@/lib/store";
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
      { title: "Assistant · Proof of Thesis" },
      {
        name: "description",
        content:
          "An inline console over your journal: slash commands run deterministic tools first, and the on-device model only speaks when reasoning is actually needed.",
      },
      { property: "og:title", content: "Assistant · Proof of Thesis" },
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
  const railRef = useRef<HTMLElement>(null);

  // Opening a panel scrolls it into view instead of leaving it below the fold.
  useEffect(() => {
    if (!railOpen) return;
    railRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [railOpen, tab]);

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
          className="doodle-pill px-3 py-1 text-[11px] hover:border-ink"
        >
          {railOpen ? "Close" : "Panels"}
        </button>
      }
    >
      <div className="grid gap-4">
        <ChatConsole ai={ai} onOpenRail={openRail} />

        <aside
          ref={railRef}
          className={cn(
            "grid scroll-mt-20 content-start gap-3 rounded-2xl border border-stroke bg-paper p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]",
            !railOpen && "hidden",
          )}
        >
          <nav className="-mx-3 -mt-3 flex gap-1 overflow-x-auto border-b border-stroke bg-paper px-3 py-2">
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
  const [web, setWeb] = useState(false);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const [helpQuery, setHelpQuery] = useState("");
  const [switchBusy, setSwitchBusy] = useState(false);
  const turn = useTurn();

  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const observationsRef = useRef<ToolObservation[]>([]);
  // The last turn's real prompt size, shown in the footer next to the ctx budget.
  const lastPromptRef = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Semantic engine onboarding: one offer, never a nag, never a silent download.
  const [semanticChip, setSemanticChip] = useState<"hidden" | "offer" | "downloading" | "done">(
    "hidden",
  );
  const [chipProgress, setChipProgress] = useState(0);

  // One idempotent bootstrap: read the index, create a session only when empty.
  useEffect(() => {
    const boot = bootstrapSessions();
    setSessions(boot.sessions);
    setActiveId(boot.activeId);
    setMessages(readSession(boot.activeId));
  }, []);

  // Hot encoder: whatever is already cached loads in idle time, then the
  // journal pool prewarms so the first question hits warm vectors. The 180MB
  // download stays manual on phones (RAM), but shapes the semantic offer.
  useEffect(() => {
    let cancelled = false;
    const idle = (fn: () => void) =>
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(() => fn(), { timeout: 4000 })
        : window.setTimeout(fn, 1500);
    idle(() => {
      if (cancelled) return;
      void (async () => {
        const cached = await providerCached("lfm-encoder-230m");
        if (cached && deviceProfile().mobile) return;
        if (cached) {
          await loadDownloadedProvider("lfm-encoder-230m");
          if (!cancelled) idle(() => void prewarmRetrieval());
        }
      })();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const installSemantic = async () => {
    setSemanticChip("downloading");
    try {
      await downloadProvider("lfm-encoder-230m", setChipProgress);
      try {
        localStorage.setItem("pot.semanticChip", "done");
      } catch {
        /* private mode: the session still works, the chip may return */
      }
      setSemanticChip("done");
      const warm = () => void prewarmRetrieval();
      if (typeof window.requestIdleCallback === "function")
        window.requestIdleCallback(warm, { timeout: 4000 });
      else setTimeout(warm, 1000);
    } catch {
      setSemanticChip("offer");
    }
  };

  const dismissSemantic = () => {
    try {
      localStorage.setItem("pot.semanticChip", "later");
    } catch {
      /* ignore */
    }
    setSemanticChip("done");
  };

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
  // `@` pulls journal entries and theses into the turn. Deterministic lookup —
  // no embeddings, no download, and only the picked records travel to a model.
  const mentionQuery = useMemo(() => {
    const m = /(?:^|\s)@([\w .-]*)$/.exec(input);
    return m ? m[1] : null;
  }, [input]);
  const mentions = useMemo(
    () => (mentionQuery === null ? [] : referenceIndex(mentionQuery, 8)),
    [mentionQuery],
  );
  const canSee = Boolean(ai.spec?.vision);
  const canReason = Boolean(ai.spec?.reasoning);

  // Whatever the active model supports is on by default, and resets to that
  // default whenever the active model changes. No click needed for normal use.
  const activeSpecId = ai.spec?.id;
  useEffect(() => {
    setVision(canSee);
    setReasoning(true);
    setThinking(canReason);
  }, [activeSpecId, canReason, canSee]);

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

  /**
   * One constrained decision: which single read-only capability would help
   * answer this question, if any. Grammar-constrained JSON (wllama turns the
   * schema into a GBNF grammar), so even the 450M cannot emit an invalid
   * choice. Any failure degrades to "no hop", never blocks the answer.
   */
  const decideAction = async (
    user: string,
    allowed: CapabilityDefinition[],
  ): Promise<{ def: CapabilityDefinition; query: string; why: string } | null> => {
    const ids = allowed.map((d) => d.id);
    if (ids.length === 0) return null;
    const messages: TurnMessage[] = [
      {
        role: "system",
        content:
          "You select one tool to answer the user's question, or none. Answer with the JSON the schema allows. The query is the search term for the tool, at most 6 words, or empty.",
      },
      {
        role: "user",
        content: `QUESTION\n${user}\n\nTOOLS\n${allowed
          .map((d) => `${d.id}: ${d.purpose} (inputs: ${d.inputs})`)
          .join("\n")}\n\nFACTS\n${factLines()}`,
      },
    ];
    let raw: string;
    try {
      raw = await ai.askMessages(messages, {
        temperature: 0,
        maxTokens: 96,
        responseSchema: {
          name: "tool_choice",
          schema: {
            type: "object",
            properties: {
              tool: { type: "string", enum: ["none", ...ids] },
              query: { type: "string" },
              why: { type: "string" },
            },
            required: ["tool", "query", "why"],
            additionalProperties: false,
          },
        },
      });
    } catch {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as { tool?: string; query?: string; why?: string };
      const def = allowed.find((d) => d.id === parsed.tool);
      if (!def) return null;
      return {
        def,
        query: String(parsed.query ?? "").slice(0, 60),
        why: String(parsed.why ?? "").slice(0, 80),
      };
    } catch {
      return null;
    }
  };

  /**
   * One assistant turn through the full pipeline. Returns the answer text
   * (null on any failure), so callers like /compress can use the result
   * without guessing at React state that has not flushed yet.
   */
  const speak = async (system: string, user: string, ground = false): Promise<string | null> => {
    // Chat never downloads weights, but a model already on this device is
    // woken up here so the first message does not need a manual Load.
    turn.stage("model", ai.target.label);
    if (ai.target.kind === "local" && !ai.loadedModelId) {
      setSwitchBusy(true);
      const woke = await ai.wake();
      setSwitchBusy(false);
      if (!woke.ok) {
        turn.settle("model", "skipped", "no local model on this device");
        push({
          role: "note",
          text:
            woke.error === "not_downloaded"
              ? `${ai.spec?.label ?? "This model"} is not downloaded yet. Download it once from the model menu and it will stay on this device.`
              : (woke.error ?? "the model failed to load"),
        });
        turn.complete();
        return null;
      }
    }
    turn.settle("model", "ok", ai.backend);
    turn.move("ready");

    setBusy(true);
    try {
      // Small talk skips the whole evidence pipeline: no retrieval, no
      // selection, no model-chosen hop. FACTS still rides along in the build,
      // so a greeting answers instantly and a short real question still lands
      // via top_tickers. This is the attention-budget rule: a 450M model
      // choosing among tools needs few, well-separated options, and "hello"
      // is not a tool question.
      const conversational = ground && isConversational(user);

      // Retrieval before generation: a handful of records, never the journal.
      let records: string[] = [];
      if (ground && !conversational) {
        const found = await retrieveContext(user, 6);
        if (found.count) {
          records = found.lines;
          push({
            role: "tool",
            text: `retrieval · ${found.count} records`,
            card: {
              source: `journal.retrieve (${found.how})`,
              facts: found.lines.slice(0, 5),
              data: { count: found.count, how: found.how },
            },
          });
        }
      }
      // Just-in-time capability detail: the one-line book always rides along,
      // full blocks only for what this turn actually touches.
      const selection = conversational
        ? {
            selected: [] as CapabilityDefinition[],
            how: "none" as const,
            reason: "conversational",
            stats: null,
          }
        : await selectCapabilities(user, 5);

      // v1 agent hop: one model-chosen read-only tool before the answer. The
      // deterministic loop stays primary; this only adds evidence to the turn.
      // Topic classification: does the question need external information or is
      // it about the app/journal? Runs through the always-warm encoder. When
      // the intent is "external" and the Web toggle is on, web.search runs
      // directly (no need for the 450M to choose). When external and Web is
      // off, the state line says so and the agent tells the user to enable it.
      // When internal, the existing hop menu runs normally and may still offer
      // web.search if the toggle is on.
      let intentExternal: boolean | null = null;
      if (ground && !conversational) {
        const intent = await classifyIntent(user).catch(() => null);
        intentExternal = intent?.kind === "external" || null;
      }
      const needsWeb = intentExternal === true && web;

      // v1 agent hop: one model-chosen read-only tool before the answer. When
      // the intent classifies as external and the Web toggle is on, the hop is
      // forced to web.search directly — no decideAction needed, no 450M
      // choosing between journal and web. Every other path builds the standard
      // hop menu from the semantic selection.
      // Firehose and unwired tools never enter the menu: they either flood the
      // context (journal.index, journal.filter) or throw (portfolio.read).
      const excluded = new Set<string>(HOP_EXCLUDED_IDS);
      let hopAllowed: CapabilityDefinition[] = [];
      let skipDecide = false;

      if (needsWeb) {
        const webDef = capabilityCatalogue().find((d) => d.id === "web.search");
        if (webDef) {
          hopAllowed = [webDef];
          skipDecide = true;
        }
      } else {
        hopAllowed = selection.selected.filter(
          (d) =>
            (d.kind === "tool" || d.kind === "command") &&
            (d.access === "READ" || d.access === "COMPUTE") &&
            !excluded.has(d.id),
        );
        if (ground && !conversational && hopAllowed.length === 0) {
          const defaults = new Set<string>(DEFAULT_HOP_IDS);
          hopAllowed.push(
            ...capabilityCatalogue().filter(
              (d) =>
                d.kind === "tool" &&
                defaults.has(d.id) &&
                (d.access === "READ" || d.access === "COMPUTE"),
            ),
          );
        }
        if (web && ground && !conversational && !hopAllowed.some((d) => d.id === "web.search")) {
          const webDef = capabilityCatalogue().find((d) => d.id === "web.search");
          if (webDef) hopAllowed.push(webDef);
        }
      }

      if (ground && !conversational && hopAllowed.length > 0) {
        turn.stage("tool", "decide");
        const pick = skipDecide
          ? { def: hopAllowed[0], query: user, why: "external intent, web.search forced" }
          : await decideAction(user, hopAllowed);
        if (pick) {
          turn.settle("tool", "ok", `${pick.def.id} · ${pick.why || "model-chosen"}`);
          try {
            const input = pick.query ? { query: pick.query } : {};
            const out =
              pick.def.kind === "command"
                ? await runCommand(pick.def.id, input)
                : await runTool(TOOL_BY_ID[pick.def.id], input);
            const summary =
              pick.def.kind === "command"
                ? ((out as CommandResult).summary ?? (out as CommandResult).status)
                : summarise(out);
            push({
              role: "tool",
              text: `${pick.def.id} · model-chosen`,
              card: {
                source: `${pick.def.id} (model pick)`,
                facts: [pick.why, summary].filter(Boolean),
                data: { query: pick.query, result: clampResult(out) } as Record<string, unknown>,
              },
            });
            observationsRef.current.push({
              id: pick.def.id,
              kind: pick.def.kind === "command" ? "command" : "tool",
              source: pick.def.id,
              status: "ok",
              summary,
              data: clampResult(out),
            });
          } catch (err) {
            // The tool failing must read as evidence, not break the turn.
            turn.settle("tool", "error", err instanceof Error ? err.message : "tool failed");
          }
        } else {
          turn.settle("tool", "skipped", "no tool chosen");
        }
      }

      const budgetTokens = Math.floor(ai.ctx * 0.75);
      const buildInput = {
        instructions: system,
        // The web toggle is part of the turn's state, not the app digest:
        // the model learns search is available (or why it is not) from the
        // same labeled lines it trusts for everything else.
        state: `${factLines()}\nweb_search: ${
          web
            ? "active this turn, prefer web.search for news and external facts"
            : intentExternal === true
              ? "disabled (Web toggle) — this question probably needs the web, enable it on the next turn"
              : "disabled (Web toggle)"
        }`,
        memory: memoryPrompt(),
        capabilitiesDigest: capabilityDigest(),
        selectedCapabilities: selection.selected,
        records,
        observations: observationsRef.current,
        history: messages,
        user,
        budgetTokens,
      };
      let build = buildTurn(buildInput);
      // The section table stays out of the transcript; the trace keeps one
      // compact audit line and the footer carries the size.
      lastPromptRef.current = build.estTokens;
      turn.move("generating");
      turn.stage("answer", ai.target.label);
      let raw: string;
      try {
        raw = await ai.askMessages(build.messages, {
          thinking,
          temperature: ground ? 0.2 : undefined,
          images: vision && image ? [image] : undefined,
        });
      } catch (err) {
        // Overflow recovery (Pi-style retry chain): if the runtime rejects
        // the prompt for size, rebuild with explicit degradation levels
        // rather than guessing smaller budget numbers. Level 1 drops
        // observation data, records and capability detail; level 2 also
        // drops history. The user never sees GENERATION FAILED from a size
        // mismatch; worst case the answer comes from FACTS alone.
        const isSizeError = (e: unknown) =>
          /context size|too long|exceeds/i.test(e instanceof Error ? e.message : String(e));
        if (!isSizeError(err)) throw err;
        build = buildTurn({ ...buildInput, shedLevel: 1 });
        lastPromptRef.current = build.estTokens;
        try {
          raw = await ai.askMessages(build.messages, {
            thinking,
            temperature: ground ? 0.2 : undefined,
            images: vision && image ? [image] : undefined,
          });
        } catch (err2) {
          if (!isSizeError(err2)) throw err2;
          build = buildTurn({ ...buildInput, shedLevel: 2 });
          lastPromptRef.current = build.estTokens;
          raw = await ai.askMessages(build.messages, {
            thinking,
            temperature: ground ? 0.2 : undefined,
            images: vision && image ? [image] : undefined,
          });
        }
      }

      const { thinking: think, answer } = splitThinking(raw);
      const text = (answer || raw || "").trim();
      // Zero output is a failure, never a quiet success.
      if (!text) {
        turn.settle("answer", "error");
        turn.fail("The model completed without producing a response.", "no_output");
        return null;
      }
      push({ role: "assistant", text, thinking: think });
      turn.settle(
        "answer",
        "ok",
        `${build.estTokens}t prompt · ${build.sections.map((s) => s.name).join("/")}`,
      );
      turn.complete();
      setImage(null);
      return text;
    } catch (err) {
      turn.settle("answer", "error");
      turn.fail(err instanceof Error ? err.message : "the assistant failed");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const runSkillTurn = async (
    skillId: string,
    args: { motive?: never; thesisId?: string } = {},
    opts: { question?: string; alwaysSpeak?: boolean } = {},
  ) => {
    turn.stage("skill", skillId);
    const result = runSkill(skillId, args);
    turn.settle("skill", "ok", `${result.skill.tools.length} tools`);
    push({
      role: "tool",
      text: result.skill.label,
      card: {
        source: result.skill.tools.join(" → ") || result.skill.id,
        facts: result.facts,
        data: clampResult(result.data) as Record<string, unknown>,
      },
    });
    observationsRef.current.push(skillObservation(result));
    if (result.aiRequired || reasoning || opts.alwaysSpeak) {
      // A routed question keeps the user's words as the prompt; the skill's
      // numbers ride along as an observation instead of a paraphrase prompt.
      await speak(
        opts.question
          ? "You are a trading-journal analyst. Ground every sentence in TURN OBSERVATIONS and FACTS. Be concrete and brief."
          : "You are a trading-journal analyst. Use only the structured result. Be concrete and brief.",
        opts.question ?? result.prompt,
        Boolean(opts.question),
      );
    } else {
      turn.complete();
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
        data: { result: clampResult(out) } as Record<string, unknown>,
      },
    });
  };

  /** `/run <id> {json}` or `/run <id> key=value key=value` */
  const parseArgs = (rest: string): Record<string, unknown> => {
    if (!rest) return {};
    if (rest.startsWith("{")) {
      try {
        return JSON.parse(rest) as Record<string, unknown>;
      } catch {
        /* fall through */
      }
    }
    const out: Record<string, unknown> = {};
    for (const part of rest.match(/[^\s"]+="[^"]*"|\S+/g) ?? []) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      out[part.slice(0, eq)] = part.slice(eq + 1).replace(/^"|"$/g, "");
    }
    if (Object.keys(out).length === 0) out.query = rest;
    return out;
  };

  const showCommandResult = (result: CommandResult) => {
    const d = result.diagnostics;
    push({
      role: "tool",
      text: result.summary ?? result.command,
      card: {
        source: result.command,
        facts: [
          `status ${result.status}${result.reason ? ` · ${result.reason}` : ""}`,
          `${d?.toolsUsed ?? 0} tool calls · ${d?.durationMs ?? 0} ms${d?.retried ? " · retried" : ""} · no model used`,
          ...(result.nextAction?.reason ? [`next: ${result.nextAction.reason}`] : []),
        ],
        data: clampResult((result.data as Record<string, unknown>) ?? {}) as Record<
          string,
          unknown
        >,
      },
    });
  };

  const runCommandTurn = async (id: string, rest: string) => {
    const def = COMMAND_BY_ID[id];
    if (!def) {
      return push({
        role: "note",
        text: `No command called ${id}. Type /run to see the list.`,
      });
    }
    const args = parseArgs(rest);
    if (commandNeedsApproval(def.id)) {
      return push({
        role: "tool",
        text: `${def.id} needs your approval`,
        approval: {
          toolId: def.id,
          kind: "command",
          access: def.access,
          target: rest || "—",
          input: args,
          state: "pending",
        },
      });
    }
    turn.stage("command", def.id);
    const res = await runCommand(def.id, args);
    observationsRef.current.push(commandObservation(res));
    turn.settle("command", res.status === "ok" ? "ok" : "error", res.summary ?? res.status);
    showCommandResult(res);
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
    if (msg.approval.kind === "command") {
      showCommandResult(
        await runCommand(
          msg.approval.toolId,
          (msg.approval.input as Record<string, unknown>) ?? {},
        ),
      );
      return;
    }
    const tool = TOOL_BY_ID[msg.approval.toolId];
    if (!tool) return;
    try {
      const out = await runTool(tool, msg.approval.input);
      push({
        role: "tool",
        text: `${tool.label} ran`,
        card: { source: tool.id, facts: [summarise(out)], data: { result: clampResult(out) } },
      });
    } catch (err) {
      push({ role: "note", text: err instanceof Error ? err.message : "the tool failed" });
    }
  };

  const submit = async () => {
    const text = input.trim();
    if (!text || busy || switchBusy) return;
    setInput("");
    observationsRef.current = [];
    turn.begin();
    push({ role: "user", text });

    // One-time semantic engine offer: only when nothing is cached and no
    // encoder is resident. Dismissed or done stays that way.
    if (semanticChip === "hidden" && !encoderReady()) {
      void providerCached("lfm-encoder-230m").then(async (cached) => {
        if (cached) return;
        try {
          if (localStorage.getItem("pot.semanticChip")) return;
        } catch {
          /* private mode: still offer, the flag just will not stick */
        }
        setSemanticChip("offer");
      });
    }

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
          text: COMMANDS.map((c) => `/${c.name} ${c.args} · ${c.blurb}`).join("\n"),
        });
        return;
      }
      if (name === "models") {
        push({
          role: "note",
          text: MODELS.map(
            (m) => `${m.label} · ${m.role} · ${STATE_LABEL[ai.states[m.id]]}\n  ${m.serve}`,
          ).join("\n"),
        });
        return;
      }
      if (name === "tools") {
        push({
          role: "note",
          text: TOOLS.filter((t) => t.live)
            .map((t) => `${t.id} [${t.access}] · ${t.purpose}`)
            .join("\n"),
        });
        return;
      }
      if (name === "skills") {
        push({
          role: "note",
          text: SKILLS.map(
            (s) => `${s.id} · ${s.purpose} (${s.aiRequired ? "needs a model" : "no model"})`,
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
          const used = contextFor(messages, Math.floor(ai.ctx * 0.4));
          push({
            role: "note",
            text: `ctx ${ai.ctx} · ${used.turns} turns replayed · ~${used.used} of ${Math.floor(ai.ctx * 0.4)} history tokens.`,
          });
        }
        return;
      }
      if (name === "usage") {
        const lastT = lastPromptRef.current;
        const memCtx = memoryStats();
        const session = sessions.find((s) => s.id === activeId);
        push({
          role: "note",
          text: `last prompt ${lastT != null && lastT > 0 ? `${lastT}t` : "—"} · ctx budget ${Math.floor(ai.ctx * 0.75)}\nmemory ${memCtx.chars}/${memCtx.limit} chars · ${memCtx.entries} notes\n${session ? `${session.turns} turns in this session` : "no active session"}`,
        });
        return;
      }
      if (name === "compress") {
        push({ role: "note", text: "Summarising this session…" });
        // Route through speak() which handles local vs cloud model and
        // returns the answer text directly (React state has not flushed at
        // this point, so reading `messages` here would be stale).
        const compressPrompt =
          "Summarise this conversation in 2 or 3 sentences: what the user asked and what was answered. Plain text only.";
        let summary: string | null = null;
        try {
          summary = await speak(compressPrompt, "compress this session", true);
        } catch {
          // Model failed; proceed to clear without a summary
        }
        const summaryText =
          summary?.replace(/^summary:\s*/i, "").slice(0, 2000) ??
          "session compressed without a model summary";
        const saved = addMemory(`session summary: ${summaryText}`);
        startSession();
        push({
          role: "note",
          text: saved.ok
            ? "Session compressed. Summary saved to memory. Started a fresh session."
            : `Session cleared, but the summary did not fit memory (${saved.chars}/${saved.limit} chars). Consolidate memory with /run memory.read and /run memory.forget.`,
        });
        return;
      }
      if (name === "model") {
        const wanted = MODELS.find(
          (m) => m.id === rest || m.label.toLowerCase() === rest.toLowerCase(),
        );
        if (wanted) {
          push({ role: "note", text: `Loading ${wanted.label} from downloaded assets…` });
          setSwitchBusy(true);
          const res = await ai.activate(wanted.id);
          setSwitchBusy(false);
          push({
            role: "note",
            text: res.ok
              ? `${wanted.label} is loaded and answering.`
              : res.error?.includes("not downloaded")
                ? `${wanted.label} is not downloaded. Download it first.`
                : `${wanted.label} failed to load: ${res.error}`,
          });
          return;
        }
        onOpenRail("model");
        push({ role: "note", text: "Model harness opened in the panel." });
        return;
      }

      if (name === "run") {
        const [id, ...tail] = rest.split(/\s+/);
        return void runCommandTurn(id, tail.join(" "));
      }
      if (name === "goal") {
        push({
          role: "note",
          text: `Goal mode runs the same commands in up to ${LIMITS.maxCyclesLocal} cycles (${LIMITS.maxTotalSteps} steps, ${Math.round(LIMITS.goalDeadlineMs / 1000)}s deadline) and is cancellable. Use /run <command> for a single step meanwhile.`,
        });
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
        const t = getDoc().theses.find((x) => x.title.toLowerCase().includes(rest.toLowerCase()));
        if (!t) return push({ role: "note", text: `No thesis matching "${rest}".` });
        return void runSkillTurn("thesis.review", { thesisId: t.id });
      }
      push({ role: "note", text: `Unknown command /${name}. Try /help.` });
      return;
    }

    turn.stage("route", "deterministic");
    const routed = routeMessage(text);
    if (routed.kind === "command") {
      turn.settle("route", "ok", routed.why);
      return void runCommandTurn(routed.commandId, routed.args ? JSON.stringify(routed.args) : "");
    }
    if (routed.kind === "skill") {
      turn.settle("route", "ok", routed.why);
      return void runSkillTurn(
        routed.skillId,
        { thesisId: routed.thesisId },
        { question: text, alwaysSpeak: true },
      );
    }
    if (routed.kind === "search") {
      // Deterministic lookup card; the turn still falls through to the model,
      // which sees the card in history and the retrieval records in context.
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
      }
    }
    if (routed.kind === "none") {
      // Second pass: the 230M encoder, not a generative model. The encoder is
      // an accelerator — when it is absent or fails the turn simply carries on.
      turn.stage("semantic", ai.capability.routeFallback ? "keyword fallback" : "encoder");
      const semantic = await routeSemantic(text);
      turn.settle(
        "semantic",
        ai.capability.routeFallback ? "skipped" : "ok",
        semantic.kind === "skill" ? semantic.why : "no confident match",
      );
      turn.settle("route", "ok");
      if (semantic.kind === "command") {
        return void runCommandTurn(
          semantic.commandId,
          semantic.args ? JSON.stringify(semantic.args) : "",
        );
      }
      if (semantic.kind === "skill") {
        return void runSkillTurn(semantic.skillId, {}, { question: text, alwaysSpeak: true });
      }
    }

    await speak(
      "You are the assistant inside a trading journal. Answer briefly. Use the records provided; if a number is needed and no record carries it, say which tool would produce it instead of guessing.",
      text,
      true,
    );
  };

  const apply = (s: Suggestion) => {
    setInput(s.insert);
    inputRef.current?.focus();
  };

  /** Replaces the trailing `@query` with the picked record's title. */
  const applyMention = (r: Reference) => {
    setInput((prev) =>
      prev.replace(/(?:^|\s)@([\w .-]*)$/, (m) => `${m.startsWith(" ") ? " " : ""}@${r.title} `),
    );
    inputRef.current?.focus();
  };

  const active = sessions.find((s) => s.id === activeId);
  const ctxUsed = contextFor(messages, Math.floor(ai.ctx * 0.4));

  return (
    <div className="grid content-start gap-3">
      <Panel
        eyebrow={`Session // ${active?.title ?? "new"} · ${messages.length} turns`}
        action={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => startSession()}
              className="doodle-pill px-2.5 py-0.5 text-[11px] hover:border-ink"
            >
              New
            </button>
            {activeId && sessions.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  deleteSession(activeId);
                  const rest = listSessions();
                  setSessions(rest);
                  if (rest[0]) openSession(rest[0].id);
                  else startSession();
                }}
                className="doodle-pill px-2.5 py-0.5 text-[11px] hover:border-ink"
              >
                Delete
              </button>
            )}
          </div>
        }
      >
        {sessions.length > 1 && (
          <div className="flex gap-1 overflow-x-auto border-b border-stroke px-3 py-2">
            {sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => openSession(s.id)}
                className={cn(
                  "doodle-pill shrink-0 max-w-[160px] truncate px-2.5 py-0.5 text-[11px]",
                  s.id === activeId ? "bg-ink text-paper" : "text-ink-soft hover:border-ink",
                )}
              >
                {s.title}
              </button>
            ))}
          </div>
        )}
        <div ref={boxRef} className="max-h-[52vh] min-h-[240px] overflow-y-auto px-4 py-3">
          {messages.length === 0 && (
            <p className="py-6 text-[13px] text-ink-soft">
              Ask in plain words, or press / for a command.
            </p>
          )}
          {(semanticChip === "offer" || semanticChip === "downloading") && (
            <div className="doodle-inset mb-3 flex flex-wrap items-center gap-2 px-3 py-2">
              <p className="text-[13px]">
                {semanticChip === "downloading"
                  ? `semantic engine · ${Math.round(chipProgress * 100)}%`
                  : "Make routing semantic? 180 MB, downloaded once, then always ready on this device."}
              </p>
              {semanticChip === "offer" && (
                <>
                  <button
                    type="button"
                    onClick={() => void installSemantic()}
                    className="doodle-pill bg-ink px-3 py-1 text-[11px] text-paper"
                  >
                    Install
                  </button>
                  <button
                    type="button"
                    onClick={dismissSemantic}
                    className="doodle-pill px-3 py-1 text-[11px] text-ink-faint hover:border-ink"
                  >
                    Not now
                  </button>
                </>
              )}
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
            {busy && <li className="eyebrow">{ai.output ? ai.output.slice(-160) : "thinking…"}</li>}
          </ul>
        </div>

        {mentions.length > 0 && (
          <ul className="max-h-[190px] overflow-y-auto border-t border-stroke">
            {mentions.map((r) => (
              <li key={`${r.kind}:${r.id}`}>
                <button
                  type="button"
                  onClick={() => applyMention(r)}
                  className="flex w-full items-baseline gap-2 px-4 py-2 text-left hover:bg-sunken"
                >
                  <span className="eyebrow">{r.kind}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px]">{r.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {mentions.length === 0 && picks.length > 0 && (
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

        <div className="border-t border-stroke">
          <FlowStrip nodes={turn.nodes} />
          {turn.error && (
            <div className="flex items-start gap-2 border-b border-loss/40 bg-loss/5 px-4 py-2">
              <span className="eyebrow shrink-0 text-loss">{PHASE_LABEL[turn.error.phase]}</span>
              <span className="min-w-0 flex-1 text-[12px] text-loss">{turn.error.message}</span>
              <button
                type="button"
                onClick={turn.clearError}
                aria-label="Dismiss error"
                className="doodle-pill grid h-5 w-5 shrink-0 place-items-center text-loss"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          {switchBusy && <p className="eyebrow border-b border-stroke px-4 py-2">loading model…</p>}
          <div className="px-4 py-3">
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
                disabled={switchBusy}
                placeholder={switchBusy ? "Loading model…" : "Ask, or / for commands"}
                className="min-h-[38px] flex-1 resize-none bg-transparent text-[13px] outline-none disabled:opacity-50"
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
                  disabled={switchBusy}
                  aria-label="Send"
                  className="doodle-pill grid h-8 w-8 place-items-center bg-ink text-paper disabled:opacity-50"
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
              <Toggle
                on={web}
                onClick={() => setWeb((v) => !v)}
                icon={<Globe className="h-3 w-3" />}
                label="Web"
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
                onClick={() => setHelp((h) => !h)}
                className={cn(
                  "doodle-pill ml-auto inline-flex items-center gap-1 px-2.5 py-1 text-[11px]",
                  help ? "bg-ink text-paper" : "text-ink-faint hover:border-ink",
                )}
              >
                <HelpCircle className="h-3 w-3" /> Help
              </button>
              <ModelSwitch
                ai={ai}
                onOpenPanel={() => onOpenRail("model")}
                onBusyChange={setSwitchBusy}
              />

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

            <p className="num eyebrow mt-2 flex flex-wrap gap-x-3">
              <span>semantic · {semanticLabel(ai.capability).toLowerCase()}</span>
              {turn.phase !== "idle" && <span>{PHASE_LABEL[turn.phase]}</span>}
              <span>ctx {ai.ctx}</span>
              {lastPromptRef.current != null && <span>last {lastPromptRef.current}t</span>}
              <span>
                {ctxUsed.turns} turns ·{" "}
                {Math.round((ctxUsed.used / Math.max(1, Math.floor(ai.ctx * 0.4))) * 100)}% history
              </span>
              <span>
                {ai.target.kind === "cloud" ? "cloud" : ai.backend === "webgpu" ? "WebGPU" : "WASM"}
              </span>
              {ai.status.phase === "downloading" && (
                <span>downloading {Math.round(ai.status.progress * 100)}%</span>
              )}
              {ai.speed && <span>{ai.speed.tps.toFixed(1)} tok/s</span>}
            </p>
          </div>
        </div>
        {help && (
          <HelpPanel
            query={helpQuery}
            onQuery={setHelpQuery}
            onPick={(insert) => {
              setInput(insert);
              setHelp(false);
              inputRef.current?.focus();
            }}
          />
        )}
      </Panel>
    </div>
  );
}

/**
 * Searchable reference for everything the console can do: commands, skills and
 * live tools. Plain substring matching — discovery must work with no model and
 * no encoder on the device.
 */
function HelpPanel({
  query,
  onQuery,
  onPick,
}: {
  query: string;
  onQuery: (v: string) => void;
  onPick: (insert: string) => void;
}) {
  const q = query.trim().toLowerCase();
  const hit = (...parts: string[]) => !q || parts.join(" ").toLowerCase().includes(q);

  const rows = [
    ...COMMANDS.filter((c) => hit(c.name, c.args, c.blurb)).map((c) => ({
      key: `cmd:${c.name}`,
      group: "command",
      label: `/${c.name} ${c.args}`.trim(),
      hint: c.blurb,
      insert: `/${c.name} `,
    })),
    ...SKILLS.filter((s) => hit(s.id, s.label, s.purpose)).map((s) => ({
      key: `skill:${s.id}`,
      group: s.aiRequired ? "skill · uses a model" : "skill · deterministic",
      label: `/skill ${s.id}`,
      hint: s.purpose,
      insert: `/skill ${s.id}`,
    })),
    ...TOOLS.filter((t) => t.live && hit(t.id, t.label, t.purpose)).map((t) => ({
      key: `tool:${t.id}`,
      group: `tool · ${t.access}`,
      label: `/tool ${t.id}`,
      hint: t.purpose,
      insert: `/tool ${t.id} `,
    })),
  ];

  return (
    <div className="border-t border-stroke">
      <input
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Search commands, skills and tools"
        className="w-full border-b border-stroke bg-transparent px-4 py-2 text-[12px] outline-none"
      />
      <ul className="max-h-[240px] overflow-y-auto">
        {rows.length === 0 && (
          <li className="px-4 py-3 text-[12px] text-ink-soft">Nothing matches that.</li>
        )}
        {rows.map((r) => (
          <li key={r.key}>
            <button
              type="button"
              onClick={() => onPick(r.insert)}
              className="flex w-full items-baseline gap-2 px-4 py-2 text-left hover:bg-sunken"
            >
              <span className="num text-[12px] font-medium">{r.label}</span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink-soft">{r.hint}</span>
              <span className="eyebrow">{r.group}</span>
            </button>
          </li>
        ))}
      </ul>
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

/**
 * Capture-time bound for anything that will ride into the prompt as an
 * observation or card payload. Small results pass through untouched; big
 * ones keep head and tail with a marker naming the dropped size, so the
 * model sees the cut and can ask for more. The assembly layer applies the
 * same cap again (clampDataText) as a guarantee; this keeps cards and
 * observations small at the source.
 */
function clampResult(out: unknown): unknown {
  const json = JSON.stringify(out ?? null);
  if (json.length <= MAX_OBSERVATION_CHARS) return out;
  const half = Math.floor(MAX_OBSERVATION_CHARS / 2);
  return `${json.slice(0, half)}\n[truncated: first and last ${half} of ${json.length} chars]\n${json.slice(-half)}`;
}

/**
 * Small English words that would otherwise look like ticker symbols to the
 * uppercase check below. Deliberately a closed list: anything not here that
 * is all-caps (SOL, BTC, USDC) is treated as a ticker and the turn is not
 * small talk.
 */
const CONVERSATIONAL_SAFE_WORDS = new Set([
  "I",
  "A",
  "OK",
  "AI",
  "IN",
  "ON",
  "AT",
  "TO",
  "BY",
  "UP",
  "DO",
  "GO",
  "NO",
  "SO",
  "IT",
  "IS",
  "AS",
  "AM",
  "AN",
  "OR",
  "WE",
  "ME",
  "MY",
  "HE",
  "BE",
  "IF",
  "OF",
  "US",
]);

/** Short small talk needs no retrieval, no capability selection, and no
 * model-chosen hop: FACTS still rides along, so a one-line greeting answers
 * instantly and a short real question still lands via top_tickers.
 * Deliberately zero-cost and deterministic: no encoder call for a decision
 * this obvious, because this runs before every grounded turn on phones.
 * "Hey what is Bitcoin?" stays conversational (static knowledge, no hop);
 * "latest news on bitcoin" is long enough to classify as external instead.
 * Exported for the verification harness only. */
export function isConversational(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length > 6) return false;
  if (/\d/.test(text)) return false;
  const hasTicker = words.some(
    (w) =>
      // venue perp symbols run long (BTC-PERP, TAO-PERP), so cap at 12 chars
      /^[A-Z][A-Z0-9-]{1,11}[.!?]?$/.test(w) &&
      !CONVERSATIONAL_SAFE_WORDS.has(w.replace(/[.!?]$/, "")),
  );
  return !hasTicker;
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
              <span className={cn("eyebrow", l.level === "error" && "text-loss")}>{l.level}</span>
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
