// Web search for news and external facts the journal cannot answer. The
// chain degrades gracefully at every step:
//
//   1. same-origin /api/web-search (src/server.ts) — the worker fetches
//      lite.duckduckgo.com server-side, where browser CORS does not apply,
//      and parses real result rows. Works in dev and on the deployed app.
//   2. s.jina.ai directly from the browser — CORS-enabled, so it also works
//      from a purely static host. Requires a free key (localStorage): the
//      keyless endpoint answers 401 since Jina ended anonymous access.
//   3. /api/web-search?provider=tavily — only when a Tavily key is stored;
//      the key rides a same-origin header, never a third-party origin.
//   4. /api/web-search?provider=jina — the same Jina key, but fetched by
//      the worker: reaches providers the browser itself is blocked from.
//   5. api.duckduckgo.com Instant Answer JSON — CORS-enabled fallback that
//      returns an abstract plus related links instead of live SERP rows.
//   6. en.wikipedia.org full-text search — CORS-enabled (origin=*), the
//      last resort; unlike the old opensearch call it answers natural-
//      language phrases, not just title prefixes.
//
// First non-empty transport wins: the happy path stays a single request and
// scarce quotas are never spent when DuckDuckGo answers. When everything
// fails the note names each transport's outcome, so a dead provider is
// visible instead of a generic "blocked". Rows are deduped by URL and, when
// the always-warm MiniLM encoder is available, reordered by local cosine
// relevance (imports lazily so the server bundle never pulls the embedding
// runtime).
//
// Output is normalized and bounded (5 rows, snippets trimmed) so it enters
// observations like any other tool result; the capture-level clampResult and
// assembly-level clampDataText still apply behind it.

export type WebResult = {
  title: string;
  url: string;
  snippet: string;
};

export type WebSearchSource = "duckduckgo-lite" | "duckduckgo-ia" | "jina" | "tavily" | "wikipedia";

export type WebSearchOut = {
  query: string;
  source: WebSearchSource;
  results: WebResult[];
  note?: string;
};

const MAX_ROWS = 5;
const SNIPPET_CHARS = 220;

// ── optional provider keys (sealed on this device, never bundled) ─────

export type WebProviderKeys = { jina?: string; tavily?: string };

import { peekSecret, putSecret } from "@/lib/secrets";

/** Keys live in the device secret store (AES-GCM sealed, IDB primary with a
 * sealed mirror), hydrated into the boot cache at startup. Sync on purpose:
 * the search chain must not wait on IDB before every hop. */
export function getWebKeys(): WebProviderKeys {
  const out: WebProviderKeys = {};
  const jina = peekSecret("web.jina");
  const tavily = peekSecret("web.tavily");
  if (jina) out.jina = jina;
  if (tavily) out.tavily = tavily;
  return out;
}

export function setWebKeys(keys: WebProviderKeys): void {
  if (typeof window === "undefined") return;
  void putSecret("web.jina", keys.jina ?? "");
  void putSecret("web.tavily", keys.tavily ?? "");
}

// ── shared HTML/text helpers ──────────────────────────────────────────

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

