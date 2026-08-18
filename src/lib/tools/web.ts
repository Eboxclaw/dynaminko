// Web search via DuckDuckGo, for news and external facts the journal cannot
// answer. Two transports, in order:
//
//   1. same-origin /api/web-search (src/server.ts) — the worker fetches
//      lite.duckduckgo.com server-side, where browser CORS does not apply,
//      and parses real result rows. Works in dev and on the deployed app.
//   2. api.duckduckgo.com Instant Answer JSON — CORS-enabled, so it also
//      works from a purely static host with no server routes. Returns an
//      abstract plus related links instead of live SERP rows.
//
// Output is normalized and bounded (5 rows, snippets trimmed) so it enters
// observations like any other tool result; the capture-level clampResult and
// assembly-level clampDataText still apply behind it.

export type WebResult = {
  title: string;
  url: string;
  snippet: string;
};

export type WebSearchOut = {
  query: string;
  source: "duckduckgo-lite" | "duckduckgo-ia";
  results: WebResult[];
  note?: string;
};

const MAX_ROWS = 5;
const SNIPPET_CHARS = 220;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

/** lite.duckduckgo.com is a plain table of anchors and snippet cells.
 * Attribute order inside the anchor varies, so href is pulled from the tag
 * attributes after the class match, not inline in one regex. */
function parseLite(html: string, limit: number): WebResult[] {
  const out: WebResult[] = [];
  const snippetBlock = /class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g;
  const snippets: string[] = [];
  for (const m of html.matchAll(snippetBlock)) snippets.push(stripTags(m[1]));
  let i = 0;
  for (const m of html.matchAll(/<a\b([^>]*\bclass="result-link"[^>]*)>([\s\S]*?)<\/a>/g)) {
    if (out.length >= limit) break;
    const href = /href="([^"]+)"/.exec(m[1])?.[1];
    if (!href) continue;
    const raw = decodeURIComponent(href);
    // lite wraps outbound links as //duckduckgo.com/l/?uddg=<encoded>
    const target = /[?&]uddg=([^&]+)/.exec(raw)?.[1];
    const url = target ? decodeURIComponent(target) : raw;
    if (!/^https?:\/\//.test(url)) continue;
    // After unwrap, surviving duckduckgo.com links are internal (ads,
    // trackers), never organic results.
    if (/^https?:\/\/([^/]+\.)?duckduckgo\.com\//i.test(url)) continue;
    out.push({
      title: stripTags(m[2]).slice(0, 120),
      url,
      snippet: (snippets[i] ?? "").slice(0, SNIPPET_CHARS),
    });
    i++;
  }
  return out;
}

/** The worker-side handler wired into src/server.ts's fetch entry. */
export async function webSearchProxy(url: URL, request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
  const limit = Math.min(8, Math.max(1, Number(url.searchParams.get("limit")) || MAX_ROWS));
  if (!q) return Response.json({ error: "missing q" }, { status: 400 });
  try {
    const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
        accept: "text/html",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      return Response.json({ error: `duckduckgo ${res.status}` }, { status: 502 });
    }
    const html = await res.text();
    const results = parseLite(html, limit);
    if (results.length === 0) {
      // Zero rows means the anomaly wall or an empty SERP; signal failure so
      // the client falls through to the Instant Answer API instead of
      // treating "blocked" as "no results on the web".
      return Response.json(
        { error: "duckduckgo returned no parsable results (anomaly wall or empty page)" },
        { status: 502 },
      );
    }
    return Response.json(
      { query: q, source: "duckduckgo-lite", results },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "upstream failed" },
      { status: 502 },
    );
  }
}

type IaTopic = { FirstURL?: string; Text?: string; Topics?: IaTopic[] };

function flattenTopics(topics: IaTopic[], out: WebResult[], limit: number) {
  for (const t of topics) {
    if (out.length >= limit) return;
    if (t.Topics) {
      flattenTopics(t.Topics, out, limit);
      continue;
    }
    if (t.FirstURL && t.Text) {
      const text = stripTags(t.Text);
      out.push({
        title: text.split(" - ")[0].slice(0, 120),
        url: t.FirstURL,
        snippet: text.slice(0, SNIPPET_CHARS),
      });
    }
  }
}

/** Client-side fallback: the Instant Answer API sends CORS headers. */
async function instantAnswer(query: string, limit: number): Promise<WebSearchOut> {
  const res = await fetch(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
  );
  if (!res.ok) throw new Error(`duckduckgo ia ${res.status}`);
  const data = (await res.json()) as {
    Heading?: string;
    AbstractText?: string;
    AbstractURL?: string;
    RelatedTopics?: IaTopic[];
  };
  const results: WebResult[] = [];
  if (data.AbstractText && data.AbstractURL) {
    results.push({
      title: data.Heading || query,
      url: data.AbstractURL,
      snippet: data.AbstractText.slice(0, SNIPPET_CHARS),
    });
  }
  flattenTopics(data.RelatedTopics ?? [], results, limit);
  return {
    query,
    source: "duckduckgo-ia",
    results: results.slice(0, limit),
    note: results.length ? undefined : "no instant answer for this query",
  };
}

/** tool: web.search — live DuckDuckGo search, proxy first, IA fallback. */
export async function webSearch(query: string, limit = MAX_ROWS): Promise<WebSearchOut> {
  const q = query.trim().slice(0, 200);
  const cap = Math.min(8, Math.max(1, limit || MAX_ROWS));
  if (!q) return { query: "", source: "duckduckgo-ia", results: [], note: "empty query" };
  try {
    const res = await fetch(`/api/web-search?q=${encodeURIComponent(q)}&limit=${cap}`);
    if (res.ok) {
      const data = (await res.json()) as WebSearchOut;
      if (Array.isArray(data.results) && data.results.length > 0) {
        return { ...data, results: data.results.slice(0, cap) };
      }
    }
  } catch {
    /* static host or proxy down: fall through to the CORS-enabled API */
  }
  const ia = await instantAnswer(q, cap);
  if (ia.results.length === 0) {
    return {
      ...ia,
      note: "web search returned no rows: DuckDuckGo may be blocking this network; report this instead of inventing results",
    };
  }
  return ia;
}
