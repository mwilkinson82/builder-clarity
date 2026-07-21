import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src/lib/projects.functions.ts"), "utf8");
const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260720152709_project_financial_integrity_atomicity.sql",
  ),
  "utf8",
);
const billingLineMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260720152500_billing_line_item_atomicity.sql"),
  "utf8",
);
const billingWorkspace = readFileSync(
  join(process.cwd(), "src/components/project/billing/BillingWorkspace.tsx"),
  "utf8",
);
const payAppEditor = readFileSync(
  join(process.cwd(), "src/components/project/billing/BillingApplicationRowEditor.tsx"),
  "utf8",
);
const invoiceEditor = readFileSync(
  join(process.cwd(), "src/components/project/billing/BillingInvoiceRowEditor.tsx"),
  "utf8",
);

function sourceBlock(start: string, end: string) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  expect(startAt, `missing source marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endAt, `missing source marker: ${end}`).toBeGreaterThan(startAt);
  return source.slice(startAt, endAt);
}

describe("project financial rollup integrity", () => {
  it("fails closed when any authoritative project-cost query fails", () => {
    const portfolio = sourceBlock("export const listProjects", "export const getProject");
    expect(portfolio).toContain("Financial rollup could not load");
    expect(portfolio).not.toContain("const subDegrade");

    const project = sourceBlock("export const getProject", "// ---------------- PROJECT CRUD");
    const subRowsStart = project.indexOf("const subRows");
    const subRows = project.slice(subRowsStart, project.indexOf("const [", subRowsStart));
    expect(subRows).toMatch(/if \(error\)[\s\S]*throw new Error/);
    expect(subRows).not.toMatch(/if \(error\) return \[\]/);
  });
});

describe("manual invoice-payment retry integrity", () => {
  it("uses one atomic RPC instead of a sequence of REST writes", () => {
    const recordPayment = sourceBlock(
      "export const recordInvoicePayment",
      "export const reconcileInvoicePayments",
    );
    expect(recordPayment).toContain('"record_invoice_payment_atomic"');
    expect(source).toMatch(/idempotency_key: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(200\),/);
    expect(source).not.toContain("invoicePaymentIdempotencyKey");
    expect(recordPayment).toContain("p_idempotency_key: data.idempotency_key");
    expect(recordPayment).not.toMatch(/dynamicTable\([^)]*, "payment_ledger"\)[\s\S]*\.insert\(/);

    expect(migration).toMatch(/select \*[\s\S]*from public\.billing_invoices[\s\S]*for update/i);
    expect(migration).toMatch(/insert into public\.payment_ledger/i);
    expect(migration).toMatch(/update public\.billing_invoices/i);
    expect(migration).toMatch(/update public\.billing_applications/i);
    expect(migration).toMatch(/insert into public\.billing_application_events/i);
  });

  it("deduplicates a lost-response retry and refuses key reuse with different money", () => {
    expect(migration).toMatch(
      /create unique index if not exists payment_ledger_invoice_idempotency_unique[\s\S]*\(invoice_id, idempotency_key\)/i,
    );
    expect(migration).toMatch(/on conflict \(invoice_id, idempotency_key\)[\s\S]*do nothing/i);
    expect(migration).toMatch(/if not v_inserted then[\s\S]*v_existing\.amount_cents/i);
    expect(migration).toContain(
      "This payment idempotency key was already used for different payment details.",
    );
    expect(migration).toMatch(/v_existing\.paid_at is distinct from p_paid_at/i);
    expect(migration).toContain("Payment fees cannot exceed the payment amount.");
    expect(migration).toMatch(/if v_inserted then[\s\S]*billing_application_events/i);
    expect(migration).toMatch(/'deduplicated', not v_inserted/i);
  });

  it("fails the whole transaction when an invoice, pay-app, or lifecycle update fails", () => {
    expect(migration).toMatch(/language plpgsql[\s\S]*security invoker/i);
    expect(migration).not.toMatch(/exception\s+when[\s\S]*billing_application_events/i);
    expect(migration).not.toMatch(/record_invoice_payment_atomic[\s\S]*return null/i);
  });
});

describe("payment ledger authority", () => {
  it("rejects hand-entered paid totals and payment-derived statuses at the server boundary", () => {
    expect(source).toContain(
      "Payments received and paid status are ledger-controlled. Record or reconcile the linked invoice payment instead.",
    );
    expect(source).toContain(
      "Paid amount and paid status are ledger-controlled. Record or reconcile a payment instead.",
    );
    expect(source).toContain(
      "Invoices are created as hidden, cash-free drafts. Send the saved invoice through the audited send command.",
    );
  });

  it("renders paid totals read-only and identifies paid/partial states as payment-derived", () => {
    expect(payAppEditor).not.toMatch(/onValueChange=\{\(paid_to_date\)/);
    expect(invoiceEditor).not.toMatch(/onPatch\(\{ paid_amount/);
    expect(payAppEditor).toContain("Partial · from payments");
    expect(invoiceEditor).toContain(
      '<LedgerDetail label="Status" value={invoiceStatusLabel(invoice.status)} />',
    );
    expect(billingWorkspace).not.toMatch(/onValueChange=\{\(paid_to_date\)/);
    expect(billingWorkspace).not.toMatch(/onValueChange=\{\(paid_amount\)/);
    expect(billingWorkspace).toContain("Your entries are still here; correct the issue or retry.");
  });
});

describe("change-order allocation concurrency integrity", () => {
  it("requires Approved status and enforces both cumulative caps in the database", () => {
    expect(migration).toContain("Only an approved change order can be allocated.");
    expect(migration).toMatch(
      /validate_change_order_allocation_integrity[\s\S]*from public\.change_orders[\s\S]*for update/i,
    );
    expect(migration).toMatch(
      /from public\.change_order_allocations[\s\S]*where change_order_id = new\.change_order_id/i,
    );
    expect(migration).toMatch(/sum\(abs\(round\(contract_amount \* 100\)::bigint\)\)/i);
    expect(migration).toMatch(/sum\(abs\(round\(cost_amount \* 100\)::bigint\)\)/i);
    expect(migration).toMatch(
      /v_existing_contract_cents \+ abs\(v_new_contract_cents\) > v_contract_cap_cents/i,
    );
    expect(migration).toMatch(
      /v_existing_cost_cents \+ abs\(v_new_cost_cents\) > v_cost_cap_cents/i,
    );
  });

  it("protects direct REST inserts and updates, not only the application RPC", () => {
    expect(migration).toMatch(
      /create trigger change_order_allocations_validate_integrity[\s\S]*before insert or update[\s\S]*validate_change_order_allocation_integrity/i,
    );

    const allocate = sourceBlock(
      "export const allocateChangeOrder",
      "export const deleteChangeOrderAllocation",
    );
    expect(allocate).toContain('"allocate_change_order_atomic"');
    expect(allocate).toMatch(/p_contract_amount_cents: Math\.abs/);
    expect(allocate).toContain("p_idempotency_key: data.idempotencyKey");
    expect(migration).toMatch(/v_sign := -1/);
    expect(allocate).not.toMatch(/change_order_allocations"\)\.insert/);
    expect(migration).toMatch(
      /revoke all on function public\.validate_change_order_allocation_integrity\(\)[\s\S]*from service_role/i,
    );
    expect(migration).toMatch(
      /grant execute on function public\.allocate_change_order_atomic\([\s\S]*to authenticated, service_role/i,
    );
    expect(migration).toMatch(
      /allocate_change_order_atomic\([\s\S]*language plpgsql[\s\S]*security definer/i,
    );
    expect(migration).toMatch(
      /revoke insert, update, delete on public\.change_order_allocations[\s\S]*from authenticated, service_role/i,
    );
  });

  it("removes only uncaptured allocations through an authorized atomic command", () => {
    const remove = sourceBlock(
      "export const deleteChangeOrderAllocation",
      "export interface ChangeOrderAllocationListRow",
    );
    expect(remove).toContain('"delete_change_order_allocation_atomic"');
    expect(remove).not.toMatch(/change_order_allocations"\)\.delete/);
    expect(migration).toMatch(
      /create or replace function public\.delete_change_order_allocation_atomic\([\s\S]*security definer/i,
    );
    expect(migration).toContain(
      "This allocation is already part of a billing snapshot and cannot be removed.",
    );
    expect(migration).toMatch(
      /create trigger change_order_allocations_protect_authority[\s\S]*before insert or update or delete/i,
    );
    expect(migration).toMatch(
      /v_atomic_write text := coalesce\([\s\S]*current_setting\('overwatch\.change_order_allocation_write', true\)[\s\S]*''[\s\S]*\)/i,
    );
  });

  it("deduplicates an ambiguous allocation retry and rejects key reuse for another payload", () => {
    expect(migration).toMatch(
      /change_order_allocations_co_idempotency_unique[\s\S]*\(change_order_id, idempotency_key\)/i,
    );
    expect(migration).toMatch(
      /v_existing\.idempotency_fingerprint is distinct from v_idempotency_fingerprint/i,
    );
    expect(migration).toContain(
      "This allocation idempotency key was already used for different details.",
    );
    expect(migration).toMatch(/'deduplicated', true/i);
    expect(migration).toMatch(/'deduplicated', false/i);
  });

  it("prevents an allocated change order from being de-approved or reduced below its allocations", () => {
    expect(migration).toMatch(
      /create trigger change_orders_validate_allocated_update[\s\S]*before update of status, financial_direction, contract_amount, cost_amount[\s\S]*validate_allocated_change_order_update/i,
    );
    expect(migration).toContain(
      "Remove this change order from billing before changing it from Approved.",
    );
    expect(migration).toContain(
      "The change-order contract value cannot be reduced below its allocated amount.",
    );
    expect(migration).toContain(
      "The change-order cost value cannot be reduced below its allocated amount.",
    );
    expect(migration).toContain(
      "An allocated change order is a financial record and cannot be deleted.",
    );
  });

  it("rejects fractional-cent change orders and allocations at both boundaries", () => {
    expect(migration).toContain("Change-order contract and cost values must be exact to the cent.");
    expect(migration).toContain("Allocation contract and cost values must be exact to the cent.");
    expect(migration).toMatch(
      /create trigger change_orders_validate_money_precision[\s\S]*before insert or update of contract_amount, cost_amount/i,
    );
    expect(source).toContain("Enter an amount with no more than two decimal places.");
  });
});

describe("billing snapshot authority", () => {
  it("captures approved change-order allocation provenance immutably", () => {
    expect(billingLineMigration).toMatch(
      /create table if not exists public\.billing_line_change_order_allocations/i,
    );
    expect(billingLineMigration).toMatch(
      /insert into public\.billing_line_change_order_allocations[\s\S]*from public\.billing_line_items line[\s\S]*join public\.change_order_allocations allocation/i,
    );
    expect(billingLineMigration).toMatch(
      /revoke all on public\.billing_line_change_order_allocations[\s\S]*from public, anon, authenticated, service_role/i,
    );
    expect(billingLineMigration).toMatch(
      /create trigger billing_line_co_allocations_protect_provenance[\s\S]*before insert or update or delete/i,
    );
    expect(billingLineMigration).toMatch(
      /coalesce\([\s\S]*current_setting\('overwatch\.billing_line_authoritative_write', true\)[\s\S]*''[\s\S]*\) <> 'generating'/i,
    );
  });

  it("rejects incomplete retries and overbilling against remaining line capacity", () => {
    expect(billingLineMigration).toContain(
      "The existing billing snapshot is incomplete and cannot be treated as a successful generation retry.",
    );
    expect(billingLineMigration).toContain(
      "Billing amount exceeds the remaining contract capacity or prior certified values exceed a line contract.",
    );
    expect(billingLineMigration).toMatch(
      /work_completed_previous_cents::numeric[\s\S]*materials_stored_this_period_cents::numeric[\s\S]*<=[\s\S]*scheduled_value_cents::numeric \+ change_order_value_cents::numeric/i,
    );
    expect(billingLineMigration).toMatch(
      /billing_snapshot_bucket_count[\s\S]*v_expected_snapshot_count[\s\S]*v_existing_distinct_bucket_count <> v_expected_snapshot_count/i,
    );
    expect(billingLineMigration).not.toMatch(/if v_existing_count <> v_bucket_count/i);
  });

  it("derives prior certified values only from submitted financial history", () => {
    expect(billingLineMigration).toMatch(/prior\.status in \('submitted', 'partial', 'paid'\)/i);
  });

  it("allows draft cleanup but preserves submitted and certified applications", () => {
    expect(billingLineMigration).toContain(
      "Only a draft pay application without certification history can be deleted.",
    );
    expect(billingLineMigration).toMatch(
      /create trigger billing_applications_guard_line_integrity_delete[\s\S]*before delete on public\.billing_applications/i,
    );
  });

  it("seeds demo billing through the same authoritative generator and mutation commands", () => {
    const demoBilling = sourceBlock(
      "const seedHarborDemoBillingProgress",
      "const resetHarborDemoBillingWorkspace",
    );
    expect(demoBilling).toContain('"generate_billing_line_items_atomic"');
    expect(demoBilling).toContain('"apply_billing_line_item_mutations_atomic"');
    expect(demoBilling).not.toMatch(/billing_line_items"\)\.insert/);
    expect(demoBilling).not.toMatch(/billing_line_items"\)\.update/);
  });
});
