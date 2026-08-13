// Normalized position model shared by every venue reader.
//
// A wallet balance, a trading position, an LP position and account equity are
// four different things. They are modelled as such: the UI never has to guess
// from a string, and nothing double-counts.

export type VenueId = "velodrome" | "inkyswap" | "nado" | "hyperliquid";

export type PositionKind =
  | "perp"
  | "spot"
  | "lp-concentrated"
  | "lp-constant-product";

export type Position = {
  id: string;
  venue: VenueId;
  kind: PositionKind;
  /** primary market symbol, e.g. "BTC-PERP" or "ETH/USDC" */
  symbol: string;
  /** every token involved — one for perps, two for pools */
  symbols: string[];
  /** display label; kept so existing rows render unchanged */
  label: string;
  side?: "long" | "short";
  size?: number;
  entryPrice?: number | null;
  markPrice?: number | null;
  /** USD notional when the venue reports a price we trust */
  notionalValue: number | null;
  unrealizedPnl?: number | null;
  liquidationPrice?: number | null;
  leverage?: number | null;
  /** venue account this belongs to (subaccount id, NFT id, …) */
  accountId?: string | null;
  parentAddress: string;
  /** short right-aligned summary line */
  detail: string | null;
  metadata?: Record<string, string | number | null>;
  fetchedAt: number;
  /** back-compat with the first venue UI: same number as notionalValue */
  value: number | null;
};

/** Margin/collateral state of a trading account — never a position. */
export type AccountSummary = {
  id: string;
  venue: VenueId;
  accountId: string;
  label: string;
  parentAddress: string;
  equity: number | null;
  available: number | null;
  marginUsed: number | null;
  health: number | null;
  detail: string | null;
};

export type VenueStatus = "ok" | "empty" | "pending" | "error";

export type VenueReport = {
  venueId: string;
  status: VenueStatus;
  positions: Position[];
  accounts: AccountSummary[];
  note: string | null;
  fetchedAt: number;
  /** true when the live read failed and this is a cached answer */
  stale: boolean;
};

/** Older name kept so existing imports keep compiling. */
export type VenuePosition = Position;

export function emptyReport(venueId: string, note: string | null = null): VenueReport {
  return {
    venueId,
    status: "empty",
    positions: [],
    accounts: [],
    note,
    fetchedAt: Date.now(),
    stale: false,
  };
}

/** 10^18 fixed point → float. Safe for the magnitudes these venues report. */
export function fromX18(raw: string | number | null | undefined): number {
  if (raw == null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n / 1e18 : 0;
}

export function reportValue(report: VenueReport): number {
  return report.positions.reduce((sum, p) => sum + (p.notionalValue ?? 0), 0);
}
