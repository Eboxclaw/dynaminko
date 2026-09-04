import {
  createLazyFileRoute,
  type LazyRouteOptions,
} from "@tanstack/react-router";
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
  compileHead,
  renderHead,
  skillObservation,
  type CompiledHead,
  type ToolObservation,
} from "@/lib/agent/context";
import { DECIDE_SYSTEM, decideUserContent, hopEvidence, hopKey, isRepeatHop } from "@/lib/agent/hops";
import { captureResult, readOffloaded, type CapturedResult } from "@/lib/agent/offload";
import {
  capabilityCatalogue,
  capabilityDigest,
  DEFAULT_HOP_IDS,
  HOP_EXCLUDED_IDS,
  selectCapabilities,
  type CapabilityDefinition,
} from "@/lib/capabilities/catalogue";
import { routeMessage, routeSemantic, classifyIntent, suppressedAdviceRead } from "@/lib/chat/route";
import { PHASE_LABEL } from "@/lib/chat/pipeline";
import { useDoc } from "@/hooks/useDoc";
import { relativeTime } from "@/lib/format";
import {
  MODELS,
  STATE_LABEL,
  deviceProfile,
  prefillRate,
  splitThinking,
  stripToolCallMarkup,
} from "@/lib/ai";
import { scaledHopDeadlineMs } from "@/lib/ai/runtime";
import type { TurnMessage } from "@/lib/ai";
import {
  prewarmRetrieval,
  referenceIndex,
  retrieveContext,
  type Reference,
} from "@/lib/ai/retrieval";
import {
  activateSemantic,
  downloadSemanticProvider,
  encoderCached,
  encoderReady,
} from "@/lib/ai/encoder";
import { unverifiedNumbers } from "@/lib/agent/grounding";
import { extractNativeToolCall, parseCallBody, decideTools } from "@/lib/ai/nativeTools";
import type { NativeToolTurn } from "@/lib/ai";

import { AGENTS, automationOn } from "@/lib/agents/registry";
import { COMMANDS, parseCommand, suggestions, type Suggestion } from "@/lib/chat/commands";
import { estimateTokens, factLines, portfolioFactLines } from "@/lib/chat/context";
import {
  beginTurn,
  completedTurn,
  markTurnFailed,
  markAnswerDone,
  markFirstUsefulAction,
  measure,
  tagModel,
  tagTurn,
} from "@/lib/ai/trace";
import { newMessage, type Approval, type ChatCard, type ChatMessage } from "@/lib/chat/session";
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
  log,
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

/**
 * First http(s) URL from a captured web.search result. The observation's data
 * is whatever captureResult clamped (native object when small, JSON string
 * when oversized), so both shapes are accepted. Used by the 2-hop fallback
 * when the model declines to pick a page.
 */
