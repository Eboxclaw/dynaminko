import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useChainPortfolio } from "./useChainPortfolio";
import { useLocalStorage } from "./useLocalStorage";
import { usePublicData } from "./usePublicData";
import { applyLivePrices } from "@/lib/prices";
import {
  positionsFromSnapshots,
  holdingsFromSnapshots,
  pricesFromSnapshots,
  type Holding,
} from "@/lib/portfolio";
import { positionsForWallets, type Wallet } from "@/lib/wallets";
import type { WalletSnapshot } from "@/lib/chain/blockscout";
import { rpcCall } from "@/lib/chain/blockscout";
import { DEFAULT_CHAIN_ID, getChain, type ChainConfig } from "@/chains";

type ChainValue = {
  demo: boolean;
  setDemo: (v: boolean) => void;
  chain: ChainConfig;
  chainId: number;
  setChainId: (id: number) => void;
  head: { block: number | null; latencyMs: number | null; online: boolean };
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

export function ChainProvider({ wallets, children }: { wallets: Wallet[]; children: ReactNode }) {
  const [, persistDemo] = useLocalStorage<boolean>("dyn.demoData", false);
  const demo = false;
  const setDemo = useCallback((_value: boolean) => persistDemo(false), [persistDemo]);
  const [chainId, setChainId] = useLocalStorage<number>("dyn.chainId", DEFAULT_CHAIN_ID);
  const chain = getChain(chainId);
  const portfolio = useChainPortfolio(wallets, chainId, true);
  const publicData = usePublicData();

  // Head block + RPC latency for the network pill.
  const [head, setHead] = useState<ChainValue["head"]>({
    block: null,
    latencyMs: null,
    online: false,
  });
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const t0 = performance.now();
      try {
        const hex = await rpcCall(chain, "eth_blockNumber");
        if (cancelled) return;
        setHead({
          block: typeof hex === "string" ? Number.parseInt(hex, 16) : null,
          latencyMs: Math.round(performance.now() - t0),
          online: true,
        });
      } catch {
        if (!cancelled) setHead({ block: null, latencyMs: null, online: false });
      }
    };
    void tick();
    const iv = window.setInterval(tick, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(iv);
    };
  }, [chain]);

  const snapshotList = useMemo(() => Object.values(portfolio.snapshots), [portfolio.snapshots]);

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

  const switchChain = useCallback((id: number) => setChainId(getChain(id).id), [setChainId]);

  const value = useMemo<ChainValue>(() => {
    const holdings = demo ? [] : holdingsFromSnapshots(snapshotList);
    const positions = demo ? positionsForWallets(wallets) : positionsFromSnapshots(snapshotList);
    return {
      demo,
      setDemo,
      chain,
      chainId: chain.id,
      setChainId: switchChain,
      head,
      snapshots: demo ? {} : portfolio.snapshots,
      snapshotList: demo ? [] : snapshotList,
      holdings,
      positions,
      status: demo ? "ready" : portfolio.status,
      fetchedAt: demo ? null : portfolio.fetchedAt,
      refresh: portfolio.refresh,
      sourceLabel: demo ? "staged demo data" : `${chain.shortName} rpc + explorer`,
    };
  }, [
    demo,
    setDemo,
    chain,
    switchChain,
    head,
    snapshotList,
    wallets,
    portfolio.snapshots,
    portfolio.status,
    portfolio.fetchedAt,
    portfolio.refresh,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChain(): ChainValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useChain must be used inside <ChainProvider>");
  return ctx;
}
