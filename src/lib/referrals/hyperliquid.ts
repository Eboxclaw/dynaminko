// Hyperliquid referral state reader + setReferrer L1 action.
//
// Single info endpoint surfaces referrer, volume, rewards, and builder fees in
// one payload. setReferrer binds a code programmatically via a signed L1
// action (no dashboard round-trip required, unlike Nado).
//
// The L1-action signature follows the official Python SDK exactly
// (hyperliquid/utils/signing.py): the wallet never signs the action itself —
// it signs a phantom agent { source: "a" (mainnet), connectionId: keccak256(
// msgpack(action) + nonce_be8 + vault_flag) } under the Exchange/1/1337
// domain, and the posted body carries { action, signature, nonce }.
//
// Reference: https://hyperliquid.gitbook.io/hyperliquid-docs/referrals
//            https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint

import { keccak_256 } from "@noble/hashes/sha3.js";

/** The team's referral code: referrer earns 10% of referred fees, referred
 * user gets a 4% discount. Pre-filled in Settings unless the user has saved
 * their own code or is already bound. */
export const TEAM_HL_REFERRAL_CODE = "OFFICIALINKO";

export type HyperliquidReferralState = {
  /** Who referred this user, if anyone. */
  referredBy: { referrer: string; code: string } | null;
  /** Cumulative trading volume in USD. */
  cumVolumeUsd: number;
  unclaimedReferralRewardsUsd: number;
  claimedReferralRewardsUsd: number;
  /** Builder rewards are a separate stream returned in the same payload. */
  builderRewardsUsd: number;
};

const HL_INFO_URL = "https://api.hyperliquid.xyz/info";
const HL_EXCHANGE_URL = "https://api.hyperliquid.xyz/exchange";
const REFERRAL_VOLUME_THRESHOLD = 10_000; // $10k to unlock your own code

/**
 * Queries referral + builder reward state for a Hyperliquid user address.
 * Single payload covers both streams; do not build separate polling for
 * referral vs builder rewards.
 */
export async function getReferralState(
  userAddress: string,
  signal?: AbortSignal,
): Promise<HyperliquidReferralState> {
  const res = await fetch(HL_INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "referral", user: userAddress }),
    signal,
  });
  if (!res.ok) throw new Error(`Hyperliquid referral query failed: ${res.status}`);
  const data = (await res.json()) as {
    referredBy?: { referrer: string; code: string } | null;
    cumVlm?: string;
    unclaimedRewards?: string;
    claimedRewards?: string;
    builderRewards?: string;
  };
  return {
    referredBy: data.referredBy ?? null,
    cumVolumeUsd: Number(data.cumVlm ?? 0),
    unclaimedReferralRewardsUsd: Number(data.unclaimedRewards ?? 0),
    claimedReferralRewardsUsd: Number(data.claimedRewards ?? 0),
    builderRewardsUsd: Number(data.builderRewards ?? 0),
  };
}

/**
 * Returns how far the user is toward unlocking their own referral code, as a
 * fraction of the $10k volume threshold (0..1).
 */
export function referralVolumeProgress(state: HyperliquidReferralState): number {
  return Math.min(state.cumVolumeUsd / REFERRAL_VOLUME_THRESHOLD, 1);
}

/**
 * A signer interface. In practice, pass `window.ethereum`-based typed-data
 * signing; types are kept abstract so this adapter has no wallet dependency.
 */
export interface TypedDataSigner {
  readonly address: string;
  signTypedData(
    domain: unknown,
    types: unknown,
    primaryType: string,
    message: unknown,
  ): Promise<string>;
}

// ── L1-action hashing (mirrors hyperliquid-python-sdk signing.py) ──────────

/**
 * Minimal msgpack encoder covering the value shapes an HL action uses:
 * plain objects (insertion-ordered, like the Python dicts the SDK packs),
 * strings (UTF-8), integers, booleans, null, arrays. Byte-compatible with
 * Python `msgpack.packb` for these types: that equivalence is what makes the
 * action hash — and therefore the signature — valid.
 */
