// P0.2 thread policy: the mobile curve must stay conservative (phones starve
// the UI thread above ~2-4 workers), desktop keeps cores-1 capped at 12.
// Null cores assume 4.

import { describe, expect, it } from "vitest";

import {
  prefillRateMsPerToken,
  prefirstTokenIdleMs,
  scaledHopDeadlineMs,
  threadPolicy,
} from "./runtime";

describe("threadPolicy", () => {
  it("mobile curve at 4 / 6 / 8 / 12 reported cores", () => {
    expect(threadPolicy(4, true)).toBe(2);
    expect(threadPolicy(6, true)).toBe(3);
    expect(threadPolicy(8, true)).toBe(4);
    expect(threadPolicy(12, true)).toBe(6);
  });

  it("desktop curve at 4 / 6 / 8 / 12 reported cores", () => {
    expect(threadPolicy(4, false)).toBe(3);
    expect(threadPolicy(6, false)).toBe(5);
    expect(threadPolicy(8, false)).toBe(7);
    expect(threadPolicy(12, false)).toBe(11);
  });

  it("unknown cores assume 4 on both curves", () => {
    expect(threadPolicy(null, true)).toBe(2);
    expect(threadPolicy(null, false)).toBe(3);
  });

  it("never returns less than one thread, even on absurd reports", () => {
    expect(threadPolicy(1, false)).toBe(1);
    expect(threadPolicy(1, true)).toBe(2); // mobile floor is 2 workers
  });
});

describe("prefill rate and scaled deadlines", () => {
  it("rate is null with no samples and tracks the 9th decile with them", () => {
    expect(prefillRateMsPerToken([])).toBeNull();
    // Cache-hit turns report small ttft over the whole prompt; the high
    // decile must reflect the full-prefill samples, not the hits.
    const samples = [1.9, 1.8, 2.0, 1.9, 2.1, 7.2, 7.1, 7.3, 7.2, 1.9];
    expect(prefillRateMsPerToken(samples)).toBeCloseTo(7.2, 5);
  });

  it("rate ignores non-finite and non-positive garbage", () => {
    expect(prefillRateMsPerToken([0])).toBeNull();
    expect(prefillRateMsPerToken([-3])).toBeNull();
    expect(prefillRateMsPerToken([NaN])).toBeNull();
    expect(prefillRateMsPerToken([5])).toBe(5);
  });

  it("idle ceiling stays at the static 75s floor until a rate exists", () => {
    expect(prefirstTokenIdleMs(null, 4000)).toBe(75_000);
  });

  it("idle ceiling scales with the rate but caps at 240s", () => {
    // IAB: ~7.2 ms/token x 3 x 4000t = 86.4s, above the floor.
    expect(prefirstTokenIdleMs(7.2, 4000)).toBe(86_400);
    // A 3400t prompt at the same rate clamps back up to the floor.
    expect(prefirstTokenIdleMs(7.2, 3400)).toBe(75_000);
    // Slow hypothetical backend: 3 x 30 x 4000 = 360s clamps to 240s.
    expect(prefirstTokenIdleMs(30, 4000)).toBe(240_000);
    // Tiny prompt on a fast backend stays at the floor.
    expect(prefirstTokenIdleMs(0.5, 200)).toBe(75_000);
  });

  it("hop deadline floors at 60s, caps at 180s", () => {
    expect(scaledHopDeadlineMs(null, 4000)).toBe(60_000);
    expect(scaledHopDeadlineMs(30, 4000)).toBe(180_000);
    expect(scaledHopDeadlineMs(0.5, 2000)).toBe(60_000);
    // 7.2 ms/token x 3 x 2000t = 43.2s clamps up to the 60s floor.
    expect(scaledHopDeadlineMs(7.2, 2000)).toBe(60_000);
    // 7.2 x 3 x 8000t = 172.8s survives above the floor.
    expect(scaledHopDeadlineMs(7.2, 8000)).toBeCloseTo(172_800, 0);
  });
});
