import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast, Toaster } from "sonner";
import { BootLoader } from "@/components/fustore/BootLoader";
import { Sidebar } from "@/components/fustore/Sidebar";
import { TopBar } from "@/components/fustore/TopBar";
import { PortfolioPie } from "@/components/fustore/PortfolioPie";
import { CategoryExposure } from "@/components/fustore/CategoryExposure";
import { MarketTable } from "@/components/fustore/MarketTable";
import { OrderBook } from "@/components/fustore/OrderBook";
import { KrakenTerminal } from "@/components/fustore/KrakenTerminal";
import { ThesisPanel } from "@/components/fustore/ThesisPanel";
import { AlertsPanel } from "@/components/fustore/AlertsPanel";
import { ASSETS, totalBalance } from "@/lib/fustore-data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FUstore — Command Center · Ink Chain" },
      {
        name: "description",
        content:
          "Elite dark command center for trading tokenized stocks and crypto — Privacy, Defense, Chips, AI, Health, Store of Value — on Ink Chain via Kraken CLI and Nado CLOB.",
      },
      { property: "og:title", content: "FUstore — Command Center" },
      {
        property: "og:description",
        content: "Unstoppable gateway to tokenized assets on Ink Chain.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const [active, setActive] = useState("dash");
  const [cliOpen, setCliOpen] = useState(false);
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [selected, setSelected] = useState(ASSETS[0]);

  return (
    <div className="min-h-screen bg-obsidian text-slate-300 flex selection:bg-neon-mint/30 selection:text-neon-mint">
      <BootLoader />
      <Toaster
        theme="dark"
        position="bottom-left"
        toastOptions={{
          style: {
            background: "#0d0d0d",
            border: "1px solid #1a1a1a",
            color: "#e2e8f0",
            fontFamily: "JetBrains Mono, monospace",
            fontSize: "11px",
          },
        }}
      />
      <Sidebar active={active} onSelect={setActive} onOpenCli={() => setCliOpen(true)} />

      <main className="flex-1 flex flex-col min-w-0">
        <TopBar
          balance={totalBalance()}
          balanceHidden={balanceHidden}
          onToggleBalance={() => setBalanceHidden((v) => !v)}
          onOpenCli={() => setCliOpen(true)}
        />

        <div className="p-6 lg:p-8 grid grid-cols-12 gap-6 overflow-y-auto">
          <div className="col-span-12 lg:col-span-4 space-y-6">
            <PortfolioPie hidden={balanceHidden} />
            <CategoryExposure hidden={balanceHidden} />
          </div>

          <div className="col-span-12 lg:col-span-8 space-y-6">
            <MarketTable
              selected={selected}
              onSelect={setSelected}
              onAction={(a, action) =>
                toast(`${action} · ${a.ticker}`, {
                  description: `Routed via Nado CLOB on Ink Chain @ $${a.price.toFixed(2)}`,
                })
              }
            />

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <OrderBook asset={selected} />
              <ThesisPanel activeTicker={selected.ticker} />
            </div>

            <AlertsPanel />

            <footer className="text-[10px] font-mono text-slate-600 uppercase tracking-[0.3em] py-6 text-center border-t border-steel">
              F U S T O R E · UNSTOPPABLE GATEWAY · natively on ink chain
            </footer>
          </div>
        </div>
      </main>

      <KrakenTerminal open={cliOpen} onClose={() => setCliOpen(false)} />
    </div>
  );
}
