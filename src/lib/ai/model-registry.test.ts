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
  budgetOutcome,
  deviceProfile,
  kvCacheGb,
  memoryBudgetGb,
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
    expect(DEFAULT_CTX).toBeLessThanOrEqual(m.maxCtx);
  });

  it("the roster carries no device-class gate: every model is offered everywhere", () => {
    // The old desktopOnly flag hid the 2.6B and the Thinking tune on touch
    // devices regardless of RAM. Detection now tunes the inference PATH, it
    // never filters the roster; fit is the budgetGuard's job at load time.
    for (const m of MODELS) expect("desktopOnly" in m).toBe(false);
  });

  it("the formerly gated models fit an 8GB-class phone envelope at 8K", () => {
    // deviceMemory 8 x 0.8 = the 6.4 GB envelope a Pixel-class phone reports.
    expect(budgetOutcome(MODEL_BY_ID["lfm2-2_6"], 8192, 6.4).verdict).toBe("SAFE");
    expect(budgetOutcome(MODEL_BY_ID["lfm2-350-thinking"], 8192, 6.4).verdict).toBe("SAFE");
  });

  it("the roster is the approved LFM2.5 + Qwen set: the 1.2B pair is gone", () => {
    const ids = MODELS.map((m) => m.id);
    expect(ids).not.toContain("lfm2-1_2-instruct");
    expect(ids).not.toContain("lfm2-1_2-thinking");
    expect(ids).toContain("lfm2-350");
    expect(ids).toContain("lfm2-350-thinking");
    expect(ids).toContain("lfm2-450-vl");
    expect(ids).toContain("lfm2-2_6");
    expect(ids).toContain("qwen38-2b-distill");
  });

  it("the encoder is a non-generative GGUF with the MiniLM fallback beside it", () => {
    const enc = MODEL_BY_ID[ENCODER_ID];
    expect(enc.runtime).toBe("gguf");
    expect(enc.generative).toBe(false);
    expect(enc.capabilities).toEqual(["encode"]);
    const nonGenerative = MODELS.filter((m) => !m.generative).map((m) => m.id).sort();
    expect(nonGenerative).toEqual(["lfm2-5-embed-350m", "minilm-6-v2"]);
    // The fallback stays a transformers-runtime encoder.
    expect(MODEL_BY_ID["minilm-6-v2"].runtime).toBe("transformers");
  });

  it("local sampling follows the 0.2 standard with card-explained exceptions", () => {
    expect(MODEL_BY_ID["lfm2-350"].sampling?.temperature).toBe(0.2);
    expect(MODEL_BY_ID["lfm2-2_6"].sampling?.temperature).toBe(0.2);
    expect(MODEL_BY_ID["lfm2-450-vl"].sampling?.temperature).toBe(0.2);
    // Card-explicit exceptions: the Thinking tune starts at the standard, the
    // Qwen distill keeps its card's 0.6.
    expect(MODEL_BY_ID["lfm2-350-thinking"].sampling?.temperature).toBe(0.2);
    expect(MODEL_BY_ID["qwen38-2b-distill"].sampling?.temperature).toBe(0.6);
    expect(MODEL_BY_ID["qwen38-2b-distill"].sampling?.topP).toBe(0.95);
  });

  it("the Qwen hybrid leaves its KV geometry unknown on purpose", () => {
    // Gated DeltaNet layers carry no context-scaled KV; a guess here would
    // misprice the budget, so the model degrades to UNCERTAIN instead.
    expect(MODEL_BY_ID["qwen38-2b-distill"].kv).toBeUndefined();
    expect(budgetOutcome(MODEL_BY_ID["qwen38-2b-distill"], 8192, 8).verdict).toBe("UNCERTAIN");
    // The Thinking 350M shares the base backbone geometry.
    expect(kvCacheGb(MODEL_BY_ID["lfm2-350-thinking"], 8192, "q8_0")).toBeCloseTo(0.0498, 3);
  });

  it("only the 2.6B forces the separate-runtime encoder (co-residency limit)", () => {
    for (const m of MODELS.filter((x) => x.generative)) {
      expect(m.encoderFallback ?? false).toBe(m.id === "lfm2-2_6");
    }
  });

  it("the 2.6B keeps its real 131072 card ceiling and the ladder reaches it", () => {
    expect(MODEL_BY_ID["lfm2-2_6"].maxCtx).toBe(131072);
    expect(CTX_CHOICES).toContain(131072);
    // Hybrid KV (8 of 30 layers): 128K at q8_0 ≈ 1.0625 GiB (= the ~1.14
    // decimal GB of the card math), a capacity question the budget model
    // evaluates, never a reason to cap the card.
    expect(kvCacheGb(MODEL_BY_ID["lfm2-2_6"], 131072, "q8_0")).toBeCloseTo(1.0625, 3);
    expect(kvCacheGb(MODEL_BY_ID["lfm2-2_6"], 65536, "q8_0")).toBeCloseTo(0.53125, 3);
  });

  it("every reasoning model carries the 2048 starting thinking budget", () => {
    const reasoning = MODELS.filter((m) => m.reasoning);
    expect(reasoning.length).toBeGreaterThan(0);
    for (const m of reasoning) expect(m.reasoningBudget).toBe(2048);
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

  it("KV reference values match the published LFM2.5 architecture", () => {
    // 6 attention layers x 8 KV heads x 64 head dim, q8_0 K+V:
    // 6*8192*8*64*1.0625*2 bytes = 53,477,376 B
    expect(kvCacheGb(MODEL_BY_ID["lfm2-350"], 8192, "q8_0")).toBeCloseTo(0.0498, 3);
    // f16 doubles it
    expect(kvCacheGb(MODEL_BY_ID["lfm2-350"], 8192, "f16")).toBeCloseTo(0.0936, 3);
    // 2.6B carries KV on 8 attention layers: 8*65536*1024*1.0625 bytes
    expect(kvCacheGb(MODEL_BY_ID["lfm2-2_6"], 65536, "q8_0")).toBeCloseTo(0.531, 2);
    // The gated VL model has unknown geometry: no promise is made.
    expect(kvCacheGb(MODEL_BY_ID["lfm2-450-vl"], 8192)).toBeNull();
    expect(memoryBudgetGb(MODEL_BY_ID["lfm2-450-vl"], 8192)).toBeNull();
  });

  it("budget peak reference: 350M at 8192 lands just above half a gigabyte", () => {
    // weights 0.219 + KV 0.0498 + buffers 0.0263 + overhead 0.15, +15% margin
    expect(memoryBudgetGb(MODEL_BY_ID["lfm2-350"], 8192)).toBeCloseTo(0.512, 2);
  });

  it("budget outcomes reject only true overflow predictions", () => {
    // 2.6B at 65536: peak ~2.83 GB. All three outcomes in one table:
    // 8 GB class -> comfortable SAFE; 4 GB class -> inside the 70% near-band
    // (UNCERTAIN proceeds); 2.6 GB class -> predicted overflow (UNSAFE).
    const big = MODEL_BY_ID["lfm2-2_6"];
    expect(budgetOutcome(big, 65536, 8).verdict).toBe("SAFE");
    expect(budgetOutcome(big, 65536, 4).verdict).toBe("UNCERTAIN");
    expect(budgetOutcome(big, 65536, 2.6).verdict).toBe("UNSAFE");
    // Missing telemetry never blocks (UNCERTAIN proceeds), it just warns.
    expect(budgetOutcome(big, 65536, null).verdict).toBe("UNCERTAIN");
    // Unknown architecture degrades to UNCERTAIN, never a guess.
    expect(budgetOutcome(MODEL_BY_ID["lfm2-450-vl"], 8192, 8).verdict).toBe("UNCERTAIN");
  });

  it("recommendModel falls back to the default when probing is unavailable", () => {
    expect(recommendModel(deviceProfile()).id).toBe(DEFAULT_MODEL_ID);
    // An unprobed profile (SSR / first paint) also defaults.
    expect(recommendModel({ ramGb: null, cores: null, mobile: false, probed: false }).id).toBe(
      DEFAULT_MODEL_ID,
    );
  });

  it("recommendModel suggests the 350M on a tight 2GB phone", () => {
    const rec = recommendModel({ ramGb: 2, cores: 4, mobile: true, probed: true });
    // The suggestion is order-driven and the budget is no longer halved for
    // touch: 2 GB reported covers the 350M's 1.5 GB minRam directly.
    expect(rec.id).toBe("lfm2-350");
  });

  it("recommendModel ignores touch for the suggestion: same memory, same pick", () => {
    // The old rule excluded desktop-flagged models and halved the mobile
    // budget; the phone pick now depends only on reported memory and order.
    const phone = recommendModel({ ramGb: 8, cores: 8, mobile: true, probed: true });
    const desktop = recommendModel({ ramGb: 8, cores: 8, mobile: false, probed: true });
    expect(phone.id).toBe(desktop.id);
    expect(phone.reason).toContain("touch device");
  });
});
