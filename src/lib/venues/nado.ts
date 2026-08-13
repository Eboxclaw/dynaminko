// Nado reader — Ink CLOB: spot, perps, unified margin.
//
// Reads are public: no key, no signing. The address is not the account; an
// address owns one or more subaccounts (default + isolated), so we discover
// them first and read each one.
//
//   address → Archive {subaccounts} → packed subaccount
//           → Gateway subaccount_info → perp_balances / spot_balances / healths
//
// Every number Nado reports is 10^18 fixed point. PnL is derived from the
// venue's own quote balance and oracle price, never reconstructed from
// transfer history.

import {
  emptyReport,
  fromX18,
  type AccountSummary,
  type Position,
  type VenueReport,
} from "./types";

const ARCHIVE = "https://archive.prod.nado.xyz/v1";
const GATEWAY = "https://gateway.prod.nado.xyz/v1/query";

type Subaccount = {
  id: string;
  subaccount: string;
  address: string;
  subaccount_name: string;
  isolated: boolean;
};

type Balance = { amount: string; v_quote_balance?: string; last_cumulative_funding_x18?: string };
type BalanceRow = { product_id: number; balance: Balance };
type ProductRow = {
  product_id: number;
  oracle_price_x18: string;
  state?: { cumulative_funding_long_x18?: string; cumulative_funding_short_x18?: string };
};

type SubaccountInfo = {
  subaccount: string;
  exists: boolean;
  healths: { assets: string; liabilities: string; health: string }[];
  spot_balances: BalanceRow[];
  perp_balances: BalanceRow[];
  spot_products: ProductRow[];
  perp_products: ProductRow[];
};

type SymbolRow = { product_id: number; symbol: string; type: "spot" | "perp" };

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`nado ${res.status}`);
  return (await res.json()) as T;
}

let symbolCache: { at: number; spot: Map<number, string>; perp: Map<number, string> } | null = null;

/** product_id → ticker, for both books. Cached for the session. */
async function symbols(signal?: AbortSignal) {
  if (symbolCache && Date.now() - symbolCache.at < 10 * 60_000) return symbolCache;
  const spot = new Map<number, string>();
  const perp = new Map<number, string>();
  try {
    const res = await fetch(`${GATEWAY}?type=symbols`, { headers: { accept: "application/json" }, signal });
    if (res.ok) {
      const json = (await res.json()) as { data?: { symbols?: Record<string, SymbolRow> } };
      for (const row of Object.values(json.data?.symbols ?? {})) {
        (row.type === "perp" ? perp : spot).set(row.product_id, row.symbol);
      }
    }
  } catch {
    // metadata is a nicety; product ids still render
  }
  symbolCache = { at: Date.now(), spot, perp };
  return symbolCache;
}

function readSubaccounts(address: string, signal?: AbortSignal) {
  return postJson<{ subaccounts?: Subaccount[] }>(
    ARCHIVE,
    { subaccounts: { address: address.toLowerCase() } },
    signal,
  ).then((r) => r.subaccounts ?? []);
}

function readInfo(packed: string, signal?: AbortSignal) {
  return postJson<{ data?: SubaccountInfo }>(
    GATEWAY,
    { type: "subaccount_info", subaccount: packed },
    signal,
  ).then((r) => r.data);
}

