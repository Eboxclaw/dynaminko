// Venue registry for positions held outside plain wallet balances:
// liquidity positions on DEXes and margin/trading accounts.
//
// Each venue owns a reader. A reader either returns real positions or reports
// that the venue has no public read wired yet — it never invents a number.
// Venues settle independently: one failure must not blank the others.

import { readHyperliquid } from "./hyperliquid";
import { readNado } from "./nado";
import {
  emptyReport,
  reportValue,
  type AccountSummary,
  type Position,
  type VenuePosition,
  type VenueReport,
} from "./types";
import { readVelodrome } from "./velodrome";

export type { AccountSummary, Position, VenuePosition, VenueReport };
export { reportValue };

export type VenueKind = "lp" | "trading";

export type Venue = {
  id: string;
  label: string;
  kind: VenueKind;
  blurb: string;
  read: (address: string, chainId: number, signal?: AbortSignal) => Promise<VenueReport>;
};

/** Nothing public to read yet — surfaced in the UI as a pending row. */
function pending(venueId: string, note: string) {
  return async (): Promise<VenueReport> => ({
    ...emptyReport(venueId, note),
    status: "pending",
  });
}

export const VENUES: Venue[] = [
  {
    id: "velodrome",
    label: "Velodrome",
    kind: "lp",
    blurb: "Slipstream concentrated liquidity",
    read: readVelodrome,
  },
  {
    id: "inkyswap",
    label: "Inkyswap",
    kind: "lp",
    blurb: "Native Ink AMM",
    read: pending("inkyswap", "Uniswap V4 position read not wired yet."),
  },
  {
    id: "nado",
    label: "Nado",
    kind: "trading",
    blurb: "Ink CLOB · spot, perps, unified margin",
    read: readNado,
  },
  {
    id: "hyperliquid",
    label: "Hyperliquid",
    kind: "trading",
    blurb: "Perp DEX account",
    read: readHyperliquid,
  },
];

export const VENUE_BY_ID = Object.fromEntries(VENUES.map((v) => [v.id, v])) as Record<
  string,
  Venue
>;

export async function readVenues(
  address: string,
  chainId: number,
  signal?: AbortSignal,
): Promise<VenueReport[]> {
  const settled = await Promise.allSettled(
    VENUES.map((v) => v.read(address, chainId, signal)),
  );
  return settled.map((result, i) => {
    const venue = VENUES[i]!;
    if (result.status === "fulfilled") return result.value;
    return {
      ...emptyReport(venue.id, describe(result.reason)),
      status: "error" as const,
    };
  });
}

function describe(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  return message ? `Read failed: ${message}` : "Read failed.";
}
