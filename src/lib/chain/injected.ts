// Minimal EIP-1193 connector — zero dependencies, read-only.
// We request accounts, watch chain/account changes and can ask the wallet to
// switch to an Ink network. No signing, no transactions, ever.

import { hexChainId, type ChainConfig } from "@/chains";

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: never[]) => void) => void;
  removeListener?: (event: string, handler: (...args: never[]) => void) => void;
  isMetaMask?: boolean;
  isRabby?: boolean;
  isCoinbaseWallet?: boolean;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export function getInjected(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  return window.ethereum ?? null;
}

export function walletName(p: Eip1193Provider | null): string {
  if (!p) return "No wallet";
  if (p.isRabby) return "Rabby";
  if (p.isMetaMask) return "MetaMask";
  if (p.isCoinbaseWallet) return "Coinbase Wallet";
  return "Injected wallet";
}

export async function requestAccounts(): Promise<string[]> {
  const p = getInjected();
  if (!p) throw new Error("No injected wallet found");
  const accounts = (await p.request({ method: "eth_requestAccounts" })) as string[];
  return accounts.map((a) => a.toLowerCase());
}

export async function currentAccounts(): Promise<string[]> {
  const p = getInjected();
  if (!p) return [];
  try {
    const accounts = (await p.request({ method: "eth_accounts" })) as string[];
    return accounts.map((a) => a.toLowerCase());
  } catch {
    return [];
  }
}

export async function currentChainId(): Promise<number | null> {
  const p = getInjected();
  if (!p) return null;
  try {
    const hex = (await p.request({ method: "eth_chainId" })) as string;
    return Number.parseInt(hex, 16);
  } catch {
    return null;
  }
}

/** Ask the wallet to switch, adding the network first when it's unknown. */
export async function switchToChain(chain: ChainConfig): Promise<void> {
  const p = getInjected();
  if (!p) throw new Error("No injected wallet found");
  const id = hexChainId(chain.id);
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: id }] });
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code !== 4902) throw err;
    await p.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: id,
          chainName: chain.name,
          nativeCurrency: chain.currency,
          rpcUrls: [...chain.rpcUrls],
          blockExplorerUrls: [chain.explorer],
        },
      ],
    });
  }
}

export function subscribe(handlers: {
  onAccounts?: (accounts: string[]) => void;
  onChain?: (chainId: number) => void;
}): () => void {
  const p = getInjected();
  if (!p?.on) return () => {};
  const onAccounts = ((accounts: string[]) =>
    handlers.onAccounts?.(accounts.map((a) => a.toLowerCase()))) as (...a: never[]) => void;
  const onChain = ((hex: string) =>
    handlers.onChain?.(Number.parseInt(hex, 16))) as (...a: never[]) => void;
  p.on("accountsChanged", onAccounts);
  p.on("chainChanged", onChain);
  return () => {
    p.removeListener?.("accountsChanged", onAccounts);
    p.removeListener?.("chainChanged", onChain);
  };
}
