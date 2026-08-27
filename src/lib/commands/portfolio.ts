// Portfolio commands. Everything here is derived from the live wallet source
// — the same cached snapshot + venue reports + quotes the /portfolio page
// renders — never from extracted signals. No model, no network: the reader
// worker has already filled the IDB cache.

import {
  addAlert,
  getDoc,
  patchSettings,
  readCachedSnapshot,
  readCachedVenueReports,
} from "@/lib/store";
import { SECTOR_BY_ID, classifyAsset, type SectorId } from "@/lib/sectors";
import { buildPortfolio, type Holding } from "@/lib/portfolio";
import { composeBaskets, composeNetWorth, openPerps, type MergedHolding } from "@/lib/exposure";
import type { Quote } from "@/lib/prices";

import { failed, ok, type CommandContext, type CommandResult } from "./types";

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** classification: user override wins, then the deterministic registry. */
export function classify(symbol: string): { basket: SectorId; source: string; confidence: number } {
  const overrides = getDoc().settings.basketOverrides ?? {};
  const rec = classifyAsset(symbol, overrides);
  return { basket: rec.basket, source: rec.source, confidence: rec.confidence };
}

/**
 * The live holdings picture for the active wallet. One source of truth for
 * every portfolio command: on-chain balances + venue spot balances, priced
 * with the cached quotes, split into baskets. Signal-based net flow was the
 * old source; it answered "what moved" instead of "what do I hold".
 */
export async function holdingsPicture() {
  const snapshot = await readCachedSnapshot();
  const reports = await readCachedVenueReports();
  const overrides = getDoc().settings.basketOverrides;
  if (!snapshot) return null;
  // Same quote key the price pipeline caches under; the tool layer uses it too.
  const { idbGet } = await import("@/lib/cache/idb");
  const quotes = (await idbGet<Quote[]>("quotes:latest")) ?? [];
  const portfolio = buildPortfolio(snapshot, quotes, overrides);
  const merged = composeBaskets(portfolio, reports, quotes, overrides);
  return {
    portfolio,
    merged,
    reports,
    netWorth: composeNetWorth(portfolio, reports),
    perps: openPerps(reports),
  };
}

export async function snapshot(
  _args: Record<string, unknown>,
  ctx: CommandContext,
): Promise<CommandResult> {
  const id = "portfolio.snapshot";
  ctx.count();
  const picture = await holdingsPicture();
  if (!picture)
    return ok(
      id,
      { tokens: 0, totalValueUsd: 0, baskets: [], stale: true },
      "No wallet snapshot cached yet; sync your wallet on the home page first.",
    );
  const { merged, portfolio, netWorth, perps } = picture;
  const rows = merged.holdings;
  ctx.count(rows.length);
  const baskets = merged.slices.map((s) => ({
    basket: s.sector,
    label: SECTOR_BY_ID[s.sector]?.label ?? s.sector,
    valueUsd: Math.round(s.value),
    share: Math.round(s.share * 100),
  }));
  return ok(
    id,
    {
      walletValueUsd: Math.round(portfolio.total),
      venueSpotValueUsd: Math.round(merged.venueSpotTotal),
      totalValueUsd: Math.round(merged.total),
      netWorthUsd: Math.round(netWorth.net),
      venues:
        netWorth.venueEquity > 0
          ? `wallet ${Math.round(netWorth.wallet)} + venues ${Math.round(netWorth.venueEquity)}`
          : null,
      tokens: rows.length,
      baskets,
      openPerps: perps.trades.length,
      sources: rows.length ? "wallet + venues" : "wallet",
    },
    `${rows.length} tokens · $${Math.round(merged.total)} across ${baskets.length} baskets` +
      (perps.trades.length ? ` · ${perps.trades.length} open perps` : "") +
      (netWorth.venueEquity > 0 ? ` · net worth $${Math.round(netWorth.net)}` : "") +
      ".",
  );
}

export async function positions(
  args: Record<string, unknown>,
  ctx: CommandContext,
): Promise<CommandResult> {
  const id = "portfolio.positions";
  ctx.count();
  const picture = await holdingsPicture();
  if (!picture)
    return ok(
      id,
      { rows: [], stale: true },
      "No wallet snapshot cached yet; sync your wallet first.",
    );
  const limit = typeof args.limit === "number" ? args.limit : 10;
  const basket = str(args.basket) as SectorId | null;
  const rows = picture.merged.holdings
    .filter((h) => !basket || h.sector === basket)
    .slice(0, limit);
  ctx.count(rows.length);
  return ok(
    id,
    rows.map((l) => positionLine(l)),
    `${rows.length} position lines${basket ? ` in ${basket}` : ""}.`,
  );
}

/** One holding row as the model reads it: amount, value, basket, source venues. */
function positionLine(h: MergedHolding | Holding): Record<string, unknown> {
  const h2 = h as MergedHolding;
  return {
    symbol: h2.symbol,
    basket: h2.sector,
    amount: h2.amount,
    valueUsd: h2.value != null ? Math.round(h2.value) : null,
    change24h: h2.change24h,
    sources: h2.sources?.length ? h2.sources.join("+") : "wallet",
  };
}

export function categorizeToken(args: Record<string, unknown>, ctx: CommandContext): CommandResult {
  const id = "portfolio.categorize_token";
  const symbol = str(args.symbol)?.toUpperCase();
  if (!symbol) return failed(id, "invalid_arguments", "symbol is required");
  const basket = str(args.basket) as SectorId | null;
  ctx.count();
  if (basket) {
    if (!SECTOR_BY_ID[basket]) return failed(id, "invalid_arguments", `unknown basket ${basket}`);
    const overrides = getDoc().settings.basketOverrides ?? {};
    patchSettings({ basketOverrides: { ...overrides, [symbol]: basket } });
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
  return ok(
    id,
    { id: alert.id, symbol, direction, target },
    `Alert on ${symbol} ${direction} ${target}.`,
  );
}
