// Ink Chain configuration — Kraken's Optimism Superchain L2.
// Mainnet and testnet are two entries of the same shape so nothing downstream
// hardcodes an RPC or explorer URL. Add new chains next to this file.

export type ChainConfig = {
  id: number;
  name: string;
  shortName: string;
  /** true when this network is a testnet */
  testnet: boolean;
  currency: { name: string; symbol: string; decimals: number };
  rpcUrls: readonly string[];
  explorer: string;
  /** Blockscout v2 API base, when the explorer exposes one */
  explorerApi: string | null;
};

export const INK_MAINNET: ChainConfig = {
  id: 57073,
  name: "Ink Chain",
  shortName: "ink",
  testnet: false,
  currency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc-gel.inkonchain.com"],
  explorer: "https://explorer.inkonchain.com",
  explorerApi: "https://explorer.inkonchain.com/api/v2",
};

export const INK_SEPOLIA: ChainConfig = {
  id: 763373,
  name: "Ink Sepolia",
  shortName: "ink-sepolia",
  testnet: true,
  currency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc-gel-sepolia.inkonchain.com"],
  explorer: "https://explorer-sepolia.inkonchain.com",
  explorerApi: "https://explorer-sepolia.inkonchain.com/api/v2",
};

/** Back-compat alias for older imports. */
export const INK_CHAIN = INK_MAINNET;
