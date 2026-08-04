// Wallet model. Wallets are split by provenance:
//   read   — an address pasted in for read-only tracking
//   live   — a "signed" wallet (mocked: no real signer yet)
// Exactly ONE wallet is active at a time. `visible` is the storage-level
// encoding of that: the active wallet is the only one with visible: true.
// Multi-wallet aggregation is deliberately out of scope for now.

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

/** The single active wallet, or null when nothing is being tracked. */
export function activeWallet(wallets: Wallet[]): Wallet | null {
  return wallets.find((w) => w.visible && isValidAddress(w.address)) ?? null;
}

/** Make exactly one wallet active; everything else is unloaded. */
export function withActiveWallet(wallets: Wallet[], id: string): Wallet[] {
  return wallets.map((w) => ({ ...w, visible: w.id === id }));
}

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
