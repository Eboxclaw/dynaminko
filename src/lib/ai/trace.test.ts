// Trace contract: the KPI clock, phase summing, and the completed-turn
// snapshot /usage reads (a command turn's beginTurn must not erase it).

import { describe, expect, it } from "vitest";

import {
  beginTurn,
  completedTurn,
  markAnswerDone,
  markFirstUsefulAction,
  measure,
  tagModel,
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
});
