// Deterministic router. Plain prose is matched against skills and journal
// nouns before any model is considered. No model runs here.

import { getDoc, type Sentiment } from "@/lib/store";
import { SKILLS } from "@/lib/skills/registry";

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
