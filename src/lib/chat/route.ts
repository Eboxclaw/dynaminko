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
  | { kind: "skill"; skillId: string; motive?: Sentiment; thesisId?: string; why: string; candidates?: CapabilityCandidate[] }
  | { kind: "command"; commandId: string; args?: Record<string, unknown>; why: string; candidates?: CapabilityCandidate[] }
  | { kind: "search"; query: string; why: string; candidates?: CapabilityCandidate[] }
  | { kind: "none"; candidates?: CapabilityCandidate[] };

const MOTIVES: Sentiment[] = ["conviction", "reactive", "hedge", "fomo", "rebalance"];

const PRE_EXECUTE: { commandId: string; aliases: string[] }[] = [
  { commandId: "portfolio.snapshot", aliases: ["show my exposure", "what do i hold", "what do i have", "holdings", "allocation"] },
  { commandId: "journal.resolve_inbox", aliases: ["what is waiting in my inbox", "pending trades", "unanswered trades", "resolve my inbox"] },
  { commandId: "journal.apply_answer", aliases: ["resolve all pending trades", "bulk resolve"] },
];

const SKILL_ALIASES: { skillId: string; aliases: string[] }[] = [
  { skillId: "motive.performance", aliases: ["motive", "discipline", "why do i", "emotion"] },
  { skillId: "journal.review", aliases: ["review", "coverage", "how am i", "state", "pot"] },
  { skillId: "thesis.review", aliases: ["thesis", "conviction case", "stress test"] },
  { skillId: "plan.create", aliases: ["plan", "next step", "what should i", "todo"] },
  { skillId: "capture.tidy", aliases: ["tidy", "rewrite", "clean up"] },
];

function includesAlias(q: string, aliases: string[]) {
  return aliases.find((alias) => q.includes(alias.toLowerCase()));
}

function tickerArg(text: string): string | undefined {
  return /\b([A-Z]{2,6})\b/.exec(text)?.[1];
}

export function routeMessage(text: string): Routed {
  const q = text.toLowerCase();
  const motive = MOTIVES.find((m) => q.includes(m));
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

  for (const k of SKILL_ALIASES) {
    const hit = includesAlias(q, k.aliases);
    if (!hit) continue;
    return { kind: "skill", skillId: k.skillId, motive, why: `matched "${hit}"` };
  }

  if (motive) return { kind: "skill", skillId: "motive.performance", motive, why: `matched the motive "${motive}"` };

  const ticker = tickerArg(text);
  if (ticker) return { kind: "search", query: ticker, why: `looked up ${ticker}` };

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
  if (best.kind === "skill") return { kind: "skill", skillId: best.id, why: best.reason, candidates };
  if (best.kind === "command" || best.kind === "batch_command") {
    return { kind: "command", commandId: best.id, why: best.reason, candidates };
  }
  return { kind: "none", candidates };
}

/** Tools, skills, commands and batch commands ranked semantically for pickers. */
export async function discover(text: string, limit = 5) {
  const catalogue = capabilityCatalogue().filter((c) => c.kind !== "concept");
  const targets = catalogue.map((c) => ({ id: `${c.kind}:${c.id}`, text: capabilitySearchText(c) }));
  const ranked = await rank(text, targets, { opportunistic: true }).catch(() => null);
  return ranked?.slice(0, limit) ?? [];
}
