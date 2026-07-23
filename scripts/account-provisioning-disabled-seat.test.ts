import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P0 finding 2: disabled-seat + client-only containment. Locks the
// FORWARD migration currently staged unapplied under supabase/migrations/;
// see docs/RELEASE_GATE.md §6 for the maintenance-window apply path.
//
// P0 correction (this turn): the migration now REMOVES the same-email
// invite auto-accept loop from ensure_user_account and the alias-clone
// block. The ONLY invite acceptance boundary is
// finalize_invite_acceptance(); the ONLY client-access acceptance
// boundary is finalize_client_access(). Both are called from the
// auth callback with the exact clicked resource id.

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260724000000_account_provisioning_history_containment.sql",
  ),
  "utf8",
);

describe("account provisioning — disabled-seat containment (tracked, unapplied)", () => {
  it("ensure_user_account no longer contains a same-email invite auto-accept loop", () => {
    // The loop `FOR v_invite IN SELECT ... FROM organization_invites`
    // is removed. Only finalize_invite_acceptance() may accept invites
    // (which correctly writes v_invite.role into a membership for the
    // SINGLE clicked invite — that INSERT stays).
    expect(migration).not.toMatch(/FOR\s+v_invite\s+IN\s+SELECT/i);
    // No alias-clone block that copied role/capabilities from another
    // UUID sharing a mutable profile email.
    expect(migration).not.toMatch(/WITH alias_source AS/);
  });

  it("ensure_user_account keeps the per-caller and per-email advisory locks (bootstrap serialization)", () => {
    expect(migration).toContain(
      "pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0))",
    );
    expect(migration).toContain(
      "pg_advisory_xact_lock(hashtextextended(v_email_key, 1))",
    );
  });

  it("preserves the valid-active-default fallback and active-membership fallback", () => {
    expect(migration).toContain("m.organization_id = p.default_organization_id");
    expect(migration).toMatch(/ORDER BY \(m\.role = 'owner'\) DESC, m\.created_at ASC/);
  });

  it("history guard detects prior association across alias UUIDs (profiles + auth.users)", () => {
    expect(migration).toContain("WITH alias_users AS");
    expect(migration).toContain("FROM public.profiles");
    expect(migration).toContain("FROM auth.users");
    expect(migration).toContain("public.overwatch_access_email_key(email) = v_email_key");

    // All the association surfaces the guard must cover.
    expect(migration).toContain("FROM public.organization_memberships m");
    expect(migration).toContain("m.user_id IN (SELECT id FROM alias_users)");
    expect(migration).toContain("FROM public.organization_invites i");
    expect(migration).toContain("i.accepted_by IN (SELECT id FROM alias_users)");
    // Any invite BY EMAIL — pending/accepted/revoked/expired alike —
    // counts as prior identity history so the alias cannot bootstrap.
    expect(migration).toContain("public.overwatch_access_email_key(i.email) = v_email_key");
    expect(migration).toContain("FROM public.organizations o");
    expect(migration).toContain("o.created_by IN (SELECT id FROM alias_users)");
    expect(migration).toContain("p.default_organization_id IS NOT NULL");
    expect(migration).toContain("FROM public.project_client_access pca");
    expect(migration).toContain("pca.client_user_id IN (SELECT id FROM alias_users)");
    expect(migration).toContain("pca.accepted_by IN (SELECT id FROM alias_users)");
    expect(migration).toContain(
      "public.overwatch_access_email_key(pca.email) = v_email_key",
    );
    expect(migration).toContain("FROM public.projects pr");
    expect(migration).toContain("pr.owner_id IN (SELECT id FROM alias_users)");
    expect(migration).toContain("FROM public.project_memberships pm");
    expect(migration).toContain("pm.user_id IN (SELECT id FROM alias_users)");

    // Guard must run BEFORE any bootstrap INSERT of a new organization.
    const guardIdx = migration.indexOf("WITH alias_users AS");
    const bootstrapInsertIdx = migration.indexOf(
      "INSERT INTO public.organizations (name, created_by)",
    );
    expect(guardIdx).toBeGreaterThan(0);
    expect(bootstrapInsertIdx).toBeGreaterThan(guardIdx);
  });

  it("drops the demo seed trigger AND the auto-accept trigger in the same migration", () => {
    expect(migration).toContain("DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users");
    expect(migration).toContain(
      "DROP TRIGGER IF EXISTS on_auth_user_account_created ON auth.users",
    );
  });

  it("returns NULL and clears only the caller's stale default when history exists", () => {
    expect(migration).toMatch(/IF v_has_history THEN[\s\S]*?RETURN NULL;[\s\S]*?END IF;/);
    expect(migration).toContain("SET default_organization_id = NULL,");
    expect(migration).toContain("WHERE id = p_user_id;");
    expect(migration).toMatch(
      /IF v_current_default IS NOT NULL AND NOT EXISTS[\s\S]*?m\.status = 'active'/,
    );
  });

  it("does not sweep organizations/memberships or rewrite arbitrary defaults", () => {
    expect(migration).not.toMatch(/DELETE FROM public\.organizations/);
    expect(migration).not.toMatch(/DELETE FROM public\.organization_memberships/);
    expect(migration).not.toMatch(
      /UPDATE public\.profiles[\s\S]{0,200}WHERE id <> p_user_id/,
    );
  });

  it("does not mutate commercial entitlement", () => {
    expect(migration).not.toContain("contractor_circle_grant");
    expect(migration).not.toContain("seat_limit =");
    expect(migration).not.toContain("billing_status =");
  });

  it("keeps EXECUTE containment on ensure_user_account and asserts it atomically", () => {
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.ensure_user_account(uuid, text, text) FROM PUBLIC;",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.ensure_user_account(uuid, text, text) FROM anon;",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.ensure_user_account(uuid, text, text) FROM authenticated;",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.ensure_user_account(uuid, text, text) TO service_role;",
    );
    expect(migration).toContain("rolname = 'sandbox_exec'");
    expect(migration).toContain("has_function_privilege(");
    expect(migration).toContain("ensure_user_account remains executable by a browser role");
    expect(migration).toContain("ensure_user_account remains executable by sandbox_exec");
    expect(migration).toContain("ensure_user_account lost service_role EXECUTE");
  });

  it("keeps the auth.uid-bound wrapper callable by authenticated", () => {
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.ensure_current_user_account() TO authenticated;",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.ensure_current_user_account() TO service_role;",
    );
  });

  it("finalize_invite_acceptance is the sole invite-acceptance boundary", () => {
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.finalize_invite_acceptance(p_invite_id uuid)",
    );
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("v_caller uuid := auth.uid()");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.finalize_invite_acceptance(uuid) FROM anon;",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.finalize_invite_acceptance(uuid) TO authenticated;",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.finalize_invite_acceptance(uuid) TO service_role;",
    );
    expect(migration).toContain(
      "finalize_invite_acceptance remains executable by anon",
    );
    expect(migration).toContain(
      "finalize_invite_acceptance remains executable by sandbox_exec",
    );

    // The RPC must re-validate email match, pending status, and use
    // clock_timestamp() for expiry AFTER the lock wait so a row that
    // expires while blocking is rejected.
    expect(migration).toContain("FROM public.organization_invites");
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toMatch(
      /public\.overwatch_access_email_key\(v_invite\.email\) <> v_email_key/,
    );
    expect(migration).toMatch(/v_invite\.status <> 'pending'/);
    expect(migration).toContain("v_now := clock_timestamp();");
    expect(migration).toMatch(
      /v_invite\.expires_at IS NULL OR v_invite\.expires_at <= v_now/,
    );

    // Exactly-one-row assertion: GET DIAGNOSTICS on the pending ->
    // accepted UPDATE, RAISE if the count isn't 1 (guarantees zero
    // writes on revoked/expired/mismatched at commit time).
    expect(migration).toContain("GET DIAGNOSTICS v_updated = ROW_COUNT;");
    expect(migration).toContain(
      "finalize_invite_acceptance: expected exactly 1 invite update, got %",
    );
    expect(migration).toContain("ERRCODE = 'serialization_failure'");
  });

  it("finalize_client_access is the sole client-portal acceptance boundary", () => {
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.finalize_client_access(p_access_id uuid)",
    );
    expect(migration).toContain("FROM public.project_client_access");
    expect(migration).toContain("FOR UPDATE");
    // Same fail-closed guarantees.
    expect(migration).toMatch(
      /public\.overwatch_access_email_key\(v_row\.email\) <> v_email_key/,
    );
    expect(migration).toMatch(/v_row\.status NOT IN \('pending', 'active'\)/);
    expect(migration).toContain("v_now := clock_timestamp();");
    expect(migration).toMatch(
      /v_row\.expires_at IS NOT NULL AND v_row\.expires_at <= v_now/,
    );
    expect(migration).toContain(
      "finalize_client_access: expected exactly 1 access update, got %",
    );

    // Privilege matrix.
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.finalize_client_access(uuid) FROM anon;",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.finalize_client_access(uuid) TO authenticated;",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.finalize_client_access(uuid) TO service_role;",
    );
    expect(migration).toContain(
      "finalize_client_access remains executable by anon",
    );
    expect(migration).toContain(
      "finalize_client_access remains executable by sandbox_exec",
    );
  });

  it("closes the org-null project bypass and drops the legacy owner_all policy", () => {
    expect(migration).toContain("DROP POLICY IF EXISTS projects_owner_all ON public.projects");
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.tg_projects_ensure_organization()",
    );
    expect(migration).toContain(
      "No active company access for this user; project cannot be created.",
    );
    expect(migration).toContain(
      "legacy policy projects_owner_all remains on public.projects",
    );
  });

  it("does not run a live structural probe that inserts against random org ids", () => {
    expect(migration).not.toMatch(
      /INSERT INTO public\.organization_memberships[\s\S]{0,200}gen_random_uuid\(\)/,
    );
  });
});
