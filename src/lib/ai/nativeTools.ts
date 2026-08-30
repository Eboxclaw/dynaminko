// Native tool-call dialect. The LFM chat templates (applied by llama.cpp
// inside wllama) train the models to call tools with
// `<|tool_call_start|>[name(key=value, ...)]<|tool_call_end|>` tokens. Our
// harness speaks GBNF JSON in the decide phase and prose in the answer phase,
// so a model that follows its template instead of our contract had the call
// stripped to an empty answer (the 2.6B "no output" break). This parser
// recovers those calls as real picks. The fixtures come from real captured
// completions (window.__lastRaw), not invented strings.

export type NativeToolCall = {
  id: string;
  args: Record<string, string | number | boolean>;
};

/**
 * The tagged native form. Pipe-delimited tokens are what the LFM templates
 * emit; the angle-bracket variant covers detokenizer drift. The opener is
 * allowed to be unclosed: truncated runs end mid-call and the call is still
 * recoverable.
 */
const NATIVE_CALL =
  /<\|?\s*tool_call_start\s*\|?>([\s\S]*?)(?:<\|?\s*tool_call_end\s*\|?>|$)/i;

type JsonCall = {
  name?: unknown;
  arguments?: unknown;
  function?: { name?: unknown; arguments?: unknown };
};

/**
 * Parse one call body in either dialect: the python-ish
 * `name(key='value', limit=5)` form the LFM models actually emit, or the JSON
 * form `{"name": ..., "arguments": {...}}` (bare, wrapped in a list, or
 * OpenAI-style under `function`).
 */
export function parseCallBody(body: string): NativeToolCall | null {
  const inner = body
    .trim()
    .replace(/^\[+/, "")
    .replace(/\]+$/, "")
    .trim();
  if (!inner) return null;

  if (inner.startsWith("{") || inner.startsWith("[")) {
    try {
      const parsed = JSON.parse(inner) as JsonCall | JsonCall[];
      const item = Array.isArray(parsed) ? parsed[0] : parsed;
      const call = item?.function ?? item;
      if (call && typeof call.name === "string") {
        let args = call.arguments;
        if (typeof args === "string") {
          try {
            args = JSON.parse(args) as unknown;
          } catch {
            args = undefined;
          }
        }
        return { id: call.name, args: coerceArgs(args) };
      }
    } catch {
      // Not JSON after all: fall through to the python-ish dialect.
    }
  }

  const fn = /^([A-Za-z_][\w.-]*)\s*\(([\s\S]*)\)\s*$/.exec(inner);
  if (!fn || /tool_call/i.test(fn[1])) return null;
  const args: Record<string, string | number | boolean> = {};
  const pair = /([A-Za-z_][\w.-]*)\s*=\s*('([^']*)'|"([^"]*)"|[^,()]+)/g;
  let m: RegExpExecArray | null;
  while ((m = pair.exec(fn[2]))) {
    const key = m[1];
    if (m[3] !== undefined || m[4] !== undefined) {
      args[key] = m[3] ?? m[4];
      continue;
    }
    const token = m[2].trim();
    if (/^-?\d+(\.\d+)?$/.test(token)) args[key] = Number(token);
    else if (token === "true") args[key] = true;
    else if (token === "false") args[key] = false;
    else args[key] = token.replace(/^['"]+|['"]+$/g, "");
  }
  return { id: fn[1], args };
}

/** Pull the first native tool call out of a completion, if any. */
export function extractNativeToolCall(text: string): NativeToolCall | null {
  if (!text || !/tool_call/i.test(text)) return null;
  const m = NATIVE_CALL.exec(text);
  if (!m) return null;
  return parseCallBody(m[1]);
}

function coerceArgs(src: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!src || typeof src !== "object") return out;
  for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (v != null) out[k] = JSON.stringify(v);
  }
  return out;
}

// ── native tool protocol composition ────────────────────────────────────

export type NativeToolTurn = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  content: string;
};

export type NativeMessage = {
  role: string;
  content: unknown;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: Record<string, unknown> };
  }[];
  tool_call_id?: string;
};

/**
 * Append the native tool protocol to a dialogue: one assistant message
 * carrying every call, then one role:"tool" response per call, in order.
 * Arguments MUST be a mapping: the LFM chat template raises on JSON-encoded
 * argument strings ("parse arguments with json.loads() before applying the
 * chat template"). This is the closed loop a tool-trained model waits for:
 * without it, the model re-issues its call instead of answering.
 */
export function withNativeToolTurns(
  messages: NativeMessage[],
  toolTurns: NativeToolTurn[],
): NativeMessage[] {
  if (!toolTurns.length) return messages;
  return [
    ...messages,
    {
      role: "assistant",
      content: "",
      tool_calls: toolTurns.map((t) => ({
        id: t.id,
        type: "function" as const,
        function: { name: t.name, arguments: t.args },
      })),
    },
    ...toolTurns.map((t) => ({
      role: "tool",
      tool_call_id: t.id,
      content: t.content,
    })),
  ];
}
