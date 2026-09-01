import { readDelta } from "@/lib/ai/stream";
import { withNativeToolTurns, type NativeMessage, type NativeToolTurn } from "@/lib/ai/nativeTools";

// Optional cloud models. Everything here is off by default and opt-in: the
// local runtime stays the product. Each provider speaks the OpenAI
// chat-completions shape, so one client covers all of them.
//
// Keys live in this browser only (the local document store). They are never
// bundled, never sent anywhere but the provider the user configured.

export type CloudProviderId = "openai" | "openrouter" | "engy" | "claude" | "kimi" | "zai";

/** persistence key for the manually tuned cloud context window */
export const CLOUD_CTX_KEY = "cloud";

/** Manual tuning ladder for cloud context windows (ModelPanel chips). The
 * provider card is the ceiling: GLM-5-Turbo 200K, 1M variants exist, while
 * mid-size endpoints sit at 32K-128K. */
export const CLOUD_CTX_CHOICES = [8192, 16384, 32768, 204800, 1048576] as const;

/** persistence key for the manual cloud output-token override (number or
 * "auto"); "auto" defers to the provider's defaultOutputTokens. */
export const CLOUD_OUT_KEY = "cloud-out";

/** Output-token ladder (ModelPanel chips). Auto keeps the card default. */
export const CLOUD_OUT_CHOICES = [0, 8192, 32768, 131072] as const; // 0 = auto

export type CloudProviderSpec = {
  id: CloudProviderId;
  label: string;
  baseUrl: string;
  /** a sensible default model id for the provider */
  model: string;
  blurb: string;
  /** the provider blocks browser requests unless a proxy is used */
  corsRisky: boolean;
  keysUrl: string;
  /** provider-recommended temperature; undefined falls back to 0.4 */
  temperature?: number;
  /** model-card output ceiling; the manual slider can never exceed it */
  maxOutputTokens?: number;
  /** output tokens answers request when the user has not tuned anything */
  defaultOutputTokens?: number;
  /** the model's own reasoning mode when the user has not chosen one */
  thinking?: "enabled" | "disabled";
};

export const CLOUD_PROVIDERS: CloudProviderSpec[] = [
  {
    id: "openai",
    label: "Codex / OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.4-mini",
    blurb: "OpenAI chat completions, including the Codex models.",
    corsRisky: false,
    keysUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "anthropic/claude-sonnet-4.5",
    blurb: "One key, most models. Browser requests are allowed.",
    corsRisky: false,
    keysUrl: "https://openrouter.ai/keys",
  },
  {
    id: "engy",
    label: "Engy",
    baseUrl: "https://api.engy.ai/v1",
    model: "engy-default",
    blurb: "OpenAI-compatible endpoint. Set the exact model id yourself.",
    corsRisky: true,
    keysUrl: "",
  },
  {
    id: "claude",
    label: "Claude Code",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-5",
    blurb: "Anthropic's OpenAI-compatible route. Browsers are usually blocked by CORS.",
    corsRisky: true,
    keysUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "kimi",
    label: "Kimi Code",
    baseUrl: "https://api.moonshot.ai/v1",
    model: "kimi-k2-turbo-preview",
    blurb: "Moonshot's OpenAI-compatible endpoint.",
    corsRisky: true,
    keysUrl: "https://platform.moonshot.ai/console/api-keys",
  },
  {
    id: "zai",
    label: "Z.ai",
    // Coding-plan keys (the official test key among them) carry their
    // resource package on the coding endpoint only: the standard paas/v4
    // returns 429 code 1113 "Insufficient balance" for them, while this
    // base returns 200. Verified live 2026-09-01. Standard-platform keys
    // still work here and can be pointed back via the per-provider
    // baseUrl override in the panel.
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    // The official in-app test model. 200K context, up to 128K output,
    // thinking enabled by default (arrives as reasoning_content deltas).
    model: "glm-5-turbo",
    blurb: "Z.ai GLM Coding endpoint. Official test model: GLM-5-Turbo.",
    corsRisky: false,
    keysUrl: "https://z.ai/keys",
    // Documented example setting (streaming sample); 1.0 is too hot for a
    // grounded portfolio assistant.
    temperature: 0.6,
    // Card: 200K context, up to 128K output, thinking on by default. A
    // roomy answer budget costs nothing unless the model (thinking
    // included) actually generates the tokens.
    maxOutputTokens: 131072,
    defaultOutputTokens: 32768,
    thinking: "enabled",
  },
];

export const CLOUD_BY_ID = Object.fromEntries(CLOUD_PROVIDERS.map((p) => [p.id, p])) as Record<
  CloudProviderId,
  CloudProviderSpec
>;

