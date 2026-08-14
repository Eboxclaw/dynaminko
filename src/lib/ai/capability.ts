// One place that answers "what can the assistant actually do right now".
//
// Every surface reads this instead of inferring from a status phase. The rule
// that matters: the semantic encoder is an accelerator, never a gate. When it
// is missing the router falls back to keywords and generation is untouched.

import { MODEL_BY_ID, type AiStatus, type ModelState } from "@/lib/ai";

export type CapabilitySlot = "missing" | "downloaded" | "loaded" | "error" | "not_required";

export type ModelCapabilityState = {
  modelId: string;
  /** prose generation */
  generation: CapabilitySlot;
  /** image input on the selected model */
  vision: CapabilitySlot;
  /** encoder-backed routing and retrieval */
  semantic: CapabilitySlot;
  canAnswer: boolean;
  canRoute: boolean;
  /** true when routing is running on keywords instead of vectors */
  routeFallback: boolean;
};

/** Cache state for one generative model, independent of what is selected. */
export type InstallState = "missing" | "partial" | "complete";

export type ModelAction = "download" | "resume" | "load" | "unload" | "delete" | "unavailable";

/** The action a button must offer, derived from cache and load state only. */
export function modelAction(install: InstallState, loaded: boolean, available = true): ModelAction {
  if (!available) return "unavailable";
  if (loaded) return "unload";
  if (install === "missing") return "download";
  if (install === "partial") return "resume";
  return "load";
}

/**
 * Every action that applies to one model right now, so each is its own button
 * instead of one control that relabels itself.
 */
export function modelActions(
  install: InstallState,
  loaded: boolean,
  available = true,
): ModelAction[] {
  if (!available) return ["unavailable"];
  const out: ModelAction[] = [];
  if (install === "missing") out.push("download");
  else if (install === "partial") out.push("resume");
  else if (!loaded) out.push("load");
  if (loaded) out.push("unload");
  if (install !== "missing") out.push("delete");
  return out;
}

export const ACTION_LABEL: Record<ModelAction, string> = {
  download: "Download",
  resume: "Resume",
  load: "Load",
  unload: "Unload",
  delete: "Delete",
  unavailable: "Unavailable",
};

function generationSlot(state: ModelState | undefined, status: AiStatus): CapabilitySlot {
  if (status.phase === "error") return "error";
  if (state === "loaded") return "loaded";
  if (state === "downloaded" || state === "loading") return "downloaded";
  if (state === "error") return "error";
  return "missing";
}

export function deriveCapability(input: {
  modelId: string;
  state: ModelState | undefined;
  status: AiStatus;
  cloud: boolean;
  encoder: { state: string; cached: boolean };
  /** false when nothing in the current surface needs semantic matching */
  semanticWanted?: boolean;
}): ModelCapabilityState {
  const spec = MODEL_BY_ID[input.modelId];
  const generation: CapabilitySlot = input.cloud
    ? "loaded"
    : generationSlot(input.state, input.status);

  const vision: CapabilitySlot = spec?.vision
    ? generation === "loaded"
      ? "loaded"
      : generation
    : "not_required";

  let semantic: CapabilitySlot;
  if (input.semanticWanted === false) semantic = "not_required";
  else if (input.encoder.state === "error") semantic = "error";
  else if (input.encoder.state === "loaded") semantic = "loaded";
  else if (input.encoder.cached) semantic = "downloaded";
  else semantic = "missing";

  return {
    modelId: input.modelId,
    generation,
    vision,
    semantic,
    canAnswer: generation === "loaded",
    // Routing always works: vectors when the encoder is loaded, keywords otherwise.
    canRoute: true,
    routeFallback: semantic !== "loaded" && semantic !== "not_required",
  };
}

export function semanticLabel(cap: ModelCapabilityState): string {
  switch (cap.semantic) {
    case "loaded":
      return "READY";
    case "downloaded":
      return "NOT LOADED · fallback active";
    case "error":
      return "ERROR · fallback active";
    case "not_required":
      return "NOT REQUIRED";
    default:
      return "NOT INSTALLED · fallback active";
  }
}
