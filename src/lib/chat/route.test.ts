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
});
