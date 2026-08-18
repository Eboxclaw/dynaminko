# web tools

Live web access through DuckDuckGo, off by default and enabled per session
with the Web toggle in the assistant.

## web.search

`web.search({ query, limit? })` → `{ query, source, results[{ title, url, snippet }] }`

- Live search for news and external facts the journal cannot answer.
- Two transports, tried in order: the same-origin `/api/web-search` worker
  proxy (server-side fetch of DuckDuckGo lite, real result rows) and the
  CORS-enabled DuckDuckGo Instant Answer API (abstract + related links) as
  the fallback for static hosting without server routes.
- Bounded by design: at most 5 rows (8 on explicit limit), snippets trimmed,
  so the result enters TURN OBSERVATIONS like any other tool output.
- Read-only, no approval needed. The agent is only offered this tool on
  turns where the Web toggle is on; when it is off the turn state says so,
  and the assistant can tell the user to enable the toggle instead of
  claiming it has no web access.
