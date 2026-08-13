# UI cleanup pass: venue cards, text noise, sorting menu, logo

Frontend/presentation only. No agent or backend work in this pass.

## 1. Token symbols read wrong (USD₮0 shows as "USD0")

Confirmed cause: on-chain string returns are decoded byte-by-byte as Latin-1 in
`src/lib/venues/evm.ts` (`toStringValue`), so the multi-byte `₮` in `USD₮0` becomes
mojibake (`USDâ®0`), and the portfolio's `clean()` then strips the junk down to `USD0`.

Fix: decode with `TextDecoder("utf-8")`, then normalise display symbols so `USD₮0`
renders as `USDT0`. `clean()` keeps its role as a last-resort guard only.

## 2. Text noise moves behind a "?"

Repeated explanatory sentences ("A dash means this venue reported no price.",
"Amounts are on-chain; USD value not priced.", the model/skill blurbs) disappear from the
card body. Each card gets a small `?` control in its header; tapping it reveals those notes
in a compact popover. Same control reused across Portfolio, Agents panels and Journal, so
no page carries standing paragraphs of explanation.

## 3. Velodrome / LP card layout

Current LP row crams pair, two amounts, range state and value into one wrapping line.
New layout per LP position:

```text
USDT0 / INKO                       out of range
0.00 USDT0  +  6,139,523.47 INKO          value —
```

- Pair on its own line with the range chip right-aligned.
- Token amounts on a second, muted line, formatted with thousands separators and short
  decimals, value right-aligned.
- Tick spacing and token IDs stay in the expandable detail, not the summary.
- Zero-amount legs are dimmed rather than dropped, so the pair stays readable.
- Pending venues (Inkyswap) collapse to a single compact line.

## 4. Basket dropdown escaping the card

The basket picker is absolutely positioned inside a scrolling panel, so long lists grow
past the card and off screen. It becomes a viewport-aware popover: flips above the trigger
when there is no room below, caps its height with internal scrolling, and on small screens
renders as a bottom sheet instead of a floating menu.

## 5. Card arrangement and centering

- Portfolio grid becomes a centered, max-width column set: single column on mobile, two
  balanced columns from `lg`, with venue cards equal width and consistent internal padding.
- Venue sections no longer leave a tall empty column when one side has fewer cards; cards
  flow in a single balanced grid with the section eyebrow above.
- Row rhythm unified (same vertical padding, same label/value column widths) across
  holdings, accounts and positions.

## 6. Logo and favicon

`__root.tsx` points at `/pot-mark.svg`, which does not exist in `public/`, so the tab shows
an empty icon. The app's own `Mark` monogram is exported as `public/pot-mark.svg` and
`public/favicon.png`, referenced from the root head, and the leftover Dynaminko icons in
`public/manifest.webmanifest` are replaced with the POT mark. Stale `dynaminko*` files are
removed once nothing references them.

## 7. Tab-by-tab review (same pass, presentation only)

Each tab gets the same treatment: remove standing explanatory prose into the `?` popover,
align spacing and headers to the portfolio rhythm, verify at 375px and 1280px.

- Dashboard: header density, orb sizing on mobile.
- Portfolio: as above.
- Journal / Theses: row padding, badge alignment.
- Alerts: permission block trimmed to one line plus `?`.
- Agents: panel sheet spacing, model list line count.
- Settings: group headers aligned with the rest of the app.

## Technical notes

- `src/lib/venues/evm.ts`: UTF-8 `TextDecoder` in `toStringValue`.
- `src/routes/portfolio.tsx`: `VenueCard`, `PositionRow`, `BasketPicker` layout changes.
- New `src/components/pot/HelpDot.tsx` for the `?` popover, reused everywhere.
- New `public/pot-mark.svg` + `public/favicon.png`; head links and manifest updated.
