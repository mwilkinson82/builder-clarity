import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPaths = [
  "supabase/migrations/20260724000900_auth_p0_owner_seat_preflight.sql",
  "supabase/migrations/20260724001000_auth_p0_provisioning_authorization_lockdown.sql",
  "supabase/migrations/20260724001100_auth_p0_client_active_binding_lockdown.sql",
  "supabase/migrations/20260724001200_auth_p0_authority_mutation_guards.sql",
  "supabase/migrations/20260724001300_auth_magic_link_send_reservation.sql",
] as const;

const [ownerPreflight, core, client, authority, magicLink] = migrationPaths.map((path) =>
  readFileSync(resolve(process.cwd(), path), "utf8"),
);
const ownerPreflightHarness = readFileSync(
  resolve(process.cwd(), "supabase/verification/20260724000900_auth_p0_owner_seat_preflight.sql"),
  "utf8",
);
const harness = readFileSync(
  resolve(
    process.cwd(),
    "supabase/verification/20260724001000_auth_p0_transaction_rollback_harness.sql",
  ),
  "utf8",
);

function functionBlock(source: string, functionName: string) {
  const startMarker = `CREATE OR REPLACE FUNCTION public.${functionName}(`;
  const start = source.indexOf(startMarker);
  const end = source.indexOf("$fn$;", start);
  expect(start, `missing ${functionName}`).toBeGreaterThanOrEqual(0);
  expect(end, `unterminated ${functionName}`).toBeGreaterThan(start);
  return source.slice(start, end + "$fn$;".length);
}

