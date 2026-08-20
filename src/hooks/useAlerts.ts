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

    // Warn when price alerts exist but no quotes are available
    const priceAlerts = doc.alerts.filter((a) => a.kind === "price" && a.enabled);
    if (priceAlerts.length > 0 && quotes.length === 0) {
      log("watcher", "price alerts pending - no quotes available", {
        level: "call",
        detail: `${priceAlerts.length} alert(s) waiting`,
      });
    } else if (priceAlerts.length > 0) {
      // Per-symbol: which alert symbols have no matching quote
      for (const a of priceAlerts) {
        if (a.symbol && !quotes.some((q) => q.symbol === a.symbol!.toUpperCase())) {
          log("watcher", `no quote for ${a.symbol}`, {
            level: "call",
            detail: `${a.symbol} ${a.direction} ${a.target} has no matching price`,
          });
        }
      }
    }

    const firings = evaluate(doc.alerts, {
      quotes,
      signals: doc.signals,
      theses: doc.theses,
    });
    for (const f of firings) {
      patchAlert(f.alert.id, { lastFiredAt: Date.now() });
      toast(f.title, { description: f.body });
      log("watcher", "alert fired", { level: "call", detail: `${f.title}: ${f.body}` });
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
