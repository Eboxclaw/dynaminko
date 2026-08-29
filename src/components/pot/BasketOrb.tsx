import { useEffect, useMemo, useRef, useState } from "react";

export type OrbSlice = { label: string; share: number };

/* ── emblem geometry ──────────────────────────────────────────────────────
   The Proof of Thesis mark, rebuilt as extrudable 2D paths. Coordinates come
   straight from Mark.tsx's 32-unit viewBox, recentred on the origin and
   Y-flipped so the shape stands upright in three.js space. */

const V = 32;
const C = (n: number) => n - V / 2; // centre on origin
const Y = (n: number) => V / 2 - n; // svg y grows down, three grows up

const CHAMFER = 7; // corner cut, matches the svg's diagonal ticks
const BAND = 1.5; // stroke weight of the frame

/** Outer silhouette: square with the top-left and bottom-right corners cut. */
function framePoints(inset: number): Array<[number, number]> {
  const a = 1.5 + inset;
  const b = 30.5 - inset;
  const c = CHAMFER;
  return [
    [a + c, a],
    [b, a],
    [b, b - c],
    [b - c, b],
    [a, b],
    [a, a + c],
  ];
}

function toShape(
  THREE: typeof import("three"),
  pts: Array<[number, number]>,
): import("three").Shape {
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => {
    const px = C(x);
    const py = Y(y);
    if (i === 0) s.moveTo(px, py);
    else s.lineTo(px, py);
  });
  s.closePath();
  return s;
}

/** Extruded, bevelled emblem: frame + ring + centre bar. */
function buildEmblem(THREE: typeof import("three"), material: import("three").Material) {
  const group = new THREE.Group();
  const extrude = { depth: 1.5, bevelEnabled: true, bevelSize: 0.22, bevelThickness: 0.22, bevelSegments: 2, curveSegments: 24 };
  const geos: import("three").BufferGeometry[] = [];

  // frame band
  const frame = toShape(THREE, framePoints(0));
  frame.holes.push(toShape(THREE, framePoints(BAND)));
  geos.push(new THREE.ExtrudeGeometry(frame, extrude));

  // circle band
  const ring = new THREE.Shape();
  ring.absarc(0, 0, 7, 0, Math.PI * 2, false);
  const inner = new THREE.Path();
  inner.absarc(0, 0, 7 - BAND, 0, Math.PI * 2, true);
  ring.holes.push(inner);
  geos.push(new THREE.ExtrudeGeometry(ring, extrude));

  // vertical bar
  const bar = new THREE.Shape();
  bar.moveTo(-BAND / 2, Y(9));
  bar.lineTo(BAND / 2, Y(9));
  bar.lineTo(BAND / 2, Y(23));
  bar.lineTo(-BAND / 2, Y(23));
  bar.closePath();
  geos.push(new THREE.ExtrudeGeometry(bar, extrude));

  geos.forEach((g) => {
    g.center();
    group.add(new THREE.Mesh(g, material));
  });

  // 32-unit artwork down to roughly 2.1 units across
  group.scale.setScalar(0.062);
  return { group, geos };
}

/**
 * Portfolio basket ring. GPU-accelerated via three.js/WebGL, lazily imported so
 * it never enters the SSR graph. Mobile-first: capped pixel ratio, reduced
 * geometry detail on small viewports, and rendering pauses whenever the canvas
 * is offscreen or the tab is hidden. Falls back to a CSS donut when WebGL or
 * three.js is unavailable, and honours prefers-reduced-motion.
 */
