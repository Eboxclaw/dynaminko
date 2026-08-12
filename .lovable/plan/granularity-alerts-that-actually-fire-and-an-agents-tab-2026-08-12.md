# Granularity, alerts that actually fire, and an Agents tab

Five pieces of work. Nothing here talks to the user yet — the assistant agent is only
scaffolded, wiring downloads and note-editing comes next.

## 1. Theses & Journal — deeper sub-menus

Today: four flat tabs (Inbox, Entries, Theses, Ghosts). Add a second row of
filters under the active tab, all driven by URL search params so views are linkable.

- Inbox: All / Unlinked / Selected · sort by newest, largest, oldest-unanswered ·
  filter by basket and by wallet.
- Entries: All / Linked to a thesis / Standalone · filter by alignment
  (aligned, partial, deviated, no thesis), sentiment and basket · sort by date or conviction.
- Theses: Open / Played out / Invalidated · filter by horizon and conviction ·
  a staleness marker for theses untouched for 30+ days.
- Ghosts: Never executed / Went stale (open 60+ days) / Invalidated without a trade.

Each sub-tab shows a live count. Empty states say what is missing rather than "no data".

## 2. POT Index — deeper breakdown

Keep the five axes but make each one openable.

- Click an axis to expand: the formula in plain words, the exact numerator and
  denominator, and the list of entries/signals that pushed it up or down.
- Per-axis trend: the same axis computed over the last 30 and 90 days versus all time.
- Sub-scores under the existing axes: Coverage splits into answered-within-24h vs later;
  Alignment splits by basket; Discipline splits by sentiment type; Execution splits into
  executed / ghost / invalidated; Steadiness adds the health and finances fields
  already captured by the reconcile wizard but never scored.
- A composite history sparkline, recomputed from entry timestamps (no stored history needed).
- Every axis still returns "—" with nothing written; no invented numbers.

## 3. Alerts — make them real, with permission flow

Current state: alerts are stored but nothing ever evaluates or notifies them.

- Add an alert engine that runs while the app is open: it re-checks price alerts on each
  price refresh and thesis-review alerts on a timer, marks `lastFiredAt`, and shows an
  in-app toast plus a "fired" list on the Alerts page.
- Notifications: browser `Notification` permission must be requested from a user gesture.
  Add an "Enable notifications" button on the Alerts page and in Settings showing
  permission state (not asked / granted / blocked, with instructions for blocked).
- Push to mobile: real background push (arriving with the app closed) needs a service
  worker plus a push server with VAPID keys, which this app deliberately does not have.
  Honest scope: installed-PWA notifications while the app is running or in the background
  tab, delivered through the service worker's `showNotification`. The Alerts page states
  this plainly instead of implying background delivery.
- Alert types get first-class editors: price above/below, on-chain event on a watched
  wallet (any inbox signal, or one matching a symbol), and thesis review every N days.

## 4. Settings assistant list — correct models

Replace the Smol/Qwen entries with the LFM 2.5 family, Q4_K_M:

| Model | Role | Default |
| --- | --- | --- |
| LFM 2.5 230M encoder | embeddings, tagging, retrieval | yes (automation) |
| LFM 2.5 450M VL | fast extraction and vision | yes (assistant) |
| LFM 2.5 1.2B instruct | better reasoning over trades | optional |
| LFM 2.5 2.6B VL | strongest, desktop only | optional |

Sizes shown come from the actual GGUF repos, not guesses; anything we cannot confirm
is left blank rather than invented.

## 5. New Agents tab (moves out of Settings)

New route `/agents` in the nav; the Assistant block is removed from Settings.
Sub-menus:

- **Agents** — two groups. *Automation group*: fixed-job agents (extractor, tagger,
  reconciler, alert watcher) that never chat, shown with their trigger, tools and
  last run. Not user-editable beyond on/off. *Assistant*: the single user-managed agent —
  pick model, provider (local WASM or cloud), skills and tools.
- **Models / Providers** — local models with download, cache size, load/unload and
  progress; a cloud provider slot marked as not connected.
- **Skills** — named capabilities (tidy note, reason about a trade, review a thesis,
  tag basket) toggleable per agent.
- **Tools** — what an agent may touch: read portfolio, read signals, write draft entry,
  propose thesis link, create alert. Each is read/write labelled and off by default for writes.
- **Log** — an append-only local event log: agent, event, tool call, input summary,
  duration, result or error. Filter by agent and level, clear button. This is the surface
  for verifying flows before wiring anything live.

## 6. Hide wallet connect

Header and Settings drop the "Connect wallet" button; only watch-an-address stays.
The injected-wallet code remains in place, unused, for when trading lands.

## Technical notes

- New: `src/routes/agents.tsx`, `src/lib/agents/{registry,log,tools}.ts`,
  `src/lib/alerts/engine.ts`, `src/lib/notify.ts`.
- Edited: `src/lib/ai.ts` (model list), `src/lib/pot-index.ts` (sub-scores, windows),
  `src/routes/{journal,pot,alerts,settings}.tsx`, `src/components/pot/{Shell,WalletChip}.tsx`,
  `src/lib/store.ts` (agent settings, log, alert fired state).
- Sub-tabs use TanStack Router search params so state survives reload and deep links.
- Log and agent config live in the same local document as everything else.
