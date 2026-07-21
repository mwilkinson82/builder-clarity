import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Source-marker pins for the Phase 3 capability split
// (supabase/migrations/20260720230000_authz_phase3_capability_split.sql).
// The pglite harness proves the file applies and replays; these pins keep the
// SECURITY-relevant shape of the file from silently regressing in review or
// rebase. docs/ROLES.md section 5 is the agenda this file implements.

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260720230000_authz_phase3_capability_split.sql"),
  "utf8",
);

function block(start: string, end: string) {
  const startAt = migration.indexOf(start);
  const endAt = migration.indexOf(end, startAt + start.length);
  expect(startAt, `missing source marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endAt, `missing source marker: ${end}`).toBeGreaterThan(startAt);
  return migration.slice(startAt, endAt);
}

describe("authz phase 3 capability split", () => {
  it("defines the five module helpers as guarded SECURITY DEFINER functions", () => {
    for (const helper of [
      "can_manage_billing",
      "can_manage_schedule",
      "can_manage_client_access",
      "can_write_crm",
      "can_write_cost_library",
    ]) {
      const def = block(`CREATE OR REPLACE FUNCTION public.${helper}(`, "$$;");
      expect(def).toContain("SECURITY DEFINER");
      expect(def).toContain("SET search_path = public");
      expect(def).toContain("STABLE");
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${helper}(uuid) FROM PUBLIC;`);
      expect(migration).toContain(
        `GRANT EXECUTE ON FUNCTION public.${helper}(uuid) TO authenticated, service_role;`,
      );
    }
    // project-scoped helpers carry the owner + capability-with-project-scope shape
    for (const [helper, capability] of [
      ["can_manage_billing", "billing.manage"],
      ["can_manage_schedule", "schedule.manage"],
      ["can_manage_client_access", "client_portal.manage"],
    ] as const) {
      const def = block(`CREATE OR REPLACE FUNCTION public.${helper}(`, "$$;");
      expect(def).toContain("p.owner_id = (SELECT auth.uid())");
      expect(def).toContain("public.can_manage_project(p_project_id)");
      expect(def).toContain(`'${capability}'`);
    }
    expect(block("CREATE OR REPLACE FUNCTION public.can_write_crm(", "$$;")).toContain(
      "'crm.manage'",
    );
    expect(block("CREATE OR REPLACE FUNCTION public.can_write_cost_library(", "$$;")).toContain(
      "'cost_library.write'",
    );
  });

  it("retargets can_manage_estimate onto estimating.write with no is_org_member branch", () => {
    const def = block("CREATE OR REPLACE FUNCTION public.can_manage_estimate(", "$$;");
    expect(def).toContain(
      "public.has_org_capability(estimate.organization_id, 'estimating.write')",
    );
    expect(def).not.toContain("is_org_member");
    // the branches the founder kept
    expect(def).toContain("public.is_super_admin()");
    expect(def).toContain("public.can_manage_org(estimate.organization_id)");
    expect(def).toContain("NOT estimate.is_canonical_demo");
    expect(def).toContain("public.can_manage_project(estimate.project_id)");
  });

  it("moves every cost-library write policy onto can_write_cost_library", () => {
    for (const policy of [
      "cost_library_items_org_insert",
      "cost_library_items_user_update",
      "cost_library_items_user_delete",
      "estimate_markup_defaults_org_insert",
      "estimate_markup_defaults_org_update",
      "estimate_markup_defaults_org_delete",
    ]) {
      const body = block(`CREATE POLICY ${policy}`, ";");
      expect(body, policy).toContain("public.can_write_cost_library(organization_id)");
    }
    // the system-row guard survives the retarget
    expect(block("CREATE POLICY cost_library_items_user_update", ";")).toContain(
      "source <> 'system'",
    );
    expect(block("CREATE POLICY cost_library_items_user_delete", ";")).toContain(
      "source <> 'system'",
    );
  });

  it("moves CRM writes onto can_write_crm and adds no DELETE policies", () => {
    for (const policy of [
      "pipeline_opportunities_member_insert",
      "pipeline_opportunities_member_update",
      "pipeline_activity_log_member_insert",
      "pipeline_accounts_member_insert",
      "pipeline_contacts_member_update",
      "pipeline_next_actions_member_insert",
      "crm_value_assets_member_update",
      "crm_followup_playbooks_member_insert",
      "crm_followup_enrollments_member_update",
      "crm_meeting_briefs_member_insert",
      "crm_onboarding_plans_member_update",
      "crm_onboarding_tasks_member_insert",
    ]) {
      expect(block(`CREATE POLICY ${policy}`, ";"), policy).toContain(
        "public.can_write_crm(organization_id)",
      );
    }
    // delete-as-archive stands (ROLES.md Finding 4): no CRM delete policy appears
    expect(migration).not.toMatch(/CREATE POLICY (pipeline|crm)_\w+_member_delete\b/);
  });

  it("routes billing-family commands through can_manage_billing in the rewriter", () => {
    const rewriter = block("DO $phase3_swap$", "$phase3_swap$;");
    for (const command of [
      "generate_billing_line_items_atomic",
      "apply_billing_line_item_mutations_atomic",
      "create_billing_application_atomic",
      "transition_billing_application_atomic",
      "create_billing_invoice_atomic",
      "transition_billing_invoice_atomic",
      "record_invoice_payment_atomic",
      "void_invoice_payment_atomic",
      "refund_invoice_payment_atomic",
      "reconcile_invoice_payment_rollup",
      "create_cost_actual_atomic",
      "import_cost_actuals_atomic",
      "apply_production_sov_certification_to_billing",
      "record_subcontract_payment_atomic",
      "transition_subcontract_payment_atomic",
      "save_subcontract_atomic",
      "allocate_change_order_atomic",
      "convert_estimate_to_sov_atomic",
      "lock_project_budget_atomic",
    ]) {
      expect(rewriter, command).toMatch(new RegExp(`'${command}',\\s*'can_manage_billing'`));
    }
    for (const command of ["apply_wip_schedule_progress_review", "reorder_schedule_wbs_sections"]) {
      expect(rewriter, command).toMatch(new RegExp(`'${command}',\\s*'can_manage_schedule'`));
    }
    // the rewriter fails loudly instead of guessing on drifted bodies
    expect(rewriter).toContain("refusing to guess");
    // commands that stay on projects.manage are NOT swept into the swap
    for (const kept of [
      "create_change_order_atomic",
      "update_change_order_atomic",
      "delete_change_order_atomic",
      "link_change_order_exposure_atomic",
      "create_exposure_allocation_atomic",
      "update_project_financial_header_atomic",
    ]) {
      expect(rewriter, `${kept} must stay on can_manage_project`).not.toContain(`'${kept}'`);
    }
  });

  it("adds explicit checks to the four no-check commands", () => {
    const adder = block("DO $phase3_add$", "$phase3_add$;");
    expect(adder).toContain("'create_project_financial_atomic'");
    expect(adder).toContain("has_org_capability(p_organization_id, 'projects.manage')");
    expect(adder).toContain("'create_estimate_atomic'");
    expect(adder).toContain("has_org_capability(p_organization_id, 'estimating.write')");
    expect(adder).toContain("'convert_pipeline_opportunity_to_project'");
    expect(adder).toContain("has_org_capability(v_opportunity.organization_id, 'crm.manage')");
    expect(adder).toContain("has_org_capability(v_opportunity.organization_id, 'projects.manage')");
    expect(adder).toContain("'seed_project_award_contingency'");
    expect(adder).toContain("public.can_manage_project(p_project_id)");
  });

  it("retargets financial SELECTs onto can_view_financials and drops the untargeted FOR ALL policy", () => {
    for (const policy of [
      "billing_applications_team_select",
      "billing_invoices_team_select",
      "billing_line_items_team_select",
      "payment_ledger_team_select",
      "cost_actuals_team_select",
      "cost_actual_payments_team_select",
      "cost_actual_import_batches_team_select",
      "cost_buckets_team_select",
      "cost_budget_items_team_select",
    ]) {
      expect(block(`CREATE POLICY ${policy}`, ";"), policy).toContain(
        "public.can_view_financials(project_id)",
      );
    }
    expect(migration).toContain(
      "DROP POLICY IF EXISTS billing_applications_owner_via_project ON public.billing_applications;",
    );
    // dropped, not recreated
    expect(migration).not.toContain("CREATE POLICY billing_applications_owner_via_project");
  });

  it("closes the client_contacts cross-org hole and gates portal access management", () => {
    for (const policy of [
      "client_contacts_org_read",
      "client_contacts_org_insert",
      "client_contacts_org_update",
      "client_contacts_org_delete",
    ]) {
      const body = block(`CREATE POLICY ${policy}`, ";");
      expect(body, policy).toContain("public.is_org_member(organization_id)");
      expect(body, policy).toContain("'crm.manage'");
      expect(body, policy).toContain("'client_portal.manage'");
      expect(body, policy).not.toContain("can_create_project_in_org");
    }
    for (const policy of [
      "project_client_access_project_insert",
      "project_client_access_project_update",
      "project_client_access_project_delete",
    ]) {
      expect(block(`CREATE POLICY ${policy}`, ";"), policy).toContain(
        "public.can_manage_client_access(project_id)",
      );
    }
  });

  it("splits the organizations row: capability SELECT, settings-only UPDATE, column-level grant, member directory", () => {
    const select = block("CREATE POLICY organizations_member_read", ";");
    expect(select).toContain("'company.manage_settings'");
    expect(select).toContain("'billing.manage'");
    expect(select).toContain("'company.manage_team'");
    expect(select).not.toContain("is_org_member");

    const update = block("CREATE POLICY organizations_manage", ";");
    expect(update).toContain("'company.manage_settings'");
    expect(update).not.toContain("can_manage_org");

    expect(migration).toContain("REVOKE UPDATE ON public.organizations FROM authenticated;");
    const grant = block("GRANT UPDATE (", ") ON public.organizations TO authenticated;");
    for (const safe of ["name", "tax_identifier", "billing_email", "logo_path"]) {
      expect(grant).toContain(safe);
    }
    for (const sensitive of ["stripe", "entitlement", "plan_code", "seat_limit"]) {
      expect(grant).not.toContain(sensitive);
    }

    const directory = block("CREATE OR REPLACE FUNCTION public.organizations_directory(", "$$;");
    expect(directory).toContain("SECURITY DEFINER");
    expect(directory).toContain("public.is_org_member(o.id)");
    for (const col of [
      "plan_code",
      "billing_status",
      "seat_limit",
      "project_limit",
      "storage_limit_mb",
      "daily_report_limit_per_month",
    ]) {
      expect(directory).toContain(col);
    }
    for (const leak of ["stripe", "entitlement", "tax_identifier", "circle_"]) {
      expect(directory).not.toContain(leak);
    }
  });

  it("moves roster/invite/ledger reads AND writes onto the company.manage_team side of the unbundle", () => {
    const memberships = block("CREATE POLICY organization_memberships_member_read", ";");
    expect(memberships).toContain("user_id = auth.uid()");
    expect(memberships).toContain("'company.manage_team'");

    expect(block("CREATE POLICY organization_invites_member_read", ";")).toContain(
      "'company.manage_team'",
    );

    // membership/invite WRITE policies are retargeted onto company.manage_team so
    // a manage_settings-only holder can no longer PATCH capabilities onto its own
    // row (write-side privilege escalation). is_super_admin is kept; can_manage_org
    // (= manage_team OR manage_settings) is gone from every write arm.
    for (const policy of [
      "organization_memberships_manage_insert",
      "organization_memberships_manage_update",
      "organization_memberships_manage_delete",
      "organization_invites_manage_insert",
      "organization_invites_manage_update",
      "organization_invites_manage_delete",
    ]) {
      const body = block(`CREATE POLICY ${policy}`, ";");
      expect(body, policy).toContain("'company.manage_team'");
      expect(body, policy).toContain("public.is_super_admin()");
      expect(body, policy).not.toContain("can_manage_org");
    }

    expect(block("CREATE POLICY credit_ledger_members_read", ";")).toContain(
      "'company.manage_settings'",
    );
    const balance = block("CREATE OR REPLACE FUNCTION public.get_org_credit_balance(", "$$;");
    expect(balance).toContain("SECURITY DEFINER");
    expect(balance).toContain("public.is_org_member(p_org_id)");
    expect(balance).toContain("SUM(l.delta)");
  });

  it("enforces the notification url relative-path rule at the RPC and as a CHECK constraint", () => {
    const fn = block("CREATE OR REPLACE FUNCTION public.create_notification(", "RETURN v_id;");
    expect(fn).toContain("left(v_url, 1) = '/'");
    expect(fn).toContain("left(v_url, 2) <> '//'");
    expect(fn).toContain("strpos(v_url, chr(92)) = 0");
    expect(fn).toContain("RAISE EXCEPTION 'notification url must be an in-app path");

    const constraint = block("ADD CONSTRAINT notifications_url_relative_path CHECK (", ");");
    expect(constraint).toContain("url = ''");
    expect(constraint).toContain("left(url, 1) = '/'");
    expect(constraint).toContain("left(url, 2) <> '//'");
    expect(constraint).toContain("strpos(url, chr(92)) = 0");

    // pre-audit repairs existing rows before the constraint lands
    const audit = block("DO $phase3_url_audit$", "$phase3_url_audit$;");
    expect(audit).toContain("UPDATE public.notifications");
    expect(audit).toContain("SET url = ''");
    expect(migration.indexOf("$phase3_url_audit$")).toBeLessThan(
      migration.indexOf("notifications_url_relative_path"),
    );
  });

  it("keeps a founder-visible ledger of defaulted decisions", () => {
    const tags = migration.match(/-- FOUNDER-DEFAULT:/g) ?? [];
    expect(tags.length).toBeGreaterThanOrEqual(4);
  });

  it("ends with a PostgREST schema reload", () => {
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
  });
});

