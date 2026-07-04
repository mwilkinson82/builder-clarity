// Vitest config for browser-contract component tests (AITAKEOFF4 Task 0).
// The plan-room viewer is vite-coupled (?url imports, import.meta.env), so
// these tests run through the vite pipeline instead of the plain-node smoke
// harness the other suites use. Scope stays narrow on purpose: only
// scripts/**/*.test.tsx is picked up.

import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "happy-dom",
    include: ["scripts/**/*.test.tsx"],
    // The lazy supabase client needs env values if a code path ever touches
    // it; these dummies keep module imports harmless in tests.
    env: {
      VITE_SUPABASE_URL: "http://localhost:54321",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    },
  },
});
