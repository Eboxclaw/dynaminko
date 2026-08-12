// Alert evaluation. Pure functions over what we already read: live quotes,
// extracted signals and the theses the user wrote. No polling server, no
// invented triggers — an alert fires only when the data says so.

import type { Alert, Signal, Thesis } from "@/lib/store";
import type { Quote } from "@/lib/prices";

export type Firing = {
  alert: Alert;
  title: string;
  body: string;
};

const DAY = 86_400_000;
/** Don't re-fire the same alert more often than this while it stays true. */
const COOLDOWN = 6 * 3_600_000;

export function evaluate(
  alerts: Alert[],
  ctx: { quotes: Quote[]; signals: Signal[]; theses: Thesis[]; now?: number },
): Firing[] {
  const now = ctx.now ?? Date.now();
  const out: Firing[] = [];

  for (const alert of alerts) {
    if (!alert.enabled) continue;
    if (alert.lastFiredAt && now - alert.lastFiredAt < COOLDOWN) continue;

    if (alert.kind === "price") {
      if (!alert.symbol || alert.target == null) continue;
      const q = ctx.quotes.find((x) => x.symbol === alert.symbol!.toUpperCase());
      if (!q) continue;
      const hit = alert.direction === "above" ? q.usd >= alert.target : q.usd <= alert.target;
      if (!hit) continue;
      out.push({
        alert,
        title: `${q.symbol} ${alert.direction} ${alert.target}`,
        body: `Now $${q.usd.toLocaleString(undefined, { maximumFractionDigits: 6 })}. ${
          alert.note || "Read your thesis before you act."
        }`,
      });
      continue;
    }

    if (alert.kind === "onchain") {
      const since = alert.lastFiredAt ?? alert.createdAt;
      const matches = ctx.signals.filter(
        (s) =>
          s.ts > since &&
          (!alert.symbol || s.symbol.toUpperCase() === alert.symbol.toUpperCase()),
      );
      if (matches.length === 0) continue;
      out.push({
        alert,
        title: alert.symbol ? `${alert.symbol} moved on-chain` : "New wallet activity",
        body: `${matches.length} unreconciled ${matches.length === 1 ? "trade" : "trades"} waiting in your inbox.`,
      });
      continue;
    }

    if (alert.kind === "thesis-review") {
      const every = alert.everyDays ?? 30;
      const since = alert.lastFiredAt ?? alert.createdAt;
      if (now - since < every * DAY) continue;
      const thesis = ctx.theses.find((t) => t.id === alert.thesisId);
      if (alert.thesisId && !thesis) continue;
      out.push({
        alert,
        title: thesis ? `Review: ${thesis.title}` : "Thesis review",
        body: alert.note || `It has been ${every} days. Does it still hold?`,
      });
    }
  }

  return out;
}
