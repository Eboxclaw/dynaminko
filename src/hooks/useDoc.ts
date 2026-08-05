import { useCallback, useSyncExternalStore } from "react";

import {
  ensureLoaded,
  getDoc,
  subscribe,
  EMPTY_DOC,
  patchSettings,
  type PotDoc,
} from "@/lib/store";

/** Subscribe to the whole local document. SSR renders the empty document. */
export function useDoc(): PotDoc {
  return useSyncExternalStore(
    (cb) => {
      ensureLoaded();
      return subscribe(cb);
    },
    () => {
      ensureLoaded();
      return getDoc();
    },
    () => EMPTY_DOC,
  );
}

export function useSettings() {
  const doc = useDoc();
  const set = useCallback((patch: Parameters<typeof patchSettings>[0]) => {
    patchSettings(patch);
  }, []);
  return [doc.settings, set] as const;
}
