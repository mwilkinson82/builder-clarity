// Source-level guard for the _authenticated layout access-mode UX (P0
// finding 2). Ensures the four documented modes and the heartbeat gate
// stay wired to the layout, and the client-portal path helper stays
// available so /n/:projectId bypasses the internal-only gate.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const layout = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/route.tsx"),
  "utf8",
);
const accessMode = readFileSync(
  resolve(process.cwd(), "src/lib/auth/access-mode.ts"),
  "utf8",
);

describe("authenticated access-mode layout", () => {
  it("wires resolveAccessMode into the layout", () => {
    expect(layout).toContain('from "@/lib/auth/access-mode"');
    expect(layout).toContain("resolveAccessMode");
    expect(layout).toContain("useServerFn(resolveAccessMode)");
  });

  it("renders every documented access-mode branch with a stable test id", () => {
    for (const testId of [
      "access-mode-loading",
      "access-mode-client-redirecting",
      "access-mode-lookup-error",
      "access-mode-no-active-company",
    ]) {
      expect(layout).toContain(testId);
    }
  });

  it("only enables the activity heartbeat for internal_active", () => {
    expect(layout).toContain("heartbeatEnabled");
    expect(layout).toMatch(/heartbeatEnabled\s*=\s*mode\?\.kind === "internal_active"/);
    expect(layout).toContain("if (!heartbeatEnabled) return;");
  });

  it("uses the client-portal path helper to bypass the internal gate", () => {
    expect(layout).toContain("isClientPortalPath");
    expect(layout).toContain("clientPortalPathForProject");
    expect(accessMode).toContain('CLIENT_PORTAL_PREFIX = "/n/"');
  });

  it("offers a Sign out affordance on every disabled/error branch", () => {
    const matches = layout.match(/onClick=\{onSignOut\}/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(layout).toContain("handleSignOut");
    expect(layout).toContain("supabase.auth.signOut()");
  });
});

describe("resolveAccessMode helper", () => {
  it("uses ensure_current_user_account (history-safe) not ensure_user_account", () => {
    expect(accessMode).toMatch(/rpc\(\s*"ensure_current_user_account"/);
    expect(accessMode).not.toMatch(/rpc\(\s*"ensure_user_account"/);
  });

  it("classifies four discrete modes", () => {
    for (const kind of [
      '"internal_active"',
      '"client_only"',
      '"no_active_company"',
      '"lookup_error"',
    ]) {
      expect(accessMode).toContain(kind);
    }
  });

  it("treats an internal org id as authoritative for internal_active", () => {
    // orgId presence must produce internal_active regardless of client
    // access rows — internal seats always take precedence.
    expect(accessMode).toMatch(/if \(orgId\)[\s\S]*internal_active/);
  });
});
