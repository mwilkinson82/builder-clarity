import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src/lib/projects.functions.ts"), "utf8");
const route = readFileSync(
  join(process.cwd(), "src/routes/_authenticated/projects.$projectId.tsx"),
  "utf8",
);
const workspace = readFileSync(
  join(process.cwd(), "src/components/project/billing/BillingWorkspace.tsx"),
  "utf8",
);
const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260720170500_billing_application_command_integrity.sql",
  ),
  "utf8",
);

function sourceBlock(start: string, end: string) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  expect(startAt, `missing source marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endAt, `missing source marker: ${end}`).toBeGreaterThan(startAt);
  return source.slice(startAt, endAt);
}

describe("billing-application atomic command boundary", () => {
  it("routes create, update/transition, and delete through database commands", () => {
    const create = sourceBlock(
      "export const createBillingApplication",
      "export const updateBillingApplication",
    );
    const update = sourceBlock(
      "export const updateBillingApplication",
      "export const deleteBillingApplication",
    );
    const remove = sourceBlock(
      "export const deleteBillingApplication",
      "// ---------------- BILLING INVOICES + PAYMENTS",
    );

    expect(create).toContain('"create_billing_application_atomic"');
    expect(create).not.toMatch(/billing_applications"\)\s*\.insert/);
    expect(create).not.toMatch(/billing_application_events[\s\S]*\.insert/);
    expect(create).not.toMatch(/\.order\("sort_order"/);
    expect(update).toContain('"update_billing_application_atomic"');
    expect(update).toContain('"transition_billing_application_atomic"');
    expect(update).not.toMatch(/billing_applications"\)\s*\.update/);
    expect(remove).toContain('"delete_billing_application_draft_atomic"');
    expect(remove).not.toMatch(/billing_applications"\)\s*\.delete/);
  });

  it("requires caller-stable keys and reuses them after ambiguous failures", () => {
    expect(source).toContain("const billingCommandIdempotencyKey");
    expect(source).toMatch(/p_idempotency_key: idempotency_key/);
    expect(route).toContain("billingCommandRetryKeys");
    expect(route).toContain("billingCommandRetryKeys.current.get(intent)");
    expect(route).toContain("billingCommandRetryKeys.current.delete(intent)");
    expect(workspace).toContain("payAppCommandKey");
    expect(workspace).toContain('newBillingApplicationCommandKey("create")');
  });

  it("fails closed instead of fabricating browser-only financial records", () => {
    expect(route).not.toContain("LOCAL_BILLING_ID_PREFIX");
    expect(route).not.toContain("readLocalBillingApplications");
    expect(route).not.toContain("writeLocalBillingApplications");
    expect(route).not.toContain("makeLocalBillingApplication");
    expect(route).not.toContain("Application created locally");
    expect(route).toMatch(
      /const handleUpdatePayApp = async[\s\S]*billingUpdate\.mutateAsync[\s\S]*return true;[\s\S]*return false;/,
    );
  });
});

describe("billing-application database invariants", () => {
  it("serializes creates and assigns a unique deterministic project order", () => {
    const upgradeLockAt = migration.indexOf(
      "lock table public.billing_applications in share row exclusive mode",
    );
    const replaceUniqueIndexAt = migration.indexOf(
      "drop index if exists public.billing_applications_project_sort_order_unique",
    );
    expect(upgradeLockAt).toBeGreaterThanOrEqual(0);
    expect(upgradeLockAt).toBeLessThan(replaceUniqueIndexAt);
    expect(migration).toMatch(
      /create unique index billing_applications_project_sort_order_unique[\s\S]*\(project_id, sort_order\)/i,
    );
    expect(migration).toMatch(
      /create_billing_application_atomic[\s\S]*from public\.projects[\s\S]*for update/i,
    );
    expect(migration).toMatch(
      /select coalesce\(max\(application\.sort_order\), 0\) \+ 1[\s\S]*insert into public\.billing_applications/i,
    );
    expect(migration).toMatch(
      /insert into public\.billing_application_events[\s\S]*update public\.projects[\s\S]*billing_application_commands/i,
    );
  });

  it("accepts signed credits while protecting cents and the revised contract", () => {
    expect(source).toMatch(/change_order_amount:[\s\S]*\.min\(-MAX_SAFE_DOLLARS\)/);
    expect(migration).toMatch(/contract_amount \+ change_order_amount >= 0/i);
    expect(migration).toMatch(/change_order_amount \* 100 = trunc\(change_order_amount \* 100\)/i);
    expect(migration).toContain(
      "Pay-application money must be safe exact cents with a nonnegative revised contract",
    );
  });

  it("locks cumulative billing capacity and prevents impossible retainage", () => {
    expect(migration).toMatch(/retainage <= amount_billed/i);
    expect(migration).toMatch(/v_retainage > v_amount_billed/i);
    expect(migration).toMatch(
      /create_billing_application_atomic[\s\S]*from public\.projects[\s\S]*for update[\s\S]*v_cumulative_billed \+ v_amount_billed > v_contract_amount \+ v_change_order_amount/i,
    );
    expect(migration).toMatch(
      /update_billing_application_atomic[\s\S]*application\.id <> p_billing_application_id[\s\S]*v_cumulative_billed \+ v_amount_billed > v_contract_amount \+ v_change_order_amount/i,
    );
    expect(migration).toMatch(
      /transition_billing_application_atomic[\s\S]*v_to_status = 'submitted'[\s\S]*v_cumulative_billed > v_contract_amount \+ v_change_order_amount/i,
    );
    expect(migration).toContain("Cumulative pay applications cannot exceed the revised contract.");
  });

  it("deduplicates commands and rejects cross-payload key reuse", () => {
    expect(migration).toMatch(
      /constraint billing_application_commands_project_key_unique[\s\S]*unique \(project_id, idempotency_key\)/i,
    );
    expect(migration).toMatch(/idempotency_fingerprint is distinct from v_fingerprint/i);
    expect(migration).toContain(
      "This billing command idempotency key was already used for different details.",
    );
    expect(migration).toMatch(/jsonb_set\(v_existing\.result, '\{deduplicated\}'/i);
    expect(migration).toMatch(
      /transition_billing_application_atomic[\s\S]*v_existing\.billing_application_id is distinct from p_billing_application_id[\s\S]*v_existing\.idempotency_fingerprint is distinct from v_fingerprint/i,
    );
  });

  it("prevents lifecycle reversal and keeps transitions with their event", () => {
    expect(migration).toMatch(
      /v_application\.status = 'draft' and v_to_status in \('submitted', 'rejected'\)/i,
    );
    expect(migration).toMatch(/v_application\.status = 'submitted' and v_to_status = 'rejected'/i);
    expect(migration).toMatch(/v_application\.status = 'rejected' and v_to_status = 'draft'/i);
    expect(migration).not.toMatch(/v_application\.status = 'submitted' and v_to_status = 'draft'/i);
    expect(migration).toMatch(
      /transition_billing_application_atomic[\s\S]*update public\.billing_applications[\s\S]*insert into public\.billing_application_events[\s\S]*insert into public\.billing_application_commands/i,
    );
  });

  it("deletes only administrative draft history and preserves a retry tombstone", () => {
    expect(migration).toMatch(/event\.event_type not in \('created', 'draft_updated'\)/i);
    expect(migration).toMatch(/from public\.billing_invoices invoice/i);
    expect(migration).toMatch(/from public\.payment_ledger ledger/i);
    expect(migration).toMatch(/from public\.production_sov_billing_handoffs handoff/i);
    expect(migration).toMatch(
      /insert into public\.billing_application_commands[\s\S]*delete from public\.billing_application_events[\s\S]*delete from public\.billing_applications/i,
    );
    expect(migration).toContain("'deletedSnapshot', to_jsonb(v_application)");
  });

  it("makes lifecycle events scoped and immutable", () => {
    expect(migration).toContain("Billing application event scope must match its pay application.");
    expect(migration).toContain("Billing application events are immutable audit records.");
    expect(migration).toMatch(
      /revoke insert, update, delete on public\.billing_application_events from authenticated/i,
    );
    expect(migration).toMatch(
      /create trigger billing_application_events_enforce_integrity[\s\S]*before insert or update or delete/i,
    );
  });
});
