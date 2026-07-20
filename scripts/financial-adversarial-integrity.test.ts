import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const billingLines = read("supabase/migrations/20260720152500_billing_line_item_atomicity.sql");
const refunds = read("supabase/migrations/20260720163752_payment_refund_audit_integrity.sql");
const stripeEconomics = read(
  "supabase/migrations/20260720164836_stripe_fee_economics_integrity.sql",
);
const payApplications = read(
  "supabase/migrations/20260720170500_billing_application_command_integrity.sql",
);
const costActuals = read("supabase/migrations/20260720172000_cost_actual_command_integrity.sql");
const invoices = read("supabase/migrations/20260720174000_invoice_command_integrity.sql");
const billingServer = read("src/lib/billing.functions.ts");
const paymentServer = read("src/lib/payments.functions.ts");
const checkout = read("src/routes/api/stripe/checkout/invoice.ts");
const webhook = read("src/routes/api/stripe/webhook.ts");
const projectServer = read("src/lib/projects.functions.ts");

function sourceFiles(root: string): string[] {
  return readdirSync(join(process.cwd(), root), { withFileTypes: true }).flatMap((entry) => {
    const relative = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative);
    return /\.(?:ts|tsx|js|mjs)$/.test(entry.name) ? [relative] : [];
  });
}

function directRelationMutations(source: string, relation: string) {
  const starts = [
    ...source.matchAll(
      new RegExp(
        `(?:\\.from|dynamicTable)\\s*\\(\\s*(?:[^,;]+,\\s*)?["']${relation}["']\\s*\\)`,
        "g",
      ),
    ),
  ];
  return starts.flatMap((match) => {
    const statement = source.slice(match.index, source.indexOf(";", match.index) + 1);
    return /\.(?:insert|update|delete|upsert)\s*\(/.test(statement) ? [statement] : [];
  });
}

function sqlFunction(source: string, name: string) {
  const start = source.search(
    new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, "i"),
  );
  expect(start, `missing SQL function ${name}`).toBeGreaterThanOrEqual(0);
  const tail = source.slice(start + 1);
  const next = tail.search(/\ncreate\s+or\s+replace\s+function\s+public\./i);
  return source.slice(start, next < 0 ? undefined : start + 1 + next);
}

