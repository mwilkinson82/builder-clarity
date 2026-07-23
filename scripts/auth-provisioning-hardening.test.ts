import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildMagicLinkConfirmationUrl,
  emailOtpTypeFromUrl,
  requiresExplicitMagicLinkConfirmation,
  safeAuthNext,
} from "../src/lib/auth/magic-link-url";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260722233000_account_provisioning_privilege_containment.sql",
  ),
  "utf8",
);
const magicLinkApi = readFileSync(
  resolve(process.cwd(), "src/routes/api/auth/magic-link.ts"),
  "utf8",
);
const supabaseClient = readFileSync(
  resolve(process.cwd(), "src/integrations/supabase/client.ts"),
  "utf8",
);

describe("account provisioning containment", () => {
  it("removes browser execution of the parameterized security-definer function", () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.ensure_user_account\(uuid, text, text\) FROM anon;/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.ensure_user_account\(uuid, text, text\) FROM authenticated;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.ensure_user_account\(uuid, text, text\) TO service_role;/,
    );
    expect(migration).toContain("rolname = 'sandbox_exec'");
    expect(migration).toContain("has_function_privilege(");
  });

  it("copies alias access from a different user without manufacturing Owner", () => {
    expect(migration).toContain("WHERE m.user_id <> p_user_id");
    expect(migration).toMatch(
      /SELECT DISTINCT ON \(m\.organization_id\)[\s\S]*?m\.role,[\s\S]*?m\.capabilities/,
    );
    expect(migration).not.toMatch(/m\.organization_id,[\s\S]{0,120}'owner'::public\.account_role/);
  });

  it("repairs only the proven accepted-invite Owner corruption signature", () => {
    expect(migration).toContain("AND i.accepted_by = m.user_id");
    expect(migration).toContain("WHERE m.role = 'owner'");
    expect(migration).toContain("AND i.role <> 'owner'");
    expect(migration).toContain("AND o.created_by IS DISTINCT FROM m.user_id");
    expect(migration).toContain("m.created_at = i.accepted_at");
    expect(migration).toContain("2026-07-22 00:00:00+00");
    expect(migration).toContain("2026-07-23 00:00:00+00");
  });

  it("preserves an active Owner or Admin when a duplicate lower-role invite is encountered", () => {
    expect(migration).toMatch(
      /WHEN public\.organization_memberships\.status = 'active'[\s\S]*?role IN \('owner', 'admin'\)/,
    );
  });

  it("repairs stale profile defaults while retaining a valid active default", () => {
    expect(migration).toContain("m.organization_id = p.default_organization_id");
    expect(migration).toMatch(
      /WHEN v_invited_org_id IS NOT NULL THEN v_invited_org_id[\s\S]*?ELSE v_org_id/,
    );
  });

  it("does not mutate commercial entitlement while resolving an account", () => {
    expect(migration).not.toContain("SET contractor_circle_grant");
    expect(migration).not.toContain("billing_status = 'contractor_circle_grant'");
    expect(migration).not.toContain("seat_limit = 10");
  });
});

describe("MagicLink hardening", () => {
  it("builds an app-owned, scanner-safe confirmation URL from the token hash", () => {
    const url = new URL(
      buildMagicLinkConfirmationUrl(
        "https://overwatch.alpcontractorcircle.com/auth/callback?next=%2Fteam",
        "hashed-token",
      ),
    );

    expect(url.origin).toBe("https://overwatch.alpcontractorcircle.com");
    expect(url.pathname).toBe("/auth/callback");
    expect(url.searchParams.get("next")).toBe("/team");
    expect(url.searchParams.get("token_hash")).toBe("hashed-token");
    expect(url.searchParams.get("type")).toBe("email");
    expect(url.searchParams.get("confirm")).toBe("1");
    expect(requiresExplicitMagicLinkConfirmation(url)).toBe(true);
  });

  it("rejects open redirects and defaults unknown token types safely", () => {
    expect(safeAuthNext(new URL("https://app.test/auth/callback?next=https://evil.test"))).toBe(
      "/",
    );
    expect(safeAuthNext(new URL("https://app.test/auth/callback?next=//evil.test"))).toBe("/");
    expect(safeAuthNext(new URL("https://app.test/auth/callback?next=%2Fteam"))).toBe("/team");
    expect(emailOtpTypeFromUrl("not-a-type")).toBe("email");
  });

  it("uses a hashed token instead of mailing Supabase's consumable action link", () => {
    expect(magicLinkApi).toMatch(/data\??\.properties\??\.hashed_token/);
    expect(magicLinkApi).not.toMatch(/data\??\.properties\??\.action_link/);
    expect(supabaseClient).toContain("detectSessionInUrl: false");
  });
});
