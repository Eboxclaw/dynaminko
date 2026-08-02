import { useCallback, useEffect, useState } from "react";
import {
  currentAccounts,
  currentChainId,
  getInjected,
  requestAccounts,
  subscribe,
  switchToChain,
  walletName,
  type Eip1193Provider,
} from "@/lib/chain/injected";
import { getChain } from "@/chains";

export type InjectedWallet = {
  available: boolean;
  name: string;
  accounts: string[];
  chainId: number | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<string[]>;
  switchTo: (chainId: number) => Promise<void>;
};

export function useInjectedWallet(): InjectedWallet {
  const [provider, setProvider] = useState<Eip1193Provider | null>(null);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const p = getInjected();
    setProvider(p);
    if (!p) return;
    void currentAccounts().then(setAccounts);
    void currentChainId().then(setChainId);
    return subscribe({ onAccounts: setAccounts, onChain: setChainId });
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const next = await requestAccounts();
      setAccounts(next);
      setChainId(await currentChainId());
      return next;
    } catch (err) {
      const message = err instanceof Error ? err.message : "connection rejected";
      setError(message);
      throw err;
    } finally {
      setConnecting(false);
    }
  }, []);

  const switchTo = useCallback(async (id: number) => {
    setError(null);
    try {
      await switchToChain(getChain(id));
      setChainId(await currentChainId());
    } catch (err) {
      setError(err instanceof Error ? err.message : "network switch rejected");
    }
  }, []);

  return {
    available: Boolean(provider),
    name: walletName(provider),
    accounts,
    chainId,
    connecting,
    error,
    connect,
    switchTo,
  };
}
