// Deterministic router. Plain prose is matched against the shared capability
// catalogue before any model is considered. The encoder is only consulted when
// already loaded; semantic routing ranks candidates and never authorizes work.

import { getDoc, type Sentiment } from "@/lib/store";
import { rank } from "@/lib/ai/encoder";
import {
  capabilityCatalogue,
  capabilitySearchText,
  type CapabilityDefinition,
} from "@/lib/capabilities/catalogue";
import { SKILLS } from "@/lib/skills/registry";

export type CapabilityCandidate = {
  id: string;
  kind: CapabilityDefinition["kind"];
  score: number;
  reason: string;
};

export type Routed =
  | {
      kind: "skill";
      skillId: string;
      motive?: Sentiment;
      thesisId?: string;
      why: string;
      candidates?: CapabilityCandidate[];
    }
  | {
      kind: "command";
      commandId: string;
      args?: Record<string, unknown>;
      why: string;
      candidates?: CapabilityCandidate[];
    }
  | { kind: "search"; query: string; why: string; candidates?: CapabilityCandidate[] }
  | { kind: "none"; candidates?: CapabilityCandidate[] };

const PRE_EXECUTE: { commandId: string; aliases: string[]; adviceGated?: boolean }[] = [
  {
    commandId: "portfolio.snapshot",
    adviceGated: true,
    aliases: [
      "show my exposure",
      "what do i hold",
      "what do i have",
      "holdings",
      "allocation",
      // Status phrasings: "how is my portfolio doing" is the most common
      // portfolio question and must never fall through to the model hop.
      // Each alias is a distinct phrase (shorter ones are substrings of the
      // longer); "my portfolio" alone is too broad and would swallow
      // non-status questions like "move my portfolio".
      "how is my portfolio",
      "how's my portfolio",
      "how my portfolio",
      "portfolio doing",
      "portfolio status",
    ],
  },
  {
    commandId: "journal.resolve_inbox",
    aliases: [
      "what is waiting in my inbox",
      "pending trades",
      "unanswered trades",
      "resolve my inbox",
      "new trades",
      "ingest",
      "pull my trades",
      "sync my trades",
    ],
  },
  {
    commandId: "journal.apply_answer",
    aliases: ["resolve all pending trades", "resolve pending trades", "bulk resolve"],
  },
];

function includesAlias(q: string, aliases: string[]) {
  return aliases.find((alias) => q.includes(alias.toLowerCase()));
}

// ── deterministic-text normalization ───────────────────────────────────
//
// Substring aliases are only as good as the bytes they see, and users typo
// ("portefolio") and drop apostrophes ("how s"). The deterministic layer
// normalizes BEFORE matching so a wording slip cannot disable both the
// router read and the receipt filter (observed 09-04: "hello agent how s my
// portefolio doing ?" matched nothing and fell to semantic retrieval).
// Deliberately tiny and append-only; it never invents domain words.

const NORM_MISSPELLINGS: [RegExp, string][] = [
  [/\bportefolio\b/g, "portfolio"],
  [/\bporfolio\b/g, "portfolio"],
  [/\bpotfolio\b/g, "portfolio"],
  [/\bprotfolio\b/g, "portfolio"],
  [/\bportfoilo\b/g, "portfolio"],
  [/\bpotrfolio\b/g, "portfolio"],
  [/\bholldings\b/g, "holdings"],
  [/\baloccation\b/g, "allocation"],
];

