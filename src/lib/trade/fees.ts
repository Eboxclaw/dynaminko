// Fee math for the trading and swap surfaces, wallet-style: the venue's
// base fee in basis points plus the app surcharge, previewed transparently
// on the ticket before anything is signed.
//
// Sources (2026-09-12): Nado taker fees start at 1.5 bps with maker
// rebates to -0.8 bps on 30-day volume tiers (docs.nado.xyz/core/
// fees-and-rebates). Hyperliquid builder fees are capped at 10 bps on
// perps and 100 bps on spot, expressed in tenths of a basis point, and
// builders keep 100% (hyperliquid.gitbook.io, builder-codes). Base-tier
// numbers here are preview defaults: the venue's own response on order
// placement is the truth at execution time.

export type TradeVenueId = "hyperliquid" | "nado";
export type TradeKind = "perp" | "spot";

/** Venue base taker fee, basis points. Preview defaults: the venue reports
 *  the real fee with each fill, and Nado tiers scale down with 30-day
 *  volume. */
export const VENUE_FEE_BPS: Record<TradeVenueId, Record<TradeKind, number>> = {
  hyperliquid: { perp: 45, spot: 35 },
  nado: { perp: 15, spot: 15 },
};

/** The app surcharge, flat 10 bps on everything (user rule 2026-09-12).
 *  Sits exactly at Hyperliquid's perp cap and inside its spot (100) and
 *  Nado (20 placeholder) caps. */
export const APP_BUILDER_BPS = 10;

/** Protocol-side caps per venue and kind: the surcharge is clamped to
 *  these no matter what the config says. Hyperliquid's are enforced by
 *  the venue itself. */
export const BUILDER_BPS_CAPS: Record<TradeVenueId, Record<TradeKind, number>> = {
  hyperliquid: { perp: 10, spot: 100 },
  nado: { perp: 20, spot: 20 },
};

export type FeeRow = { label: string; bps: number; usd: number };

export type FeeBreakdown = {
  notionalUsd: number;
  venueFeeUsd: number;
  builderFeeUsd: number;
  totalUsd: number;
  totalBps: number;
  rows: FeeRow[];
};

function bpsToUsd(notionalUsd: number, bps: number): number {
  return Math.round(((notionalUsd * bps) / 10_000) * 100) / 100;
}

/**
 * The full fee ladder for one trade or swap leg: venue base fee, the app's
 * flat 10 bps surcharge (clamped to the venue cap), and the combined total
 * in basis points and USD. Pure and preview-only: execution-time fees come
 * from the venue's own fill response.
 */
export function feeBreakdown(opts: {
  venue: TradeVenueId;
  kind: TradeKind;
  notionalUsd: number;
}): FeeBreakdown {
  const baseBps = VENUE_FEE_BPS[opts.venue]?.[opts.kind] ?? 0;
  const cap = BUILDER_BPS_CAPS[opts.venue]?.[opts.kind] ?? 0;
  const builderBps = Math.min(APP_BUILDER_BPS, cap);
  const notionalUsd = Math.max(0, opts.notionalUsd);
  const venueFeeUsd = bpsToUsd(notionalUsd, baseBps);
  const builderFeeUsd = bpsToUsd(notionalUsd, builderBps);
  const totalUsd = Math.round((venueFeeUsd + builderFeeUsd) * 100) / 100;
  const totalBps = notionalUsd > 0 ? Math.round((totalUsd / notionalUsd) * 10_000) : baseBps + builderBps;
  return {
    notionalUsd,
    venueFeeUsd,
    builderFeeUsd,
    totalUsd,
    totalBps,
    rows: [
      { label: `${opts.venue} fee`, bps: baseBps, usd: venueFeeUsd },
      { label: "app fee", bps: builderBps, usd: builderFeeUsd },
      { label: "total", bps: totalBps, usd: totalUsd },
    ],
  };
}

/** Hyperliquid builder-code fee field: tenths of a basis point, integers
 *  only (f: 10 = 1 bp). Whole bps in, wire format out. */
export function builderFeeToTenths(bps: number): number {
  return Math.round(bps * 10);
}

/** The expected receive amount for a swap: notional minus the app swap fee
 *  (Rabby-style, embedded in the trade rather than billed separately). Gas
 *  is the venue's own concern on perp and spot books. */
export function swapReceiveEstimate(opts: {
  notionalUsd: number;
  price: number;
  appBps?: number;
}): { receiveAmount: number; feeUsd: number } | { problem: string } {
  const appBps = opts.appBps ?? APP_BUILDER_BPS;
  const { notionalUsd, price } = opts;
  if (!Number.isFinite(notionalUsd) || notionalUsd <= 0)
    return { problem: "amount must be a positive number" };
  if (!Number.isFinite(price) || price <= 0) return { problem: "price must be a positive number" };
  const feeUsd = bpsToUsd(notionalUsd, appBps);
  const receiveAmount = Math.round(((notionalUsd - feeUsd) / price) * 1e6) / 1e6;
  return { receiveAmount, feeUsd };
}
