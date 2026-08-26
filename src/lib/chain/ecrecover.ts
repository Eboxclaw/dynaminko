// On-chain signature verification for thesis attestations.
//
// EIP-191: personal_sign signs keccak("\x19Ethereum Signed Message:\n" +
// byteLength + message). The ecrecover precompile (0x...0002) takes that 32
// byte hash plus the signature and returns the signer address. It is an EVM
// precompile, so we call it on Ink mainnet even though the wallet may have
// signed on any chain. Read-only, no gas, no state.
//
// A recovered address that does not match the stored one means the signature
// was not made by that wallet (or the message changed) — the caller surfaces
// the mismatch instead of trusting the stored value.

import { keccak_256 } from "@noble/hashes/sha3.js";

import { ethCall } from "@/lib/venues/evm";

/** ecrecover is identical on every EVM chain, so any Ink node works. */
const CHAIN = 57073;
const EC_RECOVER = "0x0000000000000000000000000000000000000002";

const word = (hex: string) => hex.replace(/^0x/, "").padStart(64, "0");

/** 32 byte EIP-191 hash of a personal_sign message. */
export function eip191Hash(message: string): string {
  const msg = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(
    `\u0019Ethereum Signed Message:\n${msg.length}`,
  );
  const joined = new Uint8Array(prefix.length + msg.length);
  joined.set(prefix);
  joined.set(msg, prefix.length);
  return "0x" + Array.from(keccak_256(joined)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Recover the signer address for a personal_sign (message, signature) pair.
 * Returns null on any failure (no wallet, no RPC, malformed sig) — never
 * throws. The recovered address is lowercase. */
export async function recoverSigner(
  message: string,
  signature: string,
  signal?: AbortSignal,
): Promise<string | null> {
  let sig = signature.toLowerCase().replace(/^0x/, "");
  if (sig.length === 130) sig = "00" + sig; // some wallets drop one byte
  if (sig.length !== 132) return null;
  const r = sig.slice(0, 64);
  const s = sig.slice(64, 128);
  let v = Number.parseInt(sig.slice(128, 130), 16);
  if (v < 27) v += 27;
  if (v !== 27 && v !== 28) return null;

  const hash = eip191Hash(message);
  const data = "0x" + word(hash) + word(v.toString(16)) + word(r) + word(s);
  try {
    const result = await ethCall(CHAIN, { to: EC_RECOVER, data }, signal);
    if (!result) return null;
    const hex = result.replace(/^0x/, "");
    if (hex.length !== 64) return null;
    return "0x" + hex.slice(24).toLowerCase();
  } catch {
    return null;
  }
}
