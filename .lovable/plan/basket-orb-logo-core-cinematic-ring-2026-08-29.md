# Basket Orb: logo core + cinematic ring

Replace the wireframe sphere at the centre of the dashboard basket visual with a real 3D version of the Proof of Thesis mark, and upgrade the surrounding ring so it reads as a precision instrument rather than flat torus slices. Stays on three.js/WebGL (already installed, lazily imported), no new dependencies, no data or logic changes.

## The logo core

Build the mark procedurally from the same geometry as `Mark.tsx` (clipped-corner square frame, inner circle, vertical bar) using `THREE.Shape` + holes + `ExtrudeGeometry` with a small bevel. Result is a solid, chamfered emblem that catches light on its edges, slowly counter-rotating inside the ring, instead of the current icosahedron wireframe. Falls back to the existing CSS donut when WebGL is unavailable.

## The ring

- Slice arcs get proper bevelled cross-sections and consistent gaps, sitting on a shared plane instead of pushing back by weight.
- A hairline guide ring behind the slices for structure, plus faint tick marks at slice boundaries.
- Weight is expressed by arc thickness and material brightness, not opacity mud; drop the `i % 3 === 2` wireframe alternation which currently looks accidental.

## Cinematic but fast

- Swap `MeshBasicMaterial` for `MeshStandardMaterial` lit by three cheap lights (key, rim, fill) so edges and bevels read; no environment maps, no HDR fetch, no post-processing.
- Slow parallax: the group eases toward pointer position (desktop only) on top of the constant rotation; a short intro spin-and-settle on first paint.
- Budget stays where it is: one draw call per slice plus the emblem, low segment counts on mobile, capped pixel ratio, `IntersectionObserver` + `visibilitychange` pausing, and `prefers-reduced-motion` renders a single static framed pose.

## Technical notes

- Single file changed: `src/components/pot/BasketOrb.tsx`.
- Emblem shape defined once as a module-level path builder so geometry is created only when the scene mounts; disposed with the rest on cleanup.
- Colours keep reading `--ink` from computed styles, so light/dark theming continues to work.
