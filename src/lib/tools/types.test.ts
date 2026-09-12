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

  it("rejects the pasted-context shapes measured in the decide A/B", () => {
    // 230M, both arms, twice: the tool's purpose text pasted as the query.
    const description =
      "Free-text match over records and tickers, including venue and pnl filtering";
    expect(
      searchQueryProblem(description, { description }),
    ).toContain("tool's own description");
    // Punctuation and case drift do not dodge the comparison.
    expect(
      searchQueryProblem("Free-text match over records and tickers, including venue and pnl filtering.", {
        description,
      }),
    ).toContain("tool's own description");
    // 350M, head arm: the whole question echoed back as the query.
    const question = "What do you think about my current setup?";
    expect(searchQueryProblem(question, { userText: question })).toContain("echoes the full question");
    // A short question used verbatim stays legal: it can be a real term.
    expect(searchQueryProblem("inko price?", { userText: "inko price?" })).toBeNull();
    // A genuine term still passes with the context present.
    expect(searchQueryProblem("meme exposure", { description, userText: question })).toBeNull();
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
