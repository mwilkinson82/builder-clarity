// Vitest config for browser-contract component tests (AITAKEOFF4 Task 0).
// The plan-room viewer is vite-coupled (?url imports, import.meta.env), so
// these tests run through the vite pipeline instead of the plain-node smoke
// harness the other suites use. Scope stays narrow on purpose: only
// scripts/**/*.test.ts and scripts/**/*.test.tsx are picked up.

import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    // Codex worktrees reuse the installed dependency tree through a symlink.
    // Allow Vite to load that real path without weakening the app dev server.
    fs: {
      allow: [
        import.meta.dirname,
        fs.realpathSync(path.resolve(import.meta.dirname, "node_modules")),
      ],
    },
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "happy-dom",
    include: ["scripts/**/*.test.{ts,tsx}"],
    // The lazy supabase client needs env values if a code path ever touches
    // it; these dummies keep module imports harmless in tests.
    env: {
      VITE_SUPABASE_URL: "http://localhost:54321",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    },
  },
});
