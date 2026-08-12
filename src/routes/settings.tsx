import { createFileRoute, Link } from "@tanstack/react-router";

import { Shell } from "@/components/pot/Shell";
import { WalletPanel } from "@/components/pot/WalletChip";
import { useDoc } from "@/hooks/useDoc";
import { useActiveWallet } from "@/hooks/usePortfolio";
import { exportDoc, patchSettings, walletKey, wipe } from "@/lib/store";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Proof of Thesis" },
      {
        name: "description",
        content: "Wallets, privacy, on-device assistant and your local data.",
      },
      { property: "og:title", content: "Settings — Proof of Thesis" },
      { property: "og:description", content: "Wallets, privacy and your local data." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const doc = useDoc();
  const { wallets, active } = useActiveWallet();

  return (
    <Shell title="Settings">
      <section className="doodle-card animate-rise mb-5">
        <WalletPanel
          wallets={wallets}
          activeKey={active ? walletKey(active.chainId, active.address) : null}
        />
      </section>

      <section className="doodle-card animate-rise mb-5 p-5">
        <p className="text-[15px] font-semibold">Privacy</p>
        <label className="mt-3 flex items-center gap-3 text-[14px]">
          <input
            type="checkbox"
            checked={doc.settings.hideBalances}
            onChange={(e) => patchSettings({ hideBalances: e.target.checked })}
          />
          Hide balances by default
        </label>
      </section>

      <section className="doodle-card animate-rise mb-5 p-5">
        <p className="text-[15px] font-semibold">Assistant &amp; agents</p>
        <p className="mt-1 text-[13px] text-ink-soft">
          Models, skills, tools and the activity log now live in their own console.
        </p>
        <Link
          to="/agents"
          className="doodle-pill mt-3 inline-flex px-4 py-1.5 text-[13px] hover:bg-accent-soft"
        >
          Open Agents
        </Link>
      </section>

      <section className="doodle-card animate-rise p-5">
        <p className="text-[15px] font-semibold">Your data</p>
        <p className="mt-1 text-[13px] text-ink-soft">
          Everything lives in this browser. Export it before clearing your site data.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => {
              const blob = new Blob([exportDoc()], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "proof-of-thesis.json";
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="doodle-pill px-4 py-1.5 text-[13px] hover:bg-accent-soft"
          >
            Export
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm("Delete every thesis, entry and alert on this device?")) wipe();
            }}
            className="doodle-pill px-4 py-1.5 text-[13px] text-loss hover:bg-accent-soft"
          >
            Delete everything
          </button>
        </div>
      </section>
    </Shell>
  );
}
