// Financial-integrity contract smoke. Node-runnable via
// `node --experimental-strip-types`. This checks the application wiring and
// migration invariants, then exercises failure, retry, and concurrency models
// for the two transaction boundaries introduced by the migration.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const subcontractSource = read("src/lib/subcontracts.functions.ts");
const estimateSource = read("src/lib/estimates.functions.ts");
const projectSource = read("src/lib/projects.functions.ts");
const migration = read(
  "supabase/migrations/20260720153030_financial_integrity_atomic_subcontract_and_estimate_import.sql",
);

// Application writes must have exactly one authoritative database boundary.
for (const rpc of [
  "record_subcontract_payment_atomic",
  "transition_subcontract_payment_atomic",
  "replace_subcontract_payment_allocations_atomic",
  "attach_lien_waiver_to_payment_atomic",
  "detach_lien_waiver_from_payment_atomic",
]) {
  assert.match(subcontractSource, new RegExp(`dynamicRpc\\([^)]*${rpc}`, "s"), `${rpc} is wired`);
}
assert.doesNotMatch(
  subcontractSource,
  /evaluateSubPaymentGate|evaluateSubApprovalGate|best-effort; the payment already succeeded/,
  "the fail-open/read-then-write payment path is gone",
);
assert.match(
  subcontractSource,
  /No payment or lien waiver was changed; try again after the Lovable migration completes/,
  "a missing payment RPC fails closed without a legacy write fallback",
);
assert.match(
  subcontractSource,
  /p_amount_cents: dollarsToCents\(data\.amount\)/,
  "payment dollars cross into the RPC as integer cents",
);
assert.match(
  subcontractSource,
  /p_retainage_held_cents: dollarsToCents\(data\.retainage_held\)/,
  "retainage dollars cross into the RPC as integer cents",
);
assert.match(
  subcontractSource,
  /p_idempotency_key: data\.idempotency_key/,
  "subcontract-payment retries carry the caller's stable operation key",
);

