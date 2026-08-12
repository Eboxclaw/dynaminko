// One chat session, kept on this device. Deliberately small: the transcript is
// capped, and what gets replayed to a model is trimmed to a token budget.

import { estimateTokens } from "./context";

export type ChatCard = {
  /** what produced it */
  source: string;
  facts: string[];
  /** compact structured payload, the same thing a model would receive */
  data: Record<string, unknown>;
};

export type Approval = {
  toolId: string;
  access: string;
  target: string;
  input: unknown;
  state: "pending" | "approved" | "rejected";
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "note";
  text: string;
  thinking?: string | null;
  card?: ChatCard;
  approval?: Approval;
  ts: number;
};

const KEY = "pot.chat.v1";
const MAX_MESSAGES = 60;

export function newMessage(m: Omit<ChatMessage, "id" | "ts">): ChatMessage {
  return {
    ...m,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
  };
}

export function loadSession(): ChatMessage[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(parsed) ? parsed.slice(-MAX_MESSAGES) : [];
  } catch {
    return [];
  }
}

export function saveSession(messages: ChatMessage[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(messages.slice(-MAX_MESSAGES)));
  } catch {
    /* quota — the session is disposable */
  }
}

export function clearSession() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * The transcript the model sees: newest first until the budget runs out, then
 * flipped back into order. Tool cards go in as compact JSON, never as prose.
 */
export function transcriptFor(messages: ChatMessage[], budgetTokens: number): string {
  const lines: string[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "note") continue;
    const line =
      m.role === "tool" && m.card
        ? `tool ${m.card.source}: ${JSON.stringify(m.card.data)}`
        : `${m.role}: ${m.text}`;
    const cost = estimateTokens(line);
    if (used + cost > budgetTokens) break;
    used += cost;
    lines.unshift(line);
  }
  return lines.join("\n");
}
