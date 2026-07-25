import { PortfolioDiamond } from "../PortfolioDiamond";
import { CategoryExposure } from "../CategoryExposure";
import { ConciergeFeed } from "../ConciergeFeed";

export function DashboardView({ hidden }: { hidden: boolean }) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 p-4 md:p-6 lg:p-8">
      <div className="xl:col-span-5 space-y-6">
        <PortfolioDiamond hidden={hidden} />
        <CategoryExposure hidden={hidden} />
      </div>
      <div className="xl:col-span-7">
        <ConciergeFeed />
      </div>
    </div>
  );
}
