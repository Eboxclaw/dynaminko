import { describe, expect, it } from "vitest";

import {
  extractNativeToolCall,
  parseCallBody,
  renderInterceptedCalls,
} from "./nativeTools";
import { splitThinking, stripToolCallMarkup } from "../ai";
import { WIRE_FIXTURES } from "./wire-fixtures";

// Every fixture is a real captured output (window.__lastRaw / __lastDecide).
// The assertions pin the harness contract: whatever the model emitted, the
// pipeline must land on the documented outcome or a regression is red.

describe("per-model wire fixtures", () => {
  for (const fx of WIRE_FIXTURES) {
    it(`${fx.id} (${fx.model} ${fx.phase})`, () => {
      if (fx.expect.kind === "native-call") {
        const call = extractNativeToolCall(fx.raw);
        expect(call).not.toBeNull();
        expect(call?.id).toBe(fx.expect.tool);
        expect(call?.args).toEqual(fx.expect.args);
        return;
      }
      if (fx.expect.kind === "grammar-json") {
        const parsed = JSON.parse(fx.raw) as { tool?: string };
        expect(parsed.tool).toBe(fx.expect.tool);
        // the model's own dialect must NOT match this JSON raw
        expect(extractNativeToolCall(fx.raw)).toBeNull();
        return;
      }
      if (fx.expect.kind === "prose") {
        const { answer } = splitThinking(fx.raw);
        const text = stripToolCallMarkup(answer || fx.raw).trim();
        expect(text.length).toBeGreaterThan(40);
        expect(text).not.toContain("tool_call_start");
        return;
      }
      // empty: fail closed, no pick from either parser
      expect(extractNativeToolCall(fx.raw)).toBeNull();
      expect(parseCallBody(fx.raw)).toBeNull();
    });
  }

  it("intercepted tool_calls fragments round-trip into the native dialect", () => {
    // Captured shape from the C2 runs: name arrives, arguments as a
    // JSON-encoded string (OpenAI convention), content empty.
    const rendered = renderInterceptedCalls([
      { name: "chain.transfers", arguments: '{"limit": 3}' },
    ]);
    expect(rendered).toBe("<|tool_call_start|>[chain.transfers(limit=3)]<|tool_call_end|>");
    const call = extractNativeToolCall(rendered);
    expect(call).toEqual({ id: "chain.transfers", args: { limit: 3 } });
  });

  it("empty-arguments intercepts render as the model emitted them", () => {
    const rendered = renderInterceptedCalls([{ name: "portfolio.read", arguments: "{}" }]);
    expect(rendered).toBe("<|tool_call_start|>[portfolio.read()]<|tool_call_end|>");
    expect(extractNativeToolCall(rendered)).toEqual({ id: "portfolio.read", args: {} });
  });

  it("nameless fragments render to nothing (fail closed)", () => {
    expect(renderInterceptedCalls([{ name: "", arguments: '{"a":1}' }])).toBe("");
  });
});
