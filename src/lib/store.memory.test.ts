import { describe, expect, it } from "vitest";

import { memoryPrompt, type MemoryEntry } from "./store";

const entry = (id: string, text: string): MemoryEntry =>
  ({ id, text, ts: 0 }) as unknown as MemoryEntry;

describe("memoryPrompt cross-session bleed", () => {
  it("keeps deliberate notes but excludes auto session summaries", () => {
    const out = memoryPrompt([
      entry("m1", "session summary: user asked about ink chain news and got a bitrue link"),
      entry("m2", "user prefers basket names in uppercase"),
      entry("m3", "Session Summary: another old chat recap"),
    ]);
    expect(out).toContain("[m2] user prefers basket names in uppercase");
    expect(out).not.toContain("ink chain news");
    expect(out).not.toContain("another old chat recap");
  });

  it("returns empty when only summaries exist", () => {
    expect(
      memoryPrompt([entry("m1", "session summary: only history, no notes")]),
    ).toBe("");
  });
});