const paymentSplitHandler = subcontractSource.slice(
  subcontractSource.indexOf("export const setSubcontractPaymentSplit"),
);
assert.match(
  paymentSplitHandler,
  /replace_subcontract_payment_allocations_atomic/,
  "payment coding replacement uses one authoritative database transaction",
);
assert.match(
  paymentSplitHandler,
  /amount_cents: dollarsToCents\(row\.amount\)/,
  "payment coding crosses into the database as integer cents",
);
assert.doesNotMatch(
  paymentSplitHandler,
  /dynamicTable\([^)]*subcontract_payment_allocations|\.insert\(|\.delete\(/s,
  "the application cannot multi-call insert or delete payment coding",
);

const harborSubcontractSeed = projectSource.slice(
  projectSource.indexOf("const ensureHarborDemoSubcontractBuyout"),
  projectSource.indexOf("const resetHarborDemoSubcontractBuyout"),
);
assert.match(
  harborSubcontractSeed,
  /record_subcontract_payment_atomic/,
  "Harbor payment seed uses the authoritative atomic create command",
);
assert.match(
  harborSubcontractSeed,
  /transition_subcontract_payment_atomic/,
  "Harbor payment seed uses the authoritative forward-only paid transition",
);
assert.match(
  harborSubcontractSeed,
  /replace_subcontract_payment_allocations_atomic/,
  "Harbor payment seed uses the authoritative atomic coding command",
);
assert.match(harborSubcontractSeed, /p_status: "draft"/, "Harbor records the payment as a draft");
assert.ok(
  harborSubcontractSeed.indexOf("replace_subcontract_payment_allocations_atomic") <
    harborSubcontractSeed.indexOf('p_status: "approved"') &&
    harborSubcontractSeed.indexOf('p_status: "approved"') <
      harborSubcontractSeed.indexOf('p_status: "paid"'),
  "Harbor codes the draft before approving and paying it",
);
assert.match(
  harborSubcontractSeed,
  /harbor-demo:\$\{projectId\}:subcontract-payment-concrete-1/,
  "Harbor payment seed carries a stable project-scoped idempotency key",
);
assert.doesNotMatch(
  harborSubcontractSeed,
  /dynamicTable\(supabase, "subcontract_payments"\)\.insert/,
  "Harbor cannot bypass subcontract payment provenance with a direct paid-row insert",
);

const estimateImportHandler = estimateSource.slice(
  estimateSource.indexOf("export const importEstimateLineItems"),
  estimateSource.indexOf("export const updateLineItem"),
);
assert.match(
  estimateImportHandler,
  /import_estimate_line_items_atomic/,
  "estimate import uses RPC",
);
assert.match(
  estimateSource,
  /estimateLineImportItemInput[\s\S]*quantity: z\.number\(\)\.gt\(0\)/,
  "application import validation requires a positive quantity",
);
assert.doesNotMatch(
  estimateImportHandler,
  /\.delete\(|recalculateEstimateTotalsInternal|getNextLineSortOrder/,
  "replace never deletes or recalculates in a separate application transaction",
);
assert.match(
  estimateSource,
  /original worksheet was not changed/,
  "a missing estimate RPC reports the fail-closed rollback guarantee",
);
assert.match(
  estimateImportHandler,
  /p_idempotency_key: data\.idempotency_key/,
  "estimate append retries carry a stable operation key",
);

// Database defense-in-depth and lock contracts.
for (const fragment of [
  "CREATE TRIGGER subcontract_payments_enforce_compliance",
  "CREATE TRIGGER lien_waivers_enforce_assignment",
  "CREATE TRIGGER estimate_line_items_lock_parent",
  "FOR UPDATE",
  "FOR SHARE",
  "waiver.payment_id IS NULL",
  "p_amount_cents bigint",
  "p_retainage_held_cents bigint",
  "p_amount_cents::numeric / 100.0",
  "p_retainage_held_cents::numeric / 100.0",
  "subcontract_payments_subcontract_idempotency_unique",
  "idempotency_fingerprint",
  "CREATE TABLE IF NOT EXISTS public.estimate_import_operations",
  "This estimate-import idempotency key was already used for different rows or mode.",
  "waiver.signed_date IS NOT NULL",
  "length(trim(COALESCE(waiver.storage_path, ''))) > 0",
  "waiver.through_date IS NOT NULL",
  "waiver.amount >=",
  "CREATE TRIGGER subcontract_payments_enforce_financial_record",
  "CREATE TRIGGER subcontract_payments_enforce_commitment_capacity",
  "CREATE TRIGGER subcontract_change_orders_enforce_commitment",
  "CREATE TRIGGER subcontracts_enforce_commitment_record",
  "Approved and paid pay apps cannot exceed the subcontract revised commitment.",
  "This change would reduce subcontract commitment below approved and paid pay apps.",
  "A subcontract change order must share its subcontract project.",
  "Subcontract value cannot be reduced below approved and paid pay apps.",
  "Subcontract payments must be recorded through the atomic payment workflow.",
  "Subcontract payment creation history is immutable.",
  "Subcontract payment idempotency provenance is immutable.",
  "Approval and compliance audit fields must be changed through the atomic payment workflow.",
  "CREATE TRIGGER subcontract_payment_allocations_enforce_financial_record",
  "replace_subcontract_payment_allocations_atomic",
  "Subcontract payment splits must be replaced through the atomic allocation workflow.",
  "Approved or paid subcontract payment coding is a permanent financial record.",
  "Payment coding must equal the payment amount exactly before approval.",
  "REVOKE INSERT, UPDATE, DELETE ON TABLE public.subcontract_payment_allocations",
  "CREATE TRIGGER estimates_protect_derived_totals",
  "Estimate totals are derived from worksheet lines and cannot be edited directly.",
  "recalculate_estimate_totals_atomic",
  "overwatch.lien_waiver_atomic_write",
  "Validate the raw JSON contract before touching the existing worksheet",
  "positive quantity, and nonnegative integer-cent unit costs",
  "library_item.organization_id = v_estimate.organization_id",
  "A paid pay app cannot move backward",
  "A finalized compliance-override audit cannot be changed",
  "DELETE FROM public.estimate_line_items",
  "UPDATE public.estimates estimate",
  "REVOKE ALL ON FUNCTION public.record_subcontract_payment_atomic",
  "GRANT EXECUTE ON FUNCTION public.import_estimate_line_items_atomic",
]) {
  assert.ok(migration.includes(fragment), `migration contains: ${fragment}`);
}
const functionBodyStarts = migration.match(/\bas\s+\$\$/gi)?.length ?? 0;
const functionBodyEnds = migration.match(/\$\$;/g)?.length ?? 0;
assert.ok(functionBodyStarts >= 19, "the migration contains the expected financial command set");
assert.equal(
  functionBodyStarts,
  functionBodyEnds,
  "every financial function body has a matching closing dollar quote",
);

class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(operation: () => Promise<T> | T): Promise<T> {
    let release = () => undefined;
    const previous = this.tail;
    this.tail = new Promise<void>((resolveLock) => {
      release = resolveLock;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

type PaymentStatus = "draft" | "approved" | "paid";

class PaymentTransactionModel {
  readonly lock = new Mutex();
  payments = new Map<string, PaymentStatus>();
  paymentCents = new Map<string, number>();
  baseCommitmentCents = 10_000;
  changeOrderCents = 0;
  waiverPaymentId: string | null = null;
  certificateValid = true;
  transitionWrites = 0;

  async recordFinal(paymentId: string, failAfterWaiver = false) {
    return this.lock.run(async () => {
      const beforePayments = new Map(this.payments);
      const beforeWaiver = this.waiverPaymentId;
      try {
        this.payments.set(paymentId, "draft");
        if (!this.certificateValid) throw new Error("certificate unavailable");
        if (this.waiverPaymentId !== null) throw new Error("waiver already consumed");
        this.waiverPaymentId = paymentId;
        if (failAfterWaiver) throw new Error("simulated write failure");
        this.payments.set(paymentId, "paid");
        return paymentId;
      } catch (error) {
        this.payments = beforePayments;
        this.waiverPaymentId = beforeWaiver;
        throw error;
      }
    });
  }

  async transition(paymentId: string, status: Exclude<PaymentStatus, "draft">) {
    return this.lock.run(async () => {
      const current = this.payments.get(paymentId);
      if (!current) throw new Error("missing payment");
      if (current === status) return current;
      if (current === "paid") throw new Error("backward transition");
      const otherFinalizedCents = [...this.payments.entries()].reduce(
        (total, [id, paymentStatus]) =>
          id !== paymentId && (paymentStatus === "approved" || paymentStatus === "paid")
            ? total + (this.paymentCents.get(id) ?? 0)
            : total,
        0,
      );
      if (
        otherFinalizedCents + (this.paymentCents.get(paymentId) ?? 0) >
        this.baseCommitmentCents + this.changeOrderCents
      ) {
        throw new Error("payment exceeds revised commitment");
      }
      this.payments.set(paymentId, status);
      this.transitionWrites += 1;
      return status;
    });
  }
}

// Failure after waiver assignment rolls both the payment and waiver back. A
// clean retry can then succeed without manual cleanup.
{
  const model = new PaymentTransactionModel();
  await assert.rejects(model.recordFinal("payment-a", true), /simulated write failure/);
  assert.deepEqual([...model.payments], [], "failed transaction leaves no draft payment");
  assert.equal(model.waiverPaymentId, null, "failed transaction does not consume the waiver");
  await model.recordFinal("payment-a");
  assert.equal(model.payments.get("payment-a"), "paid", "retry completes the payment");
  assert.equal(model.waiverPaymentId, "payment-a", "retry consumes the waiver exactly once");
}

// Two concurrent pay apps cannot consume the same waiver.
{
  const model = new PaymentTransactionModel();
  const attempts = await Promise.allSettled([
    model.recordFinal("payment-a"),
    model.recordFinal("payment-b"),
  ]);
  assert.equal(
    attempts.filter((attempt) => attempt.status === "fulfilled").length,
    1,
    "exactly one concurrent payment succeeds",
  );
  assert.equal(
    attempts.filter((attempt) => attempt.status === "rejected").length,
    1,
    "the competing payment is rejected",
  );
  assert.equal(model.payments.size, 1, "only the successful payment commits");
  assert.ok(model.waiverPaymentId, "the waiver has one owner");
}

// A retried status transition is idempotent and cannot move paid backward.
{
  const model = new PaymentTransactionModel();
  model.payments.set("payment-a", "draft");
  model.paymentCents.set("payment-a", 5_000);
  await model.transition("payment-a", "approved");
  await model.transition("payment-a", "approved");
  assert.equal(model.transitionWrites, 1, "retry does not perform a second transition write");
  await model.transition("payment-a", "paid");
  await assert.rejects(model.transition("payment-a", "approved"), /backward transition/);
}

// The subcontract row lock serializes competing approvals. Two pay apps that
// each fit on their own cannot collectively exceed the revised commitment.
{
  const model = new PaymentTransactionModel();
  model.payments.set("payment-a", "draft");
  model.payments.set("payment-b", "draft");
  model.paymentCents.set("payment-a", 6_000);
  model.paymentCents.set("payment-b", 5_000);
  const attempts = await Promise.allSettled([
    model.transition("payment-a", "approved"),
    model.transition("payment-b", "approved"),
  ]);
  assert.equal(
    attempts.filter((attempt) => attempt.status === "fulfilled").length,
    1,
    "exactly one approval fits inside the commitment",
  );
  assert.equal(
    attempts.filter((attempt) => attempt.status === "rejected").length,
    1,
    "the competing over-commit approval is rejected",
  );
}

type EstimateState = { rows: number[]; total: number };

const replaceEstimate = (state: EstimateState, nextRows: number[], failAt: number | null) => {
  const before = structuredClone(state);
  try {
    state.rows = [];
    for (const [index, row] of nextRows.entries()) {
      if (index === failAt) throw new Error("simulated invalid imported row");
      state.rows.push(row);
    }
    state.total = state.rows.reduce((sum, row) => sum + row, 0);
  } catch (error) {
    state.rows = before.rows;
    state.total = before.total;
    throw error;
  }
};

// Replace failure preserves both the original worksheet and its totals; retry
// commits the rows and matching total together.
{
  const state: EstimateState = { rows: [100, 200], total: 300 };
  assert.throws(() => replaceEstimate(state, [400, 500], 1), /invalid imported row/);
  assert.deepEqual(state, { rows: [100, 200], total: 300 }, "failed replace rolls back fully");
  replaceEstimate(state, [400, 500], null);
  assert.deepEqual(state, { rows: [400, 500], total: 900 }, "retry commits rows and totals");
}

console.log("financial integrity smoke: all assertions passed");
