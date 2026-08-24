// buildTurn is the single budget-aware assembly point for every prompt the
// model sees. These tests pin the section order, the shed order, the forced
// degradation levels, and the history head+tail compaction.

import { describe, expect, it } from "vitest";

import { buildTurn, clampDataText, GROUND_RULES, MAX_OBSERVATION_CHARS } from "./context";
import { capabilityCatalogue } from "@/lib/capabilities/catalogue";
import type { ChatMessage } from "@/lib/chat/session";

function baseInput(overrides: Partial<Parameters<typeof buildTurn>[0]> = {}) {
  const defs = capabilityCatalogue().filter((d) => d.kind !== "concept" && d.kind !== "agent_capability");
  return {
    instructions: "Answer briefly.",
    state: "wallet: none watched\nentries: 0",
    capabilitiesDigest: defs.map((d) => `${d.id} | ${d.kind}`).join("\n"),
    selectedCapabilities: [] as Parameters<typeof buildTurn>[0]["selectedCapabilities"],
    records: [] as string[],
    memory: "",
    observations: [] as Parameters<typeof buildTurn>[0]["observations"],
    history: [] as ChatMessage[],
    user: "hello",
    budgetTokens: 4000,
    ...overrides,
  };
}

describe("buildTurn", () => {
  it("always leads with CORE and ends the turn with the user message", () => {
    const b = buildTurn(baseInput());
    expect(b.sections[0].name).toBe("CORE");
    expect(b.messages[0].role).toBe("system");
    const last = b.messages[b.messages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toContain("hello");
  });

  it("drops nothing when the budget is generous", () => {
    const input = baseInput({
      records: ["rec one", "rec two"],
      observations: [
        {
          id: "t1",
          kind: "tool",
          source: "journal.search",
          status: "ok",
          summary: "3 rows",
          data: { rows: [1, 2, 3] },
        },
      ],
      history: [
        { role: "user", text: "earlier question" },
        { role: "assistant", text: "earlier answer" },
      ] as unknown as ChatMessage[],
    });
    const b = buildTurn(input);
    const names = b.sections.map((s) => s.name);
    expect(names).toContain("FACTS");
    expect(names).toContain("OBSERVATIONS");
    expect(names).toContain("RECORDS");
    expect(names).toContain("HISTORY");
    expect(names).not.toContain("SHED");
  });

  it("preserves deeply nested compute-tool results (potIndex shape) in the prompt", () => {
    // potIndex() returns a PotIndex: {score, recentScore, delta,
    // axes: [{id, label, hint, formula, score, weight, parts: [{label, value, of}]}]}
    // The audit hypothesis was that small models fail to parse this nesting,
    // but the data path (clampDataText → observationsPrompt → buildTurn) must
    // survive intact. This test confirms the mechanical path works.
    const deepData = {
      score: 0.72,
      recentScore: 0.68,
      delta: 0.04,
      axes: [
        {
          id: "a1",
          label: "Momentum",
          hint: "short-term trend",
          formula: "avg(p1, p2)",
          score: 0.8,
          weight: 0.5,
          parts: [
            { label: "daily return", value: 0.02, of: 0.05 },
            { label: "volume trend", value: 0.6, of: 1.0 },
          ],
        },
      ],
      payoff: { avg: 0.03, max: 0.12, min: -0.05, count: 15 },
      ghosts: ["t1", "t2"],
      executed: 5,
      pending: 2,
      measured: 10,
    };

    const b = buildTurn(
      baseInput({
        budgetTokens: 4000,
        observations: [
          {
            id: "o1",
            kind: "tool",
            source: "indicators.potIndex",
            status: "ok",
            summary: "POT score 0.72 · recent 0.68 · delta +0.04",
            data: deepData,
          },
        ],
      }),
    );

    const obs = b.sections.find((s) => s.name === "OBSERVATIONS");
    expect(obs).toBeDefined();
    expect(obs!.text).toContain("POT score 0.72");
    expect(obs!.text).toContain("0.72");
    expect(obs!.text).toContain("Momentum");
    expect(obs!.text).toContain("daily return");
    expect(obs!.truncated).toBe(false);
  });

  it("degrades observations to summaries before dropping other sections", () => {
    const big = "x".repeat(MAX_OBSERVATION_CHARS * 3);
    const b = buildTurn(
      baseInput({
        budgetTokens: 300,
        observations: [
          {
            id: "t1",
            kind: "tool",
            source: "journal.search",
            status: "ok",
            summary: "big result",
            data: big,
          },
        ],
      }),
    );
    const obs = b.sections.find((s) => s.name === "OBSERVATIONS");
    expect(obs).toBeDefined();
    expect(obs?.truncated).toBe(true);
    expect(obs?.text).toContain("summaries only");
    expect(b.sections.some((s) => s.name === "SHED")).toBe(true);
  });

  it("forced level 1 drops records and capability detail", () => {
    const defs = capabilityCatalogue().filter((d) => d.kind === "tool").slice(0, 2);
    const b = buildTurn(
      baseInput({
        budgetTokens: 2000,
        records: ["rec"],
        selectedCapabilities: defs,
        shedLevel: 1,
      }),
    );
    const shed = b.sections.find((s) => s.name === "SHED");
    expect(shed?.text).toContain("capability detail");
    expect(shed?.text).toContain("records");
  });

  it("forced level 2 drops history entirely but keeps a compaction marker", () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      text: `turn ${i}`,
    })) as unknown as ChatMessage[];
    const b = buildTurn(baseInput({ budgetTokens: 8000, history, shedLevel: 2 }));
    expect(b.sections.some((s) => s.name === "HISTORY")).toBe(false);
    expect(b.sections.some((s) => s.name === "COMPACTION")).toBe(true);
    // The user message still ends the turn.
    expect(b.messages[b.messages.length - 1].content).toContain("hello");
  });

  it("merges consecutive user-role lines so the template sees alternating roles", () => {
    // Tool cards in history become user-role context lines. Two tool cards
    // back-to-back, then the user question, must collapse into one user turn
    // so the chat template never sees consecutive unmerged user messages.
    const history = [
      { id: "h1", role: "user", text: "earlier question", ts: 1 },
      {
        id: "h2",
        role: "tool",
        text: "journal.search result",
        card: { source: "tool.a", facts: ["s1"], data: { x: 1 } },
        ts: 2,
      },
      {
        id: "h3",
        role: "tool",
        text: "portfolio.snapshot result",
        card: { source: "tool.b", facts: ["s2"], data: { y: 2 } },
        ts: 3,
      },
    ] as unknown as ChatMessage[];
    const b = buildTurn(baseInput({ budgetTokens: 8000, history }));
    const userTurns = b.messages.filter((m) => m.role === "user");
    // The head user line, the two tool context lines and the new question are
    // all consecutive user-role content, so they collapse into a single user
    // turn; the template never sees a user->user seam.
    expect(userTurns.length).toBe(1);
    const last = userTurns[0];
    expect(last.content).toContain("tool.a");
    expect(last.content).toContain("tool.b");
    expect(last.content).toContain("hello");
  });

  it("estTokens is at least the sum of section estimates plus the user text", () => {
    const b = buildTurn(baseInput());
    const sectionSum = b.sections.reduce((n, s) => n + s.estTokens, 0);
    expect(b.estTokens).toBeGreaterThanOrEqual(sectionSum);
  });
});

describe("clampDataText", () => {
  it("passes small payloads through and marks truncation on big ones", () => {
    expect(clampDataText({ a: 1 })).toBe(JSON.stringify({ a: 1 }));
    const big = JSON.stringify({ data: "y".repeat(MAX_OBSERVATION_CHARS * 2) });
    const out = clampDataText({ data: "y".repeat(MAX_OBSERVATION_CHARS * 2) });
    expect(out).toContain("[truncated:");
    expect(out.length).toBeLessThan(big.length);
  });
});

describe("GROUND_RULES", () => {
  it("includes the anti-scaffolding rule so small models stop narrating the prompt", () => {
    expect(GROUND_RULES).toMatch(/Never narrate the prompt/);
  });
});
