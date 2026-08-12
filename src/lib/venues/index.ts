// Venue registry for positions held outside plain wallet balances:
// liquidity positions on DEXes and margin/trading accounts.
//
// Each venue owns a reader. A reader either returns real positions or reports
// that the venue has no public read wired yet — it never invents a number.

export type VenueKind = "lp" | "trading";

export type VenuePosition = {
  id: string;
  /** display label, e.g. "ETH / USDC 0.05%" or "ETH-PERP" */
  label: string;
  symbols: string[];
  /** USD value when the venue reports one */
  value: number | null;
  detail: string | null;
};

export type VenueReport = {
  venueId: string;
  status: "ok" | "empty" | "pending" | "error";
  positions: VenuePosition[];
  note: string | null;
};

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
    venueId,
    status: "pending",
    positions: [],
    note,
  });
}

async function readHyperliquid(address: string, _chainId: number, signal?: AbortSignal) {
  const report: VenueReport = {
    venueId: "hyperliquid",
    status: "empty",
    positions: [],
    note: null,
  };
  try {
    const res = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "clearinghouseState", user: address }),
      signal,
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as {
      marginSummary?: { accountValue?: string };
      assetPositions?: {
        position?: { coin?: string; szi?: string; positionValue?: string; unrealizedPnl?: string };
      }[];
    };
    const equity = Number(data.marginSummary?.accountValue ?? 0);
    const positions: VenuePosition[] = (data.assetPositions ?? [])
      .map((p) => p.position)
      .filter((p): p is NonNullable<typeof p> => Boolean(p?.coin))
      .map((p) => {
        const size = Number(p.szi ?? 0);
        return {
          id: `hl-${p.coin}`,
          label: `${p.coin}-PERP`,
          symbols: [p.coin as string],
          value: p.positionValue != null ? Number(p.positionValue) : null,
          detail: `${size > 0 ? "long" : "short"} ${Math.abs(size)}${
            p.unrealizedPnl ? ` · uPnL ${Number(p.unrealizedPnl).toFixed(2)}` : ""
          }`,
        };
      });
    if (equity > 0) {
      positions.unshift({
        id: "hl-equity",
        label: "Account equity",
        symbols: ["USDC"],
        value: equity,
        detail: "cross margin",
      });
    }
    report.positions = positions;
    report.status = positions.length > 0 ? "ok" : "empty";
  } catch {
    report.status = "error";
    report.note = "Hyperliquid did not answer.";
  }
  return report;
}

export const VENUES: Venue[] = [
  {
    id: "velodrome",
    label: "Velodrome",
    kind: "lp",
    blurb: "ve(3,3) liquidity on the Superchain",
    read: pending("velodrome", "Position read not wired yet."),
  },
  {
    id: "inkyswap",
    label: "Inkyswap",
    kind: "lp",
    blurb: "Native Ink AMM",
    read: pending("inkyswap", "Position read not wired yet."),
  },
  {
    id: "nado",
    label: "Nado",
    kind: "trading",
    blurb: "Ink CLOB · spot, perps, unified margin",
    read: pending("nado", "Account read not wired yet."),
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
  return Promise.all(
    VENUES.map((v) =>
      v.read(address, chainId, signal).catch(
        (): VenueReport => ({
          venueId: v.id,
          status: "error",
          positions: [],
          note: "Read failed.",
        }),
      ),
    ),
  );
}
