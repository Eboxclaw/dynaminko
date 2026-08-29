import { createFileRoute } from "@tanstack/react-router";
import { BasketOrb } from "@/components/pot/BasketOrb";
export const Route = createFileRoute("/orb-preview")({
  ssr: false,
  component: () => (
    <div className="p-8">
      <div className="max-w-md">
        <BasketOrb slices={[{label:"Store of Value",share:.42},{label:"DeFi",share:.24},{label:"Memes",share:.18},{label:"Stables",share:.16}]} />
      </div>
    </div>
  ),
});
