// Read-only chain access for Ink via its Blockscout explorer API + JSON-RPC.
// No keys, no signing, no writes. Runs equally in a Worker or on the main
// thread (fetch + JSON only), so the Storage/Wallet worker can own it.

import { INK_CHAIN } from "@/chains/ink";

export type TokenBalance = {
  address: string;      // contract, "native" for ETH
  symbol: string;
  name: string;
  decimals: number;
  /** human-readable amount */
  amount: number;
  /** explorer-reported USD spot, when available */
  usd: number | null;
};

export type ChainTransfer = {
  txHash: string;
  logIndex: number;
  symbol: string;
  decimals: number;
  amount: number;
  direction: "in" | "out";
  counterparty: string;
  ts: number;           // ms epoch
  blockNumber: number | null;
};

export type WalletSnapshot = {
  walletId: string;
  address: string;
  native: TokenBalance;
  tokens: TokenBalance[];
  transfers: ChainTransfer[];
  fetchedAt: number;
  /** non-fatal problems (one leg failed, cached rest still usable) */
  warnings: string[];
};

const API = `${INK_CHAIN.explorer}/api/v2`;
const RPC = INK_CHAIN.rpcUrls[0];

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" }, signal });
  if (!res.ok) throw new Error(`${url.replace(API, "")} → ${res.status}`);
  return (await res.json()) as T;
}

function toAmount(raw: string | number | null | undefined, decimals: number): number {
  if (raw == null) return 0;
  const s = String(raw);
  if (!/^\d+$/.test(s)) return Number(s) || 0;
  const d = Number.isFinite(decimals) ? decimals : 18;
  const big = BigInt(s);
  const base = BigInt(10) ** BigInt(d);
  const whole = Number(big / base);
  const frac = Number(big % base) / Number(base);
  return whole + frac;
}

export async function fetchNativeBalance(address: string, signal?: AbortSignal): Promise<TokenBalance> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [address, "latest"],
    }),
    signal,
  });
  if (!res.ok) throw new Error(`ink rpc eth_getBalance → ${res.status}`);
  const payload = (await res.json()) as { result?: string };
  const wei = payload.result ? BigInt(payload.result).toString() : "0";
  return {
    address: "native",
    symbol: INK_CHAIN.currency.symbol,
    name: INK_CHAIN.currency.name,
    decimals: INK_CHAIN.currency.decimals,
    amount: toAmount(wei, INK_CHAIN.currency.decimals),
    usd: null,
  };
}

type RawTokenBalance = {
  value: string;
  token: {
    address?: string;
    address_hash?: string;
    symbol?: string | null;
    name?: string | null;
    decimals?: string | null;
    exchange_rate?: string | null;
    type?: string;
  };
};

export async function fetchTokenBalances(address: string, signal?: AbortSignal): Promise<TokenBalance[]> {
  const rows = await getJson<RawTokenBalance[]>(
    `${API}/addresses/${address}/token-balances`,
    signal,
  );
  return rows
    .filter((r) => (r.token.type ?? "ERC-20") === "ERC-20")
    .map((r) => {
      const decimals = Number(r.token.decimals ?? 18);
      const amount = toAmount(r.value, decimals);
      const rate = r.token.exchange_rate ? Number(r.token.exchange_rate) : null;
      return {
        address: (r.token.address ?? r.token.address_hash ?? "").toLowerCase(),
        symbol: r.token.symbol ?? "?",
        name: r.token.name ?? r.token.symbol ?? "Unknown token",
        decimals,
        amount,
        usd: rate != null && Number.isFinite(rate) ? rate : null,
      };
    })
    .filter((t) => t.amount > 0)
    .sort((a, b) => (b.usd ?? 0) * b.amount - (a.usd ?? 0) * a.amount);
}

type RawTransfer = {
  transaction_hash?: string;
  tx_hash?: string;
  log_index?: number | string;
  block_number?: number;
  timestamp?: string;
  from?: { hash?: string };
  to?: { hash?: string };
  total?: { value?: string; decimals?: string };
  token?: { symbol?: string | null; decimals?: string | null };
};

/** ERC-20 transfer history, newest first. `sinceBlock` enables cheap re-syncs. */
export async function fetchTokenTransfers(
  address: string,
  sinceBlock?: number | null,
  signal?: AbortSignal,
): Promise<ChainTransfer[]> {
  const payload = await getJson<{ items?: RawTransfer[] }>(
    `${API}/addresses/${address}/token-transfers?type=ERC-20`,
    signal,
  );
  const me = address.toLowerCase();
  return (payload.items ?? [])
    .map((it, i) => {
      const decimals = Number(it.total?.decimals ?? it.token?.decimals ?? 18);
      const from = (it.from?.hash ?? "").toLowerCase();
      const to = (it.to?.hash ?? "").toLowerCase();
      return {
        txHash: it.transaction_hash ?? it.tx_hash ?? `unknown-${i}`,
        logIndex: Number(it.log_index ?? i),
        symbol: it.token?.symbol ?? "?",
        decimals,
        amount: toAmount(it.total?.value, decimals),
        direction: (to === me ? "in" : "out") as "in" | "out",
        counterparty: to === me ? from : to,
        ts: it.timestamp ? Date.parse(it.timestamp) : Date.now(),
        blockNumber: it.block_number ?? null,
      };
    })
    .filter((t) => t.amount > 0 && (sinceBlock == null || (t.blockNumber ?? 0) > sinceBlock));
}

/** Full read for one wallet. Legs settle independently so one 404 isn't fatal. */
export async function readWallet(
  walletId: string,
  address: string,
  sinceBlock?: number | null,
  signal?: AbortSignal,
): Promise<WalletSnapshot> {
  const [native, tokens, transfers] = await Promise.allSettled([
    fetchNativeBalance(address, signal),
    fetchTokenBalances(address, signal),
    fetchTokenTransfers(address, sinceBlock, signal),
  ]);
  const warnings: string[] = [];
  const reason = (r: PromiseSettledResult<unknown>) =>
    r.status === "rejected" ? String((r.reason as Error)?.message ?? r.reason) : null;
  for (const r of [native, tokens, transfers]) {
    const m = reason(r);
    if (m) warnings.push(m);
  }
  return {
    walletId,
    address,
    native:
      native.status === "fulfilled"
        ? native.value
        : {
            address: "native",
            symbol: INK_CHAIN.currency.symbol,
            name: INK_CHAIN.currency.name,
            decimals: 18,
            amount: 0,
            usd: null,
          },
    tokens: tokens.status === "fulfilled" ? tokens.value : [],
    transfers: transfers.status === "fulfilled" ? transfers.value : [],
    fetchedAt: Date.now(),
    warnings,
  };
}
