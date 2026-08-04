import { PortfolioDiamond } from "../PortfolioDiamond";
import { CategoryExposure } from "../CategoryExposure";
import { DebankPortfolio } from "../DebankPortfolio";
import { WalletMenu } from "../WalletMenu";
import { PublicDataStrip } from "../PublicDataStrip";
import { DataSource, EmptyState } from "../DataSource";
import { useChain } from "@/hooks/useChain";
import type { Wallet } from "@/lib/wallets";

export function DashboardView({
  hidden,
  wallets,
  onWalletsChange,
  positions,
  status = "idle",
  fetchedAt = null,
  onRefresh,
}: {
  hidden: boolean;
  wallets: Wallet[];
  onWalletsChange: (next: Wallet[] | ((prev: Wallet[]) => Wallet[])) => void;
  positions: Record<string, number> | null;
  status?: "idle" | "loading" | "ready" | "error";
  fetchedAt?: number | null;
  onRefresh?: () => void;
}) {
  const { holdings, demo, sourceLabel } = useChain();
  const visible = wallets.filter((w) => w.visible);

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      {/* Mobile wallet control (desktop lives in top bar) */}
      <div className="lg:hidden flex justify-end">
        <WalletMenu wallets={wallets} onChange={onWalletsChange} />
      </div>

      <PublicDataStrip />

      {visible.length === 0 ? (
        <EmptyState
          label="No wallet is being tracked."
          hint="paste a read address in the top bar or connect an injected wallet; no positions are invented."
        />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <div className="xl:col-span-5 space-y-6">
            <div>
              <PortfolioDiamond hidden={hidden} positions={positions} />
              <DataSource
                source={sourceLabel}
                at={fetchedAt}
                status={status}
                onRefresh={onRefresh}
                note={demo ? "demo" : undefined}
              />
            </div>
            <CategoryExposure hidden={hidden} positions={positions} />
          </div>
          <div className="xl:col-span-7">
            <DebankPortfolio
              wallets={wallets}
              positions={positions}
              hidden={hidden}
              holdings={holdings}
              demo={demo}
              status={status}
            />
            <DataSource
              source="ink explorer · token balances"
              at={fetchedAt}
              status={status}
              onRefresh={onRefresh}
            />
          </div>
        </div>
      )}
    </div>
  );
}