export function msgpackPack(value: unknown): Uint8Array {
  const out: number[] = [];
  const enc = new TextEncoder();
  const write = (bytes: ArrayLike<number>) => {
    for (let i = 0; i < bytes.length; i++) out.push(bytes[i]!);
  };
  const be = (n: number | bigint, len: 2 | 4 | 8): number[] => {
    const view = new DataView(new ArrayBuffer(len));
    if (len === 2) view.setUint16(0, Number(n), false);
    else if (len === 4) view.setUint32(0, Number(n), false);
    else view.setBigUint64(0, BigInt(n), false);
    return [...new Uint8Array(view.buffer)];
  };

  const pack = (v: unknown): void => {
    if (v === null) return write([0xc0]);
    if (v === undefined) return write([0xc0]);
    if (typeof v === "boolean") return write([v ? 0xc3 : 0xc2]);
    if (typeof v === "number") {
      if (!Number.isInteger(v)) throw new Error("msgpack: floats are not supported");
      if (v >= 0) {
        if (v < 0x80) return write([v]);
        if (v <= 0xff) return write([0xcc, v]);
        if (v <= 0xffff) return write([0xcd, ...be(v, 2)]);
        if (v <= 0xffff_ffff) return write([0xce, ...be(v, 4)]);
        return write([0xcf, ...be(BigInt(v), 8)]);
      }
      if (v >= -32) return write([v & 0xff]);
      if (v >= -128) return write([0xd0, v & 0xff]);
      if (v >= -32768) return write([0xd1, ...be(v & 0xffff, 2)]);
      if (v >= -2147483648) return write([0xd2, ...be(v & 0xffff_ffff, 4)]);
      return write([0xd3, ...be(BigInt(v), 8)]);
    }
    if (typeof v === "bigint") {
      if (v >= 0n && v <= 0xffff_ffff_ffff_ffffn) return write([0xcf, ...be(v, 8)]);
      throw new Error("msgpack: bigint out of range");
    }
    if (typeof v === "string") {
      const bytes = enc.encode(v);
      const len = bytes.length;
      if (len < 32) out.push(0xa0 | len);
      else if (len < 256) out.push(0xd9, len);
      else if (len < 65536) out.push(0xda, ...be(len, 2));
      else out.push(0xdb, ...be(len, 4));
      return write(bytes);
    }
    if (Array.isArray(v)) {
      const len = v.length;
      if (len < 16) out.push(0x90 | len);
      else if (len < 65536) out.push(0xdc, ...be(len, 2));
      else out.push(0xdd, ...be(len, 4));
      for (const item of v) pack(item);
      return;
    }
    if (typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>);
      const len = entries.length;
      if (len < 16) out.push(0x80 | len);
      else if (len < 65536) out.push(0xde, ...be(len, 2));
      else out.push(0xdf, ...be(len, 4));
      for (const [k, item] of entries) {
        pack(k);
        pack(item);
      }
      return;
    }
    throw new Error(`msgpack: unsupported value ${typeof v}`);
  };

  pack(value);
  return new Uint8Array(out);
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * The L1 action hash the SDK computes before signing:
 * keccak256( msgpack(action) + nonce_be8 + vault_flag ), where the vault flag
 * is 0x00 for a plain account (no vault) — the only case this app signs.
 */
export function l1ActionHash(
  action: unknown,
  nonce: number,
  vaultAddress: string | null = null,
): Uint8Array {
  const nonceBe = new Uint8Array(8);
  new DataView(nonceBe.buffer).setBigUint64(0, BigInt(nonce), false);
  const vault = vaultAddress
    ? new Uint8Array([0x01, ...hexToBytes(vaultAddress)])
    : new Uint8Array([0x00]);
  const packed = msgpackPack(action);
  const data = new Uint8Array(packed.length + nonceBe.length + vault.length);
  data.set(packed, 0);
  data.set(nonceBe, packed.length);
  data.set(vault, packed.length + nonceBe.length);
  return keccak_256(data);
}

const L1_DOMAIN = {
  name: "Exchange",
  version: "1",
  chainId: 1337,
  verifyingContract: "0x0000000000000000000000000000000000000000",
};
const AGENT_TYPES = {
  Agent: [
    { name: "source", type: "string" },
    { name: "connectionId", type: "bytes32" },
  ],
};

/**
 * Binds this user's account to a referral code via a signed L1 action.
 *
 * This does NOT require a dashboard visit. The signature follows the SDK's
 * phantom-agent scheme: the typed-data message is { source: "a" (mainnet),
 * connectionId: 0x<prefixed keccak of the packed action + nonce + vault flag> }
 * — never the action itself — and the posted body is
 * { action, signature, nonce } with the same nonce used in the hash.
 *
 * Returns { ok: true } on success, or { ok: false, error: string } on failure.
 */
export async function setReferrer(
  signer: TypedDataSigner,
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const nonce = Date.now();
  // Key order matters: msgpack packs the map in insertion order, and the
  // Python SDK builds {type, code} — keep the same order.
  const action = { type: "setReferrer" as const, code };
  const hash = l1ActionHash(action, nonce, null);
  const phantomAgent = { source: "a", connectionId: `0x${toHex(hash)}` };

  const signature = await signer.signTypedData(L1_DOMAIN, AGENT_TYPES, "Agent", phantomAgent);

  const res = await fetch(HL_EXCHANGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, signature, nonce }),
  });
  const body = (await res.json()) as { status?: string; response?: string };
  if (body.status !== "ok") {
    return { ok: false, error: body.response ?? "setReferrer rejected" };
  }
  return { ok: true };
}
