// Session recall commands. Past conversations stay out of context and are
// recalled on demand (see searchSessions in chat/sessions.ts): a keyword scan
// over stored sessions, bounded, deterministic, no model involved.

import { searchSessions } from "@/lib/chat/sessions";

import { ok, type CommandContext, type CommandResult } from "./types";

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function search(args: Record<string, unknown>, ctx: CommandContext): CommandResult {
  const id = "session.search";
  const query = str(args.query) ?? "";
  const limit = typeof args.limit === "number" ? args.limit : 8;
  ctx.count();
  const hits = searchSessions(query, limit);
  const sessions = new Set(hits.map((h) => h.sessionId));
  return ok(
    id,
    { query: query || null, hits: hits.length, sessions: sessions.size, results: hits },
    hits.length
      ? `${hits.length} turns across ${sessions.size} session${sessions.size === 1 ? "" : "s"}${query ? ` matching "${query}"` : " (recent)"}`
      : query
        ? `no past turns match "${query}"`
        : "no stored conversation turns yet",
  );
}
