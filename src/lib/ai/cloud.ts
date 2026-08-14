import { readDelta } from "@/lib/ai/stream";

// Optional cloud models. Everything here is off by default and opt-in: the
// local runtime stays the product. Each provider speaks the OpenAI
// chat-completions shape, so one client covers all of them.
//
// Keys live in this browser only (the local document store). They are never
// bundled, never sent anywhere but the provider the user configured.

export type CloudProviderId = "openai" | "openrouter" | "engy" | "claude" | "kimi";

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

export type CloudState = "unconfigured" | "configured" | "active" | "rate_limited" | "blocked" | "error";

export function cloudState(
  cfg: CloudConfig | undefined,
  lastError?: string | null,
  active = false,
): CloudState {
  if (!cfg?.apiKey) return "unconfigured";
  if (lastError) {
    if (/(?:429|rate.?limit)/i.test(lastError)) return "rate_limited";
    if (/cors|failed to fetch|network/i.test(lastError)) return "blocked";
    return "error";
  }
  return active ? "active" : "configured";
}

export type CloudChatOptions = {
  temperature?: number;
  maxTokens?: number;
  repetitionPenalty?: number;
  onToken?: (partial: string) => void;
  signal?: AbortSignal;
};

/**
 * One streaming chat call against an OpenAI-compatible endpoint. No timeout is
 * imposed: generation takes as long as it takes, the user can stop it.
 */
export async function cloudChat(
  cfg: CloudConfig,
  system: string,
  user: string,
  options: CloudChatOptions = {},
): Promise<string> {
  const spec = CLOUD_BY_ID[cfg.id];
  const base = (cfg.baseUrl || spec.baseUrl).replace(/\/$/, "");
  const model = cfg.model || spec.model;

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
      temperature: options.temperature ?? 0.4,
      max_tokens: options.maxTokens ?? 512,
      ...(options.repetitionPenalty ? { repetition_penalty: options.repetitionPenalty } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
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
        const piece = readDelta(JSON.parse(payload));
        if (piece) {
          out += piece;
          options.onToken?.(out);
        }
      } catch {
        /* keep streaming — a partial frame is not fatal */
      }
    }
  }
  return out.trim();
}
