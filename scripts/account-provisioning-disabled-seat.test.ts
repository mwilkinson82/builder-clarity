import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P0 finding 2: disabled-seat containment. This test locks the DRAFT
// migration under supabase/verification/ (unapplied) that will replace
// ensure_user_account(). It asserts the containment structure so a future
// edit cannot silently re-open the self-bootstrap-Owner path when a
// disabled/history identity refreshes.

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/verification/20260723200000_account_provisioning_disabled_seat_containment.sql",
  ),
  "utf8",
);

describe("account provisioning — disabled-seat containment (draft)", () => {
  it("preserves pending-invite-first acceptance with exact invited role/capabilities", () => {
    expect(migration).toContain(
      "FROM public.organization_invites i",
    );
    expect(migration).toMatch(/i\.status = 'pending'[\s\S]{0,80}i\.expires_at > now\(\)/);
    expect(migration).toMatch(
      /COALESCE\(\s*NULLIF\(v_invite\.capabilities, '\{\}'::jsonb\),\s*public\.role_preset_capabilities\(v_invite\.role\)/,
    );
  });

  it("preserves the valid-active-default fallback and active-membership fallback", () => {
    expect(migration).toContain("m.organization_id = p.default_organization_id");
    expect(migration).toMatch(/ORDER BY \(m\.role = 'owner'\) DESC, m\.created_at ASC/);
  });

  it("detects prior association history BEFORE the bootstrap branch", () => {
    // Must check memberships (any status), accepted invites, AND created orgs
    // — in the same guard, before any INSERT INTO public.organizations that
    // is not inside the invite loop.
    expect(migration).toContain(
      "FROM public.organization_memberships m WHERE m.user_id = p_user_id",
    );
    expect(migration).toContain(
      "FROM public.organization_invites i\n      WHERE i.accepted_by = p_user_id",
    );
    expect(migration).toContain(
      "FROM public.organizations o WHERE o.created_by = p_user_id",
    );

    const historyIdx = migration.indexOf("P0 disabled-seat containment");
    const bootstrapIdx = migration.indexOf(
      "A genuinely uninvited, unassociated account",
    );
    // Fallback: locate the bootstrap INSERT itself.
    const bootstrapInsertIdx = migration.indexOf(
      "INSERT INTO public.organizations (name, created_by)",
    );
    expect(historyIdx).toBeGreaterThan(0);
    expect(bootstrapInsertIdx).toBeGreaterThan(historyIdx);
    if (bootstrapIdx > 0) expect(bootstrapIdx).toBeGreaterThan(historyIdx);
  });

  it("returns NULL and clears only the caller's stale default when history exists", () => {
    expect(migration).toMatch(/IF v_has_history THEN[\s\S]*?RETURN NULL;[\s\S]*?END IF;/);
    expect(migration).toContain(
      "SET default_organization_id = NULL,",
    );
    // The default rewrite is scoped strictly to the caller.
    expect(migration).toContain("WHERE id = p_user_id;");
    // It only fires when the current default is not an active membership.
    expect(migration).toMatch(
      /IF v_current_default IS NOT NULL AND NOT EXISTS[\s\S]*?m\.status = 'active'/,
    );
  });

  it("does not sweep organizations/memberships or rewrite arbitrary defaults", () => {
    expect(migration).not.toMatch(/DELETE FROM public\.organizations/);
    expect(migration).not.toMatch(/DELETE FROM public\.organization_memberships/);
    // No blanket UPDATE to profiles across users.
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
    expect(migration).toContain(
      "ensure_user_account remains executable by a browser role",
    );
    expect(migration).toContain(
      "ensure_user_account remains executable by sandbox_exec",
    );
    expect(migration).toContain(
      "ensure_user_account lost service_role EXECUTE",
    );
  });

  it("keeps the auth.uid-bound wrapper callable by authenticated", () => {
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.ensure_current_user_account() TO authenticated;",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.ensure_current_user_account() TO service_role;",
    );
  });
});
