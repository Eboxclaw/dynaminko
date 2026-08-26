// Web search: parsers locked against fixtures (DDG lite table, Jina JSON and
// markdown, Wikipedia opensearch), URL dedupe, key storage guards, the
// client-side fallback chain order (first non-empty transport wins, keys ride
// headers, local rerank only reorders when the encoder answers), and the
// provider-routed proxy handlers. fetch and the encoder are mocked because
// the node test environment has neither network nor a warm embedding model.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/encoder", () => ({ rank: vi.fn(async () => null) }));

// Import after the mock so web.ts's lazy encoder import binds the fake.
const {
  assertPublicUrl,
  dedupeResults,
  digestMarkdown,
  extractHtmlDigest,
  getWebKeys,
  parseJinaPayload,
  parseLite,
  parseWikipediaPayload,
  setWebKeys,
  webRead,
  webReadProxy,
  webSearch,
  webSearchProxy,
} = await import("./web");
const { rank } = await import("@/lib/ai/encoder");

const okJson = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as Response;
const okText = (text: string) =>
  ({ ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text }) as Response;
const badUpstream = { ok: false, status: 502 } as Response;

const LITE_HTML = `
<table>
<tr><td><a class="result-link" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa">Example A</a></td></tr>
<tr><td class="result-snippet">Snippet A</td></tr>
<tr><td><a class="result-link" href="https://example.com/b">Example B</a></td></tr>
<tr><td class="result-snippet">Snippet B</td></tr>
<tr><td><a class="result-link" href="https://duckduckgo.com/ad">Ad row</a></td></tr>
</table>`;

const JINA_JSON = JSON.stringify({
  code: 200,
  data: [
    { title: "One", url: "https://one.com/x", description: "first description" },
    { title: "NoUrl", description: "dropped" },
    { title: "Two", url: "https://two.com/y", description: "second description" },
  ],
});

const JINA_MARKDOWN = `# Search results

1. [Alpha](https://alpha.com/page)
   alpha snippet text here
2. [Beta](https://beta.com/page)
   beta snippet text here`;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(rank).mockImplementation(async () => null);
});

describe("parseLite", () => {
  it("unwraps uddg links, pairs snippets, drops internal ddg rows", () => {
    const rows = parseLite(LITE_HTML, 8);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ title: "Example A", url: "https://example.com/a", snippet: "Snippet A" });
    expect(rows[1]).toMatchObject({ url: "https://example.com/b" });
  });

  it("caps rows at the limit", () => {
    expect(parseLite(LITE_HTML, 1)).toHaveLength(1);
  });
});

describe("parseJinaPayload", () => {
  it("parses the JSON form and filters rows without a url", () => {
    const rows = parseJinaPayload(JINA_JSON, 8);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ title: "One", url: "https://one.com/x", snippet: "first description" });
  });

  it("parses the markdown form, snippet is the text between links", () => {
    const rows = parseJinaPayload(JINA_MARKDOWN, 8);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ title: "Alpha", url: "https://alpha.com/page" });
    expect(rows[0].snippet).toContain("alpha snippet");
    expect(rows[1].snippet).toContain("beta snippet");
  });
});

describe("parseWikipediaPayload", () => {
  it("zips titles, descriptions and urls", () => {
    const rows = parseWikipediaPayload(
      `["q", ["T1","T2"], ["d1","d2"], ["https://en.wikipedia.org/wiki/T1","https://en.wikipedia.org/wiki/T2"]]`,
      8,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ title: "T1", url: "https://en.wikipedia.org/wiki/T1", snippet: "d1" });
  });

  it("returns nothing on a malformed payload", () => {
    expect(parseWikipediaPayload("<html>error page</html>", 8)).toEqual([]);
  });
});

describe("dedupeResults", () => {
  it("collapses trailing-slash and fragment variants, keeps order", () => {
    const rows = dedupeResults([
      { title: "a", url: "https://x.com/page", snippet: "" },
      { title: "b", url: "https://x.com/page/", snippet: "" },
      { title: "c", url: "https://x.com/page?utm=1#frag", snippet: "" },
      { title: "d", url: "https://y.com/", snippet: "" },
    ]);
    expect(rows.map((r) => r.title)).toEqual(["a", "d"]);
  });
});

