// Semantic retrieval over the journal and theses.
//
// Deterministic filter → metadata narrowing → encoder similarity → top N.
// The full journal never reaches a model: only a compact set of records does,
// and only when a question actually needs them. Embeddings are computed lazily
// and cached in memory for the session; they are never the source of truth.

import { prewarmTargets, rank } from "@/lib/ai/encoder";
import { getDoc } from "@/lib/store";
import { filterCards, searchCards, type JournalCard } from "@/lib/tools/journal";

export type Reference =
  | { kind: "thesis"; id: string; title: string; text: string }
  | { kind: "card"; id: string; title: string; text: string };

/** Everything referenceable with `@`, cheap and deterministic. */
export function referenceIndex(query = "", limit = 12): Reference[] {
  const doc = getDoc();
  const q = query.toLowerCase().trim();
  const theses: Reference[] = doc.theses
    .filter((t) => !q || t.title.toLowerCase().includes(q))
    .slice(0, limit)
    .map((t) => ({
      kind: "thesis",
      id: t.id,
      title: t.title,
      text: `${t.title}. ${t.status}. ${t.symbols.join(" ")} ${t.body ?? ""}`.trim(),
    }));
  const cards: Reference[] = (q ? searchCards(q, limit) : filterCards({ limit }))
    .slice(0, limit)
    .map((c) => ({
      kind: "card",
      id: c.id,
      title: `${c.ticker ?? "—"} · ${new Date(c.date).toISOString().slice(0, 10)}`,
      text: cardText(c),
    }));
  return [...theses, ...cards].slice(0, limit);
}

function cardText(c: JournalCard): string {
  return [
    new Date(c.date).toISOString().slice(0, 10),
    c.ticker ?? "",
    c.motive ?? "",
    c.alignment ?? "",
    c.record,
  ]
    .filter(Boolean)
    .join(" · ");
}

export type Retrieved = {
  /** compact lines, safe to hand to a model */
  lines: string[];
  /** how the candidates were narrowed */
  how: "deterministic" | "encoder";
  count: number;
};

/** Everything a question could be ranked against: theses plus recent cards. */
function referencePool(): Reference[] {
  const doc = getDoc();
  return [
    ...doc.theses.map<Reference>((t) => ({
      kind: "thesis",
      id: t.id,
      title: t.title,
      text: `thesis "${t.title}" · ${t.status} · ${t.symbols.join(" ")} · ${(t.body ?? "").slice(0, 200)}`,
    })),
    ...filterCards({ limit: 200 }).map<Reference>((c) => ({
      kind: "card",
      id: c.id,
      title: c.ticker ?? "entry",
      text: cardText(c),
    })),
  ];
}

/**
 * Warm the vector cache in idle time so the first question of a session ranks
 * against ready vectors. No-op when no encoder is resident; never downloads.
 */
export function prewarmRetrieval(): Promise<number> {
  return prewarmTargets(referencePool().map((r) => r.text));
}

/**
 * Records relevant to one question. Falls back to the deterministic search when
 * the encoder is not on the device — retrieval must never require a download.
 */
export async function retrieveContext(query: string, limit = 8): Promise<Retrieved> {
  const pool = referencePool();
  if (pool.length === 0) return { lines: [], how: "deterministic", count: 0 };

  const ranked = await rank(
    query,
    pool.map((r) => ({ id: `${r.kind}:${r.id}`, text: r.text })),
    { opportunistic: true },
  );

  if (!ranked) {
    const cards = searchCards(query, limit);
    return {
      lines: cards.map((c) => cardText(c)),
      how: "deterministic",
      count: cards.length,
    };
  }

  const byId = new Map(pool.map((r) => [`${r.kind}:${r.id}`, r]));
  const top = ranked
    .filter((r) => r.score > 0.25)
    .slice(0, limit)
    .map((r) => byId.get(r.id))
    .filter((r): r is Reference => Boolean(r));

  return { lines: top.map((r) => r.text), how: "encoder", count: top.length };
}
