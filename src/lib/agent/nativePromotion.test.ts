import { describe, expect, it } from "vitest";

import { capabilityCatalogue } from "@/lib/capabilities/catalogue";
import { nativePromotion } from "./nativePromotion";

describe("nativePromotion", () => {
  const catalogue = capabilityCatalogue();
  const read = catalogue.find((def) => def.id === "journal.search")!;
  const write = catalogue.find((def) => def.exec === "write-approval")!;

  it("accepts only capabilities present in the turn allowlist", () => {
    expect(nativePromotion(read.id, [read])?.def.id).toBe(read.id);
    expect(nativePromotion(write.id, [read])).toBeNull();
    expect(nativePromotion("invented.tool", catalogue)).toBeNull();
  });

  it("never authorizes a write-capable call for direct execution", () => {
    expect(nativePromotion(write.id, [write])).toMatchObject({
      def: { id: write.id },
      approvalRequired: true,
    });
    expect(nativePromotion(read.id, [read])?.approvalRequired).toBe(false);
  });
});