describe("P0 provisioning and authorization forward migrations", () => {
  it("are ordered after the prior containment migration and remain reviewable", () => {
    for (const path of migrationPaths) {
      const version = Number(path.split("/").at(-1)?.split("_")[0]);
      expect(version).toBeGreaterThan(20260724000000);
      expect(readFileSync(resolve(process.cwd(), path), "utf8").split("\n").length).toBeLessThan(
        800,
      );
    }
  });

  it("fails before cutover when a non-Owner invite still holds active Owner authority", () => {
    for (const source of [ownerPreflight, ownerPreflightHarness]) {
      expect(source).toContain("public.organization_memberships");
      expect(source).toContain("public.organization_invites");
      expect(source).toContain("public.organizations");
      expect(source).toContain("accepted_invite.accepted_by = membership.user_id");
      expect(source).toContain("accepted_invite.role <> 'owner'");
      expect(source).toContain("accepted_invite.accepted_at = membership.created_at");
      expect(source).toContain("organization.created_by IS DISTINCT FROM membership.user_id");
      expect(source).not.toMatch(/\bUPDATE\s+public\.organization_memberships\b/i);
      expect(source).not.toMatch(/\bDELETE\s+FROM\s+public\.organization_memberships\b/i);
    }
    expect(ownerPreflightHarness).toContain("SET TRANSACTION READ ONLY");
    expect(ownerPreflightHarness).toContain("membership_id");
    expect(ownerPreflightHarness).toContain("accepted_invite_id");
    expect(ownerPreflightHarness).toContain("unmatched_review");
    expect(ownerPreflightHarness).toContain("provenance_classification");
    expect(ownerPreflightHarness).toContain("creator_owner_membership_id");
    expect(ownerPreflightHarness).toContain("20260722233000");
    expect(ownerPreflightHarness).toContain("20260722233042");
    expect(ownerPreflightHarness).toContain("supabase_migrations.schema_migrations");
    expect(ownerPreflightHarness).toContain("Required release evidence:");
    expect(ownerPreflightHarness).toMatch(/^ROLLBACK;/m);
  });

  it("makes ordinary account resolution profile-only and fail-closed", () => {
    const ensure = functionBlock(core, "ensure_user_account");
    expect(ensure).toContain("FROM auth.users AS u");
    expect(ensure).toContain("m.status = 'active'");
    expect(ensure).toContain("RETURN v_org_id");
    expect(ensure).toContain("pg_catalog.clock_timestamp()");
    expect(ensure).toContain("GET DIAGNOSTICS v_rows = ROW_COUNT");
    expect(ensure).not.toContain("INSERT INTO public.organizations");
    expect(ensure).not.toContain("INSERT INTO public.organization_memberships");
    expect(ensure).not.toContain("organization_invites");
    expect(ensure).not.toContain("overwatch_access_email_key");
    expect(ensure).not.toContain("alias");
    expect(core).toContain("DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users");
    expect(core).toContain("DROP TRIGGER IF EXISTS on_auth_user_account_created ON auth.users");
  });

  it("accepts only the exact company invite and preserves legitimate active seats", () => {
    const finalize = functionBlock(core, "finalize_invite_acceptance");
    expect(finalize).toContain("WHERE i.id = p_invite_id");
    expect(finalize).toContain("FOR UPDATE OF i");
    expect(finalize).toContain("lower(pg_catalog.btrim(v_invite.email))");
    expect(finalize).toContain("v_invite.status <> 'pending'");
    expect(finalize).toContain("v_invite.expires_at <= v_now");
    expect(finalize).toContain("status = 'accepted'");
    expect(finalize).toContain("accepted_by = v_caller");
    expect(finalize).toContain("GET DIAGNOSTICS v_rows = ROW_COUNT");
    expect(finalize).toContain("ELSIF v_membership.status = 'pending'");
    expect(finalize).toContain("v_invite_caps");
    expect(finalize).toContain("inviter.status = 'active'");
    expect(finalize).toContain("company.manage_team");
    expect(finalize).toContain("Invite authority is invalid.");
    expect(finalize).toContain("public.app_super_admins");
    expect(finalize).not.toMatch(/FOR\s+v_invite\s+IN/i);
    expect(finalize).not.toContain("overwatch_access_email_key");
    expect(finalize).not.toMatch(
      /ELSIF v_membership\.status = 'active'[\s\S]*UPDATE public\.organization_memberships/,
    );
  });

  it("accepts one exact client row and requires active exact-user authority thereafter", () => {
    expect(core).toContain("Client-access preflight failed before P0 Auth cutover:");
    expect(client).toContain("Client-access cutover blocked:");
    expect(client).toContain("access_row.client_user_id IS NULL");
    expect(client).toContain("access_row.accepted_by IS DISTINCT FROM access_row.client_user_id");
    expect(client).toContain("SET accepted_by = access_row.client_user_id");
    expect(client).not.toMatch(
      /SET\s+client_user_id\s*=\s*[\s\S]{0,200}lower\(pg_catalog\.btrim\(access_row\.email\)\)/,
    );

    const finalize = functionBlock(core, "finalize_client_access_acceptance");
    expect(finalize).toContain("WHERE access_row.id = p_client_access_id");
    expect(finalize).toContain("FOR UPDATE OF access_row");
    expect(finalize).toContain("v_access.status = 'active'");
    expect(finalize).toContain("v_access.client_user_id = v_caller");
    expect(finalize).toContain("v_access.status <> 'pending'");
    expect(finalize).toContain("status = 'active'");
    expect(finalize).toContain("client_user_id = v_caller");
    expect(finalize).toContain("accepted_by = v_caller");
    expect(finalize).toContain("GET DIAGNOSTICS v_rows = ROW_COUNT");

    const canRead = functionBlock(client, "can_read_client_project");
    expect(canRead).toContain("access_row.status = 'active'");
    expect(canRead).toContain("access_row.client_user_id = auth.uid()");
    expect(canRead).toContain("access_row.accepted_by = auth.uid()");
    expect(canRead).not.toContain("auth.jwt()");
    expect(canRead).not.toContain("pending");

    for (const decision of [
      "record_client_change_order_decision",
      "record_client_selection_decision",
    ]) {
      const block = functionBlock(client, decision);
      expect(block).not.toContain("UPDATE public.project_client_access");
      expect(block).toContain("FOR SHARE OF access_row");
    }
  });

  it("removes project Owner minting and every direct owner-id authority branch", () => {
    expect(core).toContain("DROP TRIGGER IF EXISTS projects_owner_membership");
    expect(core).toContain("DROP FUNCTION IF EXISTS public.tg_projects_owner_membership()");
    const assignment = functionBlock(core, "tg_projects_creator_assignment");
    expect(assignment).toContain("VALUES (NEW.id, NEW.owner_id, 'manager', 'active')");
    expect(assignment).not.toMatch(/VALUES\s*\([^)]*'owner'/);

    for (const helper of ["can_read_project", "can_manage_project"]) {
      const block = functionBlock(core, helper);
      expect(block).toContain("public.has_org_capability");
      expect(block).not.toMatch(/owner_id\s*=\s*auth\.uid\(\)/);
    }
    expect(functionBlock(core, "can_create_project_in_org")).toContain(
      "public.has_org_capability(p_org_id, 'projects.manage')",
    );
    expect(core).toContain("DROP POLICY IF EXISTS projects_owner_all");
    expect(core).toContain("DROP POLICY IF EXISTS daily_reports_storage_delete");
  });

  it("makes ordinary membership authority changes RPC-only", () => {
    expect(authority).toContain(
      "CREATE OR REPLACE FUNCTION public.update_organization_membership_authority(",
    );
    expect(authority).toContain("REVOKE INSERT, UPDATE, DELETE ON public.organization_memberships");
    for (const policy of ["insert", "update", "delete"]) {
      expect(authority).toContain(
        `DROP POLICY IF EXISTS organization_memberships_manage_${policy}`,
      );
    }

    const update = functionBlock(authority, "update_organization_membership_authority");
    expect(update).toContain("SECURITY DEFINER");
    expect(update).toContain("SET search_path = ''");
    expect(update).toContain("company.manage_team");
    expect(update).toContain("Self-directed authority changes are not allowed.");
    expect(update).toContain("Existing Owner access requires a dedicated transfer workflow.");
    expect(update).toContain("Delegated authority exceeds the caller.");
    expect(update).toContain("p_status = 'pending'");
    expect(update).toContain("v_target.status = 'pending'");
    expect(update).toContain("Pending company access requires exact invite acceptance.");
    expect(update).toContain("pg_catalog.clock_timestamp()");
    expect(update).toContain("GET DIAGNOSTICS v_rows = ROW_COUNT");
  });

  it("pins browser, service-role, and sandbox execution boundaries", () => {
    expect(core).toMatch(
      /REVOKE ALL ON FUNCTION public\.ensure_user_account\(uuid, text, text\)[\s\S]*?FROM PUBLIC, anon, authenticated;/,
    );
    expect(core).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.ensure_user_account\(uuid, text, text\)[\s\S]*?TO service_role;/,
    );
    for (const finalizer of ["finalize_invite_acceptance", "finalize_client_access_acceptance"]) {
      expect(core).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${finalizer}\\(uuid\\)[\\s\\S]*?FROM PUBLIC, anon;`,
        ),
      );
      expect(core).toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION public\\.${finalizer}\\(uuid\\)[\\s\\S]*?TO authenticated, service_role;`,
        ),
      );
    }
    expect(client).toContain("'GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role'");
    expect(authority).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.update_organization_membership_authority\([\s\S]*?\) TO authenticated, service_role;/,
    );
    expect(magicLink).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.reserve_auth_magic_link_send\([\s\S]*?\) TO service_role;/,
    );
    expect(magicLink).toContain(
      "GRANT EXECUTE ON FUNCTION public.lookup_auth_user_by_email_exact(text)",
    );
    for (const source of [core, client, authority, magicLink]) {
      expect(source).toContain("sandbox_exec");
    }
  });

  it("permits secure pending-invite reissue without permitting inviter forgery", () => {
    const guard = functionBlock(authority, "tg_guard_organization_invite_authority");
    expect(guard).toContain("OLD.status <> 'pending'");
    expect(guard).toContain("NEW.organization_id IS DISTINCT FROM OLD.organization_id");
    expect(guard).toContain("NEW.email IS DISTINCT FROM OLD.email");
    expect(guard).toContain("NEW.accepted_by IS DISTINCT FROM OLD.accepted_by");
    expect(guard).toContain("NEW.accepted_at IS DISTINCT FROM OLD.accepted_at");
    expect(guard).toContain("NEW.expires_at <= pg_catalog.clock_timestamp()");
    expect(guard).toMatch(
      /NEW\.invited_by IS DISTINCT FROM OLD\.invited_by[\s\S]*NEW\.status <> 'pending'[\s\S]*NEW\.invited_by IS DISTINCT FROM v_caller/,
    );
    expect(guard).toContain("Invite authority exceeds the caller.");
  });

  it("re-checks active state on each authorization call for mid-session revocation", () => {
    for (const helper of ["can_create_project_in_org", "can_read_project", "can_manage_project"]) {
      expect(functionBlock(core, helper)).toMatch(/has_org_capability|status = 'active'/);
    }
    expect(functionBlock(client, "can_read_client_project")).toContain(
      "access_row.status = 'active'",
    );
    expect(core).not.toMatch(/SET search_path = (?!'')/);
    expect(`${core}\n${client}\n${authority}\n${magicLink}`).not.toMatch(/\bnow\(\)/i);
  });

  it("atomically reserves one MagicLink send and keeps Auth lookup service-only", () => {
    const reserve = functionBlock(magicLink, "reserve_auth_magic_link_send");
    expect(reserve).toContain("SECURITY DEFINER");
    expect(reserve).toContain("SET search_path = ''");
    expect(reserve).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(reserve).toContain("send_log.metadata ->> 'dedupe_key' = v_dedupe_key");
    expect(reserve).toContain("send_log.status IN ('pending', 'sent')");
    expect(reserve).toContain("'30 seconds'::pg_catalog.interval");
    expect(reserve).toContain("INSERT INTO public.email_send_log");
    expect(reserve).toContain("'pending'");
    expect(reserve).toContain("GET DIAGNOSTICS v_rows = ROW_COUNT");
    expect(magicLink).toContain("REVOKE ALL ON FUNCTION public.reserve_auth_magic_link_send(");
    expect(magicLink).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.reserve_auth_magic_link_send\([\s\S]*?\) TO service_role;/,
    );

    const lookup = functionBlock(magicLink, "lookup_auth_user_by_email_exact");
    expect(lookup).toContain("SECURITY DEFINER");
    expect(lookup).toContain("SET search_path = ''");
    expect(lookup).toContain("FROM auth.users AS auth_user");
    expect(lookup).toContain("auth_user.email_confirmed_at IS NOT NULL");
    expect(lookup).toContain("lower(pg_catalog.btrim(auth_user.email))");
    expect(lookup).toContain("v_match_count > 1");
    expect(lookup).toContain("Auth identity is ambiguous");
    expect(magicLink).toContain(
      "REVOKE ALL ON FUNCTION public.lookup_auth_user_by_email_exact(text)",
    );
    expect(magicLink).toContain(
      "GRANT EXECUTE ON FUNCTION public.lookup_auth_user_by_email_exact(text)",
    );
  });

  it("retires the legacy public.finalize_client_access(uuid) RPC in the definitive migration", () => {
    // The sole supported client callback finalizer is
    // public.finalize_client_access_acceptance(uuid). The legacy SECURITY
    // DEFINER RPC must be revoked from every role and dropped in 01000.
    expect(core).toMatch(
      /REVOKE ALL ON FUNCTION public\.finalize_client_access\(uuid\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(core).toMatch(
      /rolname = 'sandbox_user'[\s\S]*?REVOKE ALL ON FUNCTION public\.finalize_client_access\(uuid\) FROM sandbox_user/,
    );
    expect(core).toMatch(/DROP FUNCTION IF EXISTS public\.finalize_client_access\(uuid\);/);
    // No expires_at column exists on project_client_access; the retirement
    // block must not introduce expiry logic.
    const retireStart = core.indexOf("retire_legacy_finalize_client_access");
    expect(retireStart).toBeGreaterThan(0);
    const retireEnd = core.indexOf(
      "DROP FUNCTION IF EXISTS public.finalize_client_access(uuid);",
      retireStart,
    );
    expect(retireEnd).toBeGreaterThan(retireStart);
    expect(core.slice(retireStart, retireEnd)).not.toMatch(/expires?_at/i);

    // Harness must assert the legacy regprocedure is absent and no overload
    // remains, and must still be rollback-only.
    expect(harness).toContain("legacy public.finalize_client_access(uuid) survived 01000");
    expect(harness).toContain(
      "a public.finalize_client_access overload remains after 01000",
    );
    expect(harness).toContain(
      "to_regprocedure('public.finalize_client_access(uuid)')",
    );
    expect(harness).toContain("all six migrations report applied");
    expect(harness).not.toContain("all five migrations report applied");
    expect(harness).toMatch(/^ROLLBACK;/m);
  });

  it("ships a manual, rollback-only maintenance proof harness", () => {
    expect(harness).toContain("NOT EXECUTED");
    expect(harness).toContain("maintenance mode");
    expect(harness).toContain("Migration 00000 is");
    expect(harness).toMatch(/^BEGIN;/m);
    expect(harness).toMatch(/^ROLLBACK;/m);
    expect(harness).toContain("zero-history account");
    expect(harness).toContain("exact invite");
    expect(harness).toContain("exact client access");
    expect(harness).toContain("mid-session revocation");
    expect(harness).toContain("direct membership DML");
    expect(harness).toContain("secure invite reissue");
    expect(harness).toContain("'30 seconds' IN pg_catalog.lower(v_reservation)");
  });
});

