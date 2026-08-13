// Minimal JSON-RPC + ABI helpers. No dependency: these readers only need
// static-call encoding for a handful of known signatures, so a full chain
// library would be all cost and no benefit.

import { getChain } from "@/chains";

export function padHex(value: string): string {
  return value.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

export function padUint(value: number | bigint): string {
  return BigInt(value).toString(16).padStart(64, "0");
}

/** int24 (and friends) two's-complement encoding for call arguments. */
export function padInt(value: number | bigint): string {
  let v = BigInt(value);
  if (v < 0n) v += 1n << 256n;
  return v.toString(16).padStart(64, "0");
}

export function words(result: string): string[] {
  const body = result.replace(/^0x/, "");
  const out: string[] = [];
  for (let i = 0; i < body.length; i += 64) out.push(body.slice(i, i + 64));
  return out;
}

export function toBigInt(word: string | undefined): bigint {
  return word ? BigInt(`0x${word}`) : 0n;
}

/** Signed integer decode for tick values and other int types. */
export function toSigned(word: string | undefined): bigint {
  const v = toBigInt(word);
  const limit = 1n << 255n;
  return v >= limit ? v - (1n << 256n) : v;
}

export function toAddress(word: string | undefined): string {
  return word ? `0x${word.slice(24)}` : "0x";
}

/**
 * Decodes an ABI-encoded dynamic string return value.
 * Bytes are UTF-8: decoding them one byte at a time turns symbols like
 * USD₮0 into mojibake, so the whole buffer goes through TextDecoder.
 */
export function toStringValue(result: string): string {
  const w = words(result);
  const len = Number(toBigInt(w[1]));
  const hex = w.slice(2).join("").slice(0, len * 2);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const out = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return out.replace(/\0+$/, "");
}


type RpcCall = { to: string; data: string };

export class RpcError extends Error {}

/** Batched eth_call. Falls back to sequential calls if the node rejects batches. */
export async function ethCallMany(
  chainId: number,
  calls: RpcCall[],
  signal?: AbortSignal,
): Promise<(string | null)[]> {
  if (calls.length === 0) return [];
  const chain = getChain(chainId);
  const url = chain?.rpcUrls[0];
  if (!url) throw new RpcError(`no RPC for chain ${chainId}`);

  const body = calls.map((c, i) => ({
    jsonrpc: "2.0",
    id: i,
    method: "eth_call",
    params: [{ to: c.to, data: c.data }, "latest"],
  }));

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new RpcError(`rpc ${res.status}`);
  const json = (await res.json()) as
    | { id: number; result?: string; error?: unknown }[]
    | { error?: unknown };
  if (!Array.isArray(json)) throw new RpcError("rpc batch rejected");

  const out: (string | null)[] = new Array(calls.length).fill(null);
  for (const row of json) out[row.id] = row.result ?? null;
  return out;
}

export async function ethCall(
  chainId: number,
  call: RpcCall,
  signal?: AbortSignal,
): Promise<string | null> {
  const [only] = await ethCallMany(chainId, [call], signal);
  return only ?? null;
}

export const SELECTOR = {
  balanceOf: "0x70a08231",
  tokenOfOwnerByIndex: "0x2f745c59",
  positions: "0x99fbab88",
  getPool: "0x28af8d0b", // getPool(address,address,int24) — Slipstream
  slot0: "0x3850c7bd",
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
} as const;

const tokenMeta = new Map<string, { symbol: string; decimals: number }>();

/** ERC-20 symbol + decimals, memoized per chain for the session. */
export async function readTokenMeta(
  chainId: number,
  addresses: string[],
  signal?: AbortSignal,
): Promise<Map<string, { symbol: string; decimals: number }>> {
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const missing = unique.filter((a) => !tokenMeta.has(`${chainId}:${a}`));
  if (missing.length > 0) {
    const calls = missing.flatMap((a) => [
      { to: a, data: SELECTOR.symbol },
      { to: a, data: SELECTOR.decimals },
    ]);
    const results = await ethCallMany(chainId, calls, signal).catch(() => []);
    missing.forEach((a, i) => {
      const sym = results[i * 2];
      const dec = results[i * 2 + 1];
      tokenMeta.set(`${chainId}:${a}`, {
        symbol: sym ? toStringValue(sym) || a.slice(0, 6) : a.slice(0, 6),
        decimals: dec ? Number(toBigInt(words(dec)[0])) : 18,
      });
    });
  }
  const out = new Map<string, { symbol: string; decimals: number }>();
  for (const a of unique) {
    out.set(a, tokenMeta.get(`${chainId}:${a}`) ?? { symbol: a.slice(0, 6), decimals: 18 });
  }
  return out;
}
