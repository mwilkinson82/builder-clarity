// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { execFileSync } from "node:child_process";
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

const GITHUB_MAIN_REF = "https://github.com/mwilkinson82/builder-clarity.git";

function resolveCommitSha() {
  const candidates = [
    process.env.VITE_COMMIT_SHA,
    process.env.LOVABLE_COMMIT_SHA,
    process.env.GITHUB_SHA,
    process.env.CF_PAGES_COMMIT_SHA,
  ];
  const suppliedSha = candidates.find((value) => /^[0-9a-f]{7,40}$/i.test(value?.trim() ?? ""));
  if (suppliedSha) return suppliedSha.trim();

  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    try {
      const remoteRef = execFileSync("git", ["ls-remote", GITHUB_MAIN_REF, "refs/heads/main"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 10_000,
      }).trim();
      const remoteSha = remoteRef.split(/\s+/, 1)[0];
      return /^[0-9a-f]{40}$/i.test(remoteSha) ? remoteSha : "unknown";
    } catch {
      return "unknown";
    }
  }
}

const commitSha = resolveCommitSha();

export default defineConfig({
  vite: {
    define: {
      "import.meta.env.VITE_COMMIT_SHA": JSON.stringify(commitSha),
    },
    resolve: {
      alias: {
        "entities/lib/decode.js": path.resolve(
          process.cwd(),
          "node_modules/entities/lib/decode.js",
        ),
        "entities/lib/encode.js": path.resolve(
          process.cwd(),
          "node_modules/entities/lib/encode.js",
        ),
        entities: path.resolve(process.cwd(), "node_modules/entities"),
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
