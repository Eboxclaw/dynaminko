import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useChainPortfolio } from "./useChainPortfolio";
import { useLocalStorage } from "./useLocalStorage";
import { usePublicData } from "./usePublicData";
import { applyLivePrices } from "@/lib/prices";
import { positionsFromSnapshots, holdingsFromSnapshots, pricesFromSnapshots, type Holding } from "@/lib/portfolio";
import { positionsForWallets, type Wallet } from "@/lib/wallets";
import type { WalletSnapshot } from "@/lib/chain/blockscout";

type ChainValue = {
  demo: boolean;
  setDemo: (v: boolean) => void;
  snapshots: Record<string, WalletSnapshot>;
  snapshotList: WalletSnapshot[];
  holdings: Holding[];
  positions: Record<string, number> | null;
  status: "idle" | "loading" | "ready" | "error";
  fetchedAt: number | null;
  refresh: () => void;
  sourceLabel: string;
};

const Ctx = createContext<ChainValue | null>(null);

export function ChainProvider({
  wallets,
  children,
}: {
  wallets: Wallet[];
  children: ReactNode;
}) {
  const [demo, setDemo] = useLocalStorage<boolean>("dyn.demoData", false);
  const chain = useChainPortfolio(wallets, !demo);
  const publicData = usePublicData();

  const snapshotList = useMemo(() => Object.values(chain.snapshots), [chain.snapshots]);

  // Overlay live quotes (CoinGecko via /api/public-data, then explorer rates).
  useEffect(() => {
    const quotes: Record<string, { usd: number | null; change24h?: number | null }> = {};
    for (const p of publicData.data?.prices ?? []) {
      quotes[p.ticker] = { usd: p.usd, change24h: p.change24h };
    }
    for (const [ticker, usd] of Object.entries(pricesFromSnapshots(snapshotList))) {
      quotes[ticker] = { usd, change24h: quotes[ticker]?.change24h ?? null };
    }
    applyLivePrices(quotes);
  }, [publicData.data, snapshotList]);

  const value = useMemo<ChainValue>(() => {
    const holdings = demo ? [] : holdingsFromSnapshots(snapshotList);
    const positions = demo
      ? positionsForWallets(wallets)
      : positionsFromSnapshots(snapshotList);
    return {
      demo,
      setDemo,
      snapshots: demo ? {} : chain.snapshots,
      snapshotList: demo ? [] : snapshotList,
      holdings,
      positions,
      status: demo ? "ready" : chain.status,
      fetchedAt: demo ? null : chain.fetchedAt,
      refresh: chain.refresh,
      sourceLabel: demo ? "staged demo data" : "ink rpc + explorer",
    };
  }, [demo, setDemo, snapshotList, wallets, chain.snapshots, chain.status, chain.fetchedAt, chain.refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChain(): ChainValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useChain must be used inside <ChainProvider>");
  return ctx;
}
