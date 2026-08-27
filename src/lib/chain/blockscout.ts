// Read-only chain access for Ink via its Blockscout explorer API + JSON-RPC.
// No keys, no signing, no writes. Every call takes an explicit ChainConfig so
// the same code serves mainnet and testnet. Runs equally in a Worker or on the
// main thread (fetch + JSON only).

import { getChain, type ChainConfig } from "@/chains";

export type TokenBalance = {
  address: string; // contract, "native" for ETH
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
  ts: number; // ms epoch
  blockNumber: number | null;
};

export type WalletSnapshot = {
  walletId: string;
  address: string;
  chainId: number;
  native: TokenBalance;
  tokens: TokenBalance[];
  transfers: ChainTransfer[];
  fetchedAt: number;
  /** non-fatal problems (one leg failed, cached rest still usable) */
  warnings: string[];
};

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" }, signal });
  if (!res.ok) throw new Error(`${new URL(url).pathname} → ${res.status}`);
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

export async function rpcCall(
  chain: ChainConfig,
  method: string,
  params: unknown[] = [],
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(chain.rpcUrls[0], {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal,
  });
  if (!res.ok) throw new Error(`${chain.shortName} rpc ${method} → ${res.status}`);
  const payload = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message ?? `${method} failed`);
  return payload.result;
}

export async function fetchNativeBalance(
  chain: ChainConfig,
  address: string,
  signal?: AbortSignal,
): Promise<TokenBalance> {
  const result = await rpcCall(chain, "eth_getBalance", [address, "latest"], signal);
  const wei = typeof result === "string" ? BigInt(result).toString() : "0";
  return {
    address: "native",
    symbol: chain.currency.symbol,
    name: chain.currency.name,
    decimals: chain.currency.decimals,
    amount: toAmount(wei, chain.currency.decimals),
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

export async function fetchTokenBalances(
  chain: ChainConfig,
  address: string,
  signal?: AbortSignal,
): Promise<TokenBalance[]> {
  if (!chain.explorerApi) return [];
  const rows = await getJson<RawTokenBalance[]>(
    `${chain.explorerApi}/addresses/${address}/token-balances`,
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
  chain: ChainConfig,
  address: string,
  sinceBlock?: number | null,
  signal?: AbortSignal,
): Promise<ChainTransfer[]> {
  if (!chain.explorerApi) return [];
  const payload = await getJson<{ items?: RawTransfer[] }>(
    `${chain.explorerApi}/addresses/${address}/token-transfers?type=ERC-20`,
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

type RawNativeTx = {
  hash?: string;
  block_number?: number;
  timestamp?: string;
  value?: string;
  from?: { hash?: string };
  to?: { hash?: string };
  status?: string;
};

/** Native ETH movements, so trade detection isn't limited to token transfers. */
export async function fetchNativeTransfers(
  chain: ChainConfig,
  address: string,
  signal?: AbortSignal,
): Promise<ChainTransfer[]> {
  if (!chain.explorerApi) return [];
  const payload = await getJson<{ items?: RawNativeTx[] }>(
    `${chain.explorerApi}/addresses/${address}/transactions?filter=to%20%7C%20from`,
    signal,
  );
  const me = address.toLowerCase();
  const d = chain.currency.decimals;
  return (payload.items ?? [])
    .filter((it) => (it.status ?? "ok") === "ok")
    .map((it, i) => {
      const to = (it.to?.hash ?? "").toLowerCase();
      const from = (it.from?.hash ?? "").toLowerCase();
      return {
        txHash: it.hash ?? `native-${i}`,
        logIndex: -1,
        symbol: chain.currency.symbol,
        decimals: d,
        amount: toAmount(it.value, d),
        direction: (to === me ? "in" : "out") as "in" | "out",
        counterparty: to === me ? from : to,
        ts: it.timestamp ? Date.parse(it.timestamp) : Date.now(),
        blockNumber: it.block_number ?? null,
      };
    })
    .filter((t) => t.amount > 0);
}

/** Full read for one wallet. Legs settle independently so one 404 isn't fatal. */
export async function readWallet(
  walletId: string,
  address: string,
  chainId: number,
  sinceBlock?: number | null,
  signal?: AbortSignal,
): Promise<WalletSnapshot> {
  const chain = getChain(chainId);
  const [native, tokens, transfers, natTransfers] = await Promise.allSettled([
    fetchNativeBalance(chain, address, signal),
    fetchTokenBalances(chain, address, signal),
    fetchTokenTransfers(chain, address, sinceBlock, signal),
    fetchNativeTransfers(chain, address, signal),
  ]);
  const warnings: string[] = [];
  for (const r of [native, tokens, transfers, natTransfers]) {
    if (r.status === "rejected") warnings.push(String((r.reason as Error)?.message ?? r.reason));
  }
  const history = [
    ...(transfers.status === "fulfilled" ? transfers.value : []),
    ...(natTransfers.status === "fulfilled" ? natTransfers.value : []),
  ].sort((a, b) => b.ts - a.ts);

  return {
    walletId,
    address,
    chainId: chain.id,
    native:
      native.status === "fulfilled"
        ? native.value
        : {
            address: "native",
            symbol: chain.currency.symbol,
            name: chain.currency.name,
            decimals: 18,
            amount: 0,
            usd: null,
          },
    tokens: tokens.status === "fulfilled" ? tokens.value : [],
    transfers: history,
    fetchedAt: Date.now(),
    warnings,
  };
}
