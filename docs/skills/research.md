# skill: research.web

Purpose: search the web for a topic, read the top page, and synthesise the
findings with citations. The question is passed in the skill input.

Actions:
- research.web — web research for a topic

Tools:
- web.search, web.read

AI required: yes. The model synthesises what was found and cites each fact to
its source page title and url.

Flow:

```text
intent(question) → web.search(query) → [optional] web.read(topUrl)
                 → structured result → AI synthesis with citations
```

Output: a bounded answer. Every factual claim is tied to a source page
(title + url). If nothing was found, say so plainly instead of inventing
results.

Approval: none (read/compute only). Logging: skill invocation logged, no mutations.
