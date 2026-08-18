// The canonical semantic command index. Deliberately tiny: one line each, just
// enough for a small model to choose and fill arguments. Implementation lives
// in the executors, which reuse the existing tool layer.

import * as journal from "./journal";
import * as memory from "./memory";
import * as portfolio from "./portfolio";
import * as session from "./session";
import type { CommandDefinition } from "./types";

export const COMMAND_DEFS: CommandDefinition[] = [
  {
    id: "session.search",
    description:
      "Recall past conversation turns by keyword across all stored sessions; no query returns recent turns.",
    args: { query: "string?", limit: "number?" },
    mode: "single",
    batchMode: "single",
    capability: ["session", "read"],
    access: "READ",
    execute: session.search,
  },
  {
    id: "memory.save",
    description: "Save one durable note about the user to persistent memory.",
    args: { text: "string" },
    mode: "single",
    batchMode: "single",
    capability: ["memory", "write"],
    access: "EDIT",
    execute: memory.save,
  },
  {
    id: "memory.read",
    description: "List persistent memory notes with ids and capacity.",
    args: {},
    mode: "single",
    batchMode: "single",
    capability: ["memory", "read"],
    access: "READ",
    execute: memory.read,
  },
  {
    id: "memory.update",
    description: "Replace one memory note by id with new text.",
    args: { id: "string", text: "string" },
    mode: "single",
    batchMode: "single",
    capability: ["memory", "write"],
    access: "EDIT",
    execute: memory.update,
  },
  {
    id: "memory.forget",
    description: "Delete one memory note by id.",
    args: { id: "string" },
    mode: "single",
    batchMode: "single",
    capability: ["memory", "write"],
    access: "EDIT",
    execute: memory.forget,
  },
  {
    id: "journal.resolve_inbox",
    description: "Aggregate pending journal trades and report what is missing.",
    args: { ticker: "string?", tradeId: "string?", limit: "number?" },
    mode: "single",
    batchMode: "aggregate",
    capability: ["journal", "read"],
    access: "READ",
    execute: journal.resolveInbox,
  },
  {
    id: "journal.apply_answer",
    description: "Apply one answer to every matching pending trade in one batch.",
    args: {
      reason: "string",
      ticker: "string?",
      motive: "string?",
      alignment: "string?",
      thesisId: "string?",
      limit: "number?",
    },
    mode: "single",
    batchMode: "batch",
    capability: ["journal", "write"],
    access: "WRITE",
    execute: journal.applyAnswer,
  },
  {
    id: "journal.review_trade",
    description: "Read one trade with its answers and what it still lacks.",
    args: { tradeId: "string" },
    mode: "single",
    batchMode: "single",
    capability: ["journal", "read"],
    access: "READ",
    execute: journal.reviewTrade,
  },
  {
    id: "journal.review_thesis",
    description: "One thesis against everything traded under it.",
    args: { thesisId: "string?", title: "string?" },
    mode: "single",
    batchMode: "single",
    capability: ["journal", "thesis", "read"],
    access: "READ",
    execute: journal.reviewThesis,
  },
  {
    id: "journal.search",
    description: "Free-text search over entries and extracted trades.",
    args: { query: "string", limit: "number?" },
    mode: "single",
    batchMode: "single",
    capability: ["journal", "read"],
    access: "READ",
    execute: journal.searchJournal,
  },
  {
    id: "portfolio.snapshot",
    description: "Current exposure grouped by basket.",
    args: {},
    mode: "single",
    batchMode: "aggregate",
    capability: ["portfolio", "read"],
    access: "COMPUTE",
    execute: portfolio.snapshot,
  },
  {
    id: "portfolio.positions",
    description: "Position lines by token, optionally one basket.",
    args: { basket: "string?", limit: "number?" },
    mode: "single",
    batchMode: "single",
    capability: ["portfolio", "read"],
    access: "COMPUTE",
    execute: portfolio.positions,
  },
  {
    id: "portfolio.categorize_token",
    description: "Classify a token into a basket, or set the user's override.",
    args: { symbol: "string", basket: "string?" },
    mode: "single",
    batchMode: "single",
    capability: ["portfolio", "classification"],
    access: "EDIT",
    execute: portfolio.categorizeToken,
  },
  {
    id: "alert.list",
    description: "List alerts on this device.",
    args: {},
    mode: "single",
    batchMode: "single",
    capability: ["alert", "read"],
    access: "READ",
    execute: portfolio.listAlerts,
  },
  {
    id: "alert.create",
    description: "Create a price alert.",
    args: { symbol: "string", target: "number", direction: "string?", note: "string?" },
    mode: "single",
    batchMode: "single",
    capability: ["alert", "write"],
    access: "WRITE",
    execute: portfolio.createAlert,
  },
];

export const COMMAND_BY_ID: Record<string, CommandDefinition> = Object.fromEntries(
  COMMAND_DEFS.map((c) => [c.id, c]),
);

/** What the model is shown: id, one line, argument names. Nothing else. */
export function commandCatalogue(): string {
  return COMMAND_DEFS.map(
    (c) => `${c.id}(${Object.keys(c.args).join(", ")}) · ${c.description}`,
  ).join("\n");
}
