import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Panel, Shell } from "@/components/pot/Shell";
import { useDoc } from "@/hooks/useDoc";
import { relativeTime } from "@/lib/format";
import {
  backgroundCapable,
  permission,
  request,
  show,
  type PermissionState,
} from "@/lib/notify";
import { addAlert, patchAlert, patchSettings, removeAlert } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/alerts")({
  head: () => ({
    meta: [
      { title: "Alerts — Proof of Thesis" },
      {
        name: "description",
        content:
          "Price levels, on-chain triggers and thesis reviews that nudge you before you react.",
      },
      { property: "og:title", content: "Alerts — Proof of Thesis" },
      { property: "og:description", content: "Price levels and thesis reviews that nudge you." },
    ],
  }),
  component: AlertsPage,
});

function Permission() {
  const doc = useDoc();
  const [state, setState] = useState<PermissionState>("default");
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    setState(permission());
    setInstalled(
      typeof window !== "undefined" &&
        window.matchMedia?.("(display-mode: standalone)").matches === true,
    );
  }, []);

  const on = state === "granted" && doc.settings.notifications;

  return (
    <Panel eyebrow="Delivery // Where an alert lands">
      <div className="space-y-3 px-4 py-4 text-[13px]">
        <p className="text-ink-soft">
          Alerts always appear inside the app while it is open. To get them on your phone&apos;s
          lock screen, grant notification permission and install Proof of Thesis to your home
          screen.
        </p>

        <ul className="space-y-1.5 text-[12px]">
          <Row label="In-app toasts" value="always on" ok />
          <Row
            label="Browser notifications"
            value={
              state === "unsupported"
                ? "not supported here"
                : state === "granted"
                  ? on
                    ? "on"
                    : "allowed, switched off"
                  : state === "denied"
                    ? "blocked in browser settings"
                    : "permission not asked yet"
            }
            ok={on}
          />
          <Row
            label="While the app is closed"
            value={
              installed
                ? backgroundCapable()
                  ? "installed — delivered in the background"
                  : "no service worker"
                : "install to home screen first"
            }
            ok={installed && backgroundCapable()}
          />
        </ul>

        <div className="flex flex-wrap gap-2 pt-1">
          {state !== "granted" && state !== "unsupported" && (
            <button
              type="button"
              disabled={state === "denied"}
              onClick={async () => {
                const next = await request();
                setState(next);
                if (next === "granted") patchSettings({ notifications: true });
              }}
              className="doodle-pill bg-ink px-4 py-1.5 text-[12px] font-medium text-paper disabled:opacity-40"
            >
              {state === "denied" ? "Blocked — unblock in browser" : "Allow notifications"}
            </button>
          )}
          {state === "granted" && (
            <>
              <button
                type="button"
                onClick={() => patchSettings({ notifications: !doc.settings.notifications })}
                className="doodle-pill px-4 py-1.5 text-[12px] hover:bg-accent-soft"
              >
                {doc.settings.notifications ? "Turn off" : "Turn on"}
              </button>
              <button
                type="button"
                onClick={() =>
                  void show("Proof of Thesis", "Notifications are working on this device.", "test")
                }
                className="doodle-pill px-4 py-1.5 text-[12px] hover:bg-accent-soft"
              >
                Send a test
              </button>
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <li className="flex items-baseline gap-2">
      <span
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", ok ? "bg-gain" : "bg-ink-faint")}
      />
      <span className="flex-1">{label}</span>
      <span className="text-ink-faint">{value}</span>
    </li>
  );
}

function PriceForm() {
  const [symbol, setSymbol] = useState("");
  const [target, setTarget] = useState("");
  const [direction, setDirection] = useState<"above" | "below">("above");

  return (
    <div className="px-4 py-4">
      <div className="flex flex-wrap gap-2">
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
      <p className="mt-2 text-[12px] text-ink-faint">
        Checked against live quotes each time prices refresh.
      </p>
    </div>
  );
}

function OnchainForm() {
  const [symbol, setSymbol] = useState("");
  return (
    <div className="px-4 py-4">
      <div className="flex flex-wrap gap-2">
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="any asset"
          className="num doodle-inset w-36 bg-transparent px-3 py-2 text-[13px] outline-none"
        />
        <button
          type="button"
          onClick={() => {
            addAlert({ kind: "onchain", symbol: symbol.trim() || null });
            setSymbol("");
          }}
          className="doodle-pill bg-ink px-4 py-2 text-[13px] font-medium text-paper"
        >
          Add
        </button>
      </div>
      <p className="mt-2 text-[12px] text-ink-faint">
        Fires when the watcher reads a new trade from your wallet that is still unreconciled.
      </p>
    </div>
  );
}

function ThesisForm() {
  const doc = useDoc();
  const [thesisId, setThesisId] = useState("");
  const [everyDays, setEveryDays] = useState("30");

  return (
    <div className="px-4 py-4">
      <div className="flex flex-wrap gap-2">
        <select
          value={thesisId}
          onChange={(e) => setThesisId(e.target.value)}
          className="doodle-inset min-w-0 max-w-full flex-1 bg-transparent px-3 py-2 text-[13px] outline-none"
        >
          <option value="">every open thesis</option>
          {doc.theses.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        <select
          value={everyDays}
          onChange={(e) => setEveryDays(e.target.value)}
          className="doodle-inset bg-transparent px-3 py-2 text-[13px] outline-none"
        >
          {[7, 14, 30, 60, 90].map((d) => (
            <option key={d} value={d}>
              every {d} days
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() =>
            addAlert({
              kind: "thesis-review",
              thesisId: thesisId || null,
              everyDays: Number(everyDays),
            })
          }
          className="doodle-pill bg-ink px-4 py-2 text-[13px] font-medium text-paper"
        >
          Add
        </button>
      </div>
      <p className="mt-2 text-[12px] text-ink-faint">
        A quiet nudge to re-read what you wrote and decide whether it still holds.
      </p>
    </div>
  );
}

const KINDS = [
  { id: "price", label: "Price level" },
  { id: "onchain", label: "On-chain event" },
  { id: "thesis-review", label: "Thesis review" },
] as const;

function AlertsPage() {
  const doc = useDoc();
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("price");
  const active = doc.alerts.filter((a) => a.enabled).length;

  return (
    <Shell title="Alerts" subtitle={`${doc.alerts.length} set · ${active} armed`}>
      <div className="grid gap-4">
        <Permission />

        <Panel eyebrow="New // Tell me when…">
          <div className="flex gap-1 overflow-x-auto border-b border-stroke px-4 py-2.5">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => setKind(k.id)}
                className={cn(
                  "doodle-pill shrink-0 px-3 py-1 text-[12px]",
                  kind === k.id ? "bg-ink text-paper" : "text-ink-soft hover:border-ink",
                )}
              >
                {k.label}
              </button>
            ))}
          </div>
          {kind === "price" && <PriceForm />}
          {kind === "onchain" && <OnchainForm />}
          {kind === "thesis-review" && <ThesisForm />}
        </Panel>

        <Panel eyebrow={`Armed // ${doc.alerts.length} on this device`} delay={60}>
          <ul>
            {doc.alerts.map((a) => {
              const thesis = doc.theses.find((t) => t.id === a.thesisId);
              return (
                <li
                  key={a.id}
                  className="flex items-center gap-3 border-b border-stroke px-4 py-3 last:border-0"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">
                      {a.kind === "price" &&
                        `${a.symbol} ${a.direction === "above" ? "above" : "below"} `}
                      {a.kind === "price" && <span className="num">{a.target}</span>}
                      {a.kind === "onchain" &&
                        `New ${a.symbol ? `${a.symbol} ` : ""}activity in the wallet`}
                      {a.kind === "thesis-review" &&
                        `Review ${thesis ? thesis.title : "open theses"} every ${a.everyDays ?? 30} days`}
                    </span>
                    <span className="eyebrow mt-0.5 block">
                      {a.kind} ·{" "}
                      {a.lastFiredAt ? `last fired ${relativeTime(a.lastFiredAt)}` : "never fired"}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => patchAlert(a.id, { enabled: !a.enabled })}
                    className={cn(
                      "doodle-pill px-3 py-1 text-[12px]",
                      a.enabled ? "bg-ink text-paper" : "text-ink-faint",
                    )}
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
              );
            })}
            {doc.alerts.length === 0 && (
              <li className="px-4 py-8 text-center text-[13px] text-ink-faint">
                No alerts yet.
              </li>
            )}
          </ul>
        </Panel>
      </div>
    </Shell>
  );
}
