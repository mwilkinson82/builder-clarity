import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { eligibleReconcileInvoices } from "../src/components/billing/StripeReconciliationPanel";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260720160258_payment_ledger_rollup_integrity.sql"),
  "utf8",
);
const commandMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260720162205_payment_command_integrity.sql"),
  "utf8",
);
const stripeMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260720162756_stripe_payment_command_integrity.sql"),
  "utf8",
);
const refundMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260720163752_payment_refund_audit_integrity.sql"),
  "utf8",
);
const feeEconomicsMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260720164836_stripe_fee_economics_integrity.sql"),
  "utf8",
);
const paymentsFunctions = readFileSync(
  join(process.cwd(), "src/lib/payments.functions.ts"),
  "utf8",
);
const reconciliationPanel = readFileSync(
  join(process.cwd(), "src/components/billing/StripeReconciliationPanel.tsx"),
  "utf8",
);

describe("payment-ledger database authority", () => {
  it("reconciles every direct ledger mutation at statement scope", () => {
    expect(migration).toMatch(
      /after insert on public\.payment_ledger[\s\S]*referencing new table as new_rows[\s\S]*for each statement/i,
    );
    expect(migration).toMatch(
      /after update on public\.payment_ledger[\s\S]*referencing old table as old_rows new table as new_rows[\s\S]*for each statement/i,
    );
    expect(migration).toMatch(
      /after delete on public\.payment_ledger[\s\S]*referencing old table as old_rows[\s\S]*for each statement/i,
    );
    expect(migration).toMatch(
      /from public\.billing_invoices invoice[\s\S]*order by invoice\.id[\s\S]*for update/i,
    );
    expect(migration).toMatch(
      /from public\.billing_applications application[\s\S]*order by application\.id[\s\S]*for update/i,
    );
    expect(migration).toMatch(/when ledger\.status = 'succeeded'[\s\S]*ledger\.amount_cents/i);
    expect(migration).toMatch(/update public\.billing_invoices[\s\S]*paid_amount = v_paid_cents/i);
    expect(migration).toMatch(
      /update public\.billing_applications[\s\S]*paid_to_date = v_paid_cents/i,
    );
  });

  it("validates every denormalized payment parent and normalizes exact cents", () => {
    expect(migration).toMatch(
      /before insert or update of invoice_id, project_id, billing_application_id,[\s\S]*organization_id, amount, amount_cents, status/i,
    );
    for (const message of [
      "Payment project must match the invoice project.",
      "Payment pay application must match the invoice pay application.",
      "Payment organization must match the invoice project organization.",
      "A succeeded payment must have a positive integer-cent amount.",
    ]) {
      expect(migration).toContain(message);
    }
    expect(migration).toMatch(/new\.amount_cents := v_amount_cents/i);
    expect(migration).toMatch(/new\.amount := v_amount_cents::numeric \/ 100\.0/i);
  });

  it("preflights and enforces both active-invoice uniqueness rules", () => {
    expect(migration).toContain("Cannot enforce one active invoice per pay application");
    expect(migration).toContain("Cannot enforce unique active invoice numbers");
    expect(migration).toMatch(
      /create unique index if not exists billing_invoices_one_active_per_application_unique[\s\S]*where billing_application_id is not null[\s\S]*status <> 'void'/i,
    );
    expect(migration).toMatch(
      /create unique index if not exists billing_invoices_active_number_per_project_unique[\s\S]*project_id, lower\(btrim\(invoice_number\)\)[\s\S]*status <> 'void'/i,
    );
  });

  it("preflights unsafe legacy cash and repairs every existing rollup", () => {
    expect(migration).toContain(
      "does not match its invoice, project, pay application, and organization",
    );
    expect(migration).toContain("has succeeded cash that cannot be reconciled safely");
    expect(migration).toMatch(
      /select public\.reconcile_invoice_payment_rollups\([\s\S]*array_agg\(invoice\.id order by invoice\.id\)[\s\S]*array_agg\(application\.id order by application\.id\)/i,
    );
    expect(commandMigration).toContain("paid cash above total due");
  });

  it("guards invoice and pay-app derived fields without blocking ordinary lifecycle states", () => {
    expect(migration).toMatch(
      /before update of paid_amount, status, paid_at, total_due on public\.billing_invoices/i,
    );
    expect(migration).toMatch(
      /before update of paid_to_date, status on public\.billing_applications/i,
    );
    expect(migration).toContain("An invoice with succeeded payment cash cannot be voided.");
    expect(migration).toContain(
      "Invoice paid status must come from succeeded payment ledger entries.",
    );
    expect(migration).toContain(
      "Pay-application paid status must come from succeeded payment ledger entries.",
    );
    expect(migration).toMatch(/new\.status in \('draft', 'sent', 'viewed', 'overdue'\)/i);
    expect(migration).toMatch(
      /current_setting\('overwatch\.payment_rollup_mode', true\) in \('deferred', 'reconciling'\)/i,
    );
  });

  it("keeps trigger helpers private and exposes one authorized repair RPC", () => {
    for (const fn of [
      "tg_validate_payment_ledger_scope",
      "tg_reconcile_payment_ledger_statement",
      "tg_guard_billing_invoice_payment_rollup",
      "tg_guard_billing_application_payment_rollup",
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `revoke all on function public\\.${fn}\\(\\) from public, anon, authenticated, service_role`,
          "i",
        ),
      );
    }
    expect(migration).toMatch(
      /create or replace function public\.reconcile_invoice_payment_rollup\(p_invoice_id uuid\)[\s\S]*returns jsonb[\s\S]*public\.can_manage_project/i,
    );
    expect(migration).toMatch(
      /grant execute on function public\.reconcile_invoice_payment_rollup\(uuid\)[\s\S]*to authenticated, service_role/i,
    );
  });
});

