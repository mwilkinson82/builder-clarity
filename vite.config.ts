// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { createRequire } from "node:module";
import path from "node:path";
import { loadEnv } from "vite";

// Server routes under /lovable/email/* need non-VITE secrets at runtime.
// Keep them out of the client bundle by loading them into process.env only.
const serverEnv = loadEnv(
  process.env.NODE_ENV === "production" ? "production" : "development",
  process.cwd(),
  "",
);
Object.assign(process.env, serverEnv);

// htmlparser2 deep-imports entities v4's lib/{decode,encode}.js, but where
// that v4 copy LIVES depends on the package manager's hoisting: bun nests it
// under htmlparser2/node_modules while npm hoists it to the top level (where
// bun instead puts entities v7, which ships no lib/). Hardcoding either path
// breaks the other environment — Lovable's deploy broke one way, local
// builds the other. Resolve the copy htmlparser2 actually depends on and
// alias to that, wherever it is.
const requireFromConfig = createRequire(import.meta.url);
// Exports maps block resolving "<pkg>/package.json" directly; resolve the
// main entry and cut the path at its node_modules/<name> segment instead.
const packageDir = (resolvedEntry: string, name: string) => {
  const marker = `${path.sep}node_modules${path.sep}${name}${path.sep}`;
  const index = resolvedEntry.lastIndexOf(marker);
  if (index < 0) throw new Error(`Could not locate package directory for ${name}`);
  return resolvedEntry.slice(0, index + marker.length - 1);
};
const htmlparser2Dir = packageDir(requireFromConfig.resolve("htmlparser2"), "htmlparser2");
const requireFromHtmlparser2 = createRequire(path.join(htmlparser2Dir, "package.json"));
const entitiesV4Dir = packageDir(requireFromHtmlparser2.resolve("entities"), "entities");

export default defineConfig({
  vite: {
    resolve: {
      alias: {
        "entities/lib/decode.js": path.join(entitiesV4Dir, "lib/decode.js"),
        "entities/lib/encode.js": path.join(entitiesV4Dir, "lib/encode.js"),
      },
    },
    optimizeDeps: {
      ignoreOutdatedRequests: true,
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
