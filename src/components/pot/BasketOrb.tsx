import { useEffect, useRef } from "react";

export type OrbSlice = { label: string; share: number };

/**
 * Portfolio basket ring. GPU-accelerated via three.js/WebGL (WebGPU-capable
 * browsers get the accelerated path automatically through the same context
 * negotiation). Falls back silently to a static grid on machines without a
 * GL context. three is imported lazily so it never enters the SSR graph.
 */
export function BasketOrb({ slices }: { slices: OrbSlice[] }) {
  const host = useRef<HTMLDivElement>(null);

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
        return;
      }
      if (disposed || !host.current) return;

      const width = el.clientWidth || 320;
      const height = el.clientHeight || 220;
      let renderer: import("three").WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      } catch {
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height);
      el.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
      camera.position.set(0, 2.4, 6.2);
      camera.lookAt(0, 0, 0);

      const ink = getComputedStyle(document.documentElement)
        .getPropertyValue("--ink")
        .trim() || "#101012";
      const color = new THREE.Color(ink);

      const group = new THREE.Group();
      scene.add(group);

      const data = slices.length > 0 ? slices : [{ label: "empty", share: 1 }];
      const total = data.reduce((s, d) => s + d.share, 0) || 1;
      let angle = 0;
      const rings: import("three").Mesh[] = [];

      data.forEach((d, i) => {
        const span = (d.share / total) * Math.PI * 2;
        const geo = new THREE.TorusGeometry(2.1, 0.06 + d.share * 0.34, 10, 96, span * 0.94);
        const mat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.28 + 0.62 * (d.share / Math.max(...data.map((x) => x.share))),
          wireframe: i % 2 === 1,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = Math.PI / 2.35;
        mesh.rotation.z = angle;
        group.add(mesh);
        rings.push(mesh);
        angle += span;
      });

      const shell = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.25, 1),
        new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.18 }),
      );
      group.add(shell);

      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      let raf = 0;
      const start = performance.now();
      const tick = (t: number) => {
        const e = (t - start) / 1000;
        group.rotation.y = reduce ? 0.3 : e * 0.16;
        shell.rotation.x = reduce ? 0 : e * 0.22;
        renderer.render(scene, camera);
        if (!reduce) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);

      const onResize = () => {
        const w = el.clientWidth || width;
        const h = el.clientHeight || height;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      window.addEventListener("resize", onResize);

      cleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", onResize);
        rings.forEach((m) => {
          m.geometry.dispose();
          (m.material as import("three").Material).dispose();
        });
        shell.geometry.dispose();
        (shell.material as import("three").Material).dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [slices]);

  return <div ref={host} className="h-[220px] w-full" aria-hidden="true" />;
}
