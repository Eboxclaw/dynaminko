import { describe, expect, it } from "vitest";

import { hopEvidence, hopKey, isRepeatHop } from "./hops";

describe("hopEvidence", () => {
  it("is empty before any hop ran", () => {
    expect(hopEvidence([])).toBe("");
  });

  it("lists every observation and caps the latest data", () => {
    const big = "x".repeat(3000);
    const evidence = hopEvidence([
      { id: "web.search", status: "ok", summary: "3 results" },
      { id: "portfolio.read", status: "ok", summary: "wallet ~$1907", data: { total: 777 } },
      { id: "journal.search", status: "ok", summary: "matched", data: big },
    ]);
    expect(evidence).toContain("web.search (ok): 3 results");
    expect(evidence).toContain("portfolio.read (ok): wallet ~$1907");
    expect(evidence).toContain("journal.search (ok): matched");
    expect(evidence).toContain("latest result data:");
    // only the latest observation's data rides along
    expect(evidence).not.toContain("777");
    const dataLine = evidence.split("\n").find((l) => l.startsWith("latest result data:")) ?? "";
    expect(dataLine.length).toBeLessThan(3000);
    expect(dataLine).toContain("[clipped]");
  });

  it("passes string data through the same cap", () => {
    const evidence = hopEvidence([{ id: "web.read", status: "ok", data: "y".repeat(2000) }]);
    const dataLine = evidence.split("\n").find((l) => l.startsWith("latest result data:")) ?? "";
    expect(dataLine).toContain("[clipped]");
  });
});

describe("hop keys", () => {
  it("detects an identical repeat hop", () => {
    const key = hopKey("journal.search", { query: "inko" });
    expect(isRepeatHop(key, [hopKey("portfolio.read", {}), key])).toBe(true);
    expect(isRepeatHop(key, [hopKey("portfolio.read", {})])).toBe(false);
    expect(isRepeatHop(hopKey("journal.search", { query: "inko", limit: 3 }), [key])).toBe(false);
  });
});
