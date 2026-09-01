// P0.2 thread policy: the mobile curve must stay conservative (phones starve
// the UI thread above ~2-4 workers), desktop keeps cores-1 capped at 12.
// Null cores assume 4.

import { describe, expect, it } from "vitest";

import { threadPolicy } from "./runtime";

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
