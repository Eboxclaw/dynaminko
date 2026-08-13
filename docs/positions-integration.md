# Positions integration spec — Velodrome, InkySwap, Nado, Hyperliquid

Verified August 12, 2026. None of the readers below exist in `src/` yet apart from
Hyperliquid (`src/lib/venues/index.ts`). Addresses and endpoints were taken from each
protocol's own current documentation; re-verify before a production deploy.

## Wallet model

| Role | Purpose | Chain | Data model |
| --- | --- | --- | --- |
| Main read wallet | Ink reads today (`readWallet()`), and the identity used for Hyperliquid | Ink 57073 + Hyperliquid | one `WalletRef`, `chainId: 57073` |
| Trading account | A Nado subaccount or Hyperliquid vault/subaccount the user opts to track | Ink or Hyperliquid | extra `WalletRef`, `kind: "watch"`, plus a parent link |

The add button reads "track a trading account", not "add a wallet": Nado and Hyperliquid
subaccounts are sub-identifiers under one signing address, not separate EOAs.

## Velodrome (Ink 57073)

| Contract | Address |
| --- | --- |
| Slipstream NonFungiblePositionManager | `0xefD0f78F93f578036AE34D52A813a4BE7D8D2D52` |
| Slipstream pool factory | `0x718E46d0962A66942E233760a8bd6038Ce54EdCD` |
| Slipstream Sugar helper | `0x116bb1E5E57c9fA95a29aA50Eb1edb352446C089` |
| V2 pool factory | `0x31832f2a97Fd20664D76Cc421207669b55CE4BC0` |
| V2 router | `0x3a63171DD9BebF4D07BC782FECC7eb0b890C2A45` |
| V2 voter | `0x97cDBCe21B6fd0585d29E539B1B99dAd328a1123` |

- CL positions: `balanceOf` + `tokenOfOwnerByIndex` + `positions(tokenId)` on the Position
  Manager. N+1 reads; the Sugar helper exists to batch this — check its ABI first.
- V2 positions: `balanceOf` on each pool's ERC-20 LP token, which needs a pool list.
- No wallet-scoped Ink indexer confirmed. Check `docs.inkonchain.com/tools/indexers`.
- Resolve factories at runtime where possible; Velodrome ships new ones.

## InkySwap / InkyPump (Ink 57073)

Not an AMM in the Velodrome sense: a bonding-curve launchpad that graduates tokens into
Uniswap V4 pools.

| Contract | Address |
| --- | --- |
| InkyPumpHook (proxy) | `0x4cC8F6d5B7cE150CCC0A9B7664532B1283b96AC4` |
| Uniswap V4 PoolManager | `0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32` |
| Uniswap V4 PositionManager | `0x1b35d13a2E2528f192637F14B05f0Dc0e7dEB566` |
| Uniswap V4 StateView | `0x76Fd297e2D437cd7f76d50F01AfE6160f86e9990` |
| Uniswap V4 Quoter | `0x3972C00f7ed4885e145823eb7C655375d275A1C5` |

- REST, no auth: `GET https://inkypump.com/api/tokens/by-owner?owner=0x…` (tokens created),
  `GET https://inkyswap.com/api/pairs` (pool-level, not wallet-scoped).
- No wallet-scoped LP endpoint. Read positions as Uniswap V4 NFTs on the Position Manager.
- TVL ≈ $633K. Lowest read priority of the four.

## Nado (Ink) — spot, perps, unified margin

| Service | Base URL |
| --- | --- |
| Gateway REST | `https://gateway.prod.nado.xyz/v1` and `/v2` |
| Archive REST | `https://archive.prod.nado.xyz/v1` and `/v2` |

No auth and no signing for reads.

1. Subaccounts: POST Archive `{"subaccounts":{"address":"0x…"}}` → `id`, packed subaccount
   bytes32, `subaccount_name`, isolated flag.
2. Positions: POST Gateway `{"type":"subaccount_info","subaccount":"<packed>"}` →
   `spot_balances` (signed: negative = borrow), `perp_balances` (signed size + virtual
   quote for cost basis), three health tiers, and embedded product metadata.
3. History: the Archive Portfolio query returns value, PnL and activity per timeframe —
   use it directly rather than reconstructing PnL from balance deltas.

Step 1 pre-populates the "track a trading account" button.

## Hyperliquid

Single endpoint: `POST https://api.hyperliquid.xyz/info`, no auth for reads.

| Query | Body | Returns |
| --- | --- | --- |
| Perps | `{"type":"clearinghouseState","user":"0x…"}` | positions (`szi`, `entryPx`, `positionValue`, `unrealizedPnl`, `liquidationPx`, leverage) + `marginSummary` |
| Spot | `{"type":"spotClearinghouseState","user":"0x…"}` | `coin`, `total`, `hold`, `entryNtl` |
| Subaccounts | `{"type":"subAccounts","user":"0x…"}` | each with embedded clearinghouse + spot state |
| Vaults | `{"type":"userVaultEquities","user":"0x…"}` | vault equity |

Same address as the Ink read wallet. Hyperliquid runs on HyperCore/HyperEVM: route it
through its own reader keyed off `chainId`, never through Blockscout logic.

## Data model changes

- `WalletRef`: one new optional field expressing "subaccount/vault under a parent" —
  parent address plus the venue subaccount identifier. Without it, a tracked subaccount
  looks like an unrelated wallet and the POT Index loses the one-person framing.
- New `Position` type, separate from token balances: `venue`
  (`velodrome | inkyswap | nado | hyperliquid`), `kind`
  (`lp-concentrated | lp-constant-product | spot | perp`), venue-specific identity
  (NFT id + tick range, `product_id`, or coin), and a common subset every journal entry
  can reason about: notional value and unrealized PnL where the venue reports one.
- Worker placement: extend the existing market/read worker, no new worker. Each venue
  settles independently via `Promise.allSettled`, as `readWallet()` already does.

## Open questions before building

1. Slipstream Sugar's exact read functions — direct ABI check needed.
2. Whether a hosted Ink indexer exists for Velodrome, or raw contract reads are the path.
3. InkySwap has no indexer shortcut and the smallest likely share — deprioritize.
4. LP PnL (Velodrome, InkySwap) is materially harder than Nado/Hyperliquid, which report
   it directly. Its own follow-up spec once position reads land.

## Implementation status

| Venue | Reader | State |
| --- | --- | --- |
| Nado | `src/lib/venues/nado.ts` | Live. Archive v1 subaccount discovery + Gateway state; perps, spot, equity/health. |
| Hyperliquid | `src/lib/venues/hyperliquid.ts` | Live. Perps, spot, subaccounts and vault equity. |
| Velodrome | `src/lib/venues/velodrome.ts` | Live. Slipstream NFT enumeration → `positions` → factory pool → `slot0`; token amounts + in/out of range. USD not priced. |
| InkySwap | — | Pending. Uniswap V4 position read not wired. |

Shared model in `src/lib/venues/types.ts`: `Position` (perp / spot / lp-*) and
`AccountSummary` (equity, margin, health). Net worth = wallet balances +
account equity only; perp notional is exposure, never added to net worth.
LP amounts are reported without USD because no price source is trusted for
those pairs yet.
