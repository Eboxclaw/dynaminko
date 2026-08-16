// Logo registry — local assets only, no network cost at runtime.
//
// Venues ship today. The token map is deliberately empty: when token logos
// land, key entries by baseSymbol() output (see sectors.ts) so venue-suffixed
// spellings (-PERP, w…x) resolve to one asset.

/** venue id → local logo asset */
export const VENUE_LOGOS: Record<string, string> = {
  velodrome: "/logos/velodrome.svg",
  inkyswap: "/logos/inkyswap.svg",
  nado: "/logos/nado.png",
  hyperliquid: "/logos/hyperliquid.svg",
};

/** token base symbol → local logo asset. Empty until token logos land. */
export const TOKEN_LOGOS: Record<string, string> = {};

export function venueLogo(id: string): string | null {
  return VENUE_LOGOS[id] ?? null;
}

export function tokenLogo(base: string): string | null {
  return TOKEN_LOGOS[base.trim().toUpperCase()] ?? null;
}
