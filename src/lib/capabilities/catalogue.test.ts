// The capability catalogue is the single list the model is ever shown.
// The invariants that keep it honest: dead tools never appear, every default
// hop tool is usable, and the digest never carries concepts or agent entries.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_HOP_IDS,
  HOP_EXCLUDED_IDS,
  capabilityCatalogue,
  capabilityDigest,
  capabilitySearchText,
} from "./catalogue";
import { TOOLS, TOOL_BY_ID } from "@/lib/tools/registry";

describe("capabilityCatalogue", () => {
  const liveIds = () => new Set(TOOLS.filter((t) => t.live).map((t) => t.id));

  it("only includes live tools; phantom tools are absent", () => {
    const defs = capabilityCatalogue();
    const toolIds = defs.filter((d) => d.kind === "tool").map((d) => d.id);
    for (const id of toolIds) {
      expect(liveIds().has(id), `${id} is not a live tool`).toBe(true);
    }
    // chain.transfers became real: it reads the persistent transfer ledger.
    // Still-dead phantoms must stay absent.
    for (const dead of ["market.quote", "inkyswap.read", "velodrome.execute"]) {
      expect(toolIds, `${dead} should be absent`).not.toContain(dead);
    }
  });

  it("every DEFAULT_HOP_IDS entry is a live READ/COMPUTE tool or command the hop may offer", () => {
    const defs = capabilityCatalogue();
    for (const id of DEFAULT_HOP_IDS) {
      const def = defs.find((d) => d.id === id);
      expect(def, `default hop ${id} missing from catalogue`).toBeDefined();
      if (!def) continue;
      expect(def.kind === "tool" || def.kind === "command", `${id} is a ${def.kind}`).toBe(true);
      expect(["READ", "COMPUTE"], `${id} access ${def.access}`).toContain(def.access);
      expect(HOP_EXCLUDED_IDS, `${id} must not be excluded`).not.toContain(id);
    }
  });

  it("excluded hop tools are still present in the book but in the exclusion set", () => {
    const defs = capabilityCatalogue();
    for (const id of HOP_EXCLUDED_IDS) {
      expect(
        defs.some((d) => d.id === id),
        `${id} should stay in the book`,
      ).toBe(true);
    }
  });

  it("excluded tools never survive the hop menu filter, however they are selected", () => {
    // The exact filter speak() applies to a semantic selection or the default
    // set: READ/COMPUTE tools and commands, minus the exclusion set.
    const excluded = new Set<string>(HOP_EXCLUDED_IDS);
    const hopAllowed = capabilityCatalogue().filter(
      (d) =>
        (d.kind === "tool" || d.kind === "command" || d.kind === "batch_command") &&
        (d.access === "READ" || d.access === "COMPUTE") &&
        !excluded.has(d.id),
    );
    // The two dangerous ones: unbounded journal.index, and the offload reader
    // whose key is never in the prompt (the model could only hallucinate one).
    expect(hopAllowed.map((d) => d.id)).not.toContain("journal.index");
    expect(hopAllowed.map((d) => d.id)).not.toContain("context.readOffload");
    // Sanity: the filter still passes ordinary read tools through.
    expect(hopAllowed.map((d) => d.id)).toContain("journal.search");
  });

  it("execute capabilities never enter the hop menu: propose-only policy", () => {
    // The user's standing policy (2026-09-12): the agent reads, sees and
    // proposes; it never trades or executes a financial call. The venue
    // .execute stubs exist on purpose, unwired, and the catalogue drops
    // non-live tools entirely: execution is doubly absent from the model's
    // menu. Journal write-approvals are a different category (journaling,
    // not finance) and ride the explicit-action gate by design.
    const toolExec = TOOLS.filter((t) => t.id.endsWith(".execute"));
    expect(toolExec.length).toBeGreaterThanOrEqual(5); // one per venue
    for (const t of toolExec) {
      expect(t.access, `${t.id} must carry EXECUTE access`).toBe("EXECUTE");
      expect(t.live, `${t.id} must stay unwired until the execution wallet exists`).toBe(false);
    }
    const catalogue = capabilityCatalogue();
    expect(catalogue.some((d) => d.id.endsWith(".execute"))).toBe(false);
    // Proposing is the sanctioned surface: COMPUTE access, paper by design.
    const propose = catalogue.find((d) => d.id === "trade.propose");
    expect(propose?.access).toBe("COMPUTE");
    expect(propose?.output).toContain("executable: false");
    expect(DEFAULT_HOP_IDS).toContain("trade.propose");
  });

  it("digest carries every non-concept capability once, and excludes concepts", () => {
    const defs = capabilityCatalogue().filter((d) => d.kind !== "concept");
    const lines = capabilityDigest().split("\n");
    expect(lines.length).toBe(defs.length);
    const ids = lines.map((l) => l.split("|")[0].trim());
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("concept.wallet");
  });

  it("every tool id resolves in TOOL_BY_ID and carries searchable text", () => {
    for (const t of TOOLS) {
      expect(TOOL_BY_ID[t.id], `${t.id} missing from TOOL_BY_ID`).toBeDefined();
      const def = capabilityCatalogue().find((d) => d.id === t.id);
      if (def) expect(capabilitySearchText(def).length).toBeGreaterThan(0);
    }
  });
});
