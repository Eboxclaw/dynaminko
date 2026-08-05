import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { Shell } from "@/components/pot/Shell";
import { useDoc } from "@/hooks/useDoc";
import { addAlert, patchAlert, removeAlert } from "@/lib/store";

export const Route = createFileRoute("/alerts")({
  head: () => ({
    meta: [
      { title: "Alerts — Proof of Thesis" },
      {
        name: "description",
        content: "Price levels and thesis reviews that nudge you before you react.",
      },
      { property: "og:title", content: "Alerts — Proof of Thesis" },
      { property: "og:description", content: "Price levels and thesis reviews that nudge you." },
    ],
  }),
  component: AlertsPage,
});

function AlertsPage() {
  const doc = useDoc();
  const [symbol, setSymbol] = useState("");
  const [target, setTarget] = useState("");
  const [direction, setDirection] = useState<"above" | "below">("above");

  return (
    <Shell title="Alerts" subtitle={`${doc.alerts.length} set`}>
      <section className="doodle-card animate-rise p-5">
        <p className="font-hand text-xl text-accent">Tell me when…</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="ETH"
            className="num doodle-inset w-24 bg-transparent px-3 py-2 text-[13px] outline-none"
          />
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as "above" | "below")}
            className="doodle-inset bg-transparent px-3 py-2 text-[13px] outline-none"
          >
            <option value="above">goes above</option>
            <option value="below">drops below</option>
          </select>
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            inputMode="decimal"
            placeholder="4200"
            className="num doodle-inset w-28 bg-transparent px-3 py-2 text-[13px] outline-none"
          />
          <button
            type="button"
            disabled={!symbol.trim() || !Number(target)}
            onClick={() => {
              addAlert({ kind: "price", symbol: symbol.trim(), direction, target: Number(target) });
              setSymbol("");
              setTarget("");
            }}
            className="doodle-pill bg-ink px-4 py-2 text-[13px] font-medium text-paper disabled:opacity-40"
          >
            Add
          </button>
        </div>
        <p className="mt-3 text-[12px] text-ink-faint">
          Alerts are checked while the app is open and stored on this device.
        </p>
      </section>

      <ul className="mt-5 space-y-2">
        {doc.alerts.map((a) => (
          <li key={a.id} className="doodle-card flex items-center gap-3 p-4">
            <span className="flex-1 text-[14px]">
              {a.symbol} {a.direction === "above" ? "above" : "below"}{" "}
              <span className="num">{a.target}</span>
            </span>
            <button
              type="button"
              onClick={() => patchAlert(a.id, { enabled: !a.enabled })}
              className="doodle-pill px-3 py-1 text-[12px] hover:bg-accent-soft"
            >
              {a.enabled ? "On" : "Off"}
            </button>
            <button
              type="button"
              onClick={() => removeAlert(a.id)}
              className="text-[12px] text-ink-faint hover:text-loss"
            >
              Delete
            </button>
          </li>
        ))}
        {doc.alerts.length === 0 && (
          <p className="py-6 text-center font-hand text-xl text-ink-faint">no alerts yet</p>
        )}
      </ul>
    </Shell>
  );
}