describe("provider keys", () => {
  it("keyless when window is absent (server worker)", () => {
    expect(getWebKeys()).toEqual({});
    expect(() => setWebKeys({ jina: "k" })).not.toThrow();
  });

  it("round-trips through localStorage when a window exists", () => {
    const backing = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => backing.get(k) ?? null,
        setItem: (k: string, v: string) => void backing.set(k, v),
      },
    });
    setWebKeys({ jina: "jk", tavily: "tk" });
    expect(getWebKeys()).toEqual({ jina: "jk", tavily: "tk" });
  });
});

describe("webSearch chain", () => {
  it("returns proxy rows on the happy path without touching other transports", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      okJson({
        query: "q",
        source: "duckduckgo-lite",
        results: [
          { title: "A", url: "https://a.com", snippet: "sa" },
          { title: "B", url: "https://b.com", snippet: "sb" },
          { title: "C", url: "https://c.com", snippet: "sc" },
        ],
      }) as Response,
    );
    const out = await webSearch("q");
    expect(out.source).toBe("duckduckgo-lite");
    expect(out.results).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/web-search?q=q");
  });

  it("falls through to keyless Jina direct when the proxy fails, sending the stored key", async () => {
    const backing = new Map<string, string>([["inko.web-keys", JSON.stringify({ jina: "jk" })]]);
    vi.stubGlobal("window", {
      localStorage: { getItem: (k: string) => backing.get(k) ?? null, setItem: () => {} },
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValueOnce(new Error("no server")) // proxy: static host
      .mockResolvedValueOnce(okText(JINA_JSON) as Response); // jina direct
    const out = await webSearch("q");
    expect(out.source).toBe("jina");
    expect(out.results).toHaveLength(2);
    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toContain("https://s.jina.ai/q");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer jk");
  });

  it("tries every tier in order and lands on Wikipedia last", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(badUpstream as Response) // proxy ddg: anomaly wall
      .mockRejectedValueOnce(new Error("jina rate limited")) // jina direct
      .mockRejectedValueOnce(new Error("ia down")) // ddg instant answer
      .mockResolvedValueOnce( // wikipedia opensearch
        okText(`["q",["Topic"],["desc"],["https://en.wikipedia.org/wiki/Topic"]]`) as Response,
      );
    const out = await webSearch("q");
    expect(out.source).toBe("wikipedia");
    expect(out.results[0]).toMatchObject({ title: "Topic", url: "https://en.wikipedia.org/wiki/Topic" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("reranks rows when the encoder answers, and notes it", async () => {
    vi.mocked(rank).mockResolvedValueOnce([
      { id: "2", score: 0.9 },
      { id: "1", score: 0.7 },
      { id: "0", score: 0.5 },
    ]);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      okJson({
        query: "q",
        source: "duckduckgo-lite",
        results: [
          { title: "A", url: "https://a.com", snippet: "sa" },
          { title: "B", url: "https://b.com", snippet: "sb" },
          { title: "C", url: "https://c.com", snippet: "sc" },
        ],
      }) as Response,
    );
    const out = await webSearch("q");
    expect(out.results.map((r) => r.title)).toEqual(["C", "B", "A"]);
    expect(out.note).toContain("reranked");
  });

  it("reports honestly when every transport fails", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    const out = await webSearch("q");
    expect(out.results).toEqual([]);
    expect(out.note).toContain("instead of inventing results");
  });
});

describe("webSearchProxy providers", () => {
  const req = (headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/web-search", { headers });

  it("routes provider=jina upstream with json accept and key header", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(okText(JINA_JSON) as Response);
    const res = await webSearchProxy(
      new URL("http://localhost/api/web-search?q=k&provider=jina"),
      req({ "x-web-key": "jk" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; results: unknown[] };
    expect(body.source).toBe("jina");
    expect(body.results).toHaveLength(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("https://s.jina.ai/k");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer jk");
  });

  it("refuses provider=tavily without a key", async () => {
    const res = await webSearchProxy(
      new URL("http://localhost/api/web-search?q=k&provider=tavily"),
      req(),
    );
    expect(res.status).toBe(400);
  });

  it("posts to tavily upstream with the key when present", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      okJson({ results: [{ title: "T", url: "https://t.com", content: "c" }] }) as Response,
    );
    const res = await webSearchProxy(
      new URL("http://localhost/api/web-search?q=k&provider=tavily"),
      req({ "x-web-key": "tk" }),
    );
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.tavily.com/search");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tk");
  });

  it("keeps DuckDuckGo lite as the default provider", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(okText(LITE_HTML) as Response);
    const res = await webSearchProxy(new URL("http://localhost/api/web-search?q=k"), req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string };
    expect(body.source).toBe("duckduckgo-lite");
    expect(String(fetchMock.mock.calls[0][0])).toContain("lite.duckduckgo.com");
  });

  it("rejects non-GET methods and empty queries", async () => {
    const post = new Request("http://localhost/api/web-search?q=k", { method: "POST" });
    await expect(webSearchProxy(new URL(post.url), post)).resolves.toHaveProperty("status", 405);
    await expect(
      webSearchProxy(new URL("http://localhost/api/web-search"), req()),
    ).resolves.toHaveProperty("status", 400);
  });
});