it("profiles co-member visibility uses the definer shares_org_with helper", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260720230000_authz_phase3_capability_split.sql"),
    "utf8",
  );
  expect(migration).toContain("create or replace function public.shares_org_with");
  expect(migration).toMatch(/security definer[\s\S]{0,40}stable/i);
  expect(migration).toMatch(
    /profiles_self_read on public\.profiles for select[\s\S]{0,120}shares_org_with/,
  );
});

// ---------------------------------------------------------------------------
// Adversarial-review defect fixes (post-audit hardening batch). Each pin locks
// in one confirmed finding's fix so a rebase cannot silently reopen it.
// ---------------------------------------------------------------------------
describe("authz phase 3 adversarial defect fixes", () => {
  it("routes CRM teammate/owner membership proof through a SECURITY DEFINER helper (blocker)", () => {
    const helper = block("CREATE OR REPLACE FUNCTION public.user_is_active_org_member(", "$$;");
    expect(helper).toContain("SECURITY DEFINER");
    expect(helper).toContain("SET search_path = public");
    expect(helper).toContain("status = 'active'");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.user_is_active_org_member(uuid, uuid) FROM PUBLIC, anon;",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.user_is_active_org_member(uuid, uuid) TO authenticated, service_role;",
    );

    // all four teammate/owner-assignable CRM tables call the helper on both arms,
    // and the enrollments UPDATE arm (which lacks a self-branch) is covered.
    for (const policy of [
      "crm_followup_enrollments_member_insert",
      "crm_followup_enrollments_member_update",
      "crm_meeting_briefs_member_insert",
      "crm_meeting_briefs_member_update",
      "crm_onboarding_plans_member_insert",
      "crm_onboarding_plans_member_update",
      "crm_onboarding_tasks_member_insert",
      "crm_onboarding_tasks_member_update",
    ]) {
      const body = block(`CREATE POLICY ${policy}`, ";");
      expect(body, policy).toContain("public.user_is_active_org_member(");
      expect(body, policy).toContain("public.can_write_crm(organization_id)");
      // no raw in-policy EXISTS on organization_memberships (that starves post-3g)
      expect(body, policy).not.toContain("organization_memberships");
    }
  });

  it("retargets the estimates base-table UPDATE onto the estimating.write lever and locks canonical columns (high)", () => {
    const update = block("CREATE POLICY estimates_org_update", ";");
    expect(update).toContain("public.can_manage_estimate(id)");
    expect(update).not.toContain("is_org_member");
    // canonical bookkeeping columns pulled out of the authenticated column grant
    const revoke = block("REVOKE UPDATE (", ") ON public.estimates FROM authenticated;");
    expect(revoke).toContain("is_canonical_demo");
    expect(revoke).toContain("canonical_demo_key");
    expect(revoke).toContain("canonical_expected_total_cents");
  });

  it("retargets the cost_library price-history INSERT onto cost_library.write (high)", () => {
    const body = block("CREATE POLICY cost_library_price_history_org_insert", ";");
    expect(body).toContain("public.can_write_cost_library(organization_id)");
    expect(body).not.toContain("can_manage_org");
  });

  it("gates the live cost_buckets column-UPDATE path on billing.manage and drops the redundant owner FOR-ALL (medium)", () => {
    for (const policy of [
      "cost_buckets_team_insert",
      "cost_buckets_team_update",
      "cost_buckets_team_delete",
    ]) {
      const body = block(`CREATE POLICY ${policy}`, ";");
      expect(body, policy).toContain("public.can_manage_billing(project_id)");
      expect(body, policy).not.toContain("can_manage_project");
    }
    expect(migration).toContain(
      "DROP POLICY IF EXISTS cost_buckets_owner_via_project ON public.cost_buckets;",
    );
    expect(migration).not.toContain("CREATE POLICY cost_buckets_owner_via_project");
  });

  it("retargets sov_mapping_profiles writes onto billing.manage, keeping created_by (medium)", () => {
    for (const policy of [
      "sov_mapping_profiles_member_insert",
      "sov_mapping_profiles_member_update",
      "sov_mapping_profiles_member_delete",
    ]) {
      const body = block(`CREATE POLICY ${policy}`, ";");
      expect(body, policy).toContain("'billing.manage'");
      expect(body, policy).not.toContain("public.is_org_member(organization_id)");
    }
    expect(block("CREATE POLICY sov_mapping_profiles_member_insert", ";")).toContain(
      "created_by = (SELECT auth.uid())",
    );
  });

  it("retargets company-assets storage writes onto company.manage_settings (medium)", () => {
    for (const policy of [
      "company_assets_team_insert",
      "company_assets_team_update",
      "company_assets_team_delete",
    ]) {
      const body = block(`CREATE POLICY ${policy}`, ";");
      expect(body, policy).toContain("'company.manage_settings'");
      expect(body, policy).toContain("bucket_id = 'company-assets'");
      expect(body, policy).not.toContain("can_manage_org");
    }
  });

  it("rejects ASCII control characters in notification urls at every enforcement arm (medium)", () => {
    // three url-based arms: pre-audit count, pre-audit UPDATE, CHECK constraint
    const urlArms = migration.match(/\burl !~ '\[\[:cntrl:\]\]'/g) ?? [];
    expect(urlArms.length).toBeGreaterThanOrEqual(3);
    // the CHECK constraint arm specifically must carry the rule (it is the most
    // load-bearing and the deepest-indented — easy to miss on a bulk edit)
    const constraint = block("ADD CONSTRAINT notifications_url_relative_path CHECK (", ");");
    expect(constraint).toContain("[[:cntrl:]]");
    // create_notification RPC arm (v_url)
    expect(migration).toContain("v_url !~ '[[:cntrl:]]'");
  });
});
