import { describe, expect, it } from "vitest";

import { agentRailSearch } from "./agentRail";

describe("agentRailSearch", () => {
  it("gives SSR and hydration the same default tab", () => {
    expect(agentRailSearch({})).toEqual({ tab: "model" });
    expect(agentRailSearch({ tab: "unknown" })).toEqual({ tab: "model" });
    expect(agentRailSearch({ tab: "tools" })).toEqual({ tab: "tools" });
  });
});
