# Cleanup pass: portfolio cards, assistant layout, text noise, basket sorting

## Roadmap state (from ROADMAP.md, verified against the code)

Still open from the previous phases:

1. `/goal` as a bounded mode of the existing command registry
2. Journal benchmark of MiniLM vs LFM 2.5 Encoder-230M before changing the default
3. Search providers (Tavily, DuckDuckGo) behind EXTERNAL access
4. Approval previews for every WRITE/EDIT/DELETE tool call
5. Skill results pre-filling the reconcile wizard
6. Venue reads beyond Hyperliquid, Nado and Velodrome (Inkyswap still pending, Tydro missing)
7. Charts group: indicator series over journal history
8. `/trade`, only after the journal loop is complete

None of those are touched in this pass. This pass is the UI/UX and correctness cleanup you listed.

## What gets done now

### 1. Portfolio venue cards

Today Velodrome, Nado and Hyperliquid all render as one flat list of rows inside a
generic panel, so 20 empty Nado subaccounts push the real positions off screen and an
unpriced LP shows a raw `USDâ®...` string.

- One card per venue instead of one list item per venue: venue icon, name, headline
  equity, status chip.
- Accounts with zero equity collapse behind a "18 empty subaccounts" line that expands
  on tap. Only funded accounts show by default.
- Positions grouped by kind (perps, spot/margin, LP) with a small heading per group,
  side and size on one line, value right aligned.
- LP positions get a range state chip (in range / out of range) and pool pair rendered
  from the token symbols rather than the raw label; symbols are sanitised so broken
  on-chain strings never leak into the UI.
- Unpriced values show a plain dash with a single footnote per card, not a sentence
  repeated per row.
- Empty and pending venues render as a compact one-line card, not a block.

### 2. Assistant tab

- Remove the pre-text digest block inside the empty chat (the wallet/entries/theses
  dump). The empty state becomes one short line.
- Panels move from a right-hand rail to a sheet that opens directly under the composer
  (above it on wide screens is not needed): full width, its own scroll container, capped
  height, safe-area padding on mobile. Tab strip stays sticky at the top of the sheet.
- Model list text trimmed: keep name, quant, state, size. Drop the capabilities/backend
  arrow line and the long recommendation sentence; the recommendation becomes a single
  chip on the recommended model.
- Status line under the composer trimmed to context size and provider.

### 3. Text noise pass

- Sweep every route and component for em dashes and en dashes in user-visible strings and
  replace with commas, periods or plain hyphens.
- Cut duplicated explanatory sentences in Model, Skills, Tools and Agents panels, keeping
  one short line each.
- Keep punctuation in code comments untouched.

### 4. Router encoder

Verify the download path end to end in the browser (MiniLM through Transformers.js, cache
detection, progress, ready state). If it loads, fix the status reporting so Download,
downloading %, on device and running are accurate. If it cannot load in this runtime, the
encoder block and its call sites are removed and routing stays on the keyword pass, which
already works.

### 5. Sorting assets into baskets

The `portfolio.categorize_token` command exists but there is no way to use it from the UI.

- Every holding row gets a basket control: tap the basket dot, pick from the six baskets,
  the choice is written to `settings.basketOverrides` and applies everywhere.
- The Unsorted group gets a visible "sort these" affordance so unclassified tokens are the
  first thing you can fix.
- Overrides show a small marker so a user choice is distinguishable from the registry
  guess, with a reset action.

## Technical notes

- `src/routes/portfolio.tsx`: `VenueSection` split into a `VenueCard` component with
  grouped positions and collapsed empty accounts.
- `src/lib/venues/types.ts` consumers only, no reader changes; symbol sanitising lives in
  the render layer.
- `src/routes/agents.tsx`: rail becomes a bottom sheet under `ChatConsole`, digest removed.
- `src/components/pot/ModelPanel.tsx`: trimmed copy, encoder block fixed or removed.
- `src/lib/commands/portfolio.ts` `classify`/`categorizeToken` reused unchanged by the new
  basket picker.