describe("controlled payment commands", () => {
  it("enforces exact cents across gross, fees, net payout, and invoice totals", () => {
    expect(commandMigration).toMatch(
      /payment_ledger_exact_cents_check[\s\S]*gross_received_cents = amount_cents \+ surcharge_cents[\s\S]*net_payout_cents = gross_received_cents - processor_fee_cents - overwatch_fee_cents[\s\S]*refunded_gross_cents = refunded_amount_cents \+ refunded_surcharge_cents[\s\S]*net_payout = net_payout_cents::numeric \/ 100\.0/i,
    );
    expect(commandMigration).toMatch(
      /billing_invoices_exact_cents_check[\s\S]*subtotal = round\(subtotal, 2\)[\s\S]*paid_amount = round\(paid_amount, 2\)[\s\S]*paid_amount <= total_due/i,
    );
    expect(commandMigration).toMatch(
      /new\.processor_fee_cents := v_processor_fee_cents[\s\S]*new\.net_payout_cents := v_gross_received_cents - v_processor_fee_cents - v_overwatch_fee_cents/i,
    );
  });

  it("makes ownership and processor provenance immutable and deletes impossible", () => {
    expect(commandMigration).toContain("Payment ledger history cannot be deleted.");
    for (const column of [
      "project_id",
      "invoice_id",
      "billing_application_id",
      "organization_id",
      "processor",
      "payment_method",
      "processor_payment_id",
      "currency",
      "reference",
      "paid_at",
      "idempotency_key",
      "created_by",
      "stripe_checkout_session_id",
      "stripe_payment_intent_id",
    ]) {
      expect(commandMigration).toMatch(
        new RegExp(`new\\.${column} is distinct from old\\.${column}`, "i"),
      );
    }
    expect(commandMigration).toContain(
      "Stripe payment money can change only through a controlled payment command.",
    );
    expect(commandMigration).toContain(
      "Stripe refunds must use the parent-first refund payment command.",
    );
    expect(commandMigration).toMatch(
      /revoke insert, update, delete on public\.payment_ledger from authenticated/i,
    );
    expect(stripeMigration).toMatch(
      /revoke insert, update, delete on public\.payment_ledger from service_role/i,
    );
  });

  it("keeps invoice, pay-application, and payment parentage coherent", () => {
    expect(commandMigration).toContain(
      "Invoice pay application must belong to the invoice project.",
    );
    expect(commandMigration).toContain(
      "An invoice with payment history cannot move to another project or pay application.",
    );
    expect(commandMigration).toContain("An invoice with payment history cannot be deleted.");
    expect(commandMigration).toContain("A pay application with invoice history cannot be deleted.");
  });

  it("defers generic rollups while the original atomic RPC owns its lifecycle event", () => {
    expect(commandMigration).toMatch(
      /rename to record_invoice_payment_atomic_internal[\s\S]*set_config\('overwatch\.payment_rollup_mode', 'deferred', true\)[\s\S]*record_invoice_payment_atomic_internal/i,
    );
    expect(commandMigration).toMatch(
      /revoke all on function public\.record_invoice_payment_atomic_internal\([\s\S]*from public, anon, authenticated, service_role/i,
    );
  });

  it("locks parents before ledger rows for refund and void commands", () => {
    const refundBody = refundMigration.slice(
      refundMigration.indexOf("function public.refund_invoice_payment_atomic"),
    );
    expect(refundBody).toMatch(
      /from public\.billing_invoices invoice where invoice\.id = v_invoice_id for update[\s\S]*from public\.payment_ledger ledger where ledger\.id = p_payment_id for update/i,
    );

    const voidBody = commandMigration.slice(
      commandMigration.indexOf("function public.void_invoice_payment_atomic"),
    );
    expect(voidBody).toMatch(
      /from public\.billing_invoices invoice where invoice\.id = v_invoice_id for update[\s\S]*from public\.payment_ledger ledger[\s\S]*for update/i,
    );
  });

  it("books Stripe cash through one service-only, parent-first, retry-safe command", () => {
    expect(feeEconomicsMigration).toMatch(
      /create or replace function public\.record_stripe_invoice_payment_atomic\([\s\S]*security definer/i,
    );
    expect(feeEconomicsMigration).toMatch(
      /from public\.billing_invoices invoice[\s\S]*for update[\s\S]*insert into public\.payment_ledger/i,
    );
    expect(feeEconomicsMigration).toMatch(
      /stripe_checkout_session_id[\s\S]*stripe_payment_intent_id[\s\S]*processor_payment_id[\s\S]*stripe_balance_transaction_id/i,
    );
    expect(feeEconomicsMigration).toMatch(
      /grant execute on function public\.record_stripe_invoice_payment_atomic\([\s\S]*to service_role/i,
    );
    expect(stripeMigration).toMatch(
      /payment_ledger_stripe_checkout_session_unique[\s\S]*payment_ledger_stripe_payment_intent_unique/i,
    );
    expect(feeEconomicsMigration).toContain("Stripe payment would exceed the invoice total due.");
  });

  it("requires actual Stripe balance-transaction economics and labels provenance", () => {
    expect(feeEconomicsMigration).toMatch(
      /disable trigger payment_ledger_guard_history[\s\S]*update public\.payment_ledger[\s\S]*enable trigger payment_ledger_guard_history/i,
    );
    expect(feeEconomicsMigration).toMatch(
      /p_stripe_balance_transaction_id text[\s\S]*p_balance_transaction_gross_cents bigint[\s\S]*p_balance_transaction_fee_cents bigint[\s\S]*p_balance_transaction_net_cents bigint[\s\S]*p_balance_transaction_currency text/i,
    );
    expect(feeEconomicsMigration).toMatch(
      /p_balance_transaction_gross_cents <> p_gross_received_cents[\s\S]*p_balance_transaction_net_cents[\s\S]*p_balance_transaction_gross_cents - p_balance_transaction_fee_cents[\s\S]*lower\(btrim\(coalesce\(p_balance_transaction_currency, ''\)\)\) <> 'usd'/i,
    );
    expect(feeEconomicsMigration).toMatch(
      /v_processor_fee_cents := p_balance_transaction_fee_cents - p_overwatch_fee_cents/i,
    );
    expect(feeEconomicsMigration).toContain(
      "A Stripe payment requires verified balance-transaction fee evidence.",
    );
    expect(feeEconomicsMigration).toMatch(
      /processor_fee_source[\s\S]*stripe_balance_transaction_id[\s\S]*processor_fee_observed_at/i,
    );
    expect(feeEconomicsMigration).toContain(
      "Net receipt to the connected Stripe balance (gross less all Stripe and application fees), not a bank payout.",
    );
  });

  it("preserves original receipts and appends exact immutable refund deltas", () => {
    expect(refundMigration).toMatch(
      /create table if not exists public\.payment_refund_events[\s\S]*refund_gross_cents = refund_amount_cents \+ refund_surcharge_cents/i,
    );
    expect(refundMigration).toContain(
      "Payment refund events are immutable and cannot be updated or deleted.",
    );
    expect(refundMigration).toMatch(
      /sum\(ledger\.amount_cents - ledger\.refunded_amount_cents\)[\s\S]*ledger\.status in \('succeeded', 'refunded'\)/i,
    );
    expect(refundMigration).toContain(
      "Invoice total due cannot be reduced below applied payment cash.",
    );
    const refundBody = refundMigration.slice(
      refundMigration.indexOf("function public.refund_invoice_payment_atomic"),
    );
    expect(refundBody).toMatch(/insert into public\.payment_refund_events/i);
    expect(refundBody).not.toMatch(/set amount_cents\s*=/i);
    expect(refundBody).not.toMatch(/set gross_received_cents\s*=/i);
  });

  it("prevents authenticated and service callers from forging processor cash", () => {
    expect(refundMigration).toContain(
      "Authenticated payment recording cannot claim processor provenance.",
    );
    expect(refundMigration).toContain(
      "Stripe receipt refunds require the service-role webhook command.",
    );
    expect(refundMigration).toContain("The Stripe webhook command cannot refund a manual receipt.");
    expect(commandMigration).toMatch(
      /revoke insert, update, delete on public\.payment_ledger from authenticated/i,
    );
    expect(feeEconomicsMigration).toMatch(
      /revoke insert, update, delete on public\.payment_ledger from service_role/i,
    );
  });
});

describe("Stripe reconciliation command boundary", () => {
  it("offers only invoices that can absorb the charge's net A/R effect", () => {
    const invoices = [
      { id: "closed", projectName: "Closed", label: "INV-1", openBalance: 0 },
      { id: "partial", projectName: "Partial", label: "INV-2", openBalance: 60 },
      { id: "open", projectName: "Open", label: "INV-3", openBalance: 100 },
    ];

    expect(eligibleReconcileInvoices({ netAppliedAmountCents: 10_000 }, invoices)).toEqual([
      invoices[2],
    ]);
    expect(eligibleReconcileInvoices({ netAppliedAmountCents: 6_000 }, invoices)).toEqual([
      invoices[1],
      invoices[2],
    ]);
    expect(eligibleReconcileInvoices({ netAppliedAmountCents: 0 }, invoices)).toEqual(invoices);
  });

  it("never lets the browser relabel a manual receipt as Stripe cash", () => {
    expect(reconciliationPanel).toContain("recordUnmatchedStripePayment");
    expect(reconciliationPanel).not.toContain("recordInvoicePayment");
    expect(reconciliationPanel).toMatch(
      /recordPayment\(\{[\s\S]*invoiceId,[\s\S]*stripeChargeId: payment\.stripeChargeId/i,
    );
  });

  it("re-reads connected-account evidence and recovers refunded orphan charges atomically", () => {
    const commandBody = paymentsFunctions.slice(
      paymentsFunctions.indexOf("export const recordUnmatchedStripePayment"),
    );
    expect(paymentsFunctions).toMatch(/listAllConnectedStripeCharges[\s\S]*has_more/i);
    expect(commandBody).toMatch(
      /requireBillingOrSettingsCapability[\s\S]*loadOrganizationStripe[\s\S]*charges\/\$\{encodeURIComponent\(data\.stripeChargeId\)\}/i,
    );
    expect(commandBody).toMatch(
      /payment_intents\/\$\{encodeURIComponent\(paymentIntentId\)\}[\s\S]*balance_transactions\/\$\{encodeURIComponent\(balanceTransaction\)\}/i,
    );
    expect(commandBody).toMatch(
      /p_cumulative_refunded_gross_cents:[\s\S]*p_refund_processor_event_id:[\s\S]*p_refund_idempotency_key:/i,
    );
    expect(commandBody).toMatch(
      /dynamicRpc\([\s\S]*record_stripe_invoice_payment_atomic[\s\S]*p_stripe_balance_transaction_id[\s\S]*p_overwatch_fee_cents/i,
    );
  });
});

describe("rollback and retry model", () => {
  type Invoice = { paidCents: number; status: string };
  type PayApp = { paidCents: number; status: string };
  type State = {
    ledger: Array<{ cents: number; refundedCents: number; status: string }>;
    invoice: Invoice;
    application: PayApp;
  };

  const reconcile = (state: State) => {
    const paidCents = state.ledger.reduce(
      (sum, row) =>
        row.status === "succeeded" || row.status === "refunded"
          ? sum + row.cents - row.refundedCents
          : sum,
      0,
    );
    state.invoice = {
      paidCents,
      status: paidCents >= 10_000 ? "paid" : paidCents > 0 ? "partially_paid" : "sent",
    };
    state.application = {
      paidCents,
      status: paidCents >= 10_000 ? "paid" : paidCents > 0 ? "partial" : "submitted",
    };
  };

  const transaction = (state: State, operation: () => void) => {
    const before = structuredClone(state);
    try {
      operation();
    } catch (error) {
      state.ledger = before.ledger;
      state.invoice = before.invoice;
      state.application = before.application;
      throw error;
    }
  };

  it("rolls ledger and both parent rollups back if any parent update fails", () => {
    const state: State = {
      ledger: [],
      invoice: { paidCents: 0, status: "sent" },
      application: { paidCents: 0, status: "submitted" },
    };
    expect(() =>
      transaction(state, () => {
        state.ledger.push({ cents: 10_000, refundedCents: 0, status: "succeeded" });
        reconcile(state);
        throw new Error("simulated pay-app write failure");
      }),
    ).toThrow("simulated pay-app write failure");
    expect(state).toEqual({
      ledger: [],
      invoice: { paidCents: 0, status: "sent" },
      application: { paidCents: 0, status: "submitted" },
    });
  });

  it("a refund retry derives the same exact-cent truth", () => {
    const state: State = {
      ledger: [{ cents: 10_000, refundedCents: 0, status: "succeeded" }],
      invoice: { paidCents: 10_000, status: "paid" },
      application: { paidCents: 10_000, status: "paid" },
    };
    transaction(state, () => {
      state.ledger[0] = { cents: 10_000, refundedCents: 10_000, status: "refunded" };
      reconcile(state);
    });
    const afterFirst = structuredClone(state);
    transaction(state, () => reconcile(state));
    expect(state).toEqual(afterFirst);
    expect(state.invoice).toEqual({ paidCents: 0, status: "sent" });
    expect(state.application).toEqual({ paidCents: 0, status: "submitted" });
  });
});
