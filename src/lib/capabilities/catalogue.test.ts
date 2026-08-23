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
    for (const dead of ["chain.transfers", "market.quote", "inkyswap.read", "tydro.read", "velodrome.execute"]) {
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
      expect(defs.some((d) => d.id === id), `${id} should stay in the book`).toBe(true);
    }
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