export async function readNado(
  address: string,
  chainId: number,
  signal?: AbortSignal,
): Promise<VenueReport> {
  if (chainId !== 57073) {
    return { ...emptyReport("nado", "Nado trades on Ink mainnet."), status: "pending" };
  }

  const report = emptyReport("nado");
  const [subs, sym] = await Promise.all([readSubaccounts(address, signal), symbols(signal)]);
  if (subs.length === 0) {
    report.note = "No Nado subaccount for this address.";
    return report;
  }

  const infos = await Promise.allSettled(subs.map((s) => readInfo(s.subaccount, signal)));
  const now = Date.now();
  const positions: Position[] = [];
  const accounts: AccountSummary[] = [];
  let failed = 0;

  infos.forEach((settled, i) => {
    const sub = subs[i]!;
    if (settled.status === "rejected" || !settled.value) {
      failed += 1;
      return;
    }
    const info = settled.value;
    const name = sub.subaccount_name || (sub.isolated ? "isolated" : "default");
    const perpProducts = new Map(info.perp_products.map((p) => [p.product_id, p]));
    const spotProducts = new Map(info.spot_products.map((p) => [p.product_id, p]));

    for (const row of info.perp_balances) {
      const size = fromX18(row.balance.amount);
      if (size === 0) continue;
      const product = perpProducts.get(row.product_id);
      const mark = product ? fromX18(product.oracle_price_x18) : null;
      const vQuote = fromX18(row.balance.v_quote_balance);
      const long = size > 0;
      const cumulative = fromX18(
        long
          ? product?.state?.cumulative_funding_long_x18
          : product?.state?.cumulative_funding_short_x18,
      );
      const last = fromX18(row.balance.last_cumulative_funding_x18);
      const funding = size * (cumulative - last);
      const entryPrice = Math.abs(vQuote / size);
      const notional = mark != null ? Math.abs(size) * mark : null;
      const pnl = mark != null ? size * mark + vQuote - funding : null;
      const ticker = sym.perp.get(row.product_id) ?? `PERP-${row.product_id}`;
      positions.push({
        id: `nado-${sub.id}-perp-${row.product_id}`,
        venue: "nado",
        kind: "perp",
        symbol: ticker,
        symbols: [ticker.replace(/-PERP$/, "")],
        label: ticker,
        side: long ? "long" : "short",
        size: Math.abs(size),
        entryPrice,
        markPrice: mark,
        notionalValue: notional,
        unrealizedPnl: pnl,
        liquidationPrice: null,
        leverage: null,
        accountId: sub.subaccount,
        parentAddress: address,
        detail: `${long ? "long" : "short"} ${Math.abs(size)} · ${name}`,
        metadata: { subaccount: name, productId: row.product_id },
        fetchedAt: now,
        value: notional,
      });
    }

    for (const row of info.spot_balances) {
      const amount = fromX18(row.balance.amount);
      if (amount === 0) continue;
      const product = spotProducts.get(row.product_id);
      const price = product ? fromX18(product.oracle_price_x18) : null;
      const ticker = sym.spot.get(row.product_id) ?? `SPOT-${row.product_id}`;
      const value = price != null ? amount * price : null;
      positions.push({
        id: `nado-${sub.id}-spot-${row.product_id}`,
        venue: "nado",
        kind: "spot",
        symbol: ticker,
        symbols: [ticker],
        label: ticker,
        size: amount,
        markPrice: price,
        notionalValue: value,
        accountId: sub.subaccount,
        parentAddress: address,
        detail: `${amount < 0 ? "borrowed" : "margin"} ${Math.abs(amount)} · ${name}`,
        metadata: { subaccount: name, productId: row.product_id },
        fetchedAt: now,
        value,
      });
    }

    // healths: [initial, maintenance, unweighted]. Equity is the unweighted tier.
    const unweighted = info.healths[2] ?? info.healths[0];
    const maintenance = info.healths[1];
    accounts.push({
      id: `nado-${sub.id}`,
      venue: "nado",
      accountId: sub.subaccount,
      label: `Nado · ${name}`,
      parentAddress: address,
      equity: unweighted ? fromX18(unweighted.health) : null,
      available: info.healths[0] ? fromX18(info.healths[0].health) : null,
      marginUsed: unweighted ? fromX18(unweighted.liabilities) : null,
      health: maintenance ? fromX18(maintenance.health) : null,
      detail: sub.isolated ? "isolated margin" : "cross margin",
    });
  });

  report.positions = positions;
  report.accounts = accounts;
  report.status = positions.length > 0 || accounts.length > 0 ? "ok" : "empty";
  if (failed > 0) report.note = `${failed} subaccount read(s) failed.`;
  return report;
}
