// /api/stats — public, aggregate-only usage counters over Upstash Redis REST.
// Keys: spark:tot:{event} (all-time) and spark:d:{yyyy-mm-dd}:{event} (90-day
// TTL). Counts only; the endpoint never receives or stores addresses, IPs, or
// sessions.
//
// POST requires an application/json body, which a cross-origin page cannot
// send without a CORS preflight this endpoint never answers, so increments
// come from the app itself. GET is open on purpose: reviewers can check the
// numbers.

import { STATS_EVENTS } from "./client";

const NAME_RE = /^[a-z0-9_]{1,48}$/;
const DAY_TTL_SECONDS = 90 * 24 * 60 * 60;

function upstash(): { base: string; token: string } | null {
  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) return null;
  return { base: base.replace(/\/+$/, ""), token };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** Returns one result per command, or null when Upstash is not configured. */
async function pipeline(commands: string[][]): Promise<unknown[] | null> {
  const cfg = upstash();
  if (!cfg) return null;
  const res = await fetch(`${cfg.base}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.token}` },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Upstash pipeline ${res.status}`);
  const rows = (await res.json()) as Array<{ result: unknown }>;
  return rows.map((r) => r.result);
}

function accepted(name: string): boolean {
  if (!NAME_RE.test(name)) return false;
  return (STATS_EVENTS as readonly string[]).includes(name) || name.startsWith("venue_read_");
}

export async function statsEndpoint(request: Request): Promise<Response> {
  const cfg = upstash();

  if (request.method === "GET") {
    if (!cfg) return json({ configured: false });
    try {
      const keys =
        ((await pipeline([["keys", "spark:*"]]))?.[0] as string[] | undefined) ?? [];
      const values = keys.length
        ? (((await pipeline([["mget", ...keys]]))?.[0] as Array<string | null>) ?? [])
        : [];
      const totals: Record<string, number> = {};
      const daily: Record<string, Record<string, number>> = {};
      keys.forEach((key, i) => {
        const n = Number(values[i] ?? 0);
        if (key.startsWith("spark:tot:")) {
          totals[key.slice("spark:tot:".length)] = n;
        } else if (key.startsWith("spark:d:")) {
          const rest = key.slice("spark:d:".length);
          const date = rest.slice(0, 10);
          const event = rest.slice(11);
          if (/^\d{4}-\d{2}-\d{2}$/.test(date) && event) {
            (daily[date] ??= {})[event] = n;
          }
        }
      });
      return json({ configured: true, totals, daily });
    } catch (error) {
      console.error(error);
      return json({ configured: true, error: "stats read failed" }, 502);
    }
  }

  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return json({ error: "json only" }, 415);
  if (!cfg) return json({ configured: false }, 503);

  const body = (await request.json().catch(() => null)) as { events?: unknown } | null;
  const names = Array.isArray(body?.events)
    ? body.events.filter((v): v is string => typeof v === "string" && accepted(v))
    : [];
  if (names.length === 0 || names.length > 64) return json({ error: "bad events" }, 400);

  const date = new Date().toISOString().slice(0, 10);
  const commands: string[][] = [];
  const dayKeys = new Set<string>();
  for (const name of names) {
    commands.push(["incrby", `spark:tot:${name}`, "1"]);
    const dayKey = `spark:d:${date}:${name}`;
    commands.push(["incrby", dayKey, "1"]);
    dayKeys.add(dayKey);
  }
  for (const dayKey of dayKeys) commands.push(["expire", dayKey, String(DAY_TTL_SECONDS)]);
  try {
    await pipeline(commands);
  } catch (error) {
    console.error(error);
    return json({ error: "stats write failed" }, 502);
  }
  return new Response(null, { status: 204 });
}
