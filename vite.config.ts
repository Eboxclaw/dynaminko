// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    server: {
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
    },
    build: {
      // Split the stable vendor groups into their own cacheable chunks: they
      // only re-download when the library version bumps, so an app build no
      // longer forces every visitor to re-transfer ~150KB of lucide +
      // tanstack + react. The service worker caches these by hashed name,
      // making repeat and offline loads instant.
      rollupOptions: {
        output: {
          // Split stable vendor packages into their own cacheable chunks: they
          // only re-download when the library version bumps, so an app build
          // no longer forces every visitor to re-transfer ~150KB of lucide +
          // tanstack + react. The service worker caches these by hashed name,
          // making repeat and offline loads instant. Top-level package match
          // so @tanstack/react-* does not leak into vendor-react.
          manualChunks(id: string) {
            const nm = "node_modules/";
            const i = id.lastIndexOf(nm);
            if (i < 0) return;
            const pkg = id.slice(i + nm.length);
            if (pkg.startsWith("lucide-react")) return "vendor-icons";
            if (pkg.startsWith("@tanstack/")) return "vendor-tanstack";
            if (pkg.startsWith("sonner")) return "vendor-ui";
            if (pkg === "react" || pkg.startsWith("react/") || pkg === "react-dom" || pkg.startsWith("react-dom/"))
              return "vendor-react";
          },
        },
      },
    },
  },
});