export function BasketOrb({ slices }: { slices: OrbSlice[] }) {
  const host = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);

  // Stable signature so re-renders with equal data never rebuild the scene.
  const signature = useMemo(
    () => slices.map((s) => `${s.label}:${s.share.toFixed(4)}`).join("|"),
    [slices],
  );
  const data = useMemo(() => {
    const list = slices.length > 0 ? slices.slice(0, 8) : [{ label: "empty", share: 1 }];
    const total = list.reduce((s, d) => s + d.share, 0) || 1;
    return list.map((d) => ({ ...d, share: d.share / total }));
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      const el = host.current;
      if (!el) return;
      let THREE: typeof import("three");
      try {
        THREE = await import("three");
      } catch {
        setFallback(true);
        return;
      }
      if (disposed || !host.current) return;

      const small = window.matchMedia("(max-width: 640px)").matches;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const fine = window.matchMedia("(pointer: fine)").matches;

      let renderer: import("three").WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({
          antialias: !small,
          alpha: true,
          powerPreference: "low-power",
        });
      } catch {
        setFallback(true);
        return;
      }

      const size = () => ({
        w: el.clientWidth || 320,
        h: el.clientHeight || (small ? 190 : 240),
      });
      const { w, h } = size();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, small ? 1.75 : 2));
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.display = "block";
      el.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(34, w / h, 0.1, 100);
      camera.position.set(0, 2.7, 7.8);
      camera.lookAt(0, 0, 0);

      const css = getComputedStyle(document.documentElement);
      const ink = new THREE.Color(css.getPropertyValue("--ink").trim() || "#101012");
      const paper = new THREE.Color(css.getPropertyValue("--paper").trim() || "#f6f5f3");

      // Three cheap lights: key, rim, fill. No env map, no HDR fetch.
      const key = new THREE.DirectionalLight(0xffffff, 2.4);
      key.position.set(3.5, 5, 4);
      const rim = new THREE.DirectionalLight(0xffffff, 1.6);
      rim.position.set(-4, 1.5, -3);
      const fill = new THREE.HemisphereLight(0xffffff, 0x111111, 0.75);
      scene.add(key, rim, fill);

      const group = new THREE.Group();
      group.rotation.x = 0.34;
      scene.add(group);

      const meshes: import("three").Mesh[] = [];
      const materials: import("three").Material[] = [];
      const geometries: import("three").BufferGeometry[] = [];

      const track = <T extends import("three").Material>(m: T) => {
        materials.push(m);
        return m;
      };

      const radial = small ? 8 : 14;
      const tubular = small ? 56 : 120;
      const peak = Math.max(...data.map((d) => d.share));
      const GAP = 0.05; // radians of breathing room between slices
      const R = 2.05;

      // hairline guide ring behind the slices
      const guideGeo = new THREE.TorusGeometry(R, 0.012, 6, small ? 72 : 160);
      geometries.push(guideGeo);
      const guide = new THREE.Mesh(
        guideGeo,
        track(
          new THREE.MeshBasicMaterial({ color: ink, transparent: true, opacity: 0.18 }),
        ),
      );
      group.add(guide);

      let angle = -Math.PI / 2;
      data.forEach((d) => {
        const span = Math.max(d.share * Math.PI * 2 - GAP, 0.05);
        const weight = d.share / (peak || 1);
        const geo = new THREE.TorusGeometry(
          R,
          0.055 + weight * 0.155,
          radial,
          Math.max(8, Math.round(tubular * d.share) + 8),
          span,
        );
        geometries.push(geo);
        const mesh = new THREE.Mesh(
          geo,
          track(
            new THREE.MeshStandardMaterial({
              color: ink.clone().lerp(paper, 0.42 - 0.34 * weight),
              roughness: 0.34 - 0.12 * weight,
              metalness: 0.55,
            }),
          ),
        );
        mesh.rotation.z = angle;
        group.add(mesh);
        meshes.push(mesh);

        // boundary tick
        const tickGeo = new THREE.BoxGeometry(0.02, 0.3, 0.02);
        geometries.push(tickGeo);
        const tick = new THREE.Mesh(
          tickGeo,
          track(new THREE.MeshBasicMaterial({ color: ink, transparent: true, opacity: 0.28 })),
        );
        tick.position.set(Math.cos(angle) * (R + 0.3), Math.sin(angle) * (R + 0.3), 0);
        tick.rotation.z = angle - Math.PI / 2;
        group.add(tick);
        meshes.push(tick);

        angle += d.share * Math.PI * 2;
      });

      const emblemMat = track(
        new THREE.MeshStandardMaterial({
          color: ink,
          roughness: 0.22,
          metalness: 0.72,
        }),
      );
      const { group: emblem, geos } = buildEmblem(THREE, emblemMat);
      geometries.push(...geos);
      group.add(emblem);

      let raf = 0;
      let running = false;
      let visible = true;
      const start = performance.now();
      let px = 0;
      let py = 0;
      let tx = 0;
      let ty = 0;

      const render = () => renderer.render(scene, camera);
      const tick = (t: number) => {
        const e = (t - start) / 1000;
        // intro: quick spin that eases into the steady drift
        const intro = 1 - Math.exp(-e * 2.2);
        group.rotation.y = intro * 1.4 + e * 0.14;
        emblem.rotation.y = -e * 0.42;
        emblem.rotation.z = Math.sin(e * 0.5) * 0.06;
        emblem.scale.setScalar(0.062 * (0.86 + 0.14 * intro));
        px += (tx - px) * 0.06;
        py += (ty - py) * 0.06;
        group.rotation.x = 0.34 + py;
        group.position.x = px * 0.9;
        render();
        raf = requestAnimationFrame(tick);
      };
      const play = () => {
        if (running || reduce || !visible) return;
        running = true;
        raf = requestAnimationFrame(tick);
      };
      const pause = () => {
        running = false;
        cancelAnimationFrame(raf);
      };

      if (reduce) {
        group.rotation.y = 0.35;
        emblem.rotation.y = -0.4;
        render();
      } else {
        play();
      }

      const onPointer = (ev: PointerEvent) => {
        const r = el.getBoundingClientRect();
        tx = ((ev.clientX - r.left) / r.width - 0.5) * 0.5;
        ty = ((ev.clientY - r.top) / r.height - 0.5) * -0.22;
      };
      const onLeave = () => {
        tx = 0;
        ty = 0;
      };
      if (fine && !reduce) {
        el.addEventListener("pointermove", onPointer);
        el.addEventListener("pointerleave", onLeave);
      }

      const io = new IntersectionObserver(
        ([entry]) => {
          visible = entry?.isIntersecting ?? true;
          if (visible) play();
          else pause();
        },
        { threshold: 0.01 },
      );
      io.observe(el);

      const onVisibility = () => (document.hidden ? pause() : play());
      document.addEventListener("visibilitychange", onVisibility);

      const ro = new ResizeObserver(() => {
        const next = size();
        if (next.w === 0 || next.h === 0) return;
        renderer.setSize(next.w, next.h, false);
        camera.aspect = next.w / next.h;
        camera.updateProjectionMatrix();
        render();
      });
      ro.observe(el);

      cleanup = () => {
        pause();
        io.disconnect();
        ro.disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
        el.removeEventListener("pointermove", onPointer);
        el.removeEventListener("pointerleave", onLeave);
        geometries.forEach((g) => g.dispose());
        materials.forEach((m) => m.dispose());
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [data]);

  return (
    <div className="relative">
      <div
        ref={host}
        className="h-[190px] w-full touch-pan-y select-none sm:h-[240px]"
        aria-hidden="true"
      >
        {fallback && <CssDonut data={data} />}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {data.map((d) => (
          <li key={d.label} className="eyebrow flex items-center gap-1.5 text-[10px]">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink"
              style={{ opacity: 0.3 + 0.7 * d.share }}
            />
            {d.label}
            <span className="num text-ink-faint">{Math.round(d.share * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CssDonut({ data }: { data: OrbSlice[] }) {
  let acc = 0;
  const stops = data.map((d) => {
    const from = acc * 100;
    acc += d.share;
    return `color-mix(in oklab, var(--ink) ${Math.round(30 + d.share * 70)}%, transparent) ${from}% ${acc * 100}%`;
  });
  return (
    <div className="grid h-full w-full place-items-center">
      <div
        className="h-[150px] w-[150px] rounded-full"
        style={{
          background: `conic-gradient(${stops.join(",")})`,
          mask: "radial-gradient(circle, transparent 52%, #000 53%)",
          WebkitMask: "radial-gradient(circle, transparent 52%, #000 53%)",
        }}
      />
    </div>
  );
}
