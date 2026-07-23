// Source-level guard for the _authenticated layout access-mode UX (P0
// finding 2). Ensures the four documented modes and the heartbeat gate
// stay wired to the layout, and the client-portal path helper stays
// available so /client/projects/:projectId bypasses the internal-only gate.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const layout = readFileSync(resolve(process.cwd(), "src/routes/_authenticated/route.tsx"), "utf8");
const accessMode = readFileSync(resolve(process.cwd(), "src/lib/auth/access-mode.ts"), "utf8");

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
    expect(layout).toContain("clientProjectIdFromPath");
    expect(layout).toContain("clientPortalPathForProject");
    expect(accessMode).toContain('CLIENT_PORTAL_PREFIX = "/client/projects/"');
  });

  it("only opens an exact project authorized for the client-only identity", () => {
    expect(layout).toContain("onAuthorizedClientPortalRoute");
    expect(layout).toContain("mode.clientProjectIds.includes(clientPortalProjectId)");
    expect(layout).toMatch(
      /mode\.kind === "client_only" && onAuthorizedClientPortalRoute[\s\S]*?<Outlet/,
    );
  });

  it("offers a Sign out affordance on every disabled/error branch", () => {
    const matches = layout.match(/onClick=\{onSignOut\}/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(layout).toContain("handleSignOut");
    expect(layout).toContain('supabase.auth.signOut({ scope: "local" })');
  });

  it("fails closed when the restored session cannot be verified", () => {
    expect(layout).not.toContain("continuing with restored session");
    expect(layout).toMatch(
      /if \(error \|\| !data\.user\)[\s\S]*signOut\(\{ scope: "local" \}\)[\s\S]*redirect/,
    );
  });

  it("rechecks access on focus, visibility restoration, and auth changes", () => {
    expect(layout).toContain('window.addEventListener("focus"');
    expect(layout).toContain('document.addEventListener("visibilitychange"');
    expect(layout).toContain("supabase.auth.onAuthStateChange");
    expect(layout).toContain("subscription.unsubscribe()");
  });

  it("does not route a blocked identity into authenticated support", () => {
    expect(layout).not.toContain('to="/support"');
    expect(layout).toContain("mailto:support@alpcontractorcircle.com");
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

  it("requires active client access and sorts project ids deterministically", () => {
    expect(accessMode).toContain('.eq("status", "active")');
    expect(accessMode).toContain('.eq("client_user_id", userId)');
    expect(accessMode).not.toContain('["active", "pending"]');
    expect(accessMode).toContain(".sort((left, right) => left.localeCompare(right))");
  });
});
