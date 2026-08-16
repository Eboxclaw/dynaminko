# tool group: chain, portfolio, market, venues

Purpose: read-only external data. No execution anywhere in this group today.

| tool                                                    | access   | inputs              | output            | live | approval                           | logged   |
| ------------------------------------------------------- | -------- | ------------------- | ----------------- | ---- | ---------------------------------- | -------- |
| chain.transfers                                         | EXTERNAL | `{address,chainId}` | `ChainTransfer[]` | yes  | pre-authorised (watching a wallet) | optional |
| portfolio.read                                          | READ     | none                | `Portfolio`       | yes  | no                                 | optional |
| market.quote                                            | EXTERNAL | `{symbols[]}`       | `Quote[]`         | yes  | pre-authorised                     | optional |
| hyperliquid.read                                        | EXTERNAL | `{address}`         | `VenuePosition[]` | yes  | pre-authorised                     | optional |
| velodrome.read / inkyswap.read / nado.read / tydro.read | EXTERNAL | `{address}`         | `VenuePosition[]` | no   | pre-authorised                     | optional |
| \*.execute (all venues)                                 | EXECUTE  | —                   | —                 | no   | explicit                           | always   |

Rule: `*.execute` is declared so the registry is honest about scope, and is never offered in the UI while `live: false`.

Venue action reads (not registry tools — they feed the extractor, like `chain.transfers`):
the venues worker also extracts historical actions per wallet — Nado Archive `orders`
(one card per order digest, subaccounts chunked ≤5) plus `events` for
`deposit_collateral` / `withdraw_collateral` (amount = post−pre balance diff; deposits
move through per-user direct deposit addresses, so EVM counterparty matching cannot see
them), and Hyperliquid `userFills` folded per order id (master address; 1CT agent fills
attribute to the master) joined with `historicalOrders` for TP/SL tagging, plus
`userNonFundingLedgerUpdates` `deposit`/`withdrawal` deltas (user-to-user spot transfers
are skipped).

Example call:

```json
{ "tool": "market.quote", "input": { "symbols": ["ETH", "USDC"] } }
```
