// A compact digest of the journal, handed to the model instead of the journal.
// Everything deeper is fetched on demand by a tool call.

import { getDoc } from "@/lib/store";
import * as ind from "@/lib/tools/indicators";

export type Digest = {
  wallet: string | null;
  signals: number;
  inbox: number;
  entries: number;
  theses: number;
  potScore: number | null;
  openTheses: string[];
};

export function digest(): Digest {
  const doc = getDoc();
  const cov = ind.coverageStats();
  const idx = ind.potIndex();
  return {
    wallet: doc.activeWallet,
    signals: doc.signals.length,
    inbox: cov.inbox,
    entries: doc.entries.length,
    theses: doc.theses.length,
    potScore: idx.score != null ? Math.round(idx.score * 100) : null,
    openTheses: doc.theses
      .filter((t) => t.status === "open")
      .slice(0, 8)
      .map((t) => t.title),
  };
}

export function digestLine(d = digest()): string {
  return [
    d.wallet ? `wallet ${d.wallet}` : "no wallet watched",
    `${d.entries} entries`,
    `${d.signals} extracted trades (${d.inbox} unanswered)`,
    `${d.theses} theses`,
    d.potScore != null ? `POT ${d.potScore}` : "POT not measurable",
    d.openTheses.length ? `open: ${d.openTheses.join("; ")}` : "no open thesis",
  ].join(" · ");
}

/** ~4 characters per token is close enough for a budget check. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
