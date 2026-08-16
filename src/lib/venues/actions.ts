// Venue action reads — the historical half of the venue layer.
//
// Positions answer "what do I hold"; actions answer "what did I do". Each
// reader returns plain VenueActions that map deterministically into inbox
// signals: one card per order (Nado order digest, Hyperliquid order id) plus
// deposits and withdrawals. No model touches this file.
//
//   Nado        address → Archive {subaccounts} → Archive {orders} per subaccount
//               + Archive {events} for deposit_collateral / withdraw_collateral
//               (deposits move through per-user direct deposit addresses, so
//               EVM counterparty matching cannot see them — events can).
//   Hyperliquid master address → userFills + historicalOrders + ledger updates.
//               Fills executed via agent wallets (1CT) attribute to the master
//               account — always query the master, never the agent address.

import type { Signal } from "@/lib/store";

import { readSubaccounts, symbols } from "./nado";
import { fromX18 } from "./types";

const ARCHIVE = "https://archive.prod.nado.xyz/v1";
const HL_INFO = "https://api.hyperliquid.xyz/info";

export type VenueAction = {
  /** stable across refetches, so the store dedupes on it */
  id: string;
  venue: "nado" | "hyperliquid";
  action: "trade" | "deposit" | "withdraw";
  symbol: string;
  /** fund-flow direction: buy/receive = in, sell/send = out */
  side: "in" | "out";
  amount: number;
  value: number | null;
  feeUsd: number | null;
  ts: number;
  txHash: string;
  meta: Signal["meta"];
};

// ── Nado ────────────────────────────────────────────────────────────────────

type NadoOrder = {
  digest: string;
  subaccount: string;
  product_id: number;
  /** original base amount, sign = side; every number is 10^18 fixed point */
  amount: string;
  price_x18: string;
  base_filled: string;
  quote_filled: string;
  fee: string;
  builder_fee?: string;
  realized_pnl?: string;
  first_fill_timestamp?: number;
  last_fill_timestamp?: number;
};

/** Collateral movements; the amount is the post−pre balance diff. */
type NadoEvent = {
  submission_idx: number | string;
  event_type: string;
  product_id: number;
  pre_balance?: { spot?: { balance?: { amount?: string } } };
  post_balance?: { spot?: { balance?: { amount?: string } } };
};

type NadoEventTx = { submission_idx: number | string; timestamp: number | string };

