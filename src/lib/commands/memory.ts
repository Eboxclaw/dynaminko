// Agent memory commands: the model's only write path into the bounded
// persistent memory store (see store.ts for the cap and the no-silent-drop
// contract). Reads mostly happen for free: the MEMORY prompt section rides in
// every turn, so memory.read exists for explicit /run inspection, not for the
// hop. Writes are EDIT: the approval gate shows the user what the agent is
// choosing to remember about them.

import {
  addMemory,
  forgetMemory,
  memoryFullMessage,
  memoryStats,
  readMemory,
  updateMemory,
} from "@/lib/store";

import { failed, needsInput, ok, type CommandContext, type CommandResult } from "./types";

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function idOf(v: unknown): string | null {
  // Accept both "m1a2b3" and "[m1a2b3]" (the form MEMORY renders).
  const raw = str(v)?.replace(/^\[|\]$/g, "");
  return raw && /^m[a-z0-9]+$/i.test(raw) ? raw : null;
}

export function save(args: Record<string, unknown>, ctx: CommandContext): CommandResult {
  const id = "memory.save";
  const text = str(args.text);
  if (!text) return needsInput(id, {}, "what should I remember? (text)");

  const res = addMemory(text);
  ctx.count();
  if (!res.ok) {
    return failed(id, "over_limit", memoryFullMessage(res));
  }
  return ok(id, res.stats, `remembered [${res.entry.id}]: ${text.slice(0, 80)}`);
}

export function update(args: Record<string, unknown>, ctx: CommandContext): CommandResult {
  const id = "memory.update";
  const entryId = idOf(args.id);
  const text = str(args.text);
  if (!entryId || !text) {
    return needsInput(id, {}, "update needs an entry id (from MEMORY) and the new text");
  }
  const res = updateMemory(entryId, text);
  ctx.count();
  if (!res.ok) {
    if (!res.entries.some((e) => e.id === entryId)) {
      return failed(id, "not_found", `no memory entry ${entryId}; MEMORY lists the current ids`);
    }
    return failed(id, "over_limit", memoryFullMessage(res));
  }
  return ok(id, res.stats, `updated [${res.entry.id}]: ${text.slice(0, 80)}`);
}

export function forget(args: Record<string, unknown>, ctx: CommandContext): CommandResult {
  const id = "memory.forget";
  const entryId = idOf(args.id);
  if (!entryId) return needsInput(id, {}, "forget needs an entry id (from MEMORY)");
  ctx.count();
  if (!forgetMemory(entryId)) {
    return failed(id, "not_found", `no memory entry ${entryId}`);
  }
  return ok(id, memoryStats(), `forgot ${entryId}`);
}

export function read(_args: Record<string, unknown>, ctx: CommandContext): CommandResult {
  ctx.count();
  const entries = readMemory();
  const stats = memoryStats(entries);
  return ok(
    "memory.read",
    { stats, entries },
    entries.length
      ? `${entries.length} notes · ${stats.chars}/${stats.limit} chars · ${entries
          .map((e) => `[${e.id}] ${e.text.slice(0, 40)}`)
          .join(" | ")}`
      : "memory is empty",
  );
}
