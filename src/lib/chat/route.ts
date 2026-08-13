// Deterministic router. Plain prose is matched against skills and journal
// nouns before any model is considered. No generative model runs here; the
// encoder is only consulted when the keyword pass finds nothing.

import { getDoc, type Sentiment } from "@/lib/store";
import { SKILLS } from "@/lib/skills/registry";
import { TOOLS } from "@/lib/tools/registry";
import { rank } from "@/lib/ai/encoder";

export type Routed =
  | { kind: "skill"; skillId: string; motive?: Sentiment; thesisId?: string; why: string }
  | { kind: "search"; query: string; why: string }
  | { kind: "none" };

const MOTIVES: Sentiment[] = ["conviction", "reactive", "hedge", "fomo", "rebalance"];

const KEYWORDS: { skillId: string; words: string[] }[] = [
  { skillId: "motive.performance", words: ["motive", "discipline", "why do i", "emotion"] },
  { skillId: "journal.review", words: ["review", "coverage", "how am i", "state", "pot"] },
  { skillId: "thesis.review", words: ["thesis", "conviction case", "stress test"] },
  { skillId: "plan.create", words: ["plan", "next step", "what should i", "todo"] },
  { skillId: "capture.tidy", words: ["tidy", "rewrite", "clean up"] },
];

export function routeMessage(text: string): Routed {
  const q = text.toLowerCase();

  const motive = MOTIVES.find((m) => q.includes(m));
  const thesis = getDoc().theses.find((t) => t.title && q.includes(t.title.toLowerCase()));

  if (thesis) {
    return {
      kind: "skill",
      skillId: "thesis.review",
      thesisId: thesis.id,
      why: `matched the thesis "${thesis.title}"`,
    };
  }

  for (const k of KEYWORDS) {
    const hit = k.words.find((w) => q.includes(w));
    if (!hit) continue;
    if (!SKILLS.some((s) => s.id === k.skillId)) continue;
    return {
      kind: "skill",
      skillId: k.skillId,
      motive: motive ?? undefined,
      why: `matched "${hit}"`,
    };
  }

  if (motive) {
    return {
      kind: "skill",
      skillId: "motive.performance",
      motive,
      why: `matched the motive "${motive}"`,
    };
  }

  const ticker = /\b([A-Z]{2,6})\b/.exec(text)?.[1];
  if (ticker) return { kind: "search", query: ticker, why: `looked up ${ticker}` };

  return { kind: "none" };
}

/** Minimum similarity before the encoder is allowed to pick a skill. */
const THRESHOLD = 0.42;

/**
 * Second pass: embed the message and the skill/tool catalogue and take the best
 * match. Costs one small encoder call, never a generative one. Returns
 * `{ kind: "none" }` when the encoder is unavailable or nothing is close.
 */
export async function routeSemantic(text: string): Promise<Routed> {
  const targets = [
    ...SKILLS.map((s) => ({ id: `skill:${s.id}`, text: `${s.label}. ${s.purpose}` })),
    ...TOOLS.filter((t) => t.live).map((t) => ({
      id: `tool:${t.id}`,
      text: `${t.label}. ${t.purpose}`,
    })),
  ];
  // The encoder is an accelerator. Any failure downgrades routing to keywords,
  // it never breaks the turn.
  const ranked = await rank(text, targets, { opportunistic: true }).catch(() => null);
  const best = ranked?.[0];
  if (!best || best.score < THRESHOLD) return { kind: "none" };
  const [kind, id] = best.id.split(":");
  if (kind !== "skill") return { kind: "none" };
  return {
    kind: "skill",
    skillId: id,
    why: `closest match by the encoder (${best.score.toFixed(2)})`,
  };
}

/** Tools and skills ranked semantically, for the command picker. */
export async function discover(text: string, limit = 5) {
  const targets = [
    ...SKILLS.map((s) => ({ id: `/skill ${s.id}`, text: `${s.label}. ${s.purpose}` })),
    ...TOOLS.filter((t) => t.live).map((t) => ({
      id: `/tool ${t.id}`,
      text: `${t.label}. ${t.purpose}`,
    })),
  ];
  const ranked = await rank(text, targets, { opportunistic: true }).catch(() => null);
  return ranked?.slice(0, limit) ?? [];
}
