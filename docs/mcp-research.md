# MCP research · Nado and Hyperliquid trading for this stack

Phase 7 per HANDOVER.md, researched 2026-09-12. Research before code;
the implementation plan at the end is the proposal to review.

## What already exists in this repo (checked, not assumed)

- venues layer: velodrome.ts, nado.ts, tydro.ts, hyperliquid.ts, evm.ts,
  actions.ts. Live readers cover velodrome, hyperliquid, nado, tydro
  (registry VENUES + LIVE_VENUE_READERS); inkyswap is the only venue
  without a live reader.
- Nado is already integrated for reads: actions.ts POSTs to
  `https://archive.prod.nado.xyz/v1` (the archive node) for fills and
  orders, nado.ts reads subaccounts and symbols.
- Hyperliquid reads: readHyperliquid (positions/fills) and
  readHyperliquidActions via its info API.
- The tools registry exposes venue reads as capabilities; the S7/S9
  roadmap items (more venue reads, then approval-gated /trade) are the
  shipping targets.

## Research findings

### Hyperliquid

- Its own L1 (not EVM): REST info endpoint
  `https://api.hyperliquid.xyz/info` (public, browser-fetchable, no
  key) plus `exchange` endpoints that require Hyperliquid-specific
  signed actions (secp256k1 private key, EIP-712-like but HL's own
  scheme — not our injected EIP-1193 wallet path).
- MCP servers exist in number: 6rz6/HYPERLIQUID-MCP-Server (8 trading
  tools), dakkshin/hyperliquid-mcp (official Python SDK, local
  signing), Chainstack's server, junct-bot (risk-managed trading),
  TradingBalthazar (full SDK wrapper). Common tool shapes across all
  of them: market data (prices, orderbook, OHLCV), account
  (positions, margin, balance), order placement with local signing,
  cancel/modify.

### Nado

- CLOB perp + spot DEX on Ink L2, built on the Vertex Protocol engine:
  off-chain sequencer, on-chain settlement, unified margin, up to 20x
  leverage (docs.nado.xyz, DeFiLlama, Alear Research).
- Signing is EVM-native: orders are EIP-712 structures signed by the
  trader's wallet ON INK — exactly the wallet path this app already
  hand-rolls (evm.ts, injected EIP-1193). No extra private key
  management needed.
- An MCP server exists for Nado/Vertex-engine venues (moltiverse-mcp,
  per LobeHub); the community is younger than Hyperliquid's.
- This app already speaks Nado's archive API for history; the same
  node family serves market and account queries.

### The architecture fact that decides the design

MCP servers are host processes (Node/Python over stdio or HTTP). A
browser PWA cannot run them, and shipping a companion server would
break the local-first, no-backend rule. But MCP servers are only a
tool catalogue with typed calls — and this app already has the same
thing: the capability registry, the compact book the small models
read, and the decide hop that picks one tool per hop. So we do not
adopt MCP as a runtime; we adopt the MCP servers' TOOL SHAPES as
registry entries, compact and categorized, per the handover's
"indexed MCP surface: compact index + small dedicated calls ...
equip-on-decide".

## Implementation plan for this stack

Phase A · reads (browser-safe, no keys, shippable now):
- hyperliquid.market: prices/orderbook/OHLCV from the public info
  endpoint (new capability, same fetch pattern as readHyperliquid).
- nado.market: price/depth from the Nado node/archive family.
- Both as small dedicated capabilities in the existing "portfolio"/
  market category so the 230M/350M pick them with the compact book.

Phase B · execution (S9, approval-gated, Nado first):
- Nado: order placement as a write-approval capability — the user
  sees the full order, approves, the injected wallet signs EIP-712 on
  Ink, no key custody in the app. This fits the wallet model and the
  approval card flow that already exists.
- Hyperliquid execution: needs an HL signer strategy (session key
  versus full key custody in-browser is a risk decision for the user);
  keep read-only until that design exists.

Phase C · equip-on-decide:
- The trading capabilities ride the compact index with per-venue
  categorization; decide picks one; writes always surface the approval
  card. Junk-query and repeat guards already apply (same-tool cap,
  search-input rule).

## Training note

Distillation/PEFT/GRPO items stay last (user rule): they are offline,
GPU-bound, and ship as a future GGUF only after the trading loop is
proven with the current roster.

## Sources

- Hyperliquid MCP servers:
  https://github.com/6rz6/HYPERLIQUID-MCP-Server
  https://mcpservers.org/servers/dakkshin/hyperliquid-mcp
  https://chainstack.com/ship-faster-with-hyperliquid-mcp/
  https://glama.ai/mcp/servers/junct-bot/hyperliquid-mcp
- Nado: https://docs.nado.xyz/ https://defillama.com/protocol/nado
  https://alearesearch.substack.com/p/nado-unified-trading-stack-on-ink
  https://lobehub.com/mcp/mavrkofficial-moltiverse-mcp
- Paradex MCP as a comparable perp-DEX integration:
  https://mcpmarket.com/server/paradex
