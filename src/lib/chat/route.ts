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

const PRE_EXECUTE: { commandId: string; aliases: string[] }[] = [
  {
    commandId: "portfolio.snapshot",
    aliases: ["show my exposure", "what do i hold", "what do i have", "holdings", "allocation"],
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
  { commandId: "journal.apply_answer", aliases: ["resolve all pending trades", "bulk resolve"] },
];

function includesAlias(q: string, aliases: string[]) {
  return aliases.find((alias) => q.includes(alias.toLowerCase()));
}

function tickerArg(text: string): string | undefined {
  return /\b([A-Z]{2,6})\b/.exec(text)?.[1];
}

export function routeMessage(text: string): Routed {
  const q = text.toLowerCase();
  const thesis = getDoc().theses.find((t) => t.title && q.includes(t.title.toLowerCase()));

  for (const route of PRE_EXECUTE) {
    const hit = includesAlias(q, route.aliases);
    if (hit) {
      const args = route.commandId === "journal.resolve_inbox" ? { ticker: tickerArg(text) } : {};
      return { kind: "command", commandId: route.commandId, args, why: `matched "${hit}"` };
    }
  }

  if (thesis) {
    return {
      kind: "skill",
      skillId: "thesis.review",
      thesisId: thesis.id,
      why: `matched the thesis "${thesis.title}"`,
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
