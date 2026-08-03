import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
import { DpiView } from "@/components/dynaminko/views/DpiView";
import { VaultView } from "@/components/dynaminko/views/VaultView";
import { SettingsView } from "@/components/dynaminko/views/SettingsView";
import { AgentsView } from "@/components/dynaminko/views/AgentsView";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useJournal } from "@/hooks/useJournal";
import { ChainProvider, useChain } from "@/hooks/useChain";
import { totalBalance } from "@/lib/dynaminko-data";
import { isValidAddress } from "@/lib/wallet-mock";
import {
  autoLabel,
  newWalletId,
  type Wallet,
} from "@/lib/wallets";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Proof of Thesis — Reconcile every trade · by INKO" },
      {
        name: "description",
        content:
          "POT captures your thesis first, auto-fetches trades from Ink Chain, and reconciles the two into a performance score you can defend.",
      },
      { property: "og:title", content: "Proof of Thesis — Reconcile every trade · by INKO" },
      {
        property: "og:description",
        content:
          "POT captures your thesis first, auto-fetches trades from Ink Chain, and reconciles the two into a performance score you can defend.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),

  component: Index,
});

function Index() {
  const [wallets, setWallets] = useLocalStorage<Wallet[]>("dyn.wallets", []);

  // One-time migration: old single-wallet key → wallets array
  useEffect(() => {
    if (wallets.length > 0) return;
    try {
      const raw = window.localStorage.getItem("dyn.wallet");
      if (!raw) return;
      const addr = JSON.parse(raw) as string;
      if (typeof addr === "string" && isValidAddress(addr)) {
        setWallets([
          {
            id: newWalletId(),
            address: addr,
            label: autoLabel(addr, "read"),
            kind: "read",
            visible: true,
            addedAt: Date.now(),
          },
        ]);
        window.localStorage.removeItem("dyn.wallet");
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ChainProvider wallets={wallets}>
      <Shell wallets={wallets} setWallets={setWallets} />
    </ChainProvider>
  );
}

function Shell({
  wallets,
  setWallets,
}: {
  wallets: Wallet[];
  setWallets: (next: Wallet[] | ((prev: Wallet[]) => Wallet[])) => void;
}) {
  const [view, setView] = useState<ViewId>("dashboard");
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [thesesCompose, setThesesCompose] = useState(false);
  const [theses] = useLocalStorage<Thesis[]>("dyn.theses", []);

  const { positions, snapshots, demo, status, fetchedAt, refresh } = useChain();
  const { pending: pendingJournal } = useJournal(wallets, snapshots, demo);
  const badge = unreviewedCount(theses) + pendingJournal.length;

  const balance = useMemo(
    () => totalBalance(positions ?? undefined),
    // price overlay mutates ASSETS, so re-derive whenever a sync lands
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [positions, fetchedAt],
  );

  const navigate = (v: ViewId, intent?: "new-thesis" | "ask") => {
    setView(v);
    if (v === "journal" && intent === "new-thesis") setThesesCompose(true);
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

      <Sidebar active={view} onSelect={setView} journalBadge={badge} />

      <main className="flex-1 flex flex-col min-w-0 pb-16 md:pb-0">
        <TopBar
          balance={balance}
          balanceHidden={balanceHidden}
          onToggleBalance={() => setBalanceHidden((v) => !v)}
          onQuickCapture={() => setQuickOpen(true)}
          wallets={wallets}
          onWalletsChange={setWallets}
        />

        <div className="flex-1 overflow-y-auto">
          {view === "dashboard" && (
            <DashboardView
              hidden={balanceHidden}
              wallets={wallets}
              onWalletsChange={setWallets}
              positions={positions}
              status={status}
              fetchedAt={fetchedAt}
              onRefresh={refresh}
            />
          )}
          {view === "markets" && <MarketsView />}
          {view === "terminal" && <TerminalView />}
          {view === "journal" && (
            <ThesesView
              key={thesesCompose ? "compose" : "list"}
              initialCompose={thesesCompose}
              wallets={wallets}
            />
          )}
          {view === "score" && <DpiView wallets={wallets} />}
          {view === "vault" && <VaultView />}
          {view === "agents" && <AgentsView />}
          {view === "settings" && (
            <SettingsView wallets={wallets} onWalletsChange={setWallets} />
          )}
        </div>

        <footer className="hidden md:block border-t border-hairline px-6 py-3 font-mono text-[9px] uppercase tracking-[0.28em] text-ash text-center">
          PROOF OF THESIS // BY INKO // THESIS-FIRST RECONCILIATION ON INK CHAIN
        </footer>
      </main>

      <MobileTabBar
        active={view}
        onSelect={(v) => {
          setView(v);
          setThesesCompose(false);
        }}
        journalBadge={badge}
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
