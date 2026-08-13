// Portfolio commands. Everything here is derived locally from extracted
// signals and the basket taxonomy — no model, no network.

import { addAlert, getDoc, patchSettings } from "@/lib/store";
import { SECTOR_BY_ID, sectorFor, type SectorId } from "@/lib/sectors";

import { failed, ok, type CommandContext, type CommandResult } from "./types";

type Line = { symbol: string; basket: SectorId; net: number; value: number | null; trades: number };

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** classification: user override wins, then the deterministic registry. */
export function classify(symbol: string): { basket: SectorId; source: "user" | "registry"; confidence: number } {
  const sym = symbol.toUpperCase();
  const override = (getDoc().settings as { basketOverrides?: Record<string, SectorId> })
    .basketOverrides?.[sym];
  if (override) return { basket: override, source: "user", confidence: 1 };
  return { basket: sectorFor(sym), source: "registry", confidence: 0.8 };
}

function lines(ctx: CommandContext): Line[] {
  const doc = getDoc();
  ctx.count();
  const by = new Map<string, Line>();
  for (const s of doc.signals) {
    const sym = s.symbol.toUpperCase();
    const cur =
      by.get(sym) ?? { symbol: sym, basket: classify(sym).basket, net: 0, value: 0, trades: 0 };
    const sign = s.side === "in" ? 1 : -1;
    cur.net += sign * s.amount;
    cur.value = (cur.value ?? 0) + sign * (s.value ?? 0);
    cur.trades += 1;
    by.set(sym, cur);
  }
  return [...by.values()].sort((a, b) => Math.abs(b.value ?? 0) - Math.abs(a.value ?? 0));
}

export function snapshot(_args: Record<string, unknown>, ctx: CommandContext): CommandResult {
  const id = "portfolio.snapshot";
  const rows = lines(ctx);
  const baskets = new Map<SectorId, number>();
  for (const l of rows) baskets.set(l.basket, (baskets.get(l.basket) ?? 0) + Math.abs(l.value ?? 0));
  const total = [...baskets.values()].reduce((a, b) => a + b, 0);
  return ok(
    id,
    {
      tokens: rows.length,
      totalValueUsd: Math.round(total),
      baskets: [...baskets.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([b, v]) => ({
          basket: b,
          label: SECTOR_BY_ID[b]?.label ?? b,
          valueUsd: Math.round(v),
          share: total ? Math.round((v / total) * 100) : null,
        })),
    },
    `${rows.length} tokens across ${baskets.size} baskets.`,
  );
}

export function positions(args: Record<string, unknown>, ctx: CommandContext): CommandResult {
  const id = "portfolio.positions";
  const limit = typeof args.limit === "number" ? args.limit : 10;
  const basket = str(args.basket) as SectorId | null;
  const rows = lines(ctx)
    .filter((l) => !basket || l.basket === basket)
    .slice(0, limit);
  return ok(
    id,
    rows.map((l) => ({
      symbol: l.symbol,
      basket: l.basket,
      net: Number(l.net.toFixed(4)),
      valueUsd: l.value != null ? Math.round(l.value) : null,
      trades: l.trades,
    })),
    `${rows.length} position lines.`,
  );
}

export function categorizeToken(args: Record<string, unknown>, ctx: CommandContext): CommandResult {
  const id = "portfolio.categorize_token";
  const symbol = str(args.symbol)?.toUpperCase();
  if (!symbol) return failed(id, "invalid_arguments", "symbol is required");
  const basket = str(args.basket) as SectorId | null;
  ctx.count();
  if (basket) {
    if (!SECTOR_BY_ID[basket]) return failed(id, "invalid_arguments", `unknown basket ${basket}`);
    const settings = getDoc().settings as { basketOverrides?: Record<string, SectorId> };
    patchSettings({
      basketOverrides: { ...(settings.basketOverrides ?? {}), [symbol]: basket },
    } as never);
    return ok(id, { symbol, basket, source: "user" }, `${symbol} → ${basket} (your override).`);
  }
  const c = classify(symbol);
  return ok(id, { symbol, ...c, updatedAt: Date.now() }, `${symbol} → ${c.basket} (${c.source}).`);
}

export function listAlerts(_args: Record<string, unknown>, ctx: CommandContext): CommandResult {
  ctx.count();
  const alerts = getDoc().alerts;
  return ok(
    "alert.list",
    alerts.map((a) => ({
      id: a.id,
      kind: a.kind,
      symbol: a.symbol,
      direction: a.direction,
      target: a.target,
      enabled: a.enabled,
    })),
    `${alerts.length} alert${alerts.length === 1 ? "" : "s"}.`,
  );
}

export function createAlert(args: Record<string, unknown>, ctx: CommandContext): CommandResult {
  const id = "alert.create";
  const symbol = str(args.symbol)?.toUpperCase();
  const target = typeof args.target === "number" ? args.target : Number(str(args.target));
  if (!symbol || !Number.isFinite(target))
    return failed(id, "invalid_arguments", "symbol and a numeric target are required");
  const direction = str(args.direction) === "below" ? "below" : "above";
  const alert = addAlert({ kind: "price", symbol, direction, target, note: str(args.note) ?? "" });
  ctx.count();
  return ok(id, { id: alert.id, symbol, direction, target }, `Alert on ${symbol} ${direction} ${target}.`);
}
