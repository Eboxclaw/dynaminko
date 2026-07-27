import { PortfolioDiamond } from "../PortfolioDiamond";
import { CategoryExposure } from "../CategoryExposure";
import { ConciergeFeed } from "../ConciergeFeed";
import { PositionsPanel } from "../PositionsPanel";
import { WalletSelector } from "../WalletSelector";

export function DashboardView({
  hidden,
  walletAddress,
  onWalletAddressChange,
  positions,
}: {
  hidden: boolean;
  walletAddress: string;
  onWalletAddressChange: (v: string) => void;
  positions: Record<string, number> | null;
}) {
  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      {/* Mobile wallet selector (desktop lives in top bar) */}
      <div className="lg:hidden flex justify-end">
        <WalletSelector address={walletAddress} onChange={onWalletAddressChange} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-5 space-y-6">
          <PortfolioDiamond hidden={hidden} positions={positions} />
          <CategoryExposure hidden={hidden} positions={positions} />
        </div>
        <div className="xl:col-span-7 space-y-6">
          <PositionsPanel
            address={walletAddress}
            positions={positions}
            hidden={hidden}
          />
          <ConciergeFeed />
        </div>
      </div>
    </div>
  );
}
