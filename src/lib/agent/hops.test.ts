import { describe, expect, it } from "vitest";

import { DECIDE_SYSTEM, decideUserContent, hopEvidence, hopKey, isRepeatHop } from "./hops";

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

describe("decide prompt prefix stability", () => {
  const base = {
    question: "what patterns do you see in my recent trades",
    menuText: "journal.filter: filter entries by ticker (inputs: ticker)",
  };

  it("keeps the system prompt free of per-hop state", () => {
    // The slot cache reuses the longest common token prefix of consecutive
    // completions; a per-hop byte anywhere in the head kills the reuse.
    expect(DECIDE_SYSTEM).not.toMatch(/At most \d+ more tool picks/);
  });

  it("carries no FACTS block: facts ride in the compiled shared head", () => {
    // Facts render once, in the head every call of the turn shares. A FACTS
    // section in the user content would break decide/answer byte sharing.
    const content = decideUserContent(base);
    expect(content).not.toContain("FACTS");
    expect(content.startsWith("QUESTION\n")).toBe(true);
  });

  it("appends the remaining count after evidence, at the tail", () => {
    const content = decideUserContent({ ...base, evidence: "journal.filter (ok): 2 entries", remaining: 1 });
    expect(content.indexOf("EARLIER RESULTS THIS TURN")).toBeLessThan(
      content.indexOf("At most 1 more tool picks"),
    );
    expect(content.endsWith("At most 1 more tool picks this turn.")).toBe(true);
  });

  it("makes hop 1 a strict prefix of hop 2 so only new evidence prefills", () => {
    const head = decideUserContent(base);
    const hop2 = decideUserContent({
      ...base,
      evidence: 'journal.filter (ok): 2 entries\nlatest result data: [{"ticker":"INKO"}]',
      remaining: 1,
    });
    expect(hop2.startsWith(head)).toBe(true);
    expect(hop2.length).toBeGreaterThan(head.length);
  });
});
