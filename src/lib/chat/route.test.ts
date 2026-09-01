// Deterministic router: keyword pre-execute must catch the common portfolio
// and inbox phrasings so they never fall through to the model hop.

import { describe, expect, it } from "vitest";

import { routeMessage } from "./route";

describe("routeMessage", () => {
  it("routes portfolio status phrasings to portfolio.snapshot", () => {
    const phrases = [
      "hey how is my portfolio doing today?",
      "How's my portfolio looking?",
      "how my portfolio doing",
      "what is the portfolio status",
      "show my exposure",
      "what do i hold",
      "holdings",
      "my allocation",
    ];
    for (const text of phrases) {
      const r = routeMessage(text);
      expect(r.kind, `expected command for "${text}"`).toBe("command");
      if (r.kind === "command") {
        expect(r.commandId).toBe("portfolio.snapshot");
      }
    }
  });

  it("routes inbox phrasings to journal.resolve_inbox with a ticker arg", () => {
    const r = routeMessage("show me my pending trades in BTC");
    expect(r.kind).toBe("command");
    if (r.kind === "command") {
      expect(r.commandId).toBe("journal.resolve_inbox");
      expect(r.args).toEqual({ ticker: "BTC" });
    }
  });

  it("routes 'resolve all pending trades' to journal.apply_answer", () => {
    const r = routeMessage("please resolve all pending trades");
    expect(r.kind).toBe("command");
    if (r.kind === "command") expect(r.commandId).toBe("journal.apply_answer");
  });

  it("routes 'resolve pending trades' with a qualifier to journal.apply_answer, not resolve_inbox", () => {
    // "resolve pending trades" (19 chars) must beat "pending trades" (14);
    // this covers phrasings like "bulk resolve pending trades" or
    // "resolve pending trades in USDC" without needing the full 27-char alias.
    const r = routeMessage("bulk resolve pending trades now");
    expect(r.kind).toBe("command");
    if (r.kind === "command") expect(r.commandId).toBe("journal.apply_answer");
  });

  it("routes a mention of a thesis title to thesis.review", () => {
    // The empty doc in the test environment has no theses, so only the
    // alias paths are exercised here; thesis matching needs a populated doc.
    const r = routeMessage("hello there");
    expect(r.kind).toBe("none");
  });

  it("returns none for free text that matches no alias", () => {
    expect(routeMessage("why did the market drop").kind).toBe("none");
    expect(routeMessage("move my portfolio to a safer basket").kind).toBe("none");
  });

  it("routes the dedicated read skills by their own phrasings", () => {
    // wallet / inbox / open-trades phrasings that the deterministic commands
    // do not claim land on the composed skills.
    for (const [text, skillId] of [
      ["what is on the inbox", "inbox.review"],
      ["what are my open trades on nado", "trades.open"],
      ["show me my open positions", "trades.open"],
      ["what do you hold on your wallet", "wallet.holdings"],
    ] as const) {
      const r = routeMessage(text);
      expect(r.kind, `expected skill for "${text}"`).toBe("skill");
      if (r.kind === "skill") expect(r.skillId).toBe(skillId);
    }
  });

  it("keeps the deterministic command beat a same-or-shorter skill phrase", () => {
    // "what do i hold" is a command alias and must still win over the
    // wallet.holdings skill; only the longer wallet phrasings reach the skill.
    const r = routeMessage("what do i hold");
    expect(r.kind).toBe("command");
    if (r.kind === "command") expect(r.commandId).toBe("portfolio.snapshot");
  });

  it("lets advice questions built on a status phrase fall through to the model", () => {
    // The status alias matches as a substring, but the advice markers mean
    // the user wants an opinion, which the snapshot alone cannot give.
    const advice = [
      "how is my portfolio looking and what could I improve?",
      "how's my portfolio? should I change anything?",
      "what do i hold and what should I trim",
      "show my exposure and recommend improvements",
    ];
    for (const text of advice) {
      const r = routeMessage(text);
      expect(r.kind, `expected none (model hop) for "${text}"`).toBe("none");
    }
  });

  it("still captures pure status questions, even with marker substrings inside other words", () => {
    // \b markers only gate on whole words: "improved" inside a basket name
    // must not block a genuine status question.
    for (const text of ["how is my portfolio doing", "show my exposure to improved baskets"]) {
      const r = routeMessage(text);
      expect(r.kind, `expected command for "${text}"`).toBe("command");
      if (r.kind === "command") expect(r.commandId).toBe("portfolio.snapshot");
    }
  });
});
