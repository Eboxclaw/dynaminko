import { useEffect, useState } from "react";
import type { PublicDataSnapshot } from "@/lib/public-data";

export function usePublicData() {
  const [data, setData] = useState<PublicDataSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/public-data", {
          headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error(`public data ${response.status}`);
        const snapshot = (await response.json()) as PublicDataSnapshot;
        if (!cancelled) {
          setData(snapshot);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "public data unavailable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const id = window.setInterval(load, 3 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return { data, error, loading };
}
