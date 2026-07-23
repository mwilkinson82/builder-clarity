// Source-level guard for the _authenticated layout access-mode UX (P0
// finding 2). Ensures the four documented modes and the heartbeat gate
// stay wired to the layout, the client-portal path helper stays
// available so /client/projects/:projectId bypasses the internal gate, and
// the fail-closed session gate + mid-session re-resolution stay wired.

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
    expect(accessMode).toContain('CLIENT_PORTAL_PREFIX = "/client/projects/"');
  });

  it("offers a Sign out affordance on every disabled/error branch", () => {
    const matches = layout.match(/onClick=\{onSignOut\}/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(layout).toContain("handleSignOut");
    expect(layout).toContain("supabase.auth.signOut()");
  });

  it("fails closed when getUser() rejects — signs out and redirects, never renders Outlet from a stale session", () => {
    // The gate MUST NOT restore an Outlet from a getSession() fallback
    // when getUser() fails. A revoked/disabled user's cached session
    // would otherwise keep them inside internal chrome. This is the
    // P0 correction.
    expect(layout).toMatch(/beforeLoad:\s*async\s*\(\{\s*location\s*\}\)/);
    expect(layout).toContain("supabase.auth.getUser()");
    expect(layout).toMatch(/if \(error \|\| !data\.user\)/);
    // Fail-closed sign-out on gate rejection.
    const gateStart = layout.indexOf("beforeLoad:");
    const gateEnd = layout.indexOf("component: AuthenticatedLayout");
    expect(gateStart).toBeGreaterThan(-1);
    expect(gateEnd).toBeGreaterThan(gateStart);
    const gate = layout.slice(gateStart, gateEnd);
    expect(gate).toContain("await supabase.auth.signOut()");
    expect(gate).toContain('throw redirect');
    // The stale-session restore path must be removed.
    expect(gate).not.toMatch(/continuing with restored session/);
    expect(gate).not.toMatch(/return \{ user: sessionData\.session\.user \}/);
  });

  it("re-resolves access on tab-visibility return so a mid-session revocation contains", () => {
    // A seat disabled while the tab was hidden must lose access on
    // the next `visible` event, not survive until a hard refresh.
    expect(layout).toContain('addEventListener("visibilitychange"');
    expect(layout).toMatch(/setReloadKey\(\(k\) => k \+ 1\)/);
  });

  it("re-resolves access on Supabase auth-state changes and redirects on SIGNED_OUT", () => {
    expect(layout).toContain("supabase.auth.onAuthStateChange(");
    expect(layout).toMatch(/if \(event === "SIGNED_OUT"\)/);
    expect(layout).toContain('window.location.replace("/auth")');
    expect(layout).toMatch(/SIGNED_IN.*USER_UPDATED.*TOKEN_REFRESHED/);
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
    expect(accessMode).toMatch(/if \(orgId\)[\s\S]*internal_active/);
  });
});

describe("auth callback — fail-closed on establish failure", () => {
  const callback = readFileSync(
    resolve(process.cwd(), "src/routes/auth.callback.tsx"),
    "utf8",
  );

  it("does not rescue a bad/used link with a prior getSession() session", () => {
    // The prior implementation caught establishSessionFromUrl errors
    // and called supabase.auth.getSession() to see if a stale session
    // existed — if so, it navigated INTO internal chrome. That
    // silently authorized the wrong identity when a bad link was
    // opened in a browser with any prior session.
    //
    // The corrected shape MUST NOT read supabase.auth.getSession()
    // inside the catch block. (getSession is still used inside the
    // separate short-poll for a session that just arrived via
    // setSession/exchangeCodeForSession — the removed one was in the
    // failure path.)
    const catchIdx = callback.indexOf("} catch (err) {");
    const finallyIdx = callback.indexOf("} finally", catchIdx);
    expect(catchIdx).toBeGreaterThan(-1);
    expect(finallyIdx).toBeGreaterThan(catchIdx);
    const catchBlock = callback.slice(catchIdx, finallyIdx);
    expect(catchBlock).not.toContain("supabase.auth.getSession()");
    expect(catchBlock).not.toContain(".getSession()");
    // Fail closed to recovery (which signs out locally first).
    expect(catchBlock).toContain("failToRecovery(");
  });

  it("signs out locally on any callback failure before showing recovery", () => {
    // failToRecovery is the single failure path; it MUST invoke
    // supabase.auth.signOut() before revealing the recovery UI so
    // no stale session survives a bad-link click.
    const helperStart = callback.indexOf("const failToRecovery");
    expect(helperStart).toBeGreaterThan(-1);
    const helperEnd = callback.indexOf("}, [clearCaptured]);", helperStart);
    expect(helperEnd).toBeGreaterThan(helperStart);
    const helper = callback.slice(helperStart, helperEnd);
    expect(helper).toContain("supabase.auth.signOut()");
    expect(helper).toContain("setShowRecovery(true)");
  });

  it("captures client_access_id BEFORE URL scrub and finalizes it via finalize_client_access RPC", () => {
    expect(callback).toContain("readClientAccessId");
    expect(callback).toContain("clientAccessIdRef");
    expect(callback).toContain('rpc("finalize_client_access"');
    // Exact-project navigation after finalization; never a stale
    // default landing that could show the wrong project.
    expect(callback).toMatch(/`\/n\/\$\{res\.projectId\}`/);
  });
});
