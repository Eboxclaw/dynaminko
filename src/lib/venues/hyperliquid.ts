// Hyperliquid reader — perps, spot balances and subaccounts.
//
// One public endpoint, no auth. Account equity is returned as an account
// summary, never as a position: mixing the two inflates the venue total.

import {
  emptyReport,
  type AccountSummary,
  type Position,
  type VenueReport,
} from "./types";

const INFO = "https://api.hyperliquid.xyz/info";

type ClearingHouse = {
  marginSummary?: { accountValue?: string; totalMarginUsed?: string; totalNtlPos?: string };
  withdrawable?: string;
  assetPositions?: {
    position?: {
      coin?: string;
      szi?: string;
      entryPx?: string;
      positionValue?: string;
      unrealizedPnl?: string;
      liquidationPx?: string | null;
      leverage?: { type?: string; value?: number };
      marginUsed?: string;
    };
  }[];
};

type SpotState = {
  balances?: { coin?: string; total?: string; hold?: string; entryNtl?: string }[];
};

type SubAccount = {
  name?: string;
  subAccountUser?: string;
  clearinghouseState?: ClearingHouse;
  spotState?: SpotState;
};

async function info<T>(body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(INFO, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`hyperliquid ${res.status}`);
  return (await res.json()) as T;
}

function num(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function perpPositions(
  state: ClearingHouse | undefined,
  parentAddress: string,
  accountId: string,
  accountLabel: string,
  now: number,
): Position[] {
  return (state?.assetPositions ?? [])
    .map((p) => p.position)
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.coin))
    .map((p) => {
      const size = num(p.szi) ?? 0;
      const long = size > 0;
      const notional = num(p.positionValue);
      const pnl = num(p.unrealizedPnl);
      return {
        id: `hl-${accountId}-${p.coin}`,
        venue: "hyperliquid" as const,
        kind: "perp" as const,
        symbol: `${p.coin}-PERP`,
        symbols: [p.coin as string],
        label: `${p.coin}-PERP`,
        side: (long ? "long" : "short") as "long" | "short",
        size: Math.abs(size),
        entryPrice: num(p.entryPx),
        markPrice: notional && size ? notional / Math.abs(size) : null,
        notionalValue: notional,
        unrealizedPnl: pnl,
        liquidationPrice: num(p.liquidationPx ?? null),
        leverage: p.leverage?.value ?? null,
        accountId,
        parentAddress,
        detail: `${long ? "long" : "short"} ${Math.abs(size)}${
          p.leverage?.value ? ` · ${p.leverage.value}x` : ""
        }${pnl != null ? ` · uPnL ${pnl.toFixed(2)}` : ""}${
          accountLabel ? ` · ${accountLabel}` : ""
        }`,
        metadata: { account: accountLabel, marginMode: p.leverage?.type ?? null },
        fetchedAt: now,
        value: notional,
      };
    })
    .filter((p) => (p.size ?? 0) > 0);
}

function spotPositions(
  state: SpotState | undefined,
  parentAddress: string,
  accountId: string,
  accountLabel: string,
  now: number,
): Position[] {
  return (state?.balances ?? [])
    .filter((b) => b.coin && (num(b.total) ?? 0) !== 0)
    .map((b) => {
      const total = num(b.total) ?? 0;
      const entryNtl = num(b.entryNtl);
      return {
        id: `hl-${accountId}-spot-${b.coin}`,
        venue: "hyperliquid" as const,
        kind: "spot" as const,
        symbol: b.coin as string,
        symbols: [b.coin as string],
        label: b.coin as string,
        size: total,
        entryPrice: entryNtl && total ? entryNtl / total : null,
        // Hyperliquid does not price spot balances in this response.
        notionalValue: null,
        accountId,
        parentAddress,
        detail: `${total} held${accountLabel ? ` · ${accountLabel}` : ""}`,
        metadata: { account: accountLabel },
        fetchedAt: now,
        value: null,
      };
    });
}

function summary(
  state: ClearingHouse | undefined,
  parentAddress: string,
  accountId: string,
  label: string,
): AccountSummary | null {
  const equity = num(state?.marginSummary?.accountValue);
  if (equity == null) return null;
  return {
    id: `hl-acct-${accountId}`,
    venue: "hyperliquid",
    accountId,
    label,
    parentAddress,
    equity,
    available: num(state?.withdrawable),
    marginUsed: num(state?.marginSummary?.totalMarginUsed),
    health: null,
    detail: "cross margin",
  };
}

export async function readHyperliquid(
  address: string,
  _chainId: number,
  signal?: AbortSignal,
): Promise<VenueReport> {
  const report = emptyReport("hyperliquid");
  const now = Date.now();

  const [perp, spot, subs] = await Promise.allSettled([
    info<ClearingHouse>({ type: "clearinghouseState", user: address }, signal),
    info<SpotState>({ type: "spotClearinghouseState", user: address }, signal),
    info<SubAccount[]>({ type: "subAccounts", user: address }, signal),
  ]);

  if (perp.status === "rejected" && spot.status === "rejected") {
    return { ...report, status: "error", note: "Hyperliquid did not answer." };
  }

  const positions: Position[] = [];
  const accounts: AccountSummary[] = [];

  if (perp.status === "fulfilled") {
    positions.push(...perpPositions(perp.value, address, "main", "", now));
    const s = summary(perp.value, address, "main", "Hyperliquid · main");
    if (s && (s.equity ?? 0) !== 0) accounts.push(s);
  }
  if (spot.status === "fulfilled") {
    positions.push(...spotPositions(spot.value, address, "main", "", now));
  }
  if (subs.status === "fulfilled" && Array.isArray(subs.value)) {
    for (const sub of subs.value) {
      const id = sub.subAccountUser ?? sub.name ?? "sub";
      const label = sub.name ?? id.slice(0, 8);
      positions.push(...perpPositions(sub.clearinghouseState, address, id, label, now));
      positions.push(...spotPositions(sub.spotState, address, id, label, now));
      const s = summary(sub.clearinghouseState, address, id, `Hyperliquid · ${label}`);
      if (s && (s.equity ?? 0) !== 0) accounts.push(s);
    }
  }

  report.positions = positions;
  report.accounts = accounts;
  report.status = positions.length > 0 || accounts.length > 0 ? "ok" : "empty";
  if (perp.status === "rejected") report.note = "Perp state unavailable.";
  else if (spot.status === "rejected") report.note = "Spot state unavailable.";
  return report;
}
