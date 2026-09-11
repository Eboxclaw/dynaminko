// The shared search-input rule: junk queries are rejected before execution
// (the 09-04 loop ran journal.search on empty/garbage queries and retried on
// the empty results), and the rule must cover every search-like tool so new
// ones inherit it automatically.

import { describe, expect, it } from "vitest";

import { TOOLS } from "./registry";
import { isSearchTool, searchQueryProblem } from "./types";

describe("searchQueryProblem", () => {
  it("accepts real search terms", () => {
    expect(searchQueryProblem("portfolio")).toBeNull();
    expect(searchQueryProblem("  INKO trades  ")).toBeNull();
    expect(searchQueryProblem("¿cómo está?")).toBeNull();
  });

  it("rejects the junk shapes the loop actually produced", () => {
    expect(searchQueryProblem("")).toContain("empty");
    expect(searchQueryProblem("   ")).toContain("empty");
    expect(searchQueryProblem("1")).toContain("too short");
    // The 230M's degenerate "1.1 1.1.1 1.1.1.1" pick: digits and dots, no term.
    expect(searchQueryProblem("1.1 1.1.1 1.1.1.1")).toContain("no search term");
    expect(searchQueryProblem("??? !!!")).toContain("no search term");
    expect(searchQueryProblem(undefined)).toContain("must be a string");
    expect(searchQueryProblem(42)).toContain("must be a string");
  });
});

describe("isSearchTool", () => {
  it("covers every live search-like tool in the registry", () => {
    const searchLike = TOOLS.filter((t) => t.action === "search");
    expect(searchLike.length).toBeGreaterThanOrEqual(2);
    for (const t of searchLike) {
      expect(isSearchTool(t)).toBe(true);
    }
    // Non-search tools stay outside the rule.
    expect(isSearchTool(TOOLS.find((t) => t.id === "web.read")!)).toBe(false);
  });
});