function searchResultUrl(data: unknown): string | null {
  let payload: unknown = data;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  // Both shapes reach this helper: the raw search output ({results}) and the
  // card wrapper ({result: clamped}).
  const direct = (payload as { results?: unknown } | null | undefined)?.results;
  const wrapped = (payload as { result?: { results?: unknown } } | null | undefined)?.result
    ?.results;
  const results = Array.isArray(direct) ? direct : Array.isArray(wrapped) ? wrapped : null;
  if (!results) return null;
  for (const r of results) {
    const url = (r as { url?: unknown } | null)?.url;
    if (typeof url === "string" && /^https?:\/\//i.test(url)) return url.slice(0, 512);
  }
  return null;
}

// Router version note: this release's LazyRouteOptions type only models the
// component props, but the runtime merges every lazy option into
// route.options when the chunk loads (Object.assign in load-matches.js), so
// validateSearch and head behave exactly as on the eager route. The cast
// below documents that type gap, not a runtime difference.
export const Route = createLazyFileRoute("/agents")(
  {
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
  } as LazyRouteOptions,
);

function AgentsPage() {
  // useSearch() types as {} under LazyRoute (the validator generic cannot
  // survive the lazy factory); the shape comes from validateSearch above.
  const { tab } = Route.useSearch() as { tab: RailTab };
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
  // The last turn's section table (name · tokens · truncated), so /context can
  // show exactly what the model saw without rebuilding anything.
  const lastBuildRef = useRef<{ name: string; estTokens: number; truncated: boolean }[] | null>(
    null,
  );
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
  // journal pool prewarms so the first question hits warm vectors. The 90MB
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
        const cached = await encoderCached();
        if (cached && deviceProfile().mobile) return;
        if (cached) {
          await activateSemantic();
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
      await downloadSemanticProvider(setChipProgress);
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

  /** Format search results into card facts with clickable links. */
  const searchFacts = (results: unknown, why: string): string[] => {
    const rows = (results as { results?: { title: string; url: string; snippet: string }[] })
      ?.results;
    if (!rows?.length) return [why].filter(Boolean);
    return [
      why,
      ...rows
        .slice(0, 5)
        .map((r, i) => `${i + 1}. ${r.title} ${r.url} · ${r.snippet.slice(0, 100)}`),
    ].filter(Boolean);
  };

  /** Format a page digest into reader-friendly card facts. */
  const readFacts = (result: unknown, why: string): string[] => {
    const page = result as {
      title?: string;
      description?: string;
      siteName?: string;
      outline?: string[];
      paragraphs?: string[];
      images?: { alt: string; url: string }[];
      words?: number;
    } | null;
    if (!page?.title) return [why, "page could not be read"];
    const lines: string[] = [
      `Site: ${page.siteName ?? page.title}`,
      page.description ? `About: ${page.description.slice(0, 200)}` : "",
    ].filter(Boolean);
    if (page.outline?.length) {
      lines.push(`Sections: ${page.outline.slice(0, 6).join(" · ")}`);
    }
    if (page.words != null) lines.push(`${page.words.toLocaleString("en-US")} words`);
    if (page.images?.length) lines.push(`${page.images.length} images on page`);
    return [why, ...lines].filter(Boolean);
  };

  const openSession = (id: string) => {
    setActiveId(id);
    setMessages(readSession(id));
    // A session switch starts a clean evidence slate: submit() resets per
    // turn, this keeps a mid-flight page from ever mixing sessions even
    // before the next submit.
    observationsRef.current = [];
  };

  const startSession = (title?: string) => {
    const meta = createSession(title || "New session");
    setSessions(listSessions());
    setActiveId(meta.id);
    setMessages([]);
    observationsRef.current = [];
  };

  /**
   * One constrained decision: which read-only capability would help answer
   * this question next, if any. Grammar-constrained JSON (wllama turns the
   * schema into a GBNF grammar), so even the 450M cannot emit an invalid
   * choice. Any failure degrades to "no hop", never blocks the answer.
   * `evidence` carries what earlier hops observed, so a follow-up hop can
   * build on them; `remaining` lets the pick weigh spending the budget.
   */
  const decideAction = async (
    user: string,
    allowed: CapabilityDefinition[],
    opts: { head: CompiledHead; evidence?: string; remaining?: number },
  ): Promise<{
    def: CapabilityDefinition;
    query: string;
    why: string;
    ticker?: string;
    basket?: string;
    limit?: number;
    url?: string;
  } | null> => {
    const ids = allowed.map((d) => d.id);
    if (ids.length === 0) return null;
    // Adapter variant (opengrok pattern): models with decideMenu "native"
    // get the menu through the template's own `tools` render ("List of
    // tools: [...]") instead of the plain-text book. The output contract
    // stays the GBNF JSON pick either way.
    const nativeMenu = ai.spec?.decideMenu === "native";
    const tools = nativeMenu ? decideTools(allowed) : undefined;
    // The decide view opens with the turn's compiled shared head, so hop
    // prompts share every head byte (CORE, MEMORY, book, FACTS, PORTFOLIO)
    // with the answer prompt and with each other; the DECIDE role body
    // appends after it. Shared builders in hops.ts keep the rest
    // byte-identical across hops (the remaining count appends at the tail),
    // so the KV slot cache prefills only each hop's new evidence instead of
    // the whole prompt.
    const messages: TurnMessage[] = [
      { role: "system", content: `${renderHead(opts.head)}\n\nDECIDE\n${DECIDE_SYSTEM}` },
      {
        role: "user",
        content: decideUserContent({
          question: user,
          menuText: nativeMenu
            ? undefined
            : allowed
                .map(
                  (d) =>
                    `${d.id}: ${d.purpose} (inputs: ${d.inputs})${
                      d.exec === "write-approval" ? " [write]" : ""
                    }`,
                )
                .join("\n"),
          evidence: opts.evidence,
          remaining: opts.remaining,
        }),
      },
    ];
    let raw: string;
    try {
      raw = await ai.askMessages(messages, {
        // Native-menu decides run grammar-less: measured live, the template's
        // tools render and the GBNF grammar fight (the model wants to emit a
        // native call, the grammar rejects it, the output collapses to
        // empty). Without the grammar the model thinks, then calls in its
        // own dialect; the spec's sampling keeps the think coherent.
        temperature: nativeMenu ? Math.min(0.3, ai.spec?.sampling?.temperature ?? 0.2) : 0,
        // A cloud decide must not pay a reasoning preamble: speed first.
        thinking: false,
        ...(tools ? { tools } : {}),
        ...(nativeMenu
          ? {}
          : {
              // 2048, not 96 or 512: reasoning models think before they pick,
              // and the grammar ends a completed pick early so the extra
              // budget only burns when the model actually needs it. Measured:
              // a 2.6B decide at 512 spent 33s and still truncated into a
              // second leaked call.
              maxTokens: 2048,
              responseSchema: {
                name: "tool_choice",
                schema: {
                  type: "object",
                  properties: {
                    tool: { type: "string", enum: ["none", ...ids] },
                    query: { type: "string" },
                    why: { type: "string" },
                    url: { type: "string" },
                    ticker: { type: "string" },
                    basket: {
                      type: "string",
                      enum: [
                        "btc",
                        "eth",
                        "store-of-value",
                        "stables",
                        "defi",
                        "ai",
                        "l1",
                        "l2",
                        "gaming",
                        "memes",
                        "stocks",
                        "unsorted",
                      ],
                    },
                    limit: { type: "integer", minimum: 1, maximum: 8 },
                    reason: { type: "string" },
                  },
                  required: ["tool", "query", "why"],
                  additionalProperties: false,
                },
              },
            }),
      });
    } catch {
      return null;
    }
    // Decide diagnostics, same pattern as __lastRaw: the raw pick output on
    // the window so a degrading decide (wrong pick, empty menu) can be
    // interrogated without guessing.
    if (typeof window !== "undefined") {
      (window as unknown as { __lastDecide?: unknown }).__lastDecide = {
        at: new Date().toISOString(),
        model: ai.target.label,
        nativeMenu,
        menuTools: nativeMenu ? ids.length : 0,
        chars: raw.length,
        // Complete raw when short (grammar picks usually are): fixtures and
        // wire audits want the exact output, not a head excerpt.
        ...(raw.length <= 600 ? { raw } : { head: raw.slice(0, 200) }),
      };
    }
    // Native-menu decides speak the model's own dialect: parse the native
    // call first, then (some runs still answer JSON) the grammar shape, then
    // the bare call body. The book path keeps JSON first, native as fallback.
    const pickFromNative = (native: NonNullable<ReturnType<typeof extractNativeToolCall>>) => {
      const def = allowed.find((d) => d.id === native.id);
      if (!def) return null;
      const nq = native.args.query;
      const nu = native.args.url;
      const nl = native.args.limit;
      const limit = typeof nl === "number" ? Math.min(8, Math.max(1, Math.round(nl))) : undefined;
      if (def.id === "journal.filter" && !(typeof limit === "number" && limit >= 1 && limit <= 8)) {
        return null;
      }
      return {
        def,
        query: typeof nq === "string" ? nq.slice(0, 60) : "",
        url: typeof nu === "string" && /^https?:\/\//i.test(nu) ? nu.slice(0, 512) : undefined,
        limit,
        why: "native tool-call dialect",
      } as {
        def: CapabilityDefinition;
        query: string;
        why: string;
        ticker?: string;
        basket?: string;
        limit?: number;
        url?: string;
      };
    };
    const pickFromJson = (parsed: {
      tool?: string;
      query?: string;
      why?: string;
      url?: string;
      ticker?: string;
      basket?: string;
      limit?: number;
      reason?: string;
    }) => {
      const def = allowed.find((d) => d.id === parsed.tool);
      if (!def) return null;

      // Guard: journal.filter must carry a bounded limit or it is refused.
      // This replaces the HOP_EXCLUDED_IDS exclusion — the safety the
      // exclusion protected is now enforced at the contract level.
      if (def.id === "journal.filter") {
        const limit = typeof parsed.limit === "number" ? parsed.limit : 0;
        if (!(limit >= 1 && limit <= 8)) return null;
      }

      return {
        def,
        query: String(parsed.query ?? "").slice(0, 60),
        // web.read carries a page url; anything else would be an invented
        // string pretending to be one, so only http(s) survives.
        url: /^https?:\/\//i.test(String(parsed.url ?? ""))
          ? String(parsed.url).slice(0, 512)
          : undefined,
        ticker: parsed.ticker ? String(parsed.ticker).slice(0, 6).toUpperCase() : undefined,
        basket: parsed.basket,
        limit:
          typeof parsed.limit === "number" ? Math.min(8, Math.max(1, parsed.limit)) : undefined,
        reason:
          typeof parsed.reason === "string" && parsed.reason.trim()
            ? parsed.reason.trim().slice(0, 120)
            : undefined,
        why: String(parsed.why ?? "").slice(0, 80),
      };
    };
    if (nativeMenu) {
      const native = extractNativeToolCall(raw);
      if (native) return pickFromNative(native);
    }
    try {
      return pickFromJson(JSON.parse(raw));
    } catch {
      // Free text: the model's own dialect is still a valid pick.
      const native = parseCallBody(raw);
      return native ? pickFromNative(native) : null;
    }
  };

  /** Map the model's structured tool pick to the argument shape each tool
   *  expects. Only fields the capability declares in `inputs` are emitted:
   *  a model inventing a query for a no-input tool (the 350M sent "BALK",
   *  "basket"... to portfolio.netWorth) must not change the call, and must
   *  not dodge the repeat guard by varying the invented string. */
  const buildToolInput = (pick: {
    def: CapabilityDefinition;
    query: string;
    ticker?: string;
    basket?: string;
    limit?: number;
    url?: string;
    reason?: string;
  }): Record<string, unknown> => {
    const takes = (field: string) =>
      pick.def.inputs === field ||
      new RegExp(`\\b${field}\\b`).test(pick.def.inputs);
    const input: Record<string, unknown> = {};
    if (pick.query && takes("query")) input.query = pick.query;
    if (pick.url && takes("url")) input.url = pick.url;
    if (pick.ticker && takes("ticker")) input.ticker = pick.ticker;
    if (pick.basket && takes("basket")) input.basket = pick.basket;
    if (typeof pick.limit === "number" && takes("limit")) input.limit = pick.limit;
    // Write commands (journal.apply_answer) declare a free-text reason the
    // pick schema carries as its own optional field.
    if (pick.reason && takes("reason")) input.reason = pick.reason;
    return input;
  };

  /**
   * One assistant turn through the full pipeline. Returns the answer text
   * (null on any failure), so callers like /compress can use the result
   * without guessing at React state that has not flushed yet.
   */
  const speak = async (
    system: string,
    user: string,
    ground = false,
    opts: { skipRecords?: boolean; skipHop?: boolean } = {},
  ): Promise<string | null> => {
    // P0.1: tag the active turn trace with the model; the clock started in
    // submit(). Pure bookkeeping.
    tagModel(ai.target.label, ai.backend);
    // Chat never downloads weights, but a model already on this device is
    // woken up here so the first message does not need a manual Load. The
    // loaded check is against the TARGET, not "anything loaded": the model
    // panel's "Use X" chip flips the preference without loading, and a send
    // with the wrong model loaded failed with no answer at all (the turn
    // died in the runtime while /usage kept printing the older turn).
    // wake() no-ops when the target is already the loaded model.
    const wakeStart = Date.now();
    turn.stage("model", ai.target.label);
    if (ai.target.kind === "local" && ai.loadedModelId !== ai.modelId) {
      setSwitchBusy(true);
      const woke = await ai.wake(
        // Keep the wake consistent with the Thinking toggle for
        // reasoning-capable models (FAST vs REASONED is a load-time mode).
        canReason ? thinking : undefined,
      );
      setSwitchBusy(false);
      measure("modelLoad", Date.now() - wakeStart);
      if (!woke.ok) {
        turn.settle("model", "skipped", "no local model on this device");
        push({
          role: "note",
          text:
            woke.error === "not_downloaded"
              ? `${ai.spec?.label ?? "This model"} is not downloaded yet. Download it once from the model menu and it will stay on this device.`
              : (woke.error ?? "the model failed to load"),
        });
        // The turn produced no answer; mark the trace so /usage reports the
        // failure instead of the previous finished turn.
        markTurnFailed(woke.error === "not_downloaded" ? "model not downloaded" : (woke.error ?? "model failed to load"));
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
      // Web-research turns skip it: journal cards for a same-named ticker
      // (INKO the token vs the Ink chain) mislead more than they ground.
      let records: string[] = [];
      if (ground && !conversational && !opts.skipRecords) {
        const semStart = Date.now();
        const found = await retrieveContext(user, 6);
        if (found.count) {
          // Wallet-state questions must not receive transfer receipts as
          // evidence: "Received 1.81e-4 KBTC" is a historical event, and the
          // models read it as current holdings (live: the 2.6B answered a
          // wallet question from receipt lines). Trade/pnl lines stay: the
          // "how is my performance" half of those questions needs them.
          const walletShape =
            /\b(wallet|hold(?:ing)?s?|balance|net\s?worth|positions?|portfolio)\b/i.test(user);
          const lines = walletShape
            ? found.lines.filter((l) => !/\b(?:Received|Sent)\b/.test(l) || /\bpnl\b/.test(l))
            : found.lines;
          if (lines.length) {
            records = lines;
            push({
              role: "tool",
              text: `retrieval · ${lines.length} records`,
              card: {
                source: `journal.retrieve (${found.how})`,
                // Retrieval ranks by relevance; the reader wants latest first,
                // same as every other date-bearing surface.
                facts: [...lines].sort((a, b) => b.localeCompare(a)).slice(0, 5),
                data: { count: lines.length, how: found.how },
              },
            });
          }
        }
        measure("semantic", Date.now() - semStart, `retrieval ${found.count} records`);
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
        : await (async () => {
            const t0s = Date.now();
            const sel = await selectCapabilities(user, 5);
            measure("semantic", Date.now() - t0s, "capability select");
            return sel;
          })();

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
        const ti0 = Date.now();
        const intent = await classifyIntent(user).catch(() => null);
        intentExternal = intent?.kind === "external" || null;
        measure("semantic", Date.now() - ti0, "intent classify");
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
      // An explicit action request ("resolve the oldest pending trade") admits
      // write commands into the menu: the model proposes, and the approval
      // gate still stands between the pick and the write. Without this the
      // decide physically cannot propose the action the user just asked for
      // (live finding: it drifted to read tools instead). A false positive
      // costs nothing — the approval card is the enforcement, not the menu.
      const actionRequested =
        /\b(resolve|apply|create|add|delete|dismiss|categorize)\b/i.test(user);

      if (needsWeb) {
        const webDef = capabilityCatalogue().find((d) => d.id === "web.search");
        if (webDef) {
          hopAllowed = [webDef];
          skipDecide = true;
        }
      } else {
        hopAllowed = selection.selected.filter(
          (d) =>
            (d.kind === "tool" || d.kind === "command" || d.kind === "batch_command") &&
            (d.access === "READ" ||
              d.access === "COMPUTE" ||
              (actionRequested &&
                d.exec === "write-approval" &&
                (d.kind === "command" || d.kind === "batch_command"))) &&
            !excluded.has(d.id) &&
            // Capability selection can surface web.search on its own; the
            // toggle is the user's actual web permission and wins here too,
            // otherwise a toggle-off turn still searched and then the 2-hop
            // refused to read what it found.
            (d.id !== "web.search" || web),
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

      // The turn's compiled shared head, built once and handed byte-identical
      // to every call this turn: decide hops open with renderHead(head) +
      // DECIDE, the answer opens with renderHead(head) + its tail. Sections
      // sit most-stable-first, so per-refresh drift (PORTFOLIO last)
      // re-prefills only the suffix behind it. Portfolio lines are computed
      // HERE, not at answer time, so the decide and answer views see
      // identical bytes and the IDB read happens once per turn. Safe to gate
      // on observations before the loop: skill turns skip hops entirely, and
      // hops only ever push tool observations.
      const hasSkillObservation = observationsRef.current.some((o) => o.kind === "skill");
      const portfolioLines =
        ground && !conversational && !hasSkillObservation
          ? await portfolioFactLines().catch(() => "")
          : "";
      const turnHead = compileHead({
        instructions: system,
        memory: memoryPrompt(),
        book: capabilityDigest(),
        facts: [
          factLines(),
          `web_search: ${
            web
              ? "active this turn, prefer web.search for news and external facts"
              : intentExternal === true
                ? "disabled (Web toggle) — this question probably needs the web, enable it on the next turn"
                : "disabled (Web toggle)"
          }`,
        ]
          .filter(Boolean)
          .join("\n"),
        portfolio: portfolioLines,
      });

      // Router-deterministic hop 1 (S3): when the deterministic router named
      // a READ capture for this text but withheld it behind the advice gate,
      // hop 1 runs it without a decide model call; the decide still runs for
      // later hops, so ambiguous advice stays with the model. ?forceDecide=1
      // keeps the old all-decide path for an honest A/B.
      const forceDecide =
        new URLSearchParams(typeof location !== "undefined" ? location.search : "").get(
          "forceDecide",
        ) === "1";
      const routerPick = forceDecide ? null : suppressedAdviceRead(user);

      // The hop loop: the model picks one read-only tool per hop and sees
      // what every earlier hop observed, so a follow-up hop can build on the
      // one before it (search then read, positions then history). Stop
      // conditions: the model picks none, the hop budget (LIMITS.maxToolHops)
      // or wall clock runs out, a hop repeats one that already ran this turn,
      // or a tool fails. A skill turn that already collected the evidence
      // (research.web ran its own search + read) skips the loop: the extra
      // hop duplicated the search and re-triggered tool-call leaks.
      // Hop state lives outside the loop so the answer phase can promote a
      // native tool call (the model answering with its template's
      // tool-call tokens) as one final hop within the same budget.
      const executedKeys: string[] = [];
      let hopDeadline = 0;
      if (ground && !conversational && hopAllowed.length > 0 && !opts.skipHop) {
        // S4: the hop deadline scales from the measured prefill rate. A
        // decide prompt is the compiled head plus the question, and on the
        // IAB's single-thread wasm that alone can outfill the static 60s;
        // 3x the measured rate bounds the hop on this device, floored at
        // LIMITS.hopDeadlineMs and capped at 180s.
        const hopPromptEstimate = Math.ceil((renderHead(turnHead).length + user.length) / 4);
        hopDeadline = Date.now() + scaledHopDeadlineMs(prefillRate(), hopPromptEstimate);
        let lastSearchObs: ToolObservation | null = null;
        let didRead = false;
        for (let hop = 1; hop <= LIMITS.maxToolHops; hop++) {
          turn.stage("tool", hop === 1 ? "decide" : `decide ${hop}/${LIMITS.maxToolHops}`);
          if (Date.now() > hopDeadline) {
            turn.settle("tool", "skipped", "hop deadline reached");
            break;
          }
          const decStart = Date.now();
          const routerHop = hop === 1 && routerPick?.id != null;
          const routerDef = routerHop
            ? hopAllowed.find((d) => d.id === routerPick!.id)
            : undefined;
          const pick = skipDecide
            ? {
                def: hopAllowed[0],
                query: user,
                why: "external intent, web.search forced",
              }
            : routerDef
              ? {
                  def: routerDef,
                  query: user,
                  why: `router-deterministic: ${routerPick!.why}`,
                }
              : await decideAction(user, hopAllowed, {
                  head: turnHead,
                  evidence: hopEvidence(observationsRef.current),
                  remaining: LIMITS.maxToolHops - hop + 1,
                });
          // The decide call is model inference even though it outputs a tool
          // pick: it belongs in its own phase, not in tool execution. The
          // router-deterministic hop records the label so /usage shows the
          // decide ms it never spent.
          if (!skipDecide) {
            measure(
              "decide",
              Date.now() - decStart,
              routerDef ? "router-deterministic" : `hop ${hop}`,
            );
          }
          if (!pick) {
            turn.settle("tool", "skipped", "no tool chosen");
            break;
          }
          turn.settle("tool", "ok", `${pick.def.id} · ${pick.why || "model-chosen"}`);
          try {
            const input = buildToolInput(pick);
            // Run a pick in the registry that owns it: the hop menu admits
            // batch_command capabilities, and executing one as a tool used to
            // call runTool(undefined), the "reading 'run'" crash that hit the
            // first turn of a session. A tool-kind id missing from the tool
            // registry fails closed as a visible skip instead.
            const hopTool = pick.def.kind === "tool" ? (TOOL_BY_ID[pick.def.id] ?? null) : null;
            if (pick.def.kind === "tool" && !hopTool) {
              turn.settle("tool", "skipped", `${pick.def.id} has no wired implementation`);
              break;
            }
            // When the model wants a page read but does not name one right
            // after its own search, the search's top result is the obvious
            // page: fill it in rather than fail the hop.
            if (pick.def.id === "web.read" && !input.url && lastSearchObs) {
              const fallbackUrl = searchResultUrl(lastSearchObs.data);
              if (fallbackUrl) input.url = fallbackUrl;
            }
            const key = hopKey(pick.def.id, input);
            // Same-tool cap: a model that loops one tool with VARYING invented
            // inputs (the Qwen distill's journal.search meta-queries) dodges
            // the exact-repeat guard below forever. Two runs of any single
            // tool per turn is enough; the hop budget stays as the outer rail.
            const toolRuns = executedKeys.filter((k) => k.split("|")[0] === pick.def.id).length;
            if (toolRuns >= 2) {
              turn.settle("tool", "skipped", `${pick.def.id} already ran twice this turn`);
              break;
            }
            if (isRepeatHop(key, executedKeys)) {
              // A repeated search right after its own search usually means
              // the model wants the page but cannot formulate web.read with a
              // url. Read the search's top result once, deterministically,
              // then end the loop either way.
              const fallbackUrl =
                pick.def.id === "web.search" && lastSearchObs && !didRead
                  ? searchResultUrl(lastSearchObs.data)
                  : null;
              if (fallbackUrl) {
                turn.settle("tool", "ok", "web.read · top result (model repeated its search)");
                try {
                  const out = await runTool(TOOL_BY_ID["web.read"], { url: fallbackUrl });
                  const summary = summarise(out);
                  const capture = captureResult(out);
                  push({
                    role: "tool",
                    text: "web.read · follow-up",
                    card: {
                      source: "web.read (follow-up)",
                      facts: readFacts(out, "top result of the search"),
                      data: { result: capture.clamped } as Record<string, unknown>,
                      offloadKey: capture.offloadKey,
                    },
                  });
                  observationsRef.current.push({
                    id: "web.read",
                    kind: "tool",
                    source: "web.read",
                    status: "ok",
                    summary,
                    data: capture.clamped,
                    offloadKey: capture.offloadKey,
                    args: { url: fallbackUrl },
                  });
                  didRead = true;
                } catch (err) {
                  turn.settle("tool", "error", err instanceof Error ? err.message : "tool failed");
                }
              } else {
                turn.settle("tool", "skipped", "same tool and input already ran this turn");
              }
              break;
            }
            executedKeys.push(key);
            // A write pick NEVER executes inside the hop: it surfaces the
            // same approval card the /run path uses and ends the loop. The
            // approve() handler runs the command and shows the result once
            // the user approves.
            if (pick.def.exec === "write-approval" && commandNeedsApproval(pick.def.id)) {
              turn.settle("tool", "ok", `${pick.def.id} · approval requested`);
              push({
                role: "tool",
                text: `${pick.def.id} needs your approval`,
                approval: {
                  toolId: pick.def.id,
                  kind: "command",
                  access: "EDIT",
                  target: Object.entries(input)
                    .map(([k, v]) => `${k}=${String(v)}`)
                    .join(" ") || "—",
                  input,
                  state: "pending",
                },
              });
              break;
            }
            const toolStart = Date.now();
            const out = hopTool
              ? await runTool(hopTool, input)
              : await runCommand(pick.def.id, input);
            measure("tool", Date.now() - toolStart, pick.def.id);
            markFirstUsefulAction();
            const summary =
              pick.def.kind === "command"
                ? ((out as CommandResult).summary ?? (out as CommandResult).status)
                : summarise(out);
            const capture = captureResult(out);
            const isWebSearch = pick.def.id === "web.search";
            const isWebRead = pick.def.id === "web.read";
            const routerChosen = pick.why.startsWith("router-deterministic");
            push({
              role: "tool",
              text: isWebRead
                ? "web.read · follow-up"
                : `${pick.def.id} · ${routerChosen ? "router" : "model"}-chosen`,
              card: {
                source: `${pick.def.id} (${routerChosen ? "router pick" : "model pick"})`,
                facts: isWebSearch
                  ? searchFacts(out, pick.why)
                  : isWebRead
                    ? readFacts(out, pick.why)
                    : [pick.why, summary].filter(Boolean),
                data: { query: pick.query, result: capture.clamped } as Record<string, unknown>,
                offloadKey: capture.offloadKey,
              },
            });
            const obs: ToolObservation = {
              id: pick.def.id,
              kind: pick.def.kind === "command" ? "command" : "tool",
              source: pick.def.id,
              status: "ok",
              summary,
              data: capture.clamped,
              offloadKey: capture.offloadKey,
              args: input,
            };
            observationsRef.current.push(obs);
            if (isWebSearch) lastSearchObs = obs;
          } catch (err) {
            turn.settle("tool", "error", err instanceof Error ? err.message : "tool failed");
            break;
          }
        }
      }

      // 0.85 of the window, not 0.75: post-penalty answers measure 25 to 60
      // tokens, so the old reply reserve was dead weight the FACTS pile
      // tripped over. Revisit if answers grow. ai.ctx already resolves to
      // the cloud ladder when a cloud provider is active.
      const budgetTokens = Math.floor(ai.ctx * 0.85);
      // Native tool protocol: model-chosen observations become the
      // call → role:tool response dialogue the LFM template expects (the
      // model re-issues its call forever when the results arrive as prose).
      // Skill observations stay prose: the model never called those tools.
      // When turns carry the data, the prose OBSERVATIONS section drops.
      let toolTurns: NativeToolTurn[] = observationsRef.current
        .filter((o) => o.kind !== "skill" && o.kind !== "retrieval")
        .map((o, i) => ({
          id: `${o.source}:${i}`,
          name: o.source,
          args: o.args ?? {},
          content:
            `${o.summary ?? "ran"}\n${
              typeof o.data === "string" ? o.data : JSON.stringify(o.data ?? {})
            }`.slice(0, 2400),
        }));
      const buildInput = {
        head: turnHead,
        selectedCapabilities: selection.selected,
        records,
        observations: toolTurns.length ? [] : observationsRef.current,
        history: Number.isFinite(historyTurnCap) ? messages.slice(-historyTurnCap) : messages,
        user,
        budgetTokens,
      };
      let build = buildTurn(buildInput);
      const ctxStart = Date.now();
      // The section table stays out of the transcript; the trace keeps one
      // compact audit line and the footer carries the size.
      const recordBuild = () => {
        lastPromptRef.current = build.estTokens;
        lastBuildRef.current = build.sections.map(({ name, estTokens, truncated }) => ({
          name,
          estTokens,
          truncated,
        }));
      };
      recordBuild();
      measure("context", Date.now() - ctxStart, `build ${build.estTokens}t`);
      turn.move("generating");
      turn.stage("answer", ai.target.label);
      // Sampling follows the model spec instead of a hardcode: the Thinking
      // model's 0.05 finally applies, the LFM cards' 0.1 applies to the rest,
      // and grounded turns without a spec keep the old 0.2.
      const answerTemp = ground ? (ai.spec?.sampling?.temperature ?? 0.2) : undefined;
      let raw: string;
      const answerStart = Date.now();
      try {
        raw = await ai.askMessages(build.messages, {
          thinking,
          temperature: answerTemp,
          toolTurns,
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
        recordBuild();
        try {
          raw = await ai.askMessages(build.messages, {
            thinking,
            temperature: answerTemp,
            toolTurns,
            images: vision && image ? [image] : undefined,
          });
        } catch (err2) {
          if (!isSizeError(err2)) throw err2;
          build = buildTurn({ ...buildInput, shedLevel: 2 });
          recordBuild();
          raw = await ai.askMessages(build.messages, {
            thinking,
            temperature: answerTemp,
            toolTurns,
            images: vision && image ? [image] : undefined,
          });
        }
      }
      measure("answer", Date.now() - answerStart, raw.length ? "generated" : "empty");

      // Diagnostics for the no-output class of failures: keep the untouched
      // completion on the window so a failing run can be inspected (model,
      // size, head, tail) without restarting anything.
      if (typeof window !== "undefined") {
        (window as unknown as { __lastRaw?: unknown }).__lastRaw = {
          at: new Date().toISOString(),
          model: ai.target.label,
          chars: raw.length,
          head: raw.slice(0, 240),
          tail: raw.slice(-240),
        };
      }

      const { thinking: think, answer } = splitThinking(raw);
      // The model sometimes echoes the tool-call syntax from the prompt into
      // its answer; that tag is noise (the tool already ran) and must not
      // surface or be replayed as history.
      let text = stripToolCallMarkup(answer || raw || "").trim();
      let cleanThink = think ? stripToolCallMarkup(think) : null;
      // Cloud reasoning (GLM reasoning_content deltas) arrives off-band
      // through the hook, not inside the completion text: merge it so the
      // thinking accordion tells the same story it does for local models.
      if (!cleanThink && ai.target.kind === "cloud" && ai.thinkingText) {
        cleanThink = ai.thinkingText;
      }

      // A tool-trained model sometimes answers with its native tool-call
      // tokens instead of prose: the 2.6B's entire completion was once a
      // single web.search call that the markup cleaner then wiped to "no
      // output". With hop budget left, that call is a real request for more
      // data: run it as one promoted hop and answer once more from the grown
      // evidence. The LFM template also makes the model RE-ISSUE a call that
      // already ran (it expects a tool-role response turn we deliver as
      // prose): a refused repeat still gets the one closed-calls retry, so
      // the turn ends in an answer instead of a JSON dump.
      let leakRetry = false;
      if (!text) {
        const call = extractNativeToolCall(raw);
        const def = call
          ? selection.selected.find((d) => d.id === call.id) ??
            capabilityCatalogue().find((d) => d.id === call.id)
          : undefined;
        const wired =
          call !== null && def !== undefined && (def.kind !== "tool" || !!TOOL_BY_ID[call.id]);
        if (call && def && wired) {
          const input: Record<string, unknown> = {};
          const q = call.args.query ?? call.args.q;
          if (typeof q === "string" && q.trim()) input.query = q.trim().slice(0, 200);
          if (typeof call.args.url === "string" && /^https?:\/\//i.test(call.args.url)) {
            input.url = (call.args.url as string).slice(0, 512);
          }
          if (typeof call.args.limit === "number") {
            input.limit = Math.min(8, Math.max(1, Math.round(call.args.limit)));
          }
          const key = hopKey(call.id, input);
          if (!isRepeatHop(key, executedKeys) && executedKeys.length < LIMITS.maxToolHops) {
            turn.stage("tool", `${call.id} (native call)`);
            turn.settle("tool", "ok", `${call.id} · promoted from the answer`);
            try {
              const hopTool = def.kind === "tool" ? TOOL_BY_ID[call.id] : null;
              const out = hopTool
                ? await runTool(hopTool, input)
                : await runCommand(call.id, input);
              const summary =
                def.kind === "command"
                  ? ((out as CommandResult).summary ?? (out as CommandResult).status)
                  : summarise(out);
              const capture = captureResult(out);
              push({
                role: "tool",
                text: `${call.id} · follow-up`,
                card: {
                  source: `${call.id} (native call)`,
                  facts: [summary].filter(Boolean),
                  data: { result: capture.clamped } as Record<string, unknown>,
                  offloadKey: capture.offloadKey,
                },
              });
              observationsRef.current.push({
                id: call.id,
                kind: def.kind === "command" ? "command" : "tool",
                source: call.id,
                status: "ok",
                summary,
                data: capture.clamped,
                offloadKey: capture.offloadKey,
                args: input,
              });
              executedKeys.push(key);
              leakRetry = true;
            } catch (err) {
              turn.settle("tool", "error", err instanceof Error ? err.message : "tool failed");
            }
          } else if (call) {
            // Repeat of a hop that already ran (or budget gone): do not
            // execute again, but still answer once with calls closed.
            leakRetry = true;
          }
        }
      }
      if (!text && leakRetry) {
        // One more answer with the tool's data in evidence and an explicit
        // end to tool calls. The turns are rebuilt so a promoted call joins
        // the protocol as its own call → response pair.
        try {
          toolTurns = observationsRef.current
            .filter((o) => o.kind !== "skill" && o.kind !== "retrieval")
            .map((o, i) => ({
              id: `${o.source}:${i}`,
              name: o.source,
              args: o.args ?? {},
              content:
                `${o.summary ?? "ran"}\n${
                  typeof o.data === "string" ? o.data : JSON.stringify(o.data ?? {})
                }`.slice(0, 2400),
            }));
          const retryBuild = buildTurn({
            ...buildInput,
            observations: [],
            // The closed-calls directive rides as a leading record: it must
            // sit at the prompt tail (after the tool dialogue) to bind the
            // model to prose, not in the shared head.
            records: [
              "tool_calls: closed for this turn; answer now from the tool results above",
              ...records,
            ],
          });
          lastPromptRef.current = retryBuild.estTokens;
          lastBuildRef.current = retryBuild.sections.map(
            ({ name, estTokens, truncated }) => ({ name, estTokens, truncated }),
          );
          turn.stage("answer", `${ai.target.label} · after closed calls`);
          raw = await ai.askMessages(retryBuild.messages, {
            thinking,
            temperature: answerTemp,
            toolTurns,
            images: vision && image ? [image] : undefined,
          });
          if (typeof window !== "undefined") {
            (window as unknown as { __lastRaw?: unknown }).__lastRaw = {
              at: new Date().toISOString(),
              model: ai.target.label,
              retry: true,
              chars: raw.length,
              head: raw.slice(0, 240),
              tail: raw.slice(-240),
            };
          }
          const retried = splitThinking(raw);
          text = stripToolCallMarkup(retried.answer || raw || "").trim();
          cleanThink = retried.thinking ? stripToolCallMarkup(retried.thinking) : cleanThink;
        } catch {
          /* the fallback below still answers from observations */
        }
      }

      // Fail-closed numeric grounding: a number the turn's evidence never
      // carried is the signature of an invented or wrongly derived figure.
      // The note rides inside the message so the user sees exactly which
      // numbers to distrust; the log line keeps the full list for auditing.
      let finalText = text;
      if (ground && !conversational && text) {
        const evidenceText = [
          turnHead.facts,
          turnHead.portfolio,
          records.join("\n"),
          ...observationsRef.current.map(
            (o) =>
              `${o.summary ?? ""} ${
                typeof o.data === "string" ? o.data : JSON.stringify(o.data ?? {})
              }`,
          ),
        ].join("\n");
        const misses = unverifiedNumbers(text, evidenceText);
        if (misses.length > 0) {
          finalText = `${text}\n\n(not found in this turn's data: ${misses
            .slice(0, 5)
            .join(", ")}${misses.length > 5 ? ` +${misses.length - 5} more` : ""})`;
          log("agent", "grounding", {
            level: "warn",
            detail: `${misses.length} unverified numbers: ${misses.slice(0, 10).join(" ")}`,
          });
        }
      }

      // Effective settings for this answer, so a later comparison can read
      // exactly which temperature / context / sampling produced each line.
      const spec = ai.spec;
      const topP = 0.9;
      log("agent", "usage", {
        level: "info",
        detail:
          `${ai.target.label} · quant ${spec?.quant ?? "?"} · ` +
          `temp ${answerTemp ?? (spec?.sampling?.temperature ?? 0.4)} (top_p ${topP}, min_p ${spec?.sampling?.minP ?? "—"}, rep ${spec?.sampling?.repeatPenalty ?? "—"}/${spec?.sampling?.penaltyLastN ?? "—"}) · ` +
          `maxTokens ${ai.maxTokens} · ctx ${ai.loadedCtx}/${spec?.maxCtx ?? "?"} · ` +
          `${ai.backend} · prompt ~${build.estTokens}t · ` +
          `answer ~${estimateTokens(finalText)}t · tps ${ai.speed?.tps ?? "?"}` +
          (build.sections.some((s) => s.truncated)
            ? ` · shed: ${build.sections
                .filter((s) => s.truncated)
                .map((s) => s.name)
                .join(",")}`
            : ""),
      });

      // Still no prose with observations in hand: answer honestly from what
      // the tools found instead of failing. "no output" stays reserved for
      // runs that produced neither prose nor evidence.
      if (!text && observationsRef.current.length > 0) {
        const lines = observationsRef.current
          .slice(-4)
          .map((o) => `${o.source}: ${o.summary ?? "ran"}`)
          .join("; ");
        text = `I gathered the data but could not compose the full answer. What the tools found: ${lines}.`;
        // finalText was computed while text was still empty; without this the
        // honest summary was composed and then never pushed (the exact silent
        // drop that hit the second-leak turn of the 2.6B).
        finalText = text;
        log("agent", "answer", {
          level: "warn",
          detail: "no prose from the model; deterministic observation summary used",
        });
      }

      // Zero output is a failure, never a quiet success.
      if (!text) {
        turn.settle("answer", "error");
        turn.fail("The model completed without producing a response.", "no_output");
        return null;
      }
      push({ role: "assistant", text: finalText, thinking: cleanThink });
      markAnswerDone();
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
    // research.web's deterministic half searches from input.note; routing only
    // carried the question in opts, so without this the skill always answered
    // "No query provided" and the turn fell through to a model-chosen search.
    const skillArgs =
      skillId === "research.web" && opts.question ? { ...args, note: opts.question } : args;
    const result = await runSkill(skillId, skillArgs);
    turn.settle("skill", "ok", `${result.skill.tools.length} tools`);
    // One capture for both surfaces; the parked payload is the exact object
    // the observation clamps ({facts, data}), so a later readback of the key
    // matches what the model saw truncated.
    const capture = captureResult({ facts: result.facts, data: result.data }, { asJson: true });
    push({
      role: "tool",
      text: result.skill.label,
      card: {
        source: result.skill.tools.join(" → ") || result.skill.id,
        facts: result.facts,
        data: capture.clamped as Record<string, unknown>,
        offloadKey: capture.offloadKey,
      },
    });
    observationsRef.current.push(skillObservation(result, capture));
    if (result.aiRequired || reasoning || opts.alwaysSpeak) {
      // A routed question keeps the user's words as the prompt; the skill's
      // numbers ride along as an observation instead of a paraphrase prompt.
      // The anti-dump wording is explicit because the 450M otherwise answers
      // by restating every FACTS line it sees.
      await speak(
        opts.question
          ? "You are a trading-journal analyst. Answer the user's question in 2 to 4 sentences from TURN OBSERVATIONS and FACTS. Do not restate every fact line. Do not narrate your process."
          : "You are a trading-journal analyst. Use only the structured result. Be concrete and brief.",
        opts.question ?? result.prompt,
        Boolean(opts.question),
        { skipRecords: skillId === "research.web", skipHop: skillId === "research.web" },
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
    const capture = captureResult(out);
    push({
      role: "tool",
      text: tool.label,
      card: {
        source: tool.id,
        facts: [summarise(out)],
        data: { result: capture.clamped } as Record<string, unknown>,
        offloadKey: capture.offloadKey,
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
      const raw = part.slice(eq + 1).replace(/^"|"$/g, "");
      // Numeric-looking values coerce: /run journal.apply_answer limit=1
      // must reach the command as the number 1, not the string "1" (which
      // commands treat as absent and fall back to their defaults — that
      // mismatch once turned a limit=1 into 50 writes).
      const n = Number(raw);
      out[part.slice(0, eq)] = raw !== "" && Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(raw) ? n : raw;
    }
    if (Object.keys(out).length === 0) out.query = rest;
    return out;
  };

  const showCommandResult = (result: CommandResult, capture?: CapturedResult) => {
    const d = result.diagnostics;
    const cap = capture ?? captureResult((result.data as Record<string, unknown>) ?? {});
    push({
      role: "tool",
      text: result.summary ?? result.command,
      card: {
        source: result.command,
        // The human summary leads so the collapsed card (first fact only)
        // shows the actual answer, not telemetry. facts[0] is also what
        // session previews and model observations quote.
        facts: [
          ...(result.summary ? [result.summary] : []),
          `status ${result.status}${result.reason ? ` · ${result.reason}` : ""}`,
          `${d?.toolsUsed ?? 0} tool calls · ${d?.durationMs ?? 0} ms${d?.retried ? " · retried" : ""} · no model used`,
          ...(result.nextAction?.reason ? [`next: ${result.nextAction.reason}`] : []),
        ],
        data: cap.clamped as Record<string, unknown>,
        offloadKey: cap.offloadKey,
        // The inbox is where step-by-step resolution starts: the card asks
        // for input, the chip opens the wizard instead of free-typing.
        ...(result.command === "journal.resolve_inbox" &&
        result.status === "needs_input" && !wizardRef.current
          ? { options: ["resolve step by step"] }
          : {}),
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
    const cmdStart = Date.now();
    const res = await runCommand(def.id, args);
    measure("command", Date.now() - cmdStart, def.id);
    // A deterministic command result IS the useful action of this turn:
    // the KPI clock stops here, ahead of any model prose that follows.
    markFirstUsefulAction();
    // One capture serves the card and the observation's offload key; the
    // observation's own data path (commandObservation) is untouched.
    const capture = captureResult((res.data as Record<string, unknown>) ?? {});
    const obs = commandObservation(res);
    obs.offloadKey = capture.offloadKey;
    observationsRef.current.push(obs);
    turn.settle("command", res.status === "ok" ? "ok" : "error", res.summary ?? res.status);
    showCommandResult(res, capture);
    // Command turns are terminal (both submit paths return after them), so
    // the deterministic result is also the turn's completion.
    markAnswerDone();
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
      const capture = captureResult(out);
      push({
        role: "tool",
        text: `${tool.label} ran`,
        card: {
          source: tool.id,
          facts: [summarise(out)],
          data: { result: capture.clamped },
          offloadKey: capture.offloadKey,
        },
      });
    } catch (err) {
      push({ role: "note", text: err instanceof Error ? err.message : "the tool failed" });
    }
  };


  // ── step-by-step inbox resolution ──────────────────────────────────────
  //
  // When the agent resolves one or more cards, the questions come as
  // tappable option chips instead of the user having to write every field.
  // Deterministic on purpose: no model tokens, works offline, and the final
  // write still passes through the standard approval gate.
  const wizardRef = useRef<{
    step: "scope" | "motive" | "alignment" | "reason";
    limit: number;
    motive: string | null;
    alignment: string | null;
    reason: string | null;
  } | null>(null);

  const pushChoices = (text: string, options: string[]) =>
    push({ role: "note", text, options });

  const WIZARD_STEPS = {
    scope: {
      question: "How many pending cards should I resolve?",
      options: ["oldest 1 trade", "oldest 5 trades", "all pending"],
    },
    motive: {
      question: "Why were these trades made?",
      options: ["conviction", "reactive", "hedge", "fomo", "rebalance"],
    },
    alignment: {
      question: "How aligned with your theses?",
      options: ["aligned", "partial", "deviated", "no thesis"],
    },
    reason: {
      question:
        "Pick a reason (or just type your own):",
      options: ["momentum play", "thesis alignment", "portfolio rebalance", "short-term trade"],
    },
  } as const;

  const startWizard = () => {
    wizardRef.current = { step: "scope", limit: 1, motive: null, alignment: null, reason: null };
    pushChoices(WIZARD_STEPS.scope.question, [...WIZARD_STEPS.scope.options]);
  };

  const startWizardIfRequested = (text: string): boolean => {
    if (!/^\/resolve\b/i.test(text) && !(/\bresolve\b/i.test(text) && /step by step/i.test(text)))
      return false;
    startWizard();
    return true;
  };

  const advanceWizard = (text: string) => {
    const w = wizardRef.current;
    if (!w) return;
    const t = text.toLowerCase().trim();

    if (/^cancel\b|^stop\b/.test(t)) {
      wizardRef.current = null;
      push({ role: "note", text: "Resolution cancelled. Nothing was written." });
      return;
    }
    // The step marker decides what the tapped answer means; a wrong value
    // re-asks the same question with the same chips instead of guessing.
    const w2 = w;
    if (w2.step === "scope") {
      const limit =
        t.startsWith("oldest 1") ? 1 : t.startsWith("oldest 5") ? 5 : t.startsWith("all") ? 50 : 0;
      if (!limit) {
        pushChoices(WIZARD_STEPS.scope.question, [...WIZARD_STEPS.scope.options]);
        return;
      }
      w2.limit = limit;
      w2.step = "motive";
      pushChoices(WIZARD_STEPS.motive.question, [...WIZARD_STEPS.motive.options]);
      return;
    }
    if (w2.step === "motive") {
      const match = WIZARD_STEPS.motive.options.find((o) => o.toLowerCase() === t);
      if (!match) {
        pushChoices(WIZARD_STEPS.motive.question, [...WIZARD_STEPS.motive.options]);
        return;
      }
      w2.motive = match;
      w2.step = "alignment";
      pushChoices(WIZARD_STEPS.alignment.question, [...WIZARD_STEPS.alignment.options]);
      return;
    }
    if (w2.step === "alignment") {
      const match = WIZARD_STEPS.alignment.options.find((o) => o.toLowerCase() === t);
      if (!match) {
        pushChoices(WIZARD_STEPS.alignment.question, [...WIZARD_STEPS.alignment.options]);
        return;
      }
      w2.alignment = match === "no thesis" ? "no_thesis" : match;
      w2.step = "reason";
      pushChoices(WIZARD_STEPS.reason.question, [...WIZARD_STEPS.reason.options]);
      return;
    }
    // step "reason": chips or free text, then compose and hand the write to
    // the standard approval gate.
    const reason = WIZARD_STEPS.reason.options.find((o) => o.toLowerCase() === t);
    if (reason) w2.reason = text.trim();
    else if (text.trim().length >= 3) w2.reason = text.trim();
    if (!w2.reason) {
      pushChoices(WIZARD_STEPS.reason.question, [...WIZARD_STEPS.reason.options]);
      return;
    }
    // All four answers in: compose and hand the write to the standard
    // approval gate (the user still approves the actual transaction).
    const summary =
      `Ready to resolve ${w.limit === 50 ? "all pending" : `the oldest ${w.limit}`} ` +
      `with motive ${w.motive}, alignment ${w.alignment}, reason "${w.reason}".`;
    push({ role: "note", text: summary });
    wizardRef.current = null;
    runCommandTurn(
      "journal.apply_answer",
      `reason="${w.reason}" motive=${w.motive} alignment=${w.alignment} limit=${w.limit}`,
    );
  };

  const submit = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || busy || switchBusy) return;
    setInput("");
    // Step-by-step flows (the inbox resolution wizard) intercept the turn
    // before routing: the whole point is deterministic questions with
    // tappable options, no model tokens and no phrasing ambiguity.
    if (wizardRef.current) {
      push({ role: "user", text });
      advanceWizard(text);
      return;
    }
    if (startWizardIfRequested(text)) return;
    observationsRef.current = [];
    turn.begin();
    beginTurn();
    tagTurn(text);
    push({ role: "user", text });

    // One-time semantic engine offer: only when nothing is cached and no
    // encoder is resident. Dismissed or done stays that way.
    if (semanticChip === "hidden" && !encoderReady()) {
      void encoderCached().then(async (cached) => {
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
          const maxCtx = ai.spec?.maxCtx;
          const capped = maxCtx ? Math.min(n, maxCtx) : n;
          ai.setCtx(capped);
          push({
            role: "note",
            text:
              `Context window set to ${capped} tokens` +
              (capped < n
                ? ` (capped: ${ai.spec?.label ?? "this model"} tops out at ${maxCtx})`
                : "") +
              `. Saved for ${ai.spec?.label ?? "this model"}; reload to apply.`,
          });
          return;
        }
        // No number: show exactly what the model saw on the last turn. The
        // section table is the built prompt's anatomy; history scope is the
        // current session only (New session starts an empty transcript), so
        // nothing accumulates across chats. Memory is the one deliberate
        // cross-session section, bounded at its char cap.
        const lastT = lastPromptRef.current;
        const sections = lastBuildRef.current;
        if (lastT == null || !sections) {
          const used = contextFor(messages, Math.floor(ai.ctx * 0.4), historyTurnCap);
          push({
            role: "note",
            text: `ctx ${ai.ctx} · ${used.turns} turns replayed · ~${used.used} of ${Math.floor(ai.ctx * 0.4)} history tokens.\nNo model turn yet in this tab; ask something to record a prompt.`,
          });
          return;
        }
        const table = sections
          .map((s) => `${s.truncated ? "!" : " "} ${s.name} · ${s.estTokens}t`)
          .join("\n");
        push({
          role: "note",
          text: `last prompt ${lastT}t of ${Math.floor(ai.ctx * 0.85)}t budget · model ${ai.spec?.label ?? ai.target.label}\n${table}\nhistory scope: this session only · ${messages.length} messages stored\n(! = section truncated/shed; memory is the only cross-session section)`,
        });
        return;
      }
      if (name === "usage") {
        const lastT = lastPromptRef.current;
        const memCtx = memoryStats();
        const session = sessions.find((s) => s.id === activeId);
        // completedTurn, not the active trace: this command's own beginTurn
        // has already reset the in-flight turn by the time we read it. A
        // failed turn freezes itself here with a reason, so the report says
        // so instead of dressing up the previous finished turn.
        const perf = completedTurn();
        const failedNote = perf?.failed ? `LAST TURN FAILED: ${perf.failed}` : null;
        const perfLine = perf
          ? perf.failed
            ? `failed after ${perf.totalMs ?? "?"}ms · ` +
              Object.entries(perf.phases)
                .map(([k, v]) => `${k} ${v.ms}ms`)
                .join(", ")
            : `time-to-useful ${perf.timeToUsefulActionMs}ms · total ${perf.totalMs}ms · ` +
              Object.entries(perf.phases)
                .map(([k, v]) => `${k} ${v.ms}ms`)
                .join(", ")
          : "no measured turn yet (ask a question)";
        // What the load actually engaged + the answer generation's own split:
        // threadsEffective 1 = non-isolated context (the IAB), decodeTps is
        // steady-state AFTER the first token, ttft carries the prefill.
        const rt = perf?.runtime;
        const gen = perf?.generation;
        const runtimeLine = rt
          ? `runtime ${rt.backend ?? "?"} · threads ${rt.threadsEffective ?? "?"}/${rt.threadsRequested ?? "?"} · gpu layers ${rt.gpuLayers ?? "?"} · ctx ${rt.nCtx ?? "?"}`
          : "runtime not recorded this turn";
        // Prefix-reuse estimate (heuristic): the measured full-prefill rate
        // times the prompt predicts ttft without slot reuse; a ttft far
        // under that means the KV prefix was reused. Never a decision input.
        const rate = prefillRate();
        const reuse =
          gen && rate != null && gen.ttftMs != null && gen.promptTokens
            ? (() => {
                const expected = rate * gen.promptTokens;
                const ratio = gen.ttftMs! / expected;
                return ratio < 0.5
                  ? `prefix reuse: HIT (~${Math.min(99, Math.round((1 - ratio) * 100))}% prefill skipped)`
                  : "prefix reuse: miss (full prefill)";
              })()
            : null;
        const genLine = gen
          ? `gen: prompt ${gen.promptTokens ?? "?"}${gen.promptTokensEstimated ? "≈" : ""}t · ttft ${gen.ttftMs ?? "?"}ms · decode ${gen.decodeTps ?? "?"} tok/s · out ${gen.outputTokens}t · ${gen.totalMs}ms${reuse ? ` · ${reuse}` : ""}`
          : "no model generation this turn";
        // The last effective-settings line, logged by the answer turn.
        const usageLine = getDoc().logs?.find(
          (l) => l.agent === "agent" && l.event === "usage",
        )?.detail;
        push({
          role: "note",
          text: [
            ...(failedNote ? [failedNote] : []),
            perfLine,
            runtimeLine,
            genLine,
            usageLine ?? "no model answer yet this session",
            `last prompt ${lastT != null && lastT > 0 ? `${lastT}t` : "—"} · ctx budget ${Math.floor(ai.ctx * 0.85)}`,
            `memory ${memCtx.chars}/${memCtx.limit} chars · ${memCtx.entries} notes`,
            session ? `${session.turns} turns in this session` : "no active session",
          ].join("\n"),
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
      // Second pass: the MiniLM encoder, not a generative model. The encoder is
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
  // Model-aware history scope: a 350M with a 32K window and slow decode must
  // not ingest an unbounded transcript even when tokens would allow it.
  // Cloud keeps the full session (the ladder is the scope).
  const historyTurnCap = historyTurnCapFor(ai);
  const ctxUsed = contextFor(messages, Math.floor(ai.ctx * 0.4), historyTurnCap);

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
                  : "Make routing semantic? 90 MB, downloaded once, then always ready on this device."}
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
                  <div>
                    <p className="eyebrow whitespace-pre-wrap leading-relaxed">{m.text}</p>
                    {m.options && m.options.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {m.options.map((o) => (
                          <button
                            key={o}
                            type="button"
                            onClick={() => void submit(o)}
                            className="doodle-pill px-3 py-1 text-[12px]"
                          >
                            {o}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
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
                  <ToolCard
                    card={m.card}
                    text={m.text}
                    approval={m.approval}
                    onApprove={(ok) => void approve(m.id, ok)}
                  />
                )}
              </li>
            ))}
            {busy && <li className="eyebrow">{ai.output ? ai.output.slice(-160) : "thinking…"}</li>}
          </ul>
        </div>

        {mentions.length > 0 && (
          <ul className="max-h-[280px] overflow-y-auto border-t border-stroke">
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
          <ul className="max-h-[280px] overflow-y-auto border-t border-stroke">
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
                onClick={() => {
                  const next = !thinking;
                  setThinking(next);
                  // For local reasoning-capable models the template's thinking
                  // path is a load-time setting: the toggle is a reload (FAST
                  // vs REASONED), so the UI state and the loaded model can
                  // never disagree. Weights stay cached; seconds, not a
                  // re-download.
                  if (ai.target.kind === "local" && canReason) void ai.reloadReasoning(next);
                }}
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
 * One tool or approval message. Cards render collapsed by default: the card
 * id (source) plus the first fact, everything else behind one toggle. The id
 * stays visible either way, so the card remains targetable by the agent.
 */
/**
 * Model-aware history scope: recent-turns-only for small local models,
 * the full session for cloud (its context ladder is the scope).
 */
function historyTurnCapFor(ai: ReturnType<typeof useAi>): number {
  if (ai.target.kind === "cloud") return Number.POSITIVE_INFINITY;
  const w = ai.spec?.weightsGb;
  if (w == null) return 12;
  if (w < 0.4) return 8; // 350M class: recent context only
  if (w < 1) return 12; // 1.2B class
  return 16; // 2.6B class
}

function ToolCard({
  card,
  text,
  approval,
  onApprove,
}: {
  card?: ChatCard;
  text: string;
  approval?: Approval;
  onApprove: (ok: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [fullOpen, setFullOpen] = useState(false);
  const [fullText, setFullText] = useState<string | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);
  const facts = card?.facts ?? [];
  const hidden = facts.length - 1;
  const shown = expanded ? facts : facts.slice(0, 1);
  const offloadKey = card?.offloadKey;

  const loadFull = async () => {
    if (!offloadKey || fullText != null) return;
    setLoadingFull(true);
    try {
      const data = await readOffloaded(offloadKey);
      // Parked payloads are big by definition; cap what actually enters the
      // DOM so one click cannot lay out a multi-megabyte text node.
      const DISPLAY_CAP = 200_000;
      setFullText(() => {
        if (data == null) return "(full result no longer available on this device)";
        // web.read digests get a reader-friendly render instead of raw JSON.
        if (typeof data === "object" && "outline" in (data as Record<string, unknown>)) {
          const d = data as {
            title?: string;
            siteName?: string;
            description?: string;
            outline?: string[];
            paragraphs?: string[];
            linkDomains?: string[];
            images?: { alt: string; url: string }[];
            words?: number;
          };
          let reader = `# ${d.siteName ? `${d.siteName} — ${d.title}` : (d.title ?? "Untitled page")}`;
          if (d.description) reader += `\n\n${d.description}`;
          if (d.outline?.length)
            reader += `\n\n## Sections\n${d.outline.map((h) => `- ${h}`).join("\n")}`;
          if (d.paragraphs?.length) {
            reader += `\n\n## Content\n`;
            let budget = 8000;
            for (const p of d.paragraphs) {
              reader += `\n${p.slice(0, budget)}`;
              budget -= p.length;
              if (budget <= 0) break;
            }
          }
          if (d.linkDomains?.length) reader += `\n\n## Outbound links\n${d.linkDomains.join("\n")}`;
          if (d.words != null) reader += `\n\n---\n${d.words.toLocaleString("en-US")} words`;
          if (d.images?.length) reader += `\n${d.images.length} images on page`;
          return reader.length > DISPLAY_CAP
            ? `${reader.slice(0, DISPLAY_CAP)}\n[showing first ${DISPLAY_CAP.toLocaleString("en-US")} chars]`
            : reader;
        }
        const pretty = JSON.stringify(data, null, 2);
        return pretty.length > DISPLAY_CAP
          ? `${pretty.slice(0, DISPLAY_CAP)}\n[showing first ${DISPLAY_CAP.toLocaleString("en-US")} of ${pretty.length.toLocaleString("en-US")} chars]`
          : pretty;
      });
    } finally {
      setLoadingFull(false);
    }
  };

  return (
    <div className="doodle-inset max-w-[92%] px-3 py-2.5">
      <p className="num eyebrow">{card?.source ?? approval?.toolId}</p>
      {card && (
        <ul className="mt-1 grid gap-1">
          {shown.map((f, i) => (
            <li key={i} className="break-words text-[13px] leading-relaxed">
              {/* Auto-linkify http(s) urls in plain text */}
              {f.split(/(https?:\/\/[^\s]+)/g).map((part, j) =>
                /^https?:\/\//i.test(part) ? (
                  <a
                    key={j}
                    href={part}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-ink-faint/40 hover:decoration-ink"
                  >
                    {part}
                  </a>
                ) : (
                  part
                ),
              )}
            </li>
          ))}
        </ul>
      )}
      {card && hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="doodle-pill mt-1.5 px-2.5 py-0.5 text-[11px]"
        >
          {expanded ? "less" : `+${hidden} more`}
        </button>
      )}
      {card && offloadKey && expanded && (
        <>
          <button
            type="button"
            onClick={() => {
              setFullOpen((v) => !v);
              if (!fullOpen) void loadFull();
            }}
            className="doodle-pill mt-1.5 px-2.5 py-0.5 text-[11px]"
          >
            {loadingFull ? "loading…" : fullOpen ? "less" : "show full result"}
          </button>
          {fullOpen && fullText != null && (
            <pre className="doodle-inset mt-1.5 max-h-72 overflow-auto whitespace-pre-wrap break-all p-2 text-[11px] leading-snug text-ink-soft">
              {fullText}
            </pre>
          )}
          {fullOpen && loadingFull && <p className="eyebrow mt-1.5">loading full result…</p>}
        </>
      )}
      {/* When the card is a web.read result, show a link-out to the page; the
       * jump to the source stays available even while the card is collapsed. */}
      {card?.source?.startsWith("web.read") &&
        typeof card.data === "object" &&
        (card.data as Record<string, unknown>).result != null &&
        typeof (card.data as Record<string, unknown>).result === "object" && (
          <a
            href={(card.data as Record<string, { url: string }>).result?.url ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="doodle-pill mt-1.5 inline-flex px-2.5 py-0.5 text-[11px]"
            onClick={(e) => e.stopPropagation()}
          >
            open site ↗
          </a>
        )}
      {approval && (
        <div className="mt-1">
          <p className="break-words text-[13px]">
            {text} · target {approval.target}
          </p>
          <p className="eyebrow mt-1">access {approval.access} · approval required: YES</p>
          {approval.state === "pending" ? (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => onApprove(true)}
                className="doodle-pill bg-ink px-3 py-1 text-[11px] text-paper"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => onApprove(false)}
                className="doodle-pill px-3 py-1 text-[11px]"
              >
                Reject
              </button>
            </div>
          ) : (
            <p className="eyebrow mt-1">{approval.state}</p>
          )}
        </div>
      )}
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
      <ul className="max-h-[280px] overflow-y-auto">
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
 */
function isConversational(text: string): boolean {
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
