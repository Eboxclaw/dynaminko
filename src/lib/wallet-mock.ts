// Deterministic staged positions derived from a pasted 0x address. No chain
// calls — the same address always yields the same portfolio so demos are
// reproducible. Replace with an Ink Chain RPC read in the live pass.

import { ASSETS } from "./dynaminko-data";

export function isValidAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr.trim());
}

export function shortenAddress(addr: string): string {
  if (!addr) return "";
  const a = addr.trim();
  if (a.length < 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

// FNV-1a hash → deterministic seed per address
function seedFromAddress(addr: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < addr.length; i++) {
    h ^= addr.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Positions map: ticker -> qty held by wallet. */
export function positionsForAddress(addr: string): Record<string, number> {
  const seed = seedFromAddress(addr.toLowerCase());
  const out: Record<string, number> = {};
  // Deterministic pseudo-random per ticker
  ASSETS.forEach((a, i) => {
    const x = Math.sin(seed + i * 97.13) * 10000;
    const r = x - Math.floor(x);            // 0..1
    const held = r < 0.35;                   // ~65% held rate
    if (!held) {
      out[a.ticker] = 0;
      return;
    }
    // Target USD notional 500 .. 90k, scale by price -> qty
    const usd = 500 + r * 90000;
    out[a.ticker] = +(usd / a.price).toFixed(a.price > 1000 ? 4 : a.price > 10 ? 2 : 0);
  });
  return out;
}
