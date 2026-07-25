// Ink Chain configuration — Kraken's Optimism Superchain L2.
// Structured for future multi-chain support: add new chains next to this
// file exporting the same shape, then consumers can switch by import.

export type ChainConfig = {
  id: number;
  name: string;
  shortName: string;
  currency: { name: string; symbol: string; decimals: number };
  rpcUrls: readonly string[];
  explorer: string;
  testnet?: {
    id: number;
    name: string;
    rpcUrls: readonly string[];
    explorer: string;
  };
};

export const INK_CHAIN: ChainConfig = {
  id: 57073,
  name: "Ink Chain",
  shortName: "ink",
  currency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc-gel.inkonchain.com"],
  explorer: "https://explorer.inkonchain.com",
  testnet: {
    id: 763373,
    name: "Ink Sepolia",
    rpcUrls: ["https://rpc-gel-sepolia.inkonchain.com"],
    explorer: "https://explorer-sepolia.inkonchain.com",
  },
};