// ── web.read ──────────────────────────────────────────────────────────

const PAGE_HTML = `<!doctype html>
<html><head><title>Sample Site</title>
<meta name="description" content="A sample page about crypto things">
<meta property="og:site_name" content="Sample">
<meta property="og:image" content="https://cdn.sample.com/og.png">
<script>tracking()</script><style>.x{}</style>
</head><body>
<h1>Sample heading</h1><h2>Sub heading</h2><h4>Too deep</h4>
<p>First paragraph long enough to be kept because it exceeds the minimum length threshold easily.</p>
<p>Second paragraph also long enough to survive the filter with plenty of words to say.</p>
<a href="https://one.com/a">1</a><a href="https://one.com/b">2</a><a href="https://two.com/c">3</a>
<a href="https://sample.com/self">self</a>
<img src="/hero.jpg" alt="hero image"><img src="https://cdn.sample.com/a.png" alt="chart"><img src="data:ignored">
</body></html>`;

const READER_MD = `Title: Sample Site
URL Source: https://sample.com/page

Markdown Content:
# Sample Site

Intro paragraph that is long enough to be kept as the lead text of the page digest.

## Section One

Section paragraph with enough words to survive the minimum length filter comfortably.

[One](https://one.com/a) [Two](https://two.com/b)
![hero](https://cdn.sample.com/hero.png)`;

describe("extractHtmlDigest", () => {
  it("extracts meta, outline, paragraphs, link domains and images", () => {
    const d = extractHtmlDigest(PAGE_HTML, "https://sample.com/page");
    expect(d.title).toBe("Sample Site");
    expect(d.description).toBe("A sample page about crypto things");
    expect(d.siteName).toBe("Sample");
    expect(d.outline).toEqual(["Sample heading", "Sub heading"]); // h4 excluded
    expect(d.paragraphs).toHaveLength(2);
    expect(d.linkDomains[0]).toBe("one.com (2)");
    expect(d.linkDomains.some((l) => l.startsWith("sample.com"))).toBe(false);
    // og:image first, then resolved relative src; data: URIs never appear
    expect(d.images).toEqual([
      { alt: "og:image", url: "https://cdn.sample.com/og.png" },
      { alt: "hero image", url: "https://sample.com/hero.jpg" },
      { alt: "chart", url: "https://cdn.sample.com/a.png" },
    ]);
    expect(d.imageCount).toBe(3);
    expect(d.words).toBeGreaterThan(20);
  });
});