describe("adversarial financial command integrity", () => {
  it("makes line saves retry-safe and rejects stale browser versions", () => {
    const command = sqlFunction(billingLines, "apply_billing_line_item_mutations_atomic");

    expect(billingLines).toContain("billing_line_item_commands_project_key_unique");
    expect(billingLines).toContain("billing_line_item_commands_immutable");
    expect(command).toContain("p_operation_key text");
    expect(command).toContain("expected_updated_at");
    expect(command).toContain("v_line.updated_at is distinct from v_expected_updated_at");
    expect(command).toContain("errcode = '40001'");
    expect(command).toContain("request_fingerprint");
    expect(billingLines).toMatch(
      /revoke insert, update, delete on (?:table )?public\.billing_line_items\s+from authenticated, service_role/i,
    );
    expect(billingServer).toContain("p_operation_key: data.operation_key");
    expect(billingServer).toContain("expected_updated_at: data.expected_updated_at");
  });

  it("derives pay-application contract authority under the project lock", () => {
    for (const name of [
      "create_billing_application_atomic",
      "update_billing_application_atomic",
      "transition_billing_application_atomic",
    ]) {
      const command = sqlFunction(payApplications, name);
      expect(command).toContain("from public.projects project");
      expect(command).toContain("from public.change_orders change_order");
      expect(command).toContain("project.original_contract");
      expect(command).toContain("change_order.status = 'Approved'");
      expect(command).toContain("9007199254740991");
    }
    expect(payApplications).toContain(
      "A pay application with an issued invoice cannot be rejected",
    );
    expect(payApplications).toContain(
      "revoke insert, update, delete on public.billing_applications from authenticated, service_role",
    );
    for (const command of [
      "create_billing_application_atomic(uuid, jsonb, text)",
      "update_billing_application_atomic(uuid, jsonb, text)",
      "transition_billing_application_atomic(uuid, text, text, text)",
      "delete_billing_application_draft_atomic(uuid, text)",
    ]) {
      expect(payApplications).toContain(
        `grant execute on function public.${command}\n  to authenticated;`,
      );
    }
    expect(payApplications).toContain(
      "project_id uuid not null references public.projects(id) on delete restrict",
    );
  });

  it("couples initial invoice issue to pay-app submission and records delivery evidence", () => {
    const transition = sqlFunction(invoices, "transition_billing_invoice_atomic");

    expect(transition).toContain("v_application.status = 'rejected'");
    expect(transition).toContain("public.transition_billing_application_atomic(");
    expect(transition).toContain(
      "Initial invoice issuance requires an authoritative submitted pay application",
    );
    expect(transition).toContain("v_delivery_mode in ('manual', 'external')");
    expect(transition).toContain("Email delivery requires at least one valid audited recipient");
    expect(invoices).toContain("billing_invoice_legacy_repairs");
    expect(invoices).toContain("grandfathered_existing_sent_at");
    expect(invoices).not.toContain("grandfathered@example");
  });

  it("gives service-role integrations only an audited processor-state command", () => {
    const processor = sqlFunction(invoices, "update_billing_invoice_processor_state_atomic");

    expect(invoices).toContain(
      "revoke insert, update, delete on public.billing_invoices from authenticated, service_role",
    );
    expect(invoices).toContain("billing_invoice_processor_commands_immutable");
    expect(processor).toContain("auth.jwt()->>'role'");
    expect(processor).toContain("request_fingerprint");
    expect(processor).toContain(
      "Processor paid state requires a committed matching payment receipt",
    );
    expect(checkout).toContain('"update_billing_invoice_processor_state_atomic"');
    expect(webhook).toContain('"update_billing_invoice_processor_state_atomic"');
    expect(paymentServer).toContain('"update_billing_invoice_processor_state_atomic"');
    expect(checkout).not.toMatch(/billing_invoices[\s\S]{0,250}\.update\(/);
    expect(invoices).toMatch(
      /revoke all on function public\.reconcile_invoice_payment_rollups\(uuid\[\], uuid\[\]\)[\s\S]*from public, anon, authenticated, service_role/i,
    );
    expect(invoices).toMatch(
      /alter function public\.reconcile_invoice_payment_rollup\(uuid\) security definer[\s\S]*grant execute on function public\.reconcile_invoice_payment_rollup\(uuid\)[\s\S]*to authenticated/i,
    );
  });

  it("has no application source caller that mutates invoices or pay applications directly", () => {
    const violations = sourceFiles("src").flatMap((file) => {
      const source = read(file);
      return ["billing_invoices", "billing_applications"].flatMap((relation) =>
        directRelationMutations(source, relation).map((statement) => ({
          file,
          relation,
          statement,
        })),
      );
    });

    expect(violations).toEqual([]);
    expect(projectServer).not.toContain("collections_log: z.string()");
  });

  it("fingerprints full payment and refund evidence and enforces safe cents", () => {
    const manual = sqlFunction(refunds, "record_invoice_payment_atomic");
    const refund = sqlFunction(refunds, "refund_invoice_payment_atomic");
    const stripe = sqlFunction(stripeEconomics, "record_stripe_invoice_payment_atomic");

    expect(manual).toContain("9007199254740991");
    expect(manual).toContain("v_existing.reference <> coalesce(p_reference, '')");
    expect(manual).toContain("v_existing.notes <> coalesce(p_notes, '')");
    expect(manual).toContain("v_existing.paid_at is distinct from p_paid_at");
    expect(manual).toContain("Only an issued, client-visible invoice can receive a payment");
    expect(refunds).toContain("request_fingerprint");
    expect(refund).toContain("p_stripe_charge_id");
    expect(refund).toContain("p_receipt_url");
    expect(refund).toContain("p_notes");
    expect(refunds).toContain(
      "when v_invoice.status in ('sent', 'viewed', 'overdue') then v_invoice.status",
    );
    expect(refunds).toContain("when v_invoice.first_viewed_at is not null then 'viewed'");
    expect(stripe).toContain("9007199254740991");
    expect(stripe).toContain("v_existing.reference <> coalesce(p_reference, '')");
    expect(stripe).toContain("v_existing.notes <> coalesce(p_notes, '')");
    expect(stripe).toContain("v_existing.paid_at is distinct from p_paid_at");
    expect(stripe).toContain("Only an issued, client-visible invoice can receive a Stripe payment");
  });

  it("uses stable source-row identity instead of mutable cost values", () => {
    const importer = sqlFunction(costActuals, "import_cost_actuals_atomic");
    const identityAt = importer.indexOf("v_source_id := 'source-row-v1:'");
    const fingerprintAt = importer.indexOf("v_row_hash := 'cost-v2:'");

    expect(identityAt).toBeGreaterThan(fingerprintAt);
    const identityBlock = importer.slice(identityAt, identityAt + 500);
    expect(identityBlock).toContain("source_external_id");
    expect(identityBlock).toContain("v_ordinality");
    expect(identityBlock).not.toContain("v_amount_cents");
    expect(importer).toContain("reuses a source identifier for different financial details");
    expect(billingServer).toContain("source_row_id");
    expect(billingServer).toContain("row.source_row_id ?? `row:${rowIndex + 1}`");
  });
});
