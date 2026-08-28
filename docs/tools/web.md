# web tools

Live web access through a keyless provider chain, off by default and enabled
per session with the Web toggle in the assistant.

## web.search

`web.search({ query, limit? })` → `{ query, source, results[{ title, url, snippet }] }`

- Live search for news and external facts the journal cannot answer.
- Multi-provider chain. First non-empty transport wins:
  1. **DuckDuckGo lite** via the same-origin `/api/web-search` worker proxy.
  2. **Jina Search** (`s.jina.ai`) directly from the browser — CORS-enabled,
     works from static hosts. Requires a free Jina API key: the keyless
     endpoint answers 401 since Jina ended anonymous access.
  3. **Tavily** via the worker proxy — only when a Tavily key is stored.
  4. **Jina via the worker proxy** — the same Jina key, fetched server-side;
     reaches providers the browser itself is blocked from.
  5. **DuckDuckGo Instant Answer** — CORS-enabled fallback with an abstract
     and related links instead of live SERP rows.
  6. **Wikipedia full-text search** — last resort, CORS-open via `origin=*`;
     answers natural-language phrases, not just title prefixes.
- Every fallthrough records a one-line status; when the whole chain fails the
  note names each transport's outcome (for example `ddg-proxy 502; jina 401;
  tavily no key`) instead of a generic "blocked".
- Rows are deduplicated by URL and, when the always-warm MiniLM encoder is
  available, reordered by local cosine relevance (free, local, no round trip).
- Bounded by design: at most 5 rows (8 on explicit limit), snippets trimmed.

## web.read

`web.read({ url })` → `{ url, title, description, outline[], paragraphs[],
linkDomains[], images[], imageCount, words, source }`

- Fetch one web page and extract a bounded structural digest the model can
  reason over: site identity, heading outline, lead paragraphs, outbound link
  domains, and image inventory.
- Two transports: the same-origin `/api/web-read` proxy (server-side
  extraction with SSRF guard — blocks private/local/IP-literal targets,
  redirects through re-guarded fetch) then `r.jina.ai` directly from the
  browser (CORS-enabled; keyless still works here, unlike `s.jina.ai`).
- The full page never enters the context; only the digest does.
- Excluded from the first-hop semantic menu (the model cannot guess a URL).
  Available through the follow-up 2-hop chain, `/tool` command, and the
  `research.web` skill.

## 2-hop research chain

When the Web toggle is on and the agent runs `web.search`, a single follow-up
hop restricted to `web.read` is offered so the model can dig into one result
from the search results already in its observations. One extra hop per turn,
web group only, never a third hop.

## research.web skill

`/research` aliased skill: `web.search` → `web.read` on top 2 results →
model synthesis with citations (title + url). Fully grounded — the model has
both search snippets and page content in its observations.

## Vision (multimodal)

- **User-attached images**: the existing file picker now works end-to-end
  with both local models (the 450M VL model receives wllama-format
  `{ type: "image", data: ArrayBuffer }` content parts when `vision: true`)
  and cloud providers (OpenAI-format `image_url` content parts in the last
  user message).
- **Auto-image collection**: `web.read` returns the image inventory of a
  page. Images can be proxied through `/api/web-image` (same-origin, SSRF
  guarded, COEP-compatible) and downscaled for vision model synthesis.

## Provider keys

Optional API keys stored in `localStorage` under `inko.web-keys`. Search
stays keyless by default (DuckDuckGo lite proxy, Instant Answer, Wikipedia);
a Jina key enables its transport (keyless calls are refused with 401) and a
Tavily key adds the most reliable one. Set both in the model panel under
**Web search keys**. The equivalent console one-liner:

```js
setWebKeys({ jina: "your-free-key", tavily: "your-tavily-key" });
```