/** Collapse the same document arriving twice (trailing slash, query noise). */
export function dedupeResults(rows: WebResult[]): WebResult[] {
  const seen = new Set<string>();
  const out: WebResult[] = [];
  for (const r of rows) {
    const key = r.url
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "")
      .toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** lite.duckduckgo.com is a plain table of anchors and snippet cells.
 * Attribute order inside the anchor varies, so href is pulled from the tag
 * attributes after the class match, not inline in one regex. Class
 * attributes arrive single-quoted on the live endpoint (class='result-link'),
 * so both quote styles must match. */
export function parseLite(html: string, limit: number): WebResult[] {
  const out: WebResult[] = [];
  const snippetBlock = /class=(['"])result-snippet\1[^>]*>([\s\S]*?)<\/td>/g;
  const snippets: string[] = [];
  for (const m of html.matchAll(snippetBlock)) snippets.push(stripTags(m[2]));
  let i = 0;
  for (const m of html.matchAll(/<a\b([^>]*\bclass=(['"])result-link\2[^>]*)>([\s\S]*?)<\/a>/g)) {
    if (out.length >= limit) break;
    const href = /href=(["'])([^"']+)\1/.exec(m[1])?.[2];
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
      title: stripTags(m[3]).slice(0, 120),
      url,
      snippet: (snippets[i] ?? "").slice(0, SNIPPET_CHARS),
    });
    i++;
  }
  return out;
}

/**
 * s.jina.ai answers with JSON when asked (accept: application/json) and
 * plain markdown otherwise; both shapes must parse because keyless calls
 * and proxies can negotiate differently.
 */
export function parseJinaPayload(text: string, limit: number): WebResult[] {
  try {
    const data = JSON.parse(text) as {
      data?: { title?: string; url?: string; description?: string; content?: string }[];
    };
    if (Array.isArray(data.data)) {
      return data.data
        .filter((d): d is { title?: string; url: string; description?: string; content?: string } =>
          Boolean(d.url),
        )
        .slice(0, limit)
        .map((d) => ({
          title: (d.title ?? d.url).slice(0, 120),
          url: d.url,
          snippet: (d.description ?? d.content ?? "").slice(0, SNIPPET_CHARS),
        }));
    }
  } catch {
    /* markdown form handled below */
  }
  // Markdown form: "1. [Title](url)\n   snippet…". The snippet is whatever
  // text sits between one link and the next.
  const links = [...text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)];
  const out: WebResult[] = [];
  for (let i = 0; i < links.length && out.length < limit; i++) {
    const snippet = text.slice(links[i].index! + links[i][0].length, links[i + 1]?.index).trim();
    out.push({
      title: links[i][1].slice(0, 120),
      url: links[i][2],
      snippet: snippet.replace(/\s+/g, " ").slice(0, SNIPPET_CHARS),
    });
  }
  return out;
}

/** list=search replies {query:{search:[{title, snippet(html-fragment)}]}}. */
export function parseWikipediaSearch(text: string, limit: number): WebResult[] {
  try {
    const data = JSON.parse(text) as {
      query?: { search?: { title?: string; snippet?: string }[] };
    };
    return (data.query?.search ?? [])
      .slice(0, limit)
      .filter((r) => r.title)
      .map((r) => ({
        title: r.title!.slice(0, 120),
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title!.replaceAll(" ", "_"))}`,
        snippet: stripTags(r.snippet ?? "").slice(0, SNIPPET_CHARS),
      }));
  } catch {
    return [];
  }
}

// ── client-side transports ────────────────────────────────────────────

/** Direct browser call to s.jina.ai: CORS-enabled, keyless at a low rate. */
async function jinaSearchDirect(query: string, limit: number, key?: string): Promise<WebSearchOut> {
  const res = await fetch(`https://s.jina.ai/${encodeURIComponent(query)}`, {
    headers: {
      accept: "application/json",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`jina ${res.status}`);
  const results = parseJinaPayload(await res.text(), limit);
  return { query, source: "jina", results };
}

/** Provider-routed call through our own proxy; the key rides a same-origin
 * header so it never crosses to a third-party origin from the browser. */
async function proxyProvider(
  provider: "jina" | "tavily",
  query: string,
  limit: number,
  key?: string,
): Promise<WebSearchOut | null> {
  try {
    const res = await fetch(
      `/api/web-search?q=${encodeURIComponent(query)}&limit=${limit}&provider=${provider}`,
      key ? { headers: { "x-web-key": key } } : undefined,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as WebSearchOut;
    return Array.isArray(data.results) && data.results.length > 0 ? data : null;
  } catch {
    return null;
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

/** Last-resort full-text search; list=search is CORS-open via origin=* and
 * answers natural-language phrases that title-prefix opensearch could not. */
async function wikipediaSearch(query: string, limit: number): Promise<WebSearchOut> {
  const res = await fetch(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=${limit}&srsearch=${encodeURIComponent(query)}`,
    { signal: AbortSignal.timeout(8_000) },
  );
  if (!res.ok) throw new Error(`wikipedia ${res.status}`);
  return { query, source: "wikipedia", results: parseWikipediaSearch(await res.text(), limit) };
}

// ── local rerank ──────────────────────────────────────────────────────

/**
 * Reorder rows by cosine similarity against the query using the always-warm
 * MiniLM encoder. Opportunistic by design: no encoder, no reorder. The
 * encoder module is imported lazily so the server bundle (which imports
 * this file for the proxy handlers) never pulls the embedding runtime.
 */
async function rerankResults(
  query: string,
  rows: WebResult[],
): Promise<{ rows: WebResult[]; reranked: boolean }> {
  if (rows.length < 3) return { rows, reranked: false };
  try {
    const { rank } = await import("@/lib/ai/encoder");
    const ranked = await rank(
      query,
      rows.map((r, i) => ({ id: String(i), text: `${r.title}. ${r.snippet}` })),
      { opportunistic: true },
    );
    if (!ranked || ranked.length < rows.length) return { rows, reranked: false };
    const reordered = ranked.map((r) => rows[Number(r.id)]).filter(Boolean);
    if (reordered.length !== rows.length) return { rows, reranked: false };
    return { rows: reordered, reranked: true };
  } catch {
    return { rows, reranked: false };
  }
}

/** Dedupe + rerank whatever transport won; single exit for the chain. */
async function finalize(out: WebSearchOut, cap: number): Promise<WebSearchOut> {
  const deduped = dedupeResults(out.results).slice(0, cap);
  if (deduped.length === 0) return out;
  const { rows, reranked } = await rerankResults(out.query, deduped);
  return {
    ...out,
    results: rows,
    note: out.note ?? (reranked ? "rows reranked by local relevance" : undefined),
  };
}

// ── the tool entry ────────────────────────────────────────────────────

/** tool: web.search — provider chain, first non-empty transport wins.
 * Every fallthrough records a one-line status so the failure note (when it
 * comes to that) says which transport died and why. */
export async function webSearch(query: string, limit = MAX_ROWS): Promise<WebSearchOut> {
  const q = query.trim().slice(0, 200);
  const cap = Math.min(8, Math.max(1, limit || MAX_ROWS));
  if (!q) return { query: "", source: "duckduckgo-ia", results: [], note: "empty query" };
  const keys = getWebKeys();
  const statuses: string[] = [];

  // 1. DuckDuckGo lite through the same-origin proxy.
  try {
    const res = await fetch(`/api/web-search?q=${encodeURIComponent(q)}&limit=${cap}`);
    if (!res.ok) {
      statuses.push(`ddg-proxy ${res.status}`);
    } else {
      const data = (await res.json()) as WebSearchOut;
      if (Array.isArray(data.results) && data.results.length > 0) {
        return finalize({ ...data, results: data.results.slice(0, cap) }, cap);
      }
      statuses.push("ddg-proxy empty");
    }
  } catch {
    statuses.push("ddg-proxy unreachable");
  }

  // 2. Jina direct from the browser; keyed when a key exists. Keyless calls
  // get 401 these days, so this hop mostly matters once a key is stored.
  try {
    const jina = await jinaSearchDirect(q, cap, keys.jina);
    if (jina.results.length > 0) return finalize(jina, cap);
    statuses.push("jina empty");
  } catch (err) {
    statuses.push(err instanceof Error ? err.message : "jina failed");
  }

  // 3. Tavily through our proxy, only when configured.
  if (keys.tavily) {
    const tavily = await proxyProvider("tavily", q, cap, keys.tavily);
    if (tavily) return finalize(tavily, cap);
    statuses.push("tavily no rows");
  } else {
    statuses.push("tavily no key");
  }

  // 4. Jina through our proxy: same key, but the worker's egress can reach
  // providers the browser itself is blocked from.
  const jinaProxy = await proxyProvider("jina", q, cap, keys.jina);
  if (jinaProxy) return finalize(jinaProxy, cap);
  statuses.push("jina-proxy no rows");

  // 5. DuckDuckGo Instant Answer.
  try {
    const ia = await instantAnswer(q, cap);
    if (ia.results.length > 0) return finalize(ia, cap);
    statuses.push("ddg-ia empty");
  } catch (err) {
    statuses.push(err instanceof Error ? err.message : "ddg-ia failed");
  }

  // 6. Wikipedia full-text search.
  try {
    const wiki = await wikipediaSearch(q, cap);
    if (wiki.results.length > 0) return wiki;
    statuses.push("wikipedia empty");
  } catch (err) {
    statuses.push(err instanceof Error ? err.message : "wikipedia failed");
  }

  return {
    query: q,
    source: "duckduckgo-ia",
    results: [],
    note: `web search returned no rows (${statuses.join("; ")}); report this instead of inventing results`,
  };
}

// ── page reading (web.read) ───────────────────────────────────────────
//
// One page is fetched and reduced to a bounded structural digest the model
// can reason over: what the site says (lead paragraphs) and how it is built
// (outline, outbound links, image inventory). The full page never enters the
// context; the capture-level clampResult still guards whatever lands in an
// observation. Transports mirror web.search: our proxy first (server-side
// fetch has no CORS constraints), then r.jina.ai directly from the browser
// (CORS-enabled, keyless at a low rate) so static hosts keep the capability.

export type WebPageImage = { alt: string; url: string };

export type WebReadOut = {
  url: string;
  title: string;
  description: string;
  siteName?: string;
  outline: string[];
  paragraphs: string[];
  linkDomains: string[];
  images: WebPageImage[];
  imageCount: number;
  words: number;
  source: "proxy-html" | "jina-reader";
  note?: string;
};

const PARAGRAPH_BUDGET = 3000;
const OUTLINE_ROWS = 12;
const IMAGE_ROWS = 6;
const LINK_DOMAIN_ROWS = 5;
const MAX_HTML_CHARS = 2_000_000;

/** SSRF guard shared by every url-accepting transport: http(s) only, no IP
 * literals, no private/local hostnames, standard ports only. */
export function assertPublicUrl(raw: string): URL {
  const u = new URL(raw.trim());
  if (!/^https?:$/.test(u.protocol)) throw new Error("only http(s) urls are read");
  if (u.port && u.port !== "80" && u.port !== "443")
    throw new Error("non-standard ports are not read");
  const host = u.hostname.toLowerCase();
  if (/^(localhost|.*\.local|.*\.internal)$/.test(host)) {
    throw new Error("private addresses are not read");
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) {
    throw new Error("ip literals are not read");
  }
  return u;
}

function metaContent(html: string, key: string): string {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    if (!new RegExp(`(?:name|property)=["']${key}["']`, "i").test(tag)) continue;
    const content = /content=["']([^"']*)["']/i.exec(tag)?.[1];
    if (content) return decodeEntities(content).trim();
  }
  return "";
}

function emptyRead(url: string, note: string): WebReadOut {
  return {
    url,
    title: "",
    description: "",
    outline: [],
    paragraphs: [],
    linkDomains: [],
    images: [],
    imageCount: 0,
    words: 0,
    source: "proxy-html",
    note,
  };
}

/** Reduce raw HTML to the bounded digest; no dependencies, order-tolerant. */
export function extractHtmlDigest(html: string, pageUrl: string): Omit<WebReadOut, "source"> {
  const title =
    stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "") ||
    metaContent(html, "og:title");
  const description = metaContent(html, "description") || metaContent(html, "og:description");
  const siteName = metaContent(html, "og:site_name") || undefined;
  let host = "";
  try {
    host = new URL(pageUrl).hostname.toLowerCase();
  } catch {
    /* digest without domain filtering */
  }

  // Meta extraction already happened; drop the noise before structural work.
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|head|template)\b[\s\S]*?<\/\1>/gi, " ");

  const outline: string[] = [];
  for (const m of body.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = stripTags(m[2]).slice(0, 90);
    if (text && !outline.includes(text)) outline.push(text);
    if (outline.length >= OUTLINE_ROWS) break;
  }

  const paragraphs: string[] = [];
  let budget = PARAGRAPH_BUDGET;
  for (const m of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = stripTags(m[1]);
    if (text.length < 40) continue;
    paragraphs.push(text.slice(0, budget));
    budget -= text.length;
    if (budget <= 0) break;
  }

  const domainCounts = new Map<string, number>();
  for (const m of body.matchAll(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["']/gi)) {
    try {
      const h = new URL(m[1]).hostname.toLowerCase();
      if (h === host || h.endsWith(`.${host}`) || host.endsWith(`.${h}`)) continue;
      domainCounts.set(h, (domainCounts.get(h) ?? 0) + 1);
    } catch {
      /* malformed href: not a signal */
    }
  }
  const linkDomains = [...domainCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, LINK_DOMAIN_ROWS)
    .map(([d, n]) => `${d} (${n})`);

  const images: WebPageImage[] = [];
  const pushImage = (alt: string, src: string) => {
    if (images.length >= IMAGE_ROWS) return;
    if (!/^https?:\/\//.test(src)) return;
    if (images.some((i) => i.url === src)) return;
    images.push({ alt: decodeEntities(alt).trim().slice(0, 80), url: src });
  };
  pushImage("og:image", metaContent(html, "og:image"));
  let imageCount = 0;
  for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
    imageCount++;
    const src = /src=["']([^"']+)["']/i.exec(m[0])?.[1];
    if (!src || src.startsWith("data:")) continue;
    const alt = /alt=["']([^"']*)["']/i.exec(m[0])?.[1] ?? "";
    try {
      pushImage(alt, new URL(src, pageUrl).toString());
    } catch {
      /* unresolvable src: skip */
    }
  }

  const words = (body.replace(/<[^>]+>/g, " ").match(/\S+/g) ?? []).length;

  return {
    url: pageUrl,
    title: title.slice(0, 140),
    description: description.slice(0, 300),
    ...(siteName ? { siteName } : {}),
    outline,
    paragraphs,
    linkDomains,
    images,
    imageCount,
    words,
  };
}

/** Same digest shape from reader markdown (r.jina.ai output). */
export function digestMarkdown(md: string, pageUrl: string): Omit<WebReadOut, "source"> {
  // Reader responses open with "Title:"/"URL Source:"/"PublishedTime:" lines;
  // the page itself starts after the "Markdown Content:" marker. Without the
  // marker (plain markdown) the whole input is the page.
  const marker = /^Markdown Content:\s*$/m.exec(md);
  const page = marker ? md.slice(marker.index + marker[0].length) : md;
  const lines = page.split("\n");
  const headingLines = lines.filter((l) => /^#{1,3}\s+\S/.test(l));
  const title = (headingLines[0] ?? "").replace(/^#+\s+/, "").trim();
  const outline: string[] = [];
  for (const l of headingLines.slice(1)) {
    const text = l
      .replace(/^#+\s+/, "")
      .trim()
      .slice(0, 90);
    if (text && !outline.includes(text)) outline.push(text);
    if (outline.length >= OUTLINE_ROWS) break;
  }

  const stripMd = (s: string) => s.replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1").trim();
  const paragraphs: string[] = [];
  let budget = PARAGRAPH_BUDGET;
  for (const block of page.split(/\n\s*\n/)) {
    if (/^#{1,3}\s/.test(block)) continue;
    const text = stripMd(block.replace(/\s+/g, " "));
    if (text.length < 40) continue;
    paragraphs.push(text.slice(0, budget));
    budget -= text.length;
    if (budget <= 0) break;
  }

  let host = "";
  try {
    host = new URL(pageUrl).hostname.toLowerCase();
  } catch {
    /* keep empty */
  }
  const domainCounts = new Map<string, number>();
  for (const m of md.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g)) {
    try {
      const h = new URL(m[2]).hostname.toLowerCase();
      if (h === host || h.endsWith(`.${host}`) || host.endsWith(`.${h}`)) continue;
      domainCounts.set(h, (domainCounts.get(h) ?? 0) + 1);
    } catch {
      /* malformed link */
    }
  }
  const linkDomains = [...domainCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, LINK_DOMAIN_ROWS)
    .map(([d, n]) => `${d} (${n})`);

  const images: WebPageImage[] = [];
  let imageCount = 0;
  for (const m of page.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)) {
    imageCount++;
    if (images.length >= IMAGE_ROWS) continue;
    const src = m[2];
    if (!/^https?:\/\//.test(src) || images.some((i) => i.url === src)) continue;
    images.push({ alt: m[1].slice(0, 80), url: src });
  }

  return {
    url: pageUrl,
    title: title.slice(0, 140),
    description: (paragraphs[0] ?? "").slice(0, 300),
    outline,
    paragraphs,
    linkDomains,
    images,
    imageCount,
    words: (page.match(/\S+/g) ?? []).length,
  };
}

/** tool: web.read — proxy first, reader fallback, honest failure note. */
export async function webRead(pageUrl: string): Promise<WebReadOut> {
  let u: URL;
  try {
    u = assertPublicUrl(pageUrl.slice(0, 512));
  } catch (err) {
    return emptyRead(pageUrl.slice(0, 512), err instanceof Error ? err.message : "invalid url");
  }

  try {
    const res = await fetch(`/api/web-read?url=${encodeURIComponent(u.toString())}`);
    if (res.ok) return (await res.json()) as WebReadOut;
  } catch {
    /* static host or proxy down: reader fallback below */
  }

  try {
    const keys = getWebKeys();
    const res = await fetch(`https://r.jina.ai/${u.toString()}`, {
      headers: {
        accept: "text/plain",
        ...(keys.jina ? { authorization: `Bearer ${keys.jina}` } : {}),
      },
      signal: AbortSignal.timeout(25_000),
    });
    if (res.ok) {
      const md = await res.text();
      if (md.trim()) {
        return { ...digestMarkdown(md.slice(0, 400_000), u.toString()), source: "jina-reader" };
      }
    }
  } catch {
    /* both transports failed: honest note below */
  }

  return emptyRead(
    u.toString(),
    "page could not be read (proxy and reader both failed); report this instead of inventing content",
  );
}

// ── server-side proxy handlers (wired in src/server.ts) ───────────────

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/** Shared validation for every provider route. */
function readQuery(url: URL): { q: string; limit: number } | Response {
  if (url.pathname !== "/api/web-search") return jsonError("not found", 404);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
  const limit = Math.min(8, Math.max(1, Number(url.searchParams.get("limit")) || MAX_ROWS));
  if (!q) return jsonError("missing q", 400);
  return { q, limit };
}

async function jinaUpstream(q: string, limit: number, key?: string): Promise<Response> {
  try {
    const res = await fetch(`https://s.jina.ai/${encodeURIComponent(q)}`, {
      headers: {
        accept: "application/json",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return jsonError(`jina ${res.status}`, 502);
    const results = parseJinaPayload(await res.text(), limit);
    if (results.length === 0) return jsonError("jina returned no parsable results", 502);
    return Response.json(
      { query: q, source: "jina", results },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "upstream failed", 502);
  }
}

async function tavilyUpstream(q: string, limit: number, key: string | null): Promise<Response> {
  if (!key) return jsonError("tavily needs a key (x-web-key header)", 400);
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ query: q, max_results: limit }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return jsonError(`tavily ${res.status}`, 502);
    const data = (await res.json()) as {
      results?: { title?: string; url?: string; content?: string }[];
    };
    const results = (data.results ?? [])
      .filter((r) => r.url)
      .slice(0, limit)
      .map((r) => ({
        title: (r.title ?? r.url ?? "").slice(0, 120),
        url: r.url as string,
        snippet: (r.content ?? "").slice(0, SNIPPET_CHARS),
      }));
    if (results.length === 0) return jsonError("tavily returned no parsable results", 502);
    return Response.json(
      { query: q, source: "tavily", results },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "upstream failed", 502);
  }
}

/** The worker-side handler wired into src/server.ts's fetch entry. The
 * default provider stays DuckDuckGo lite; jina/tavily are opted into per
 * request via ?provider=. Keys arrive same-origin via x-web-key. */
export async function webSearchProxy(url: URL, request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return jsonError("method not allowed", 405);
  }
  const params = readQuery(url);
  if (params instanceof Response) return params;
  const { q, limit } = params;
  const provider = url.searchParams.get("provider") ?? "ddg";
  const key = request.headers.get("x-web-key");

  if (provider === "jina") return jinaUpstream(q, limit, key ?? undefined);
  if (provider === "tavily") return tavilyUpstream(q, limit, key);

  try {
    const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
        accept: "text/html",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return jsonError(`duckduckgo ${res.status}`, 502);
    }
    const html = await res.text();
    const results = parseLite(html, limit);
    if (results.length === 0) {
      // Zero rows means the anomaly wall or an empty SERP; signal failure so
      // the client falls through to the direct transports instead of
      // treating "blocked" as "no results on the web".
      return jsonError("duckduckgo returned no parsable results (anomaly wall or empty page)", 502);
    }
    return Response.json(
      { query: q, source: "duckduckgo-lite", results },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "upstream failed", 502);
  }
}

/** Manual redirect follow so every hop re-passes the SSRF guard; fetch's
 * built-in follow would happily land on an internal address. */
async function fetchPublic(target: URL): Promise<Response> {
  let current = target;
  for (let hop = 0; hop <= 3; hop++) {
    const res = await fetch(current, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status < 300 || res.status >= 400) return res;
    const loc = res.headers.get("location");
    if (!loc) return res;
    current = assertPublicUrl(new URL(loc, current).toString());
  }
  throw new Error("too many redirects");
}

/** Worker-side page reader: one guarded fetch, capped read, server-side
 * extraction so the browser only ever receives the small digest. */
export async function webReadProxy(url: URL, request: Request): Promise<Response> {
  if (request.method !== "GET") return jsonError("method not allowed", 405);
  if (url.pathname !== "/api/web-read") return jsonError("not found", 404);
  const raw = (url.searchParams.get("url") ?? "").slice(0, 512);
  let target: URL;
  try {
    target = assertPublicUrl(raw);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "invalid url", 400);
  }
  try {
    const res = await fetchPublic(target);
    if (!res.ok) return jsonError(`upstream ${res.status}`, 502);
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml|text\/plain/i.test(type)) {
      return jsonError(`unsupported content-type: ${type.slice(0, 60)}`, 415);
    }
    // Streamed read with a hard cap: a huge page can never balloon memory.
    let html = "";
    const reader = res.body?.getReader();
    if (reader) {
      const decoder = new TextDecoder();
      while (html.length < MAX_HTML_CHARS) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
      }
      await reader.cancel().catch(() => {});
    } else {
      html = await res.text();
    }
    if (!html.trim()) return jsonError("empty page", 502);
    const digest = extractHtmlDigest(html.slice(0, MAX_HTML_CHARS), target.toString());
    if (!digest.title && digest.paragraphs.length === 0) {
      return jsonError("page produced no readable text (client-rendered app?)", 422);
    }
    return Response.json(
      { ...digest, source: "proxy-html" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "upstream failed", 502);
  }
}

/** Same-origin image proxy: under COEP require-corp, cross-origin images
 * are blocked from canvas read operations. Proxying through our own origin
 * avoids the restriction while keeping the SSRF guard. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export async function webImageProxy(url: URL, request: Request): Promise<Response> {
  if (request.method !== "GET") return jsonError("method not allowed", 405);
  if (url.pathname !== "/api/web-image") return jsonError("not found", 404);
  const raw = (url.searchParams.get("url") ?? "").slice(0, 512);
  let target: URL;
  try {
    target = assertPublicUrl(raw);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "invalid url", 400);
  }
  try {
    const res = await fetchPublic(target);
    if (!res.ok) return jsonError(`upstream ${res.status}`, 502);
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!type.startsWith("image/")) return jsonError(`not an image: ${type.slice(0, 60)}`, 415);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_IMAGE_BYTES) return jsonError("image too large", 413);
    return new Response(buf, {
      status: 200,
      headers: {
        "content-type": type,
        "cache-control": "no-store",
        // The canvas use case needs the bytes readable same-origin.
        "cross-origin-embedder-policy": "require-corp",
      },
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "upstream failed", 502);
  }
}
