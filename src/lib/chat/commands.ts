// Slash commands. Resolved against the real tool, skill and model registries so
// the list can never drift from what the app can actually do.

import { getDoc, type Sentiment } from "@/lib/store";
import { CTX_CHOICES, MODELS } from "@/lib/ai";
import { SKILLS } from "@/lib/skills/registry";
import { TOOLS } from "@/lib/tools/registry";

export type Suggestion = {
  /** what gets inserted into the composer */
  insert: string;
  label: string;
  hint: string;
  badge?: string;
};

export type Command = {
  name: string;
  args: string;
  blurb: string;
  suggest: (partial: string) => Suggestion[];
};

const MOTIVES: Sentiment[] = ["conviction", "reactive", "hedge", "fomo", "rebalance"];

function match(text: string, q: string) {
  return text.toLowerCase().includes(q.toLowerCase().trim());
}

export const COMMANDS: Command[] = [
  {
    name: "skill",
    args: "<id>",
    blurb: "Run a skill: tools first, model only if the skill needs one.",
    suggest: (q) =>
      SKILLS.filter((s) => !q || match(`${s.id} ${s.label}`, q)).map((s) => ({
        insert: `/skill ${s.id} `,
        label: s.label,
        hint: s.purpose,
        badge: s.aiRequired ? "needs a model" : "no model",
      })),
  },
  {
    name: "tool",
    args: "<group.action>",
    blurb: "Call one tool directly.",
    suggest: (q) =>
      TOOLS.filter((t) => t.live && (!q || match(`${t.id} ${t.label}`, q)))
        .slice(0, 40)
        .map((t) => ({
          insert: `/tool ${t.id} `,
          label: t.id,
          hint: t.purpose,
          badge: t.access,
        })),
  },
  {
    name: "journal",
    args: "<query>",
    blurb: "Search entries and extracted trades.",
    suggest: (q) => {
      const doc = getDoc();
      const tickers = [...new Set(doc.signals.map((s) => s.symbol.toUpperCase()))];
      return [...tickers, ...MOTIVES]
        .filter((t) => !q || match(String(t), q))
        .slice(0, 12)
        .map((t) => ({
          insert: `/journal ${t} `,
          label: String(t),
          hint: "search the journal for this",
          badge: "READ",
        }));
    },
  },
  {
    name: "thesis",
    args: "<name>",
    blurb: "Review one thesis against everything traded under it.",
    suggest: (q) =>
      getDoc()
        .theses.filter((t) => !q || match(t.title, q))
        .slice(0, 12)
        .map((t) => ({
          insert: `/thesis ${t.title} `,
          label: t.title,
          hint: `${t.status} · ${t.symbols.join(" · ") || "no symbols"}`,
          badge: "READ",
        })),
  },
  {
    name: "pot",
    args: "",
    blurb: "The POT index and its axes, computed locally.",
    suggest: () => [],
  },
  {
    name: "model",
    args: "[id]",
    blurb: "Switch model, or open the harness with no argument.",
    suggest: (q) =>
      MODELS.filter((m) => !q || match(`${m.id} ${m.label}`, q)).map((m) => ({
        insert: `/model ${m.id} `,
        label: m.label,
        hint: m.role,
        badge: m.generative ? `${m.weightsGb} GB` : "encoder",
      })),
  },
  {
    name: "models",
    args: "",
    blurb: "List every model, its job, and whether it is on this device.",
    suggest: () => [],
  },
  {
    name: "context",
    args: "[tokens]",
    blurb: "Show or set the context window.",
    suggest: (q) =>
      CTX_CHOICES.filter((c) => !q || String(c).startsWith(q.trim())).map((c) => ({
        insert: `/context ${c} `,
        label: String(c),
        hint: "context window in tokens",
        badge: "ctx",
      })),
  },
  {
    name: "new",
    args: "[title]",
    blurb: "Start a fresh session.",
    suggest: () => [],
  },
  {
    name: "sessions",
    args: "",
    blurb: "List saved sessions on this device.",
    suggest: () => [],
  },
  {
    name: "tools",
    args: "",
    blurb: "List the deterministic tools.",
    suggest: () => [],
  },
  {
    name: "skills",
    args: "",
    blurb: "List the skills and what each one drives.",
    suggest: () => [],
  },
  {
    name: "help",
    args: "",
    blurb: "List every command.",
    suggest: () => [],
  },
  {
    name: "clear",
    args: "",
    blurb: "Empty this session.",
    suggest: () => [],
  },
];

export const COMMAND_BY_NAME = Object.fromEntries(COMMANDS.map((c) => [c.name, c]));

export type Parsed = { name: string; rest: string } | null;

export function parseCommand(input: string): Parsed {
  const m = /^\/([a-z]+)\s*([\s\S]*)$/i.exec(input.trim());
  if (!m) return null;
  return { name: m[1].toLowerCase(), rest: m[2].trim() };
}

/** What the inline picker shows while the user is still typing. */
export function suggestions(input: string): Suggestion[] {
  if (!input.startsWith("/")) return [];
  const parsed = parseCommand(input);
  if (!parsed) return [];
  const spaced = /\s/.test(input.trim());
  if (!spaced) {
    return COMMANDS.filter((c) => c.name.startsWith(parsed.name)).map((c) => ({
      insert: `/${c.name}${c.args ? " " : ""}`,
      label: `/${c.name} ${c.args}`.trim(),
      hint: c.blurb,
    }));
  }
  const cmd = COMMAND_BY_NAME[parsed.name];
  return cmd ? cmd.suggest(parsed.rest).slice(0, 8) : [];
}
