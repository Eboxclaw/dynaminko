import { PortfolioDiamond } from "../PortfolioDiamond";
import { CategoryExposure } from "../CategoryExposure";
import { DebankPortfolio } from "../DebankPortfolio";
import { WalletMenu } from "../WalletMenu";
import { PublicDataStrip } from "../PublicDataStrip";
import type { Wallet } from "@/lib/wallets";

export function DashboardView({
  hidden,
  wallets,
  onWalletsChange,
  positions,
}: {
  hidden: boolean;
  wallets: Wallet[];
  onWalletsChange: (next: Wallet[]) => void;
  positions: Record<string, number> | null;
}) {
  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      {/* Mobile wallet control (desktop lives in top bar) */}
      <div className="lg:hidden flex justify-end">
        <WalletMenu wallets={wallets} onChange={onWalletsChange} />
      </div>

      <PublicDataStrip />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-5 space-y-6">
          <PortfolioDiamond hidden={hidden} positions={positions} />
          <CategoryExposure hidden={hidden} positions={positions} />
        </div>
        <div className="xl:col-span-7">
          <DebankPortfolio wallets={wallets} positions={positions} hidden={hidden} />
        </div>
      </div>
    </div>
  );
}