describe("digestMarkdown", () => {
  it("builds the same digest shape from reader markdown", () => {
    const d = digestMarkdown(READER_MD, "https://sample.com/page");
    expect(d.title).toBe("Sample Site");
    expect(d.outline).toEqual(["Section One"]);
    expect(d.paragraphs[0]).toContain("Intro paragraph");
    expect(d.linkDomains.some((l) => l.startsWith("one.com"))).toBe(true);
    expect(d.images).toEqual([{ alt: "hero", url: "https://cdn.sample.com/hero.png" }]);
  });
});

describe("assertPublicUrl", () => {
  it("accepts ordinary public urls", () => {
    expect(assertPublicUrl("https://example.com/a?b=1").hostname).toBe("example.com");
    expect(assertPublicUrl(" http://example.com ").hostname).toBe("example.com");
  });

  it("rejects private, local, ip-literal and odd-scheme targets", () => {
    for (const bad of [
      "http://localhost/x",
      "http://127.0.0.1/x",
      "http://192.168.1.4/x",
      "http://10.0.0.2/x",
      "http://[::1]/x",
      "http://printer.local/x",
      "http://example.com:8080/x",
      "ftp://example.com/x",
      "javascript:alert(1)",
    ]) {
      expect(() => assertPublicUrl(bad)).toThrow();
    }
  });
});

describe("webRead chain", () => {
  it("returns the proxy digest on the happy path", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      okJson({ ...extractHtmlDigest(PAGE_HTML, "https://sample.com/page"), source: "proxy-html" }) as Response,
    );
    const out = await webRead("https://sample.com/page");
    expect(out.source).toBe("proxy-html");
    expect(out.title).toBe("Sample Site");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/web-read?url=");
  });

  it("falls back to the reader with the stored key when the proxy is down", async () => {
    const backing = new Map<string, string>([["inko.web-keys", JSON.stringify({ jina: "jk" })]]);
    vi.stubGlobal("window", {
      localStorage: { getItem: (k: string) => backing.get(k) ?? null, setItem: () => {} },
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockRejectedValueOnce(new Error("no server"))
      .mockResolvedValueOnce(okText(READER_MD) as Response);
    const out = await webRead("https://sample.com/page");
    expect(out.source).toBe("jina-reader");
    expect(out.title).toBe("Sample Site");
    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toContain("https://r.jina.ai/https://sample.com/page");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer jk");
  });

  it("returns an honest note instead of nothing when both transports fail", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    const out = await webRead("https://sample.com/page");
    expect(out.paragraphs).toEqual([]);
    expect(out.note).toContain("instead of inventing content");
  });

  it("refuses invalid urls before any fetch", async () => {
    const out = await webRead("http://localhost/secret");
    expect(out.note).toContain("private addresses");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

describe("webReadProxy", () => {
  it("fetches the page and returns the server-side digest", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(PAGE_HTML, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    const res = await webReadProxy(
      new URL("http://localhost/api/web-read?url=https%3A%2F%2Fsample.com%2Fpage"),
      new Request("http://localhost/api/web-read"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string; source: string };
    expect(body.title).toBe("Sample Site");
    expect(body.source).toBe("proxy-html");
  });

  it("refuses private targets with 400 and never fetches", async () => {
    const res = await webReadProxy(
      new URL("http://localhost/api/web-read?url=http%3A%2F%2Flocalhost%2Fx"),
      new Request("http://localhost/api/web-read"),
    );
    expect(res.status).toBe(400);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("refuses non-html content types", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    const res = await webReadProxy(
      new URL("http://localhost/api/web-read?url=https%3A%2F%2Fsample.com%2Fapi"),
      new Request("http://localhost/api/web-read"),
    );
    expect(res.status).toBe(415);
  });

  it("follows redirects manually and blocks a private hop", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "http://192.168.0.5/x" } }),
    );
    const res = await webReadProxy(
      new URL("http://localhost/api/web-read?url=https%3A%2F%2Fsample.com%2Fpage"),
      new Request("http://localhost/api/web-read"),
    );
    expect(res.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
