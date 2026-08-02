// Chain registry. Consumers resolve a ChainConfig by id and never import a
// single hardcoded network, so adding a chain is a one-line change here.

import { INK_MAINNET, INK_SEPOLIA, type ChainConfig } from "./ink";

export type { ChainConfig };
export { INK_MAINNET, INK_SEPOLIA };

export const CHAINS: readonly ChainConfig[] = [INK_MAINNET, INK_SEPOLIA];

export const DEFAULT_CHAIN_ID = INK_MAINNET.id;

export function getChain(id: number | null | undefined): ChainConfig {
  return CHAINS.find((c) => c.id === id) ?? INK_MAINNET;
}

/** 0x-prefixed hex chain id, for EIP-1193 `wallet_switchEthereumChain`. */
export function hexChainId(id: number): string {
  return `0x${id.toString(16)}`;
}

export function explorerAddressUrl(chain: ChainConfig, address: string): string {
  return `${chain.explorer}/address/${address}`;
}

export function explorerTxUrl(chain: ChainConfig, hash: string): string {
  return `${chain.explorer}/tx/${hash}`;
}