async function nadoPost<T>(body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(ARCHIVE, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`nado archive ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Historical Nado activity for every subaccount of the address: one action
 * per order digest (unfilled orders never happened and are skipped) plus
 * deposit/withdraw collateral events, whose amount is the balance delta.
 */
export async function readNadoActions(
  address: string,
  chainId: number,
  signal?: AbortSignal,
): Promise<VenueAction[]> {
  if (chainId !== 57073) return []; // Nado trades on Ink mainnet
  const subs = await readSubaccounts(address, signal);
  if (subs.length === 0) return [];
  const sym = await symbols(signal);

  const actions: VenueAction[] = [];
  // The Archive caps a query at 5 subaccounts; chunk to stay under it.
  for (let i = 0; i < subs.length; i += 5) {
    const chunk = subs.slice(i, i + 5).map((s) => s.subaccount);

    let orders: NadoOrder[] = [];
    try {
      const res = await nadoPost<{ orders?: NadoOrder[] }>(
        { orders: { subaccounts: chunk, limit: 100 } },
        signal,
      );
      orders = res.orders ?? [];
    } catch {
      continue; // one failed chunk is not fatal
    }
    for (const o of orders) {
      const base = fromX18(o.base_filled);
      if (base === 0) continue;
      const signedAmount = fromX18(o.amount);
      const buy = (signedAmount !== 0 ? signedAmount : base) > 0;
      const ticker =
        sym.perp.get(o.product_id) ?? sym.spot.get(o.product_id) ?? `PRODUCT-${o.product_id}`;
      const quote = Math.abs(fromX18(o.quote_filled));
      const fee = fromX18(o.fee ?? "0") + fromX18(o.builder_fee ?? "0");
      const pnl = o.realized_pnl != null ? fromX18(o.realized_pnl) : null;
      actions.push({
        id: `nado:${o.digest}`,
        venue: "nado",
        action: "trade",
        symbol: ticker,
        side: buy ? "in" : "out",
        amount: Math.abs(base),
        value: quote > 0 ? quote : null,
        feeUsd: fee > 0 ? fee : null,
        ts: (o.last_fill_timestamp ?? o.first_fill_timestamp ?? 0) * 1000,
        txHash: o.digest,
        meta: {
          price: fromX18(o.price_x18) || null,
          pnl: pnl !== 0 ? pnl : null,
          digest: o.digest,
        },
      });
    }

    try {
      const res = await nadoPost<{ events?: NadoEvent[]; txs?: NadoEventTx[] }>(
        {
          events: {
            subaccounts: chunk,
            event_types: ["deposit_collateral", "withdraw_collateral"],
            limit: { raw: 100 },
          },
        },
        signal,
      );
      const txTime = new Map((res.txs ?? []).map((t) => [String(t.submission_idx), t.timestamp]));
      for (const e of res.events ?? []) {
        const isDeposit = e.event_type === "deposit_collateral";
        const pre = fromX18(e.pre_balance?.spot?.balance?.amount);
        const post = fromX18(e.post_balance?.spot?.balance?.amount);
        const delta = post - pre;
        const symbol = sym.spot.get(e.product_id) ?? "USDC";
        const ts = Number(txTime.get(String(e.submission_idx)) ?? 0) * 1000;
        // The quote product is USD-denominated collateral, so value ≈ amount.
        actions.push({
          id: `nado:evt:${e.submission_idx}:${e.event_type}`,
          venue: "nado",
          action: isDeposit ? "deposit" : "withdraw",
          symbol,
          side: isDeposit ? "in" : "out",
          amount: Math.abs(delta),
          value: Math.abs(delta) || null,
          feeUsd: null,
          ts,
          txHash: `evt:${e.submission_idx}`,
          meta: {},
        });
      }
    } catch {
      // deposit events failed for this chunk; trades above still count
    }
  }
  actions.sort((a, b) => b.ts - a.ts);
  return actions.slice(0, 120); // same horizon as the EVM trade feed
}

// ── Hyperliquid ─────────────────────────────────────────────────────────────

type HlFill = {
  coin: string;
  /** "Open Long", "Close Short", "Buy", "Sell", "Long > Short", … */
  dir: string;
  /** "B" = buy order, "A" = sell order — the order side, unambiguous */
  side: string;
  oid: number;
  hash: string;
  px: string;
  sz: string;
  time: number;
  fee: string;
  feeToken: string;
  closedPnl: string;
};

type HlHistoricalOrder = {
  order: {
    oid: number;
    isTrigger?: boolean;
    isPositionTpsl?: boolean;
    triggerCondition?: string;
    triggerPx?: string;
    reduceOnly?: boolean;
  };
};

type HlLedgerUpdate = {
  time: number;
  hash: string;
  /** the update itself; shape depends on type */
  delta: {
    type: string;
    /** deposit / withdrawal */
    usdc?: string;
    fee?: string;
    /** spotTransfer / send — user-to-user transfers, skipped below */
    token?: string;
    amount?: string;
    usdcValue?: string;
  };
};

async function hlInfo<T>(body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(HL_INFO, {
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

/** "Long > Short" and friends: the order side decides, the final leg as fallback. */
function hlIsBuy(fill: HlFill): boolean {
  if (fill.side === "B") return true;
  if (fill.side === "A") return false;
  const d = fill.dir.toLowerCase();
  if (d === "buy" || d === "open long" || d === "close short") return true;
  if (d === "sell" || d === "open short" || d === "close long") return false;
  const finalLeg = (d.split(">").pop() ?? d).trim();
  const closing = d.startsWith("close");
  if (finalLeg.includes("short")) return false; // ended short = net sell
  if (finalLeg.includes("long")) return !closing; // ended long: buy unless closing it
  return true;
}

function hlDirection(dir: string): "long" | "short" | undefined {
  const d = dir.toLowerCase();
  if (d.includes("long")) return "long";
  if (d.includes("short")) return "short";
  return undefined;
}

function hlTrigger(o: HlHistoricalOrder | undefined): string | null {
  const ord = o?.order;
  if (!ord) return null;
  if (ord.isPositionTpsl) return "TP/SL";
  if (ord.isTrigger) {
    const px = num(ord.triggerPx);
    return `trigger ${ord.triggerCondition ?? ""} ${px != null ? px.toLocaleString("en-US", { maximumFractionDigits: 2 }) : ""}`.trim();
  }
  if (ord.reduceOnly) return "reduce-only";
  return null;
}

/**
 * Historical Hyperliquid activity for the master account: fills grouped into
 * one action per order id, joined with historical orders for trigger tagging,
 * plus deposit/withdrawal ledger updates.
 */
export async function readHyperliquidActions(
  address: string,
  signal?: AbortSignal,
): Promise<VenueAction[]> {
  const [fillsR, ordersR, ledgerR] = await Promise.allSettled([
    hlInfo<HlFill[]>({ type: "userFills", user: address, aggregateByTime: true }, signal),
    hlInfo<HlHistoricalOrder[]>({ type: "historicalOrders", user: address }, signal),
    hlInfo<HlLedgerUpdate[]>({ type: "userNonFundingLedgerUpdates", user: address }, signal),
  ]);
  if (fillsR.status === "rejected" && ledgerR.status === "rejected") return [];

  const ordersByOid = new Map<number, HlHistoricalOrder>();
  if (ordersR.status === "fulfilled" && Array.isArray(ordersR.value)) {
    for (const o of ordersR.value) ordersByOid.set(o.order.oid, o);
  }

  const actions: VenueAction[] = [];

  if (fillsR.status === "fulfilled" && Array.isArray(fillsR.value)) {
    // One card per order: a resting order filled at several times must not
    // become several cards, so fold rows sharing an oid.
    const byOid = new Map<number, HlFill[]>();
    for (const f of fillsR.value) {
      const rows = byOid.get(f.oid);
      if (rows) rows.push(f);
      else byOid.set(f.oid, [f]);
    }
    for (const [oid, rows] of byOid) {
      const first = rows[0]!;
      let size = 0;
      let value = 0;
      let fee = 0;
      let feeKnown = true;
      let lastTs = first.time;
      let last = first;
      for (const f of rows) {
        const sz = num(f.sz);
        const px = num(f.px);
        if (sz == null || px == null) continue;
        size += sz;
        value += sz * px;
        if (f.feeToken === "USDC") fee += num(f.fee) ?? 0;
        else feeKnown = false;
        if (f.time >= lastTs) {
          lastTs = f.time;
          last = f;
        }
      }
      if (size <= 0) continue;
      const pnl = rows.reduce((sum, f) => sum + (num(f.closedPnl) ?? 0), 0);
      actions.push({
        id: `hl:${oid}`,
        venue: "hyperliquid",
        action: "trade",
        symbol: first.coin,
        side: hlIsBuy(last) ? "in" : "out",
        amount: size,
        value,
        feeUsd: feeKnown && fee > 0 ? fee : null,
        ts: lastTs,
        txHash: last.hash,
        meta: {
          price: value / size,
          pnl: pnl !== 0 ? pnl : null,
          direction: hlDirection(last.dir),
          trigger: hlTrigger(ordersByOid.get(oid)),
          oid: String(oid),
        },
      });
    }
  }

  if (ledgerR.status === "fulfilled" && Array.isArray(ledgerR.value)) {
    for (const u of ledgerR.value) {
      const d = u.delta;
      if (!d) continue;
      // Only L1 bridge movements become cards. spotTransfer/send rows are
      // user-to-user shuffles (often dozens of tiny ones) and would bury the
      // inbox; accountClassTransfer is an internal spot↔perp reclass.
      const t = d.type.toLowerCase();
      if (t !== "deposit" && t !== "withdrawal" && t !== "withdraw") continue;
      const usdVal = num(d.usdc);
      const fee = num(d.fee);
      actions.push({
        id: `hl:led:${u.hash}`,
        venue: "hyperliquid",
        action: t === "deposit" ? "deposit" : "withdraw",
        symbol: "USDC",
        side: t === "deposit" ? "in" : "out",
        amount: usdVal != null ? Math.abs(usdVal) : 0,
        value: usdVal != null ? Math.abs(usdVal) : null,
        feeUsd: fee != null && fee > 0 ? fee : null,
        ts: u.time,
        txHash: u.hash,
        meta: {},
      });
    }
  }

  actions.sort((a, b) => b.ts - a.ts);
  return actions.slice(0, 200);
}

// ── shared ──────────────────────────────────────────────────────────────────

/** Both action readers, settled independently; one venue failing is not fatal. */
export async function readVenueActions(
  address: string,
  chainId: number,
  signal?: AbortSignal,
): Promise<VenueAction[]> {
  const [nado, hl] = await Promise.allSettled([
    readNadoActions(address, chainId, signal),
    readHyperliquidActions(address, signal),
  ]);
  return [
    ...(nado.status === "fulfilled" ? nado.value : []),
    ...(hl.status === "fulfilled" ? hl.value : []),
  ].sort((a, b) => b.ts - a.ts);
}

/** Deterministic mapping into inbox signals. The agent never rewrites these. */
export function actionsToSignals(actions: VenueAction[]): Signal[] {
  const now = Date.now();
  return actions.map((a) => ({
    id: a.id,
    txHash: a.txHash,
    symbol: a.symbol,
    side: a.side,
    amount: a.amount,
    value: a.value,
    gasUsd: null,
    feeNative: null,
    counterparty: a.venue === "nado" ? "Nado" : "Hyperliquid",
    ts: a.ts,
    extractedAt: now,
    state: "inbox" as const,
    venue: a.venue,
    action: a.action,
    meta: a.meta,
  }));
}
