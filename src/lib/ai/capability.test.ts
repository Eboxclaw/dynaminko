// The one place that answers "what can the assistant do right now".
// These tests pin the action state machine, including the partial state that
// a downloaded-but-interrupted model must surface as Resume.

import { describe, expect, it } from "vitest";

import { deriveCapability, modelAction, modelActions } from "./capability";

describe("modelAction", () => {
  it("a loaded model offers only unload", () => {
    expect(modelAction("complete", true)).toBe("unload");
    expect(modelAction("partial", true)).toBe("unload");
  });

  it("missing downloads, partial resumes, complete loads", () => {
    expect(modelAction("missing", false)).toBe("download");
    expect(modelAction("partial", false)).toBe("resume");
    expect(modelAction("complete", false)).toBe("load");
  });
});

describe("modelActions", () => {
  it("offers every applicable action as its own button", () => {
    expect(modelActions("missing", false)).toEqual(["download"]);
    expect(modelActions("partial", false)).toEqual(["resume", "delete"]);
    expect(modelActions("complete", false)).toEqual(["load", "delete"]);
    expect(modelActions("complete", true)).toEqual(["unload", "delete"]);
  });
});

describe("deriveCapability", () => {
  const encoder = { state: "loaded", cached: true };

  it("local loaded model can answer and route without fallback", () => {
    const cap = deriveCapability({
      modelId: "lfm2-350",
      state: "loaded",
      status: { phase: "ready", modelId: "lfm2-350" },
      cloud: false,
      encoder,
    });
    expect(cap.canAnswer).toBe(true);
    expect(cap.canRoute).toBe(true);
    expect(cap.routeFallback).toBe(false);
    expect(cap.semantic).toBe("loaded");
  });

  it("missing encoder falls back to keyword routing without blocking", () => {
    const cap = deriveCapability({
      modelId: "lfm2-350",
      state: "loaded",
      status: { phase: "ready", modelId: "lfm2-350" },
      cloud: false,
      encoder: { state: "missing", cached: false },
    });
    expect(cap.routeFallback).toBe(true);
    expect(cap.canRoute).toBe(true);
  });

  it("cloud provider always answers", () => {
    const cap = deriveCapability({
      modelId: "lfm2-350",
      state: "missing",
      status: { phase: "idle" },
      cloud: true,
      encoder: { state: "missing", cached: false },
    });
    expect(cap.canAnswer).toBe(true);
    expect(cap.generation).toBe("loaded");
  });

  it("a download in error reports an error slot", () => {
    const cap = deriveCapability({
      modelId: "lfm2-350",
      state: "error",
      status: { phase: "error", message: "download failed", modelId: "lfm2-350" },
      cloud: false,
      encoder,
    });
    expect(cap.generation).toBe("error");
    expect(cap.canAnswer).toBe(false);
  });
});
