// stripToolCallMarkup: small models echo the tool-call syntax they see in the
// prompt into their answer. This strips it before the text is shown or
// replayed, and leaves ordinary prose (even prose that merely mentions the
// word "tool_call") byte-identical.

import { describe, expect, it } from "vitest";
import { splitThinking, stripToolCallMarkup } from "@/lib/ai";

describe("stripToolCallMarkup", () => {
  it("removes a paired <tool_call_start>...</tool_call_end> block (the observed 2.6B form)", () => {
    const out = stripToolCallMarkup(
      "You hold several tokens.\n<tool_call_start>portfolio.read()</tool_call_end>Based on that, you are up about 12%.",
    );
    expect(out).not.toContain("tool_call");
    expect(out).toContain("You hold several tokens.");
    expect(out).toContain("you are up about 12%.");
  });

  it("removes the OpenAI-style <tool_call>...</tool_call> form", () => {
    const out = stripToolCallMarkup(
      "Sure. <tool_call>journal.search({query: x})</tool_call> Done.",
    );
    expect(out).not.toContain("tool_call");
    expect(out).toContain("Sure.");
    expect(out).toContain("Done.");
  });

  it("removes a stray unclosed opening tag", () => {
    const out = stripToolCallMarkup("Result: <tool_call_start>portfolio.read()</tool_call_end>");
    expect(out).not.toContain("tool_call");
    expect(out).toBe("Result:");
  });

  it("removes a stray closing tag with no opener", () => {
    const out = stripToolCallMarkup("You are up.</tool_call_end> Keep that in mind.");
    expect(out).not.toContain("tool_call");
    expect(out).toContain("You are up.");
    expect(out).toContain("Keep that in mind.");
  });

  it("collapses the whitespace left behind by a removed inline block", () => {
    const out = stripToolCallMarkup("a <tool_call_start>x</tool_call_end> b");
    expect(out).toBe("a b");
  });

  it("leaves prose that only mentions the word tool_call untouched", () => {
    const text = "The tool_call syntax is part of the prompt contract.";
    expect(stripToolCallMarkup(text)).toBe(text);
  });

  it("leaves ordinary answers byte-identical (no tool_call at all)", () => {
    const text = "You hold 3 tokens, up 12% on the month. BTC is your largest position.";
    expect(stripToolCallMarkup(text)).toBe(text);
  });
});

describe("splitThinking + stripToolCallMarkup together", () => {
  it("strips markup the model leaked inside its thinking block too", () => {
    const raw =
      " thinkingplan <tool_call_start>journal.search()</tool_call_end> to run the tool.</think>You are up about 12%.";
    const { thinking, answer } = splitThinking(raw);
    expect(stripToolCallMarkup(thinking ?? "")).not.toContain("tool_call");
    expect(stripToolCallMarkup(thinking ?? "")).toContain("plan to run the tool.");
    expect(stripToolCallMarkup(answer)).toBe("You are up about 12%.");
  });

  it("strips a tool-call block the model appended after a clean answer", () => {
    const raw =
      " thinkingchecking the portfolio.</think>You are up about 12%.\n<tool_call_start>portfolio.read()</tool_call_end>";
    const { answer } = splitThinking(raw);
    expect(stripToolCallMarkup(answer)).toBe("You are up about 12%.");
  });

  it("splits a real <think> block with an answer after it", () => {
    const raw = "<think>\nLet me check the holdings.\n</think>You hold $1,907 across 6 tokens.";
    const { thinking, answer } = splitThinking(raw);
    expect(thinking).toBe("Let me check the holdings.");
    expect(answer).toBe("You hold $1,907 across 6 tokens.");
  });

  it("tolerates an unterminated <think> block", () => {
    const raw = "<think>reasoning that never closed";
    const { thinking } = splitThinking(raw);
    expect(thinking).toContain("reasoning");
  });

  it("never chops prose that merely contains the word thinking", () => {
    const raw = "I am thinking about your holdings: BTC is the largest position.";
    const { thinking, answer } = splitThinking(raw);
    expect(thinking).toBeNull();
    expect(answer).toBe(raw);
  });
});
