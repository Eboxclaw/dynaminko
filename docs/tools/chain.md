# tool group: chain, portfolio, market, venues

Purpose: read-only external data. No execution anywhere in this group today.

| tool | access | inputs | output | live | approval | logged |
| --- | --- | --- | --- | --- | --- | --- |
| chain.transfers | EXTERNAL | `{address,chainId}` | `ChainTransfer[]` | yes | pre-authorised (watching a wallet) | optional |
| portfolio.read | READ | none | `Portfolio` | yes | no | optional |
| market.quote | EXTERNAL | `{symbols[]}` | `Quote[]` | yes | pre-authorised | optional |
| hyperliquid.read | EXTERNAL | `{address}` | `VenuePosition[]` | yes | pre-authorised | optional |
| velodrome.read / inkyswap.read / nado.read / tydro.read | EXTERNAL | `{address}` | `VenuePosition[]` | no | pre-authorised | optional |
| \*.execute (all venues) | EXECUTE | — | — | no | explicit | always |

Rule: `*.execute` is declared so the registry is honest about scope, and is never offered in the UI while `live: false`.

Example call:

```json
{ "tool": "market.quote", "input": { "symbols": ["ETH", "USDC"] } }
```
