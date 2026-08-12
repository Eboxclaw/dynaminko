import { useEffect, useState } from "react";
import { toast } from "sonner";

import { evaluate } from "@/lib/alerts/engine";
import { show as showNotification } from "@/lib/notify";
import { log, patchAlert } from "@/lib/store";

import { useDoc } from "./useDoc";
import { usePortfolio } from "./usePortfolio";

/**
 * The alert watcher. Runs while the app is open: re-checks on every price
 * refresh and on a 5-minute timer, marks lastFiredAt, toasts in-app and
 * raises a browser notification when the user granted permission.
 */
export function useAlerts() {
  const doc = useDoc();
  const { quotes } = usePortfolio();
  const [tick, setTick] = useState(0);

  const stamp = `${doc.alerts.length}:${quotes.map((q) => `${q.symbol}${q.usd}`).join(",")}:${doc.signals.length}:${tick}`;

  useEffect(() => {
    if (doc.alerts.length === 0) return;
    const firings = evaluate(doc.alerts, {
      quotes,
      signals: doc.signals,
      theses: doc.theses,
    });
    for (const f of firings) {
      patchAlert(f.alert.id, { lastFiredAt: Date.now() });
      toast(f.title, { description: f.body });
      log("watcher", "alert fired", { level: "call", detail: `${f.title} — ${f.body}` });
      if (doc.settings.notifications) void showNotification(f.title, f.body, f.alert.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);

  // periodic re-check so time-based (thesis review) alerts still land
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 300_000);
    return () => clearInterval(id);
  }, []);
}
