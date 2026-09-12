# Handover: findings from the UI pass, 2026-09-12

The UI cleanup session (commit chain 003b7f1..2f40c58) stayed in UI territory
per the standing rule. The items below are runtime or data behavior noticed
during the real-browser walk; they belong to the trading/venues side, so they
are recorded here instead of being fixed in that pass.

## 1. Hyperliquid available balance reads 0 in the order ticket

On /trade?venue=hyperliquid&section=trade the ticket shows
"notional $0.00 · available $0.00" while the same wallet holds USDC on
Hyperliquid (Baskets shows USDC 3.839 held, equity $3.78 on the HL account
card). The Nado ticket shows available $29.57 and works.

Suspect: `a.available` is null or 0 for Hyperliquid account summaries, so
`venueAccounts.reduce((s, a) => s + (a.available ?? 0), 0)` in
src/routes/trade.lazy.tsx (TradePage, available prop) sums to 0. Either the HL
account reader does not fill `available`, or the field means something
different per venue. The 25/50/100 percent size buttons also rely on this
number, so they silently do nothing on HL today.

## 2. Trade tab positions can contradict the Baskets tab

During the walk, Baskets showed an open HYPE-PERP SHORT on Hyperliquid while
/trade?section=positions said "Connect a wallet on the dashboard..." because
no VenueReport for the venue was in the useVenues cache at that moment. The
trade tab only consumes cached reads; it never triggers a refresh itself.
Consider kicking a refresh when the trade tab opens (or a staleness-based
refetch) so both tabs cannot disagree for minutes. The misleading empty text
is fixed UI-side (state-aware now), the data trigger is the open item.

## 3. Venue reads can appear to hang

The header pill "reading venues..." is now gated on isFetching (correct), but
during the walk it stayed visible for minutes. If a venue read can stall
without settling, isFetching never clears. A timeout/watchdog on the readers
(or surfacing a per-venue error state) would keep the pill honest.

## 4. Lazy route titles do not apply on hard loads

Direct SSR loads of /earn, /trade and /settings serve the generic document
title ("Proof of Thesis, an assisted journal for your trades") while eager
routes (/portfolio, /pot, /) set theirs. Every lazy route defines head() and
the settings file documents the cast that makes it merge at runtime, but it
only lands after hydration. If titles on first paint matter, the head blocks
need to move into non-lazy route modules (earn.tsx, trade.tsx, settings.tsx
shells) or the start server needs to await lazy chunks.

## Verification notes for whoever picks these up

- The UI pass runs with the working tree clean of trade changes; nothing in
  src/lib/trade/fees.ts or the venue readers was touched by it.
- reproduce 1 with: connect the test wallet, open the HL order ticket, type a
  size, watch the percent buttons and the available line.
