import { describe, expect, it } from "vitest";

import {
  extractNativeToolCall,
  parseCallBody,
  withNativeToolTurns,
  type NativeMessage,
} from "./nativeTools";

describe("nativeTools", () => {
  it("parses the real captured 2.6B leak (pipe dialect, python args)", () => {
    // Fixture: window.__lastRaw from the live run where the LFM 2.6B's entire
    // completion was this 88-char tool call.
    const raw = "<|tool_call_start|>[web.search(query='ink chain latest news', limit=5)]<|tool_call_end|>";
    expect(extractNativeToolCall(raw)).toEqual({
      id: "web.search",
      args: { query: "ink chain latest news", limit: 5 },
    });
  });

  it("recovers a truncated call with an unclosed opener", () => {
    const raw = "<|tool_call_start|>[web.read(url='https://example.com/post')";
    expect(extractNativeToolCall(raw)).toEqual({
      id: "web.read",
      args: { url: "https://example.com/post" },
    });
  });

  it("parses the JSON dialect, bare and in a list", () => {
    expect(
      extractNativeToolCall('<|tool_call_start|>[{"name":"web.search","arguments":{"query":"ink"}}]<|tool_call_end|>'),
    ).toEqual({ id: "web.search", args: { query: "ink" } });
    expect(
      parseCallBody('{"name":"portfolio.read","arguments":{"depth":"full"}}'),
    ).toEqual({ id: "portfolio.read", args: { depth: "full" } });
  });

  it("parses OpenAI-style function payloads and string arguments", () => {
    expect(
      parseCallBody(
        '[{"function":{"name":"web.search","arguments":"{\\"query\\":\\"nado fees\\"}"}}]',
      ),
    ).toEqual({ id: "web.search", args: { query: "nado fees" } });
  });

  it("keeps value types: numbers, booleans, quoted strings with spaces", () => {
    expect(
      parseCallBody("journal.filter(basket='defi', limit=8, asc=true)"),
    ).toEqual({ id: "journal.filter", args: { basket: "defi", limit: 8, asc: true } });
  });

  it("returns null on prose that merely contains brackets", () => {
    expect(extractNativeToolCall("See [1] and [2] for the fee schedule.")).toBeNull();
    expect(extractNativeToolCall("The answer is 42.")).toBeNull();
  });

  it("ignores a call-shaped body whose name is markup itself", () => {
    expect(parseCallBody("tool_call_start(x=1)")).toBeNull();
  });

  it("handles a call embedded after prose (partial leak)", () => {
    const raw =
      "Let me check the data.\n<|tool_call_start|>[web.search(query='hyperliquid tvl')]<|tool_call_end|>";
    expect(extractNativeToolCall(raw)).toEqual({
      id: "web.search",
      args: { query: "hyperliquid tvl" },
    });
  });
});

describe("withNativeToolTurns", () => {
  const dialogue: NativeMessage[] = [
    { role: "system", content: "CORE" },
    { role: "user", content: "whats in my wallet?" },
  ];

  it("appends one assistant tool_calls message then role:tool responses in order", () => {
    const out = withNativeToolTurns(dialogue, [
      { id: "portfolio.read:0", name: "portfolio.read", args: {}, content: "11 holdings" },
      { id: "web.search:1", name: "web.search", args: { query: "ink" }, content: "3 results" },
    ]);
    expect(out).toHaveLength(5);
    const assistant = out[2];
    expect(assistant.role).toBe("assistant");
    expect(assistant.tool_calls).toHaveLength(2);
    expect(assistant.tool_calls?.[0].function.name).toBe("portfolio.read");
    expect(assistant.tool_calls?.[1].function.arguments).toEqual({ query: "ink" });
    const tool1 = out[3];
    const tool2 = out[4];
    expect(tool1.role).toBe("tool");
    expect(tool1.tool_call_id).toBe("portfolio.read:0");
    expect(tool2.content).toBe("3 results");
  });

  it("keeps arguments a mapping (the LFM template raises on JSON strings)", () => {
    const out = withNativeToolTurns(dialogue, [
      { id: "x", name: "chain.transfers", args: { limit: 3 }, content: "rows" },
    ]);
    expect(out[2].tool_calls?.[0].function.arguments).toEqual({ limit: 3 });
  });

  it("returns the dialogue untouched when no tool turns exist", () => {
    expect(withNativeToolTurns(dialogue, [])).toBe(dialogue);
  });
});
