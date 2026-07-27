import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Toaster } from "sonner";

import { BootSequence } from "@/components/dynaminko/BootSequence";
import { Sidebar, type ViewId } from "@/components/dynaminko/Sidebar";
import { MobileTabBar } from "@/components/dynaminko/MobileTabBar";
import { TopBar } from "@/components/dynaminko/TopBar";
import { QuickCapture } from "@/components/dynaminko/QuickCapture";
import { DashboardView } from "@/components/dynaminko/views/DashboardView";
import { MarketsView } from "@/components/dynaminko/views/MarketsView";
import { TerminalView } from "@/components/dynaminko/views/TerminalView";
import { ThesesView, unreviewedCount, type Thesis } from "@/components/dynaminko/views/ThesesView";
import { VaultView } from "@/components/dynaminko/views/VaultView";
import { SettingsView } from "@/components/dynaminko/views/SettingsView";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { totalBalance } from "@/lib/dynaminko-data";
import { isValidAddress, positionsForAddress } from "@/lib/wallet-mock";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dynaminko — Command Center · Ink Chain" },
      {
        name: "description",
        content:
          "Thesis-first trading journal for Ink Chain. Route trades through Nado CLOB, earn on Tydro, reconcile with a classified AI concierge.",
      },
      { property: "og:title", content: "Dynaminko — Command Center · Ink Chain" },
      {
        property: "og:description",
        content:
          "Thesis-first trading journal for Ink Chain. Route trades through Nado CLOB, earn on Tydro, reconcile with a classified AI concierge.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const [view, setView] = useState<ViewId>("dashboard");
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [walletAddress, setWalletAddress] = useLocalStorage<string>("dyn.wallet", "");
  const [thesesCompose, setThesesCompose] = useState(false);
  const [theses] = useLocalStorage<Thesis[]>("dyn.theses", []);
  const badge = unreviewedCount(theses);

  const positions = useMemo(
    () => (walletAddress && isValidAddress(walletAddress) ? positionsForAddress(walletAddress) : null),
    [walletAddress],
  );

  const balance = useMemo(
    () => totalBalance(positions ?? undefined),
    [positions],
  );

  const navigate = (v: ViewId, intent?: "new-thesis" | "ask") => {
    setView(v);
    if (v === "theses" && intent === "new-thesis") setThesesCompose(true);
  };

  return (
    <div className="min-h-screen bg-onyx text-paper flex">
      <BootSequence />
      <Toaster
        theme="dark"
        position="bottom-left"
        toastOptions={{
          style: {
            background: "#151318",
            border: "1px solid #2A2830",
            color: "#F5F4F7",
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: "11px",
            borderRadius: 0,
          },
        }}
      />

      <Sidebar active={view} onSelect={setView} thesesBadge={badge} />

      <main className="flex-1 flex flex-col min-w-0 pb-16 md:pb-0">
        <TopBar
          balance={balance}
          balanceHidden={balanceHidden}
          onToggleBalance={() => setBalanceHidden((v) => !v)}
          onQuickCapture={() => setQuickOpen(true)}
          walletAddress={walletAddress}
          onWalletAddressChange={setWalletAddress}
        />

        <div className="flex-1 overflow-y-auto">
          {view === "dashboard" && (
            <DashboardView
              hidden={balanceHidden}
              walletAddress={walletAddress}
              onWalletAddressChange={setWalletAddress}
              positions={positions}
            />
          )}
          {view === "markets" && <MarketsView />}
          {view === "terminal" && <TerminalView />}
          {view === "theses" && (
            <ThesesView
              key={thesesCompose ? "compose" : "list"}
              initialCompose={thesesCompose}
            />
          )}
          {view === "vault" && <VaultView />}
          {view === "settings" && (
            <SettingsView
              walletAddress={walletAddress}
              onWalletAddressChange={setWalletAddress}
            />
          )}
        </div>

        <footer className="hidden md:block border-t border-hairline px-6 py-3 font-mono text-[9px] uppercase tracking-[0.28em] text-ash text-center">
          DYNAMINKO // TRADING JOURNAL // NATIVELY ON INK CHAIN · 57073
        </footer>
      </main>

      <MobileTabBar
        active={view}
        onSelect={(v) => {
          setView(v);
          setThesesCompose(false);
        }}
        thesesBadge={badge}
        onQuickCapture={() => setQuickOpen(true)}
      />

      <QuickCapture
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        onNavigate={navigate}
      />
    </div>
  );
}
