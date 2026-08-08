import { useEffect, useMemo, useRef, useState } from "react";

export type OrbSlice = { label: string; share: number };

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
      camera.position.set(0, 2.9, 7.6);
      camera.lookAt(0, 0, 0);

      const css = getComputedStyle(document.documentElement);
      const ink = new THREE.Color(css.getPropertyValue("--ink").trim() || "#101012");

      const group = new THREE.Group();
      group.rotation.x = 0.34;
      scene.add(group);

      const meshes: import("three").Mesh[] = [];
      const radial = small ? 8 : 14;
      const tubular = small ? 56 : 120;
      const peak = Math.max(...data.map((d) => d.share));
      const GAP = 0.045; // radians of breathing room between slices

      let angle = -Math.PI / 2;
      data.forEach((d, i) => {
        const span = Math.max(d.share * Math.PI * 2 - GAP, 0.05);
        const weight = d.share / (peak || 1);
        const geo = new THREE.TorusGeometry(
          2.05 + i * 0.035,
          0.06 + weight * 0.17,
          radial,
          Math.max(8, Math.round(tubular * d.share) + 8),
          span,
        );
        const mesh = new THREE.Mesh(
          geo,
          new THREE.MeshBasicMaterial({
            color: ink,
            transparent: true,
            opacity: 0.22 + 0.68 * weight,
            wireframe: i % 3 === 2,
          }),
        );
        mesh.rotation.z = angle;
        mesh.position.z = -weight * 0.18;
        group.add(mesh);
        meshes.push(mesh);
        angle += d.share * Math.PI * 2;
      });

      const core = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.12, small ? 0 : 1),
        new THREE.MeshBasicMaterial({ color: ink, wireframe: true, transparent: true, opacity: 0.16 }),
      );
      group.add(core);

      let raf = 0;
      let running = false;
      let visible = true;
      const start = performance.now();

      const render = () => renderer.render(scene, camera);
      const tick = (t: number) => {
        const e = (t - start) / 1000;
        group.rotation.y = e * 0.14;
        core.rotation.x = e * 0.2;
        core.rotation.y = -e * 0.16;
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
        render();
      } else {
        play();
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
        [...meshes, core].forEach((m) => {
          m.geometry.dispose();
          (m.material as import("three").Material).dispose();
        });
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
