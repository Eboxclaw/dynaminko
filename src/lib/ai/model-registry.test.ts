// Invariants of the model registry. The worker imports this exact module, so
// any drift between "what the UI offers" and "what the worker can load" is a
// bug these tests catch.

import { describe, expect, it } from "vitest";

import {
  CTX_CHOICES,
  DEFAULT_CTX,
  DEFAULT_MODEL_ID,
  ENCODER_ID,
  MODELS,
  MODEL_BY_ID,
  deviceProfile,
  memoryEstimateGb,
  recommendModel,
} from "../ai";

describe("model registry", () => {
  it("has unique, resolvable ids", () => {
    const ids = MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(MODEL_BY_ID[id]).toBeDefined();
  });

  it("the default model exists, is generative, and fits every device", () => {
    const m = MODEL_BY_ID[DEFAULT_MODEL_ID];
    expect(m).toBeDefined();
    expect(m.generative).toBe(true);
    expect(m.desktopOnly).toBeFalsy();
    expect(DEFAULT_CTX).toBeLessThanOrEqual(m.maxCtx);
  });

  it("the encoder is the only non-generative model and is a transformers runtime", () => {
    const enc = MODEL_BY_ID[ENCODER_ID];
    expect(enc.runtime).toBe("transformers");
    expect(enc.generative).toBe(false);
    expect(MODELS.filter((m) => !m.generative).map((m) => m.id)).toEqual([ENCODER_ID]);
  });

  it("every ctx choice is a valid number and the default is one of them", () => {
    expect(CTX_CHOICES).toContain(DEFAULT_CTX);
    for (const c of CTX_CHOICES) expect(Number.isFinite(c)).toBe(true);
  });

  it("models with a sampling block keep plausible sampling values", () => {
    for (const m of MODELS) {
      if (!m.sampling) continue;
      expect(m.sampling.temperature).toBeGreaterThanOrEqual(0);
      expect(m.sampling.temperature).toBeLessThanOrEqual(1);
      expect(m.sampling.repeatPenalty).toBeGreaterThanOrEqual(1);
    }
  });

  it("memory estimates grow with ctx and never go negative", () => {
    const m = DEFAULT_MODEL_ID;
    const small = memoryEstimateGb(m, 1024);
    const big = memoryEstimateGb(m, 32128);
    expect(small).toBeGreaterThan(0);
    expect(big).toBeGreaterThan(small);
    expect(memoryEstimateGb("no-such-model", 8192)).toBe(0);
  });

  it("recommendModel falls back to the default when probing is unavailable", () => {
    expect(recommendModel(deviceProfile()).id).toBe(DEFAULT_MODEL_ID);
    // An unprobed profile (SSR / first paint) also defaults.
    expect(recommendModel({ ramGb: null, cores: null, mobile: false, probed: false }).id).toBe(
      DEFAULT_MODEL_ID,
    );
  });

  it("recommendModel falls back to the default 350M on a tight 2GB phone", () => {
    const rec = recommendModel({ ramGb: 2, cores: 4, mobile: true, probed: true });
    // Mobile halves the reported budget to 1GB, below every model's minRam,
    // so the fallback default (350M) is returned.
    expect(rec.id).toBe("lfm2-350");
  });

  it("recommendModel never recommends a desktop-only model on a phone", () => {
    const rec = recommendModel({ ramGb: 16, cores: 8, mobile: true, probed: true });
    expect(MODEL_BY_ID[rec.id].desktopOnly).toBeFalsy();
  });
});
