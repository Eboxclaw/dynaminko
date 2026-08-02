# Dynaminko — Live data, network switching, agent console, nav fixes

Four workstreams. Everything stays browser-first and local-first: no backend, no signing, no funds at risk.

## 1. Network switcher (mainnet / Ink Sepolia)

- Extend `src/chains/ink.ts` into a small registry exporting both networks in the same `ChainConfig` shape, plus a resolver so nothing downstream hardcodes an RPC or explorer URL.
- Add a network state (persisted in localStorage) exposed through the chain context; the top bar connection pill becomes a switcher showing "Connected to Ink Chain" / "Ink Sepolia" with a live block height and latency dot.
- Every read path — balances, transfers, explorer links, gas, the public data strip — takes the active network from context instead of the current single constant. Snapshot cache keys are namespaced per chain ID so switching never shows the other network's balances.
- Verify against both endpoints with a real request before calling it done; if Sepolia's explorer API differs, fall back to plain JSON-RPC reads for balances there.

## 2. Removing mock data / wiring real reads

Current state: wallet balances and transfers already come from the Ink explorer, but prices, market rows, order books, and Vault positions are still fixture-backed.

- **Prices**: widen the CoinGecko-backed feed to cover every crypto asset in the universe, and mark tokenized-equity rows explicitly as "indicative" rather than pretending they are live.
- **Markets**: research Nado's public market-data endpoints and, where they exist, drive the asset rows (last price, 24h change, funding) and the order book depth panel from them. Where no public endpoint exists, the panel says so via the existing data-source strip instead of rendering invented depth.
- **Vault**: replace the fixture APYs with the DefiLlama pool data already reachable, per supported asset.
- **Journal**: keep ingesting real ERC-20 transfers; extend to native ETH transfers and swap detection so trade events aren't limited to token moves.
- Anything that cannot be sourced live is labelled as staged and reachable only via the existing demo toggle — no silently fake numbers.

## 3. Wallet connect (read-only, injected)

- Add an EIP-1193 connector with zero dependencies: `eth_requestAccounts`, `chainId` watch, `accountsChanged` / `chainChanged` listeners, and a `wallet_switchEthereumChain` prompt when the wallet is on the wrong network.
- A connected wallet becomes a `kind: "live"` entry in the existing wallet list and flows through the same read pipeline as pasted addresses.
- No signing, no transactions. Order tickets remain simulated and are labelled as such.

## 4. Agent console (Agents / Models / Skills / MCP)

New Settings section with a submenu, local-first:

- **Models** — registry of in-browser models (WebGPU / llama.cpp-wasm), showing size, quantization, and whether the runtime probe supports them. Download, cache in the Cache API, show progress, evict. Optional remote provider keys stored in browser storage only, used as fallback when no local model is loaded.
- **Agents** — named agent profiles (system prompt, model binding, enabled skills, temperature), persisted locally. The AI Terminal picks the active agent.
- **Skills** — toggleable capability list the agent may use (read portfolio, propose thesis, propose journal entry, propose alert). Every skill remains propose-then-approve; nothing writes silently.
- **MCP** — endpoint list with URL, transport, connection state, and discovered tool names. Connections are attempted from the browser; servers that block browser origins are reported plainly rather than faked.

## 5. Navigation UX

- Desktop sidebar: sticky full-height column with its own scroll region so it never scrolls away with page content, a pinned/expanded state that persists instead of hover-only, and the logo and Settings anchored top and bottom.
- Mobile: the 8-column tab bar is too dense. Reduce to five primary tabs plus the quick-capture action, with the remainder in a "More" sheet. Larger touch targets, safe-area padding, and the theses badge kept as a quiet mint count.
- Content area gets its own scroll container so the top bar stays fixed and mobile view height uses dynamic viewport units.

## Technical notes

- Chain registry: `src/chains/index.ts` exporting `INK_MAINNET`, `INK_SEPOLIA`, and a `useNetwork` accessor via the existing `ChainProvider`.
- Reader worker gains a `chain` field on its request payload; IndexedDB cache keys become `chain.snapshots.v1:<chainId>`.
- Wallet connector lives in `src/lib/chain/injected.ts` — plain EIP-1193, no library.
- Agent config in `src/lib/agents/` with localStorage persistence; model weights in the Cache API, never localStorage.
- Local inference loads lazily on first use so startup is never blocked.

## Out of scope this pass

Order signing or submission, real funds movement, WalletConnect, and any server-side persistence.