/** Normalize user prose for deterministic intent checks. Idempotent. */
export function normalizeRoutingText(text: string): string {
  let out = ` ${text.toLowerCase()} `
    .replace(/\s+/g, " ")
    // dropped-apostrophe contractions: "how s" / "hows" → "how is"
    .replace(/\b(how|what|where|when|who)(?:\s|')?s\b/g, "$1 is");
  for (const [re, fix] of NORM_MISSPELLINGS) out = out.replace(re, fix);
  return out.trim();
}

// ── portfolio-status as a first-class domain ────────────────────────────
//
// A current-holdings/exposure/net-worth question must never depend on
// semantic retrieval to discover its data source: the domain is recognized
// deterministically (with normalized text), the live snapshot is read
// directly, and the model's job is presentation. Word shapes, not exact
// alias phrasings, so any wording of the question lands here.

const PORTFOLIO_DOMAIN_WORD =
  /\b(portfolio|holdings|exposure|allocation|positions|net\s?worth|wallet)\b/;
const PORTFOLIO_STATUS_SHAPE =
  /\b(how|what|status|doing|look(?:ing|s)?|state|check|overview|summary|update|value|worth|am i|did i|perform)\b/;
const PORTFOLIO_WRITE_SHAPE = /\b(move|sell|buy|swap|transfer|deposit|withdraw|rebalance|close|open)\b/;

/**
 * Whether the (already normalized) text asks about CURRENT portfolio state.
 * False for advice (the ADVICE_MARKER gate keeps the model in the loop) and
 * for write intents (those are approval flows, never a status read).
 */
export function isPortfolioStatusQuery(norm: string): boolean {
  if (!PORTFOLIO_DOMAIN_WORD.test(norm)) return false;
  if (!PORTFOLIO_STATUS_SHAPE.test(norm)) return false;
  if (PORTFOLIO_WRITE_SHAPE.test(norm)) return false;
  if (ADVICE_MARKER.test(norm)) return false;
  return true;
}

/**
 * The READ the deterministic router recognized but deliberately withheld:
 * a status phrase embedded in an advice question ("how is my portfolio
 * doing and what could I improve?"). The status half is still a plain fact
 * request, so the hop loop can run that read as hop 1 without paying a
 * decide model call for it; the model keeps the floor through later hops,
 * where it answers the advice half from the evidence. null when nothing
 * was withheld (pure status already runs as a terminal command turn, pure
 * advice never matched). Read-only by construction: only the advice-gated
 * PRE_EXECUTE entry is returned, and that entry is a READ capture.
 */
export function suppressedAdviceRead(text: string): { id: string; why: string } | null {
  const q = normalizeRoutingText(text);
  for (const route of PRE_EXECUTE) {
    if (!route.adviceGated) continue;
    const hit = includesAlias(q, route.aliases);
    if (hit && ADVICE_MARKER.test(q)) {
      return { id: route.commandId, why: `matched "${hit}" behind the advice gate` };
    }
  }
  // First-class domain: an advice question about current portfolio state
  // still owes the user the status half deterministically.
  if (isPortfolioStatusQuery(q) && ADVICE_MARKER.test(q)) {
    return { id: "portfolio.snapshot", why: "portfolio-status domain behind the advice gate" };
  }
  return null;
}

/**
 * Advice intent riding on a status phrase: "how is my portfolio looking and
 * what could I improve?" contains the status alias but asks for an opinion,
 * which the snapshot data alone cannot give. When one of these markers is
 * present the deterministic capture is skipped and the model hop answers,
 * with FACTS riding along as usual.
 */
const ADVICE_MARKER =
  /\b(improve|should i|should you|what should|could i|advice|recommend|thoughts|what do you think|any idea|ideas on|how can i|how do i|optimi[sz]e|rebalance)\b/;

function tickerArg(text: string): string | undefined {
  return /\b([A-Z]{2,6})\b/.exec(text)?.[1];
}

export function routeMessage(text: string): Routed {
  const q = normalizeRoutingText(text);
  const thesis = getDoc().theses.find((t) => t.title && q.includes(t.title.toLowerCase()));

  // Longest alias wins across commands and skills: "what do you hold on your
  // wallet" contains "what do i hold", so the more specific skill phrase must
  // beat the generic command phrase on the same input. Commands keep priority
  // over skills when the same-length phrase is hit (commands are the
  // deterministic floor; skills add a model step on top).
  type Hit = { kind: "command" | "skill"; id: string; hit: string };
  const hits: Hit[] = [];
  for (const route of PRE_EXECUTE) {
    const hit = includesAlias(q, route.aliases);
    if (!hit) continue;
    // A status phrase embedded in an advice question is not a status request;
    // letting it fall through is safe because FACTS ride along in the hop.
    if (route.adviceGated && ADVICE_MARKER.test(q)) continue;
    hits.push({ kind: "command", id: route.commandId, hit });
  }
  for (const skill of SKILLS) {
    if (!skill.aliases?.length) continue;
    const hit = includesAlias(q, skill.aliases);
    if (hit) hits.push({ kind: "skill", id: skill.id, hit });
  }
  let best: Hit | null = null;
  for (const h of hits) {
    if (!best) {
      best = h;
      continue;
    }
    // longer phrase wins; on a tie the command wins over the skill
    if (
      h.hit.length > best.hit.length ||
      (h.hit.length === best.hit.length && h.kind === "command" && best.kind === "skill")
    ) {
      best = h;
    }
  }

  if (best) {
    if (best.kind === "command") {
      const args = best.id === "journal.resolve_inbox" ? { ticker: tickerArg(text) } : {};
      return { kind: "command", commandId: best.id, args, why: `matched "${best.hit}"` };
    }
    return { kind: "skill", skillId: best.id, why: `matched "${best.hit}"` };
  }
  if (thesis) {
    return {
      kind: "skill",
      skillId: "thesis.review",
      thesisId: thesis.id,
      why: `matched the thesis "${thesis.title}"`,
    };
  }

  // First-class domain floor: a current-portfolio question that missed every
  // alias phrasing still routes to the snapshot deterministically; semantic
  // retrieval is never required to discover the portfolio data source.
  if (isPortfolioStatusQuery(q)) {
    return {
      kind: "command",
      commandId: "portfolio.snapshot",
      args: {},
      why: "portfolio-status domain",
    };
  }

  return { kind: "none" };
}

const STRONG = 0.75;

/** Rank catalogue capabilities. Confidence is advisory, not authorization. */
export async function routeSemantic(text: string): Promise<Routed> {
  const catalogue = capabilityCatalogue().filter((c) => c.kind !== "concept");
  const targets = catalogue.map((c) => ({ id: c.id, text: capabilitySearchText(c) }));
  const ranked = await rank(text, targets, { opportunistic: true }).catch(() => null);
  const candidates =
    ranked?.slice(0, 5).map((r) => {
      const def = catalogue.find((c) => c.id === r.id);
      return {
        id: r.id,
        kind: def?.kind ?? "agent_capability",
        score: r.score,
        reason: `catalogue semantic score ${r.score.toFixed(2)}`,
      } satisfies CapabilityCandidate;
    }) ?? [];
  const best = candidates[0];
  if (!best || best.score < STRONG) return { kind: "none", candidates };
  if (best.kind === "skill")
    return { kind: "skill", skillId: best.id, why: best.reason, candidates };
  if (best.kind === "command" || best.kind === "batch_command") {
    return { kind: "command", commandId: best.id, why: best.reason, candidates };
  }
  return { kind: "none", candidates };
}

/** Tools, skills, commands and batch commands ranked semantically for pickers. */
export async function discover(text: string, limit = 5) {
  const catalogue = capabilityCatalogue().filter((c) => c.kind !== "concept");
  const targets = catalogue.map((c) => ({
    id: `${c.kind}:${c.id}`,
    text: capabilitySearchText(c),
  }));
  const ranked = await rank(text, targets, { opportunistic: true }).catch(() => null);
  return ranked?.slice(0, limit) ?? [];
}

/**
 * Classify a turn as needing external information (web/search) or internal
 * (app/journal). Uses the always-warm encoder to rank the question against
 * two seeded intent descriptions. The Web toggle already gates tool access;
 * this decides whether the 450M even sees web tools in the hop menu.
 */
const EXTERNAL_INTENT_TEXT =
  "needs the latest/live web information, news, current events, facts the app cannot have, real-time data, online research, what is new, the latest news on X, what happened with, current price of, research on the internet, search the web, check online, find online";
const INTERNAL_INTENT_TEXT =
  "about the user's own trading journal, personal portfolio, past trades, theses, their own extracted signals, app content, existing records on this device";

export type Intent = { kind: "internal" | "external"; score: number };

export async function classifyIntent(text: string): Promise<Intent | null> {
  const targets = [
    { id: "external", text: EXTERNAL_INTENT_TEXT },
    { id: "internal", text: INTERNAL_INTENT_TEXT },
  ];
  const ranked = await rank(text, targets, { opportunistic: true }).catch(() => null);
  if (!ranked || ranked.length < 2) return null;
  const best = ranked[0];
  if (best.score < 0.1) return null; // too uncertain to classify
  return { kind: best.id as "internal" | "external", score: best.score };
}
