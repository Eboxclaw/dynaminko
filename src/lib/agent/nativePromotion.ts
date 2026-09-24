import type { CapabilityDefinition } from "@/lib/capabilities/catalogue";

export type NativePromotion = {
  def: CapabilityDefinition;
  approvalRequired: boolean;
};

/**
 * Resolve a native call emitted during answer generation against the exact
 * per-turn allowlist. A model-trained tool name is never authority to reach
 * the global catalogue. Write-capable calls may only surface an approval.
 */
export function nativePromotion(
  id: string,
  allowed: CapabilityDefinition[],
): NativePromotion | null {
  const def = allowed.find((candidate) => candidate.id === id);
  if (!def) return null;
  if (def.kind !== "tool" && def.kind !== "command" && def.kind !== "batch_command") return null;
  return { def, approvalRequired: def.exec === "write-approval" };
}
