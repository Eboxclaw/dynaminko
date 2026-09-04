// Trace contract: the KPI clock, phase summing, and the completed-turn
// snapshot /usage reads (a command turn's beginTurn must not erase it).

import { describe, expect, it } from "vitest";

import {
  beginTurn,
  completedTurn,
  markAnswerDone,
  markFirstUsefulAction,
  markTurnFailed,
  measure,
  tagGeneration,
  tagModel,
  tagRuntime,
  tagTurn,
} from "./trace";

describe("perf trace", () => {
  it("sums repeated measures of the same phase and tags the turn once", () => {
    beginTurn();
    tagTurn("q1");
    tagModel("m1", "webgpu");
    tagModel("m2"); // first tag wins
    measure("semantic", 10, "a");
    measure("semantic", 5, "b");
    markFirstUsefulAction();
    markFirstUsefulAction(); // idempotent
    markAnswerDone();
    const t = completedTurn();
    expect(t?.question).toBe("q1");
    expect(t?.model).toBe("m1");
    expect(t?.phases.semantic?.ms).toBe(15);
    expect(t?.timeToUsefulActionMs).toBeLessThanOrEqual(t?.totalMs ?? 0);
  });

  it("keeps the completed turn stable across the next beginTurn", () => {
    beginTurn();
    markAnswerDone();
    const done = completedTurn();
    expect(done?.totalMs).not.toBeNull();
    beginTurn(); // a /usage command turn resets the active trace…
    expect(completedTurn()).toBe(done); // …but the snapshot survives
  });

  it("runtime tags merge field-by-field and land in the completed snapshot", () => {
    beginTurn();
    tagTurn("q-rt");
    tagRuntime({ backend: "webgpu", threadsRequested: 9 });
    tagRuntime({ threadsEffective: 1, gpuLayers: 30, nCtx: 16384 });
    tagGeneration({
      promptTokens: 2861,
      promptTokensEstimated: true,
      outputTokens: 64,
      ttftMs: 41000,
      decodeTps: 5.2,
      totalMs: 44500,
      reasoningTokens: null,
    });
    markAnswerDone();
    const t = completedTurn();
    // Field-by-field merge: the backend survives the second partial tag.
    expect(t?.runtime).toEqual({
      backend: "webgpu",
      threadsRequested: 9,
      threadsEffective: 1,
      gpuLayers: 30,
      nCtx: 16384,
    });
    expect(t?.generation?.decodeTps).toBe(5.2);
    expect(t?.generation?.promptTokensEstimated).toBe(true);
  });

  it("a failed turn freezes itself as the completed snapshot with the reason", () => {
    beginTurn();
    tagTurn("doomed question");
    measure("decide", 43500, "hop 1");
    // The answer never landed: no markAnswerDone, straight to the failure.
    markTurnFailed("chat timed out");
    const t = completedTurn();
    expect(t?.failed).toBe("chat timed out");
    expect(t?.question).toBe("doomed question");
    expect(t?.phases.decide?.ms).toBe(43500);
    // No useful-action KPI: a failed turn never produced one.
    expect(t?.timeToUsefulActionMs).toBeUndefined();
    // And the next beginTurn does not erase it (same guarantee as success).
    beginTurn();
    expect(completedTurn()?.failed).toBe("chat timed out");
  });
});