/** What the user configured for one provider. Stored locally. */
export type CloudConfig = {
  id: CloudProviderId;
  apiKey: string;
  baseUrl?: string;
  model?: string;
};

export type CloudState = "unconfigured" | "configured" | "blocked" | "error";

export function cloudState(cfg: CloudConfig | undefined, lastError?: string | null): CloudState {
  if (!cfg?.apiKey) return "unconfigured";
  if (lastError) return /cors|failed to fetch|network/i.test(lastError) ? "blocked" : "error";
  return "configured";
}

export type CloudChatOptions = {
  temperature?: number;
  maxTokens?: number;
  onToken?: (partial: string) => void;
  /**
   * Reasoning stream for models that expose it (GLM-5 family sends
   * reasoning_content deltas ahead of content). The partial grows with
   * thinking-only tokens, so the UI can show what the model is doing
   * before the answer starts.
   */
  onThinking?: (partial: string) => void;
  /**
   * GLM-5 family thinking switch. Decides run with "disabled" (speed
   * first: a structured pick must not pay for a reasoning preamble);
   * answers inherit the provider default (enabled).
   */
  thinking?: "enabled" | "disabled";
  signal?: AbortSignal;
  /** structured output; endpoints that reject it throw and the caller degrades */
  responseSchema?: { name: string; schema: Record<string, unknown> };
  /** base64 data URLs for multimodal (vision) models */
  images?: string[];
  /**
   * Native tool protocol, same as the local path: one assistant tool_calls
   * message plus role:"tool" responses. Without this, cloud models never
   * see what the hop loop's tools returned and answer from FACTS alone.
   */
  toolTurns?: NativeToolTurn[];
};

/**
 * One streaming chat call against an OpenAI-compatible endpoint, full message
 * array. No timeout is imposed: generation takes as long as it takes, the user
 * can stop it.
 */
export async function cloudChatMessages(
  cfg: CloudConfig,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string | unknown }>,
  options: CloudChatOptions = {},
): Promise<string> {
  const spec = CLOUD_BY_ID[cfg.id];
  const base = (cfg.baseUrl || spec.baseUrl).replace(/\/$/, "");
  const model = cfg.model || spec.model;

  // Build the message array, transforming the last user message to
  // multimodal content parts when images are passed.
  let bodyMessages: Array<Record<string, unknown>>;
  if (options.images?.length) {
    bodyMessages = messages.map((m, i) => {
      if (m.role !== "user" || i < messages.length - 1) return { role: m.role, content: m.content };
      // Last user message: text plus image parts (OpenAI multimodal format).
      const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        { type: "text", text: String(m.content) },
        ...options.images!.map((dataUrl) => ({ type: "image_url", image_url: { url: dataUrl } })),
      ];
      return { role: "user", content: parts };
    });
  } else {
    bodyMessages = messages as Array<Record<string, unknown>>;
  }
  // Close the tool protocol when the turn ran tools on the model's behalf:
  // OpenAI-compatible endpoints accept assistant tool_calls + role:"tool"
  // responses, and without them the model cannot see its own tool results.
  const composed: NativeMessage[] = options.toolTurns?.length
    ? withNativeToolTurns(bodyMessages as NativeMessage[], options.toolTurns)
    : (bodyMessages as NativeMessage[]);

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.apiKey}`,
    },
    signal: options.signal,
    body: JSON.stringify({
      model,
      stream: true,
      temperature: options.temperature ?? spec.temperature ?? 0.4,
      max_tokens: options.maxTokens ?? 512,
      ...(options.thinking ? { thinking: { type: options.thinking } } : {}),
      ...(options.responseSchema
        ? {
            response_format: {
              type: "json_schema",
              json_schema: {
                name: options.responseSchema.name,
                schema: options.responseSchema.schema,
              },
            },
          }
        : {}),
      messages: composed,
    }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`${spec.label} refused the call (${res.status}). ${text.slice(0, 180)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let out = "";
  let thinking = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload);
        const piece = readDelta(parsed);
        if (piece) {
          out += piece;
          options.onToken?.(out);
        }
        // GLM-5 family streams its reasoning separately; surface it so the
        // turn shows what the model is doing before prose starts.
        const thought = parsed.choices?.[0]?.delta?.reasoning_content;
        if (typeof thought === "string" && thought) {
          thinking += thought;
          options.onThinking?.(thinking);
        }
      } catch {
        /* keep streaming — a partial frame is not fatal */
      }
    }
  }
  return out.trim();
}

/** Single-turn wrapper kept for existing callers. */
export async function cloudChat(
  cfg: CloudConfig,
  system: string,
  user: string,
  options: CloudChatOptions = {},
): Promise<string> {
  return cloudChatMessages(
    cfg,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    options,
  );
}
