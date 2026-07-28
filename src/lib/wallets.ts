// Multi-wallet model. Wallets are split by provenance:
//   read  — an address pasted in for read-only tracking
//   live  — a "connected" wallet (mocked: no real signer yet)
// Each wallet has a visibility flag; the dashboard aggregates positions
// across every visible wallet regardless of kind.

import { ASSETS } from "./dynaminko-data";
import { isValidAddress, positionsForAddress } from "./wallet-mock";

export type WalletKind = "read" | "live";

export type Wallet = {
  id: string;
  address: string;
  label: string;
  kind: WalletKind;
  visible: boolean;
  addedAt: number;
};

export function newWalletId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Math.random()).slice(2);
}

// Deterministic label from an address ("Vault A7F3") so users can distinguish
// pasted addresses without having to name them manually.
export function autoLabel(addr: string, kind: WalletKind) {
  const tail = addr.slice(-4).toUpperCase();
  return `${kind === "live" ? "Live" : "Read"} ${tail}`;
}

export function mockLiveAddress(): string {
  const hex = "0123456789abcdef";
  let out = "0x";
  for (let i = 0; i < 40; i++) out += hex[Math.floor(Math.random() * 16)];
  return out;
}

/** Merged positions across every visible wallet. */
export function positionsForWallets(wallets: Wallet[]): Record<string, number> | null {
  const active = wallets.filter((w) => w.visible && isValidAddress(w.address));
  if (active.length === 0) return null;
  const merged: Record<string, number> = {};
  for (const a of ASSETS) merged[a.ticker] = 0;
  for (const w of active) {
    const p = positionsForAddress(w.address);
    for (const [k, v] of Object.entries(p)) merged[k] = (merged[k] ?? 0) + v;
  }
  return merged;
}
