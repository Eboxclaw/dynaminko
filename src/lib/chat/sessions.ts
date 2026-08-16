// Many chat sessions, all on this device. An index of titles is kept small and
// always loaded; each transcript is stored under its own key and only read when
// that session is opened.

import { estimateTokens } from "./context";
import type { ChatMessage } from "./session";

export type SessionMeta = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: number;
};

const INDEX_KEY = "pot.chat.index.v1";
const BODY = (id: string) => `pot.chat.session.${id}`;
const MAX_SESSIONS = 20;
const MAX_MESSAGES = 60;

const has = () => typeof localStorage !== "undefined";

function read<T>(key: string, fallback: T): T {
  if (!has()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  if (!has()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota — sessions are disposable */
  }
}

export function listSessions(): SessionMeta[] {
  return read<SessionMeta[]>(INDEX_KEY, []).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function newSessionId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createSession(title = "New session"): SessionMeta {
  const meta: SessionMeta = {
    id: newSessionId(),
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    turns: 0,
  };
  const next = [meta, ...listSessions()].slice(0, MAX_SESSIONS);
  write(INDEX_KEY, next);
  write(BODY(meta.id), []);
  return meta;
}

export function readSession(id: string): ChatMessage[] {
  return read<ChatMessage[]>(BODY(id), []).slice(-MAX_MESSAGES);
}

/** Persists a transcript and keeps the index title/turn count in step. */
export function writeSession(id: string, messages: ChatMessage[]) {
  write(BODY(id), messages.slice(-MAX_MESSAGES));
  const index = read<SessionMeta[]>(INDEX_KEY, []);
  const first = messages.find((m) => m.role === "user")?.text ?? "";
  const next = index.map((s) =>
    s.id === id
      ? {
          ...s,
          updatedAt: Date.now(),
          turns: messages.length,
          title: first ? first.slice(0, 48) : s.title,
        }
      : s,
  );
  write(INDEX_KEY, next);
}

export function deleteSession(id: string) {
  write(
    INDEX_KEY,
    read<SessionMeta[]>(INDEX_KEY, []).filter((s) => s.id !== id),
  );
  if (has()) localStorage.removeItem(BODY(id));
}

export function renameSession(id: string, title: string) {
  write(
    INDEX_KEY,
    read<SessionMeta[]>(INDEX_KEY, []).map((s) => (s.id === id ? { ...s, title } : s)),
  );
}

/** Reads the index, creating a first session when there is none. Idempotent. */
export function bootstrapSessions(): { sessions: SessionMeta[]; activeId: string } {
  const existing = listSessions();
  if (existing.length) return { sessions: existing, activeId: existing[0].id };
  const created = createSession();
  return { sessions: [created], activeId: created.id };
}

/**
 * What the model actually sees. There is no fixed turn cap: history is replayed
 * newest first until the session's token budget runs out, then flipped back.
 */
export function contextFor(
  messages: ChatMessage[],
  budgetTokens: number,
  maxMessages = Number.POSITIVE_INFINITY,
): { text: string; used: number; turns: number } {
  const lines: string[] = [];
  let used = 0;
  let turns = 0;
  for (let i = messages.length - 1; i >= 0 && turns < maxMessages; i--) {
    const m = messages[i];
    if (m.role === "note") continue;
    const line =
      m.role === "tool" && m.card
        ? `tool ${m.card.source}: ${JSON.stringify(m.card.data)}`
        : `${m.role}: ${m.text}`;
    const cost = estimateTokens(line);
    if (used + cost > budgetTokens) break;
    used += cost;
    turns += 1;
    lines.unshift(line);
  }
  return { text: lines.join("\n"), used, turns };
}
