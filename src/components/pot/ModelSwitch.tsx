// The inline model switch that lives beside the composer.
//
// Selecting a local model is an explicit activation: verify, load, wait for
// ready, then answer. The composer stays disabled while that happens, and a
// failed load stays on screen with a retry instead of scrolling away.

import { ChevronDown, Cloud, Cpu } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { useAi } from "@/hooks/useAi";
import { ACTION_LABEL } from "@/lib/ai/capability";
import { CLOUD_PROVIDERS } from "@/lib/ai/cloud";
import { patchAssistant } from "@/lib/store";
import { useDoc } from "@/hooks/useDoc";
import { cn } from "@/lib/utils";

const BACKEND_LABEL: Record<string, string> = {
  webgpu: "WebGPU",
  wasm: "WASM",
  cloud: "Cloud",
  unavailable: "not running",
};

export function ModelSwitch({
  ai,
  onOpenPanel,
  onBusyChange,
}: {
  ai: ReturnType<typeof useAi>;
  onOpenPanel: () => void;
  /** true while a model is being verified and loaded */
  onBusyChange?: (busy: boolean) => void;
}) {
  const doc = useDoc();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const cloud = ai.target.kind === "cloud";
  const cap = ai.capability;

  const state = switching
    ? "Loading…"
    : error
      ? "Load failed"
      : cloud
        ? "Cloud · Ready"
        : cap.generation === "loaded"
          ? `Local · Ready · ${BACKEND_LABEL[ai.backend] ?? ai.backend}`
          : cap.generation === "downloaded"
            ? "Local · On device"
            : cap.generation === "error"
              ? "Load failed"
              : "Local · Not installed";

  const pick = async (modelId: string) => {
    setOpen(false);
    setError(null);
    setSwitching(modelId);
    onBusyChange?.(true);
    const res = await ai.activate(modelId);
    setSwitching(null);
    onBusyChange?.(false);
    if (!res.ok) setError({ id: modelId, message: res.error ?? "the model failed to load" });
  };

  const pickCloud = (id: string) => {
    setOpen(false);
    setError(null);
    patchAssistant({ provider: "cloud", cloudId: id });
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "doodle-pill num inline-flex max-w-[15rem] items-center gap-1.5 px-2.5 py-1 text-[11px] hover:border-ink",
          error && "border-loss text-loss",
        )}
      >
        {cloud ? <Cloud className="h-3 w-3 shrink-0" /> : <Cpu className="h-3 w-3 shrink-0" />}
        <span className="min-w-0 truncate">{ai.target.label}</span>
        <span className="shrink-0 whitespace-nowrap text-ink-faint">{state}</span>
        <ChevronDown className="h-3 w-3 shrink-0" />

      </button>

      {error && (
        <button
          type="button"
          onClick={() => void pick(error.id)}
          className="doodle-pill ml-1 px-2 py-1 text-[11px] text-loss hover:border-loss"
        >
          Retry
        </button>
      )}

      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-2 w-72 overflow-hidden rounded-md border border-stroke bg-paper shadow-lg">
          <p className="eyebrow border-b border-stroke px-3 py-1.5">Local</p>
          <ul>
            {ai.models
              .filter((m) => m.generative)
              .map((m) => {
                const action = ai.actionFor(m.id);
                const active = !cloud && ai.modelId === m.id;
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      disabled={action === "unavailable"}
                      onClick={() => void pick(m.id)}
                      className={cn(
                        "flex w-full items-baseline gap-2 px-3 py-2 text-left text-[12px] hover:bg-ink/5",
                        active && "bg-ink/5 font-medium",
                        action === "unavailable" && "opacity-40",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{m.label}</span>
                      <span className="eyebrow shrink-0">
                        {active && ai.capability.generation === "loaded"
                          ? "Ready"
                          : ACTION_LABEL[action]}
                      </span>
                    </button>
                  </li>
                );
              })}
          </ul>
          <p className="eyebrow border-y border-stroke px-3 py-1.5">Cloud</p>
          <ul>
            {CLOUD_PROVIDERS.map((p) => {
              const cfg = doc.settings.assistant.cloud?.[p.id];
              const ready = Boolean(cfg?.apiKey);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={!ready}
                    onClick={() => pickCloud(p.id)}
                    className={cn(
                      "flex w-full items-baseline gap-2 px-3 py-2 text-left text-[12px] hover:bg-ink/5",
                      cloud && doc.settings.assistant.cloudId === p.id && "bg-ink/5 font-medium",
                      !ready && "opacity-40",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{p.label}</span>
                    <span className="eyebrow shrink-0">{ready ? "Ready" : "No key"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenPanel();
            }}
            className="w-full border-t border-stroke px-3 py-2 text-left text-[12px] text-ink-faint hover:bg-ink/5"
          >
            Model settings
          </button>
        </div>
      )}
    </div>
  );
}
