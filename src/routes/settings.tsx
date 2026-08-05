import { createFileRoute } from "@tanstack/react-router";

import { Shell } from "@/components/pot/Shell";
import { WalletPanel } from "@/components/pot/WalletChip";
import { useAi } from "@/hooks/useAi";
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
  const ai = useAi();

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
        <p className="text-[15px] font-semibold">Assistant</p>
        <p className="mt-1 text-[13px] text-ink-soft">
          Runs entirely in this browser with WebAssembly. The model downloads once and is cached.
        </p>
        <div className="mt-3 space-y-2">
          {ai.models.map((m) => (
            <label key={m.id} className="doodle-inset flex items-start gap-3 p-3 text-[13px]">
              <input
                type="radio"
                name="model"
                className="mt-1"
                checked={ai.modelId === m.id}
                onChange={() => patchSettings({ aiModelId: m.id })}
              />
              <span>
                <span className="block font-medium">
                  {m.label} <span className="num text-ink-faint">{m.sizeMb} MB</span>
                </span>
                <span className="block text-ink-faint">{m.blurb}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void ai.load()}
            className="doodle-pill bg-ink px-4 py-1.5 text-[13px] font-medium text-paper"
          >
            {ai.status.phase === "ready" ? "Loaded" : "Download & start"}
          </button>
          {ai.status.phase === "downloading" && (
            <span className="num text-[12px] text-ink-faint">
              {Math.round(ai.status.progress * 100)}%
            </span>
          )}
          {ai.status.phase === "error" && (
            <span className="text-[12px] text-loss">{ai.status.message}</span>
          )}
        </div>
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
