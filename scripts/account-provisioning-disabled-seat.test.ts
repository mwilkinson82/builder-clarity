import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P0 finding 2: disabled-seat + client-only containment. Locks the
// FORWARD migration currently staged unapplied under supabase/migrations/;
// see docs/RELEASE_GATE.md §6 for the maintenance-window apply path.

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260724000000_account_provisioning_history_containment.sql",
  ),
  "utf8",
);

describe("account provisioning — disabled-seat containment (tracked, unapplied)", () => {
  it("preserves pending-invite-first acceptance with exact invited role/capabilities under FOR UPDATE", () => {
    expect(migration).toContain("FROM public.organization_invites i");
    expect(migration).toMatch(/i\.status = 'pending'[\s\S]{0,120}i\.expires_at > now\(\)/);
    expect(migration).toContain("FOR UPDATE OF i");
    expect(migration).toMatch(
      /COALESCE\(\s*NULLIF\(v_invite\.capabilities, '\{\}'::jsonb\),\s*public\.role_preset_capabilities\(v_invite\.role\)/,
    );
  });

  it("serializes same-email aliases via a per-email advisory transaction lock", () => {
    expect(migration).toContain("pg_advisory_xact_lock(hashtextextended(v_email_key, 1))");
  });

  it("preserves the valid-active-default fallback and active-membership fallback", () => {
    expect(migration).toContain("m.organization_id = p.default_organization_id");
    expect(migration).toMatch(/ORDER BY \(m\.role = 'owner'\) DESC, m\.created_at ASC/);
  });

  it("detects prior association history across alias UUIDs BEFORE any bootstrap INSERT", () => {
    // History guard inspects alias UUIDs found via BOTH public.profiles AND
    // auth.users by normalized email — so a disabled alias with no profiles
    // row still counts as history.
    expect(migration).toContain("WITH alias_users AS");
    expect(migration).toContain("FROM public.profiles");
    expect(migration).toContain("FROM auth.users");
    expect(migration).toContain("public.overwatch_access_email_key(email) = v_email_key");

    // All the association surfaces the guard must cover.
    expect(migration).toContain("FROM public.organization_memberships m");
    expect(migration).toContain("m.user_id IN (SELECT id FROM alias_users)");
    expect(migration).toContain("FROM public.organization_invites i");
    expect(migration).toContain("i.accepted_by IN (SELECT id FROM alias_users)");
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

  it("keeps EXECUTE containment on the parameterized function and asserts it atomically", () => {
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

  it("adds finalize_invite_acceptance as an auth.uid-bound RPC, contained from anon/sandbox", () => {
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

    // The RPC must re-validate email match, pending status, expiry —
    // under FOR UPDATE — and reject if any check fails.
    expect(migration).toContain("FROM public.organization_invites");
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toMatch(/public\.overwatch_access_email_key\(v_invite\.email\) <> v_email_key/);
    expect(migration).toMatch(/v_invite\.status <> 'pending'/);
    expect(migration).toMatch(/v_invite\.expires_at IS NULL OR v_invite\.expires_at <= now\(\)/);
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
    // The prior draft's structural probe inserted a membership with a
    // random nonexistent organization_id and would abort on the immediate
    // FK. Replaced with deterministic privilege assertions.
    expect(migration).not.toMatch(/INSERT INTO public\.organization_memberships[\s\S]{0,200}gen_random_uuid\(\)/);
  });
});
