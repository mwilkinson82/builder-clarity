import assert from "node:assert/strict";
import {
  canTransitionPayment,
  centsToDollars,
  checkoutSessionOutcome,
  DEFAULT_STRIPE_AMOUNT_THRESHOLD_CENTS,
  dollarsToCents,
  estimatedCardFeeCents,
  initialPaymentState,
  invoicePaymentTotals,
  invoiceTotalDueDollars,
  isOverRecording,
  lineWorkForPercentCents,
  maskAccountTail,
  methodAvailability,
  PENDING_LOCK_MAX_AGE_HOURS,
  pendingPaymentLock,
  percentOfCents,
  percentOfDollars,
  planChargeRefund,
  planCheckoutCompletion,
  quantizeDollars,
  reconcileInvoiceFromLedger,
  renderRemittanceMemo,
  resolveEnabledMethods,
  stripeConnectReady,
  sumDollarsToCents,
  type EnabledPaymentMethods,
} from "../src/lib/payments-domain.ts";
import { applySovBucketPatch, sovLineForecast, sovTotals } from "../src/lib/sov-rollup.ts";
import { computeWIPBucket, computeProjectWIP, type WIPBucketInput } from "../src/lib/wip.ts";
import { invoiceViewToRecord } from "../src/lib/portal-view-signal.ts";
import {
  computeG702Face,
  computeG703Rows,
  computeG703Totals,
  computePreviousCertificatesCents,
  overbilledLineMessage,
  overbilledLines,
} from "../src/lib/aia-math.ts";
import {
  aiaBuilderSteps,
  aiaGenerateGate,
  type AiaBuilderSnapshot,
} from "../src/lib/aia-builder-steps.ts";
import { buildBillingLinesFromBuckets } from "../src/lib/billing-line-generation.ts";
import {
  allocatedContractByChangeOrder,
  summarizeApprovedCo,
  unallocatedContract,
} from "../src/lib/change-order-allocation.ts";
import {
  allocatedByExposure,
  riskByCostCode,
  summarizeExposure,
  unallocatedExposure,
} from "../src/lib/exposure-allocation.ts";
import { computeBudgetLedger } from "../src/lib/budget-ledger.ts";
import { aggregateEstimateToBudget } from "../src/lib/estimate-budget.ts";
import {
  agingBucketTotals,
  appendCollectionsNote,
  collectionsFlag,
  daysOverdue,
  daysUntilDue,
  receivableAgingBucket,
} from "../src/lib/receivables.ts";
import { summarizeCostSettlement } from "../src/lib/cost-settlement.ts";

// --- Cost settlement: partial cash + linked supplier credits ---------------

const partialCost = summarizeCostSettlement({
  invoiceCents: 20000,
  cashPaidCents: 5000,
  creditCents: 5000,
});
assert.equal(partialCost.settledCents, 10000);
assert.equal(partialCost.remainingCents, 10000);
assert.equal(partialCost.state, "partial");

const creditedCost = summarizeCostSettlement({
  invoiceCents: 20000,
  cashPaidCents: 15000,
  creditCents: 5000,
});
assert.equal(creditedCost.remainingCents, 0);
assert.equal(creditedCost.state, "settled");

const legacyPaidCost = summarizeCostSettlement({
  invoiceCents: 20000,
  cashPaidCents: 0,
  creditCents: 0,
  legacyPaid: true,
});
assert.equal(legacyPaidCost.cashPaidCents, 20000, "legacy paid rows remain fully settled");

// --- Payment state machine -------------------------------------------------

assert.equal(initialPaymentState("manual"), "succeeded");
assert.equal(initialPaymentState("stripe"), "pending");

// Manual records: created succeeded, only refund/void from there.
assert.equal(canTransitionPayment("manual", "succeeded", "refunded"), true);
assert.equal(canTransitionPayment("manual", "succeeded", "void"), true);
assert.equal(canTransitionPayment("manual", "succeeded", "pending"), false);
assert.equal(canTransitionPayment("manual", "pending", "succeeded"), false);

// Stripe records: pending -> succeeded | failed; succeeded -> refunded.
assert.equal(canTransitionPayment("stripe", "pending", "succeeded"), true);
assert.equal(canTransitionPayment("stripe", "pending", "failed"), true);
assert.equal(canTransitionPayment("stripe", "succeeded", "refunded"), true);
assert.equal(canTransitionPayment("stripe", "pending", "refunded"), false);
assert.equal(canTransitionPayment("stripe", "failed", "succeeded"), false);
assert.equal(canTransitionPayment("stripe", "refunded", "succeeded"), false);
assert.equal(canTransitionPayment("stripe", "succeeded", "void"), false);

// --- Cents math round-trips ------------------------------------------------

assert.equal(dollarsToCents(1234.56), 123456);
assert.equal(dollarsToCents(0.1) + dollarsToCents(0.2), 30); // no float drift
assert.equal(centsToDollars(123456), 1234.56);
assert.equal(centsToDollars(dollarsToCents(19.99)), 19.99);
assert.equal(dollarsToCents(centsToDollars(2500000)), 2500000);
// The classic float trap: 285.55 * 100 = 28554.999... must round, not truncate.
assert.equal(dollarsToCents(285.55), 28555);
assert.equal(dollarsToCents(Number.NaN), 0);

// --- Partial payment arithmetic ---------------------------------------------

const partials = invoicePaymentTotals(1000000, [
  { amountCents: 250000, state: "succeeded" },
  { amountCents: 250000, state: "succeeded" },
  { amountCents: 100000, state: "pending" }, // not yet money
  { amountCents: 50000, state: "failed" }, // never money
]);
assert.equal(partials.paidCents, 500000);
assert.equal(partials.remainingCents, 500000);
assert.equal(partials.status, "partially_paid");

// Refund pulls an invoice back from paid.
const refunded = invoicePaymentTotals(1000, [{ amountCents: 1000, state: "refunded" }]);
assert.equal(refunded.paidCents, 0);
assert.equal(refunded.status, "unpaid");

const settled = invoicePaymentTotals(1000, [
  { amountCents: 400, state: "succeeded" },
  { amountCents: 600, state: "succeeded" },
]);
assert.equal(settled.status, "paid");
assert.equal(settled.remainingCents, 0);

// Over-recording is warned, not blocked: the check itself must be exact.
assert.equal(isOverRecording(500000, 500000), false);
assert.equal(isOverRecording(500000, 500001), true);
assert.equal(isOverRecording(0, 1), true);

// --- Method availability matrix ---------------------------------------------

const allOn: EnabledPaymentMethods = {
  direct_bank: true,
  card: true,
  ach_debit: true,
  allow_stripe_over_threshold: false,
};

// Profile + Stripe ready, small invoice: everything available.
const ready = methodAvailability({
  hasPaymentProfile: true,
  stripeReady: true,
  enabled: allOn,
  invoiceTotalCents: 500000,
  thresholdCents: DEFAULT_STRIPE_AMOUNT_THRESHOLD_CENTS,
});
assert.equal(ready.direct_bank.available, true);
assert.equal(ready.card.available, true);
assert.equal(ready.ach_debit.available, true);
assert.equal(ready.stripeHiddenByThreshold, false);

// No payment profile: direct bank unavailable with the right reason.
const noProfile = methodAvailability({
  hasPaymentProfile: false,
  stripeReady: true,
  enabled: allOn,
  invoiceTotalCents: 500000,
  thresholdCents: DEFAULT_STRIPE_AMOUNT_THRESHOLD_CENTS,
});
assert.equal(noProfile.direct_bank.available, false);
assert.equal(noProfile.direct_bank.reason, "no_payment_profile");
assert.equal(noProfile.card.available, true);

// Stripe not ready: card/ACH show "Connect Stripe to enable".
const noStripe = methodAvailability({
  hasPaymentProfile: true,
  stripeReady: false,
  enabled: allOn,
  invoiceTotalCents: 500000,
  thresholdCents: DEFAULT_STRIPE_AMOUNT_THRESHOLD_CENTS,
});
assert.equal(noStripe.card.available, false);
assert.equal(noStripe.card.reason, "stripe_not_ready");
assert.equal(noStripe.ach_debit.reason, "stripe_not_ready");
assert.equal(noStripe.direct_bank.available, true);

// Requisition-sized invoice: Stripe methods hidden by the threshold guardrail.
const bigInvoice = methodAvailability({
  hasPaymentProfile: true,
  stripeReady: true,
  enabled: allOn,
  invoiceTotalCents: 2500001,
  thresholdCents: DEFAULT_STRIPE_AMOUNT_THRESHOLD_CENTS,
});
assert.equal(bigInvoice.card.available, false);
assert.equal(bigInvoice.card.reason, "over_threshold");
assert.equal(bigInvoice.stripeHiddenByThreshold, true);
assert.equal(bigInvoice.direct_bank.available, true); // the $200K rail stays up

// Exactly at threshold is allowed.
const atThreshold = methodAvailability({
  hasPaymentProfile: true,
  stripeReady: true,
  enabled: allOn,
  invoiceTotalCents: 2500000,
  thresholdCents: DEFAULT_STRIPE_AMOUNT_THRESHOLD_CENTS,
});
assert.equal(atThreshold.card.available, true);

// Deliberate per-invoice override lifts the guardrail.
const overridden = methodAvailability({
  hasPaymentProfile: true,
  stripeReady: true,
  enabled: { ...allOn, allow_stripe_over_threshold: true },
  invoiceTotalCents: 20000000,
  thresholdCents: DEFAULT_STRIPE_AMOUNT_THRESHOLD_CENTS,
});
assert.equal(overridden.card.available, true);
assert.equal(overridden.stripeHiddenByThreshold, false);

// Toggled off beats everything.
const toggledOff = methodAvailability({
  hasPaymentProfile: true,
  stripeReady: true,
  enabled: { ...allOn, card: false },
  invoiceTotalCents: 1000,
  thresholdCents: DEFAULT_STRIPE_AMOUNT_THRESHOLD_CENTS,
});
assert.equal(toggledOff.card.available, false);
assert.equal(toggledOff.card.reason, "toggled_off");

// --- Toggle resolution (invoice override > company default > fallback) ------

const inherited = resolveEnabledMethods({}, { direct_bank: true, card: false });
assert.equal(inherited.card, false); // company default wins over fallback
assert.equal(inherited.ach_debit, true); // fallback fills the gap

const overriddenMethods = resolveEnabledMethods({ card: true }, { card: false });
assert.equal(overriddenMethods.card, true); // invoice override wins

assert.deepEqual(resolveEnabledMethods(null, null), {
  direct_bank: true,
  card: true,
  ach_debit: true,
  allow_stripe_over_threshold: false,
});

// --- Stripe readiness --------------------------------------------------------

assert.equal(
  stripeConnectReady({ accountId: "acct_1", connectStatus: "active", processorReady: true }),
  true,
);
assert.equal(
  stripeConnectReady({ accountId: "acct_1", connectStatus: "pending", processorReady: false }),
  false,
);
assert.equal(
  stripeConnectReady({ accountId: "", connectStatus: "active", processorReady: true }),
  false,
);

// --- Remittance memo + masking ----------------------------------------------

assert.equal(
  renderRemittanceMemo("Reference: Invoice {number}", "INV-014"),
  "Reference: Invoice INV-014",
);
assert.equal(renderRemittanceMemo("", "INV-2"), "Reference: Invoice INV-2");
assert.equal(renderRemittanceMemo("Job {number} / {number}", "7"), "Job 7 / 7");
assert.equal(maskAccountTail("000123456789"), "•••• 6789");
assert.equal(maskAccountTail("6789"), "•••• 6789");
assert.equal(maskAccountTail(""), "");

// --- Card fee estimate --------------------------------------------------------

assert.equal(estimatedCardFeeCents(1000000), 29030); // $10,000 -> $290.30
assert.equal(estimatedCardFeeCents(0), 0);
assert.equal(estimatedCardFeeCents(-5), 0);

// --- ACH is asynchronous: completed-but-unpaid sessions must NOT book --------

assert.equal(checkoutSessionOutcome("paid"), "book"); // cards settle at completion
assert.equal(checkoutSessionOutcome("no_payment_required"), "book");
assert.equal(checkoutSessionOutcome("unpaid"), "await_async"); // ACH: wait for async_payment_succeeded
assert.equal(checkoutSessionOutcome(""), "await_async"); // unknown = never book early

// --- Webhook idempotency: same event twice = one record ----------------------

const invoiceSnapshot = { totalDueCents: 1000000, paidCents: 0 };
const firstDelivery = planCheckoutCompletion(
  {
    amountTotalCents: 1000000,
    surchargeCents: 0,
    overwatchFeeCents: 0,
    occurredAtIso: "2026-07-03T12:00:00.000Z",
    alreadyRecorded: false,
  },
  invoiceSnapshot,
);
assert.ok(firstDelivery.payment);
assert.equal(firstDelivery.payment?.amountCents, 1000000);
assert.equal(firstDelivery.invoicePatch?.status, "paid");
assert.equal(firstDelivery.invoicePatch?.paidAtIso, "2026-07-03T12:00:00.000Z");

const secondDelivery = planCheckoutCompletion(
  {
    amountTotalCents: 1000000,
    surchargeCents: 0,
    overwatchFeeCents: 0,
    occurredAtIso: "2026-07-03T12:00:01.000Z",
    alreadyRecorded: true,
  },
  { totalDueCents: 1000000, paidCents: 1000000 },
);
assert.equal(secondDelivery.payment, null); // no second record
assert.equal(secondDelivery.invoicePatch, null); // no double-count

// Partial Stripe payment leaves the invoice partially paid.
const partialStripe = planCheckoutCompletion(
  {
    amountTotalCents: 400000,
    surchargeCents: 0,
    overwatchFeeCents: 0,
    occurredAtIso: "2026-07-03T12:00:00.000Z",
    alreadyRecorded: false,
  },
  { totalDueCents: 1000000, paidCents: 0 },
);
assert.equal(partialStripe.invoicePatch?.status, "partially_paid");
assert.equal(partialStripe.invoicePatch?.paidAtIso, null);

// Surcharge covers fees; it never counts as progress against the invoice.
const surcharged = planCheckoutCompletion(
  {
    amountTotalCents: 1029030,
    surchargeCents: 29030,
    overwatchFeeCents: 0,
    occurredAtIso: "2026-07-03T12:00:00.000Z",
    alreadyRecorded: false,
  },
  { totalDueCents: 1000000, paidCents: 0 },
);
assert.equal(surcharged.payment?.amountCents, 1000000);
assert.equal(surcharged.invoicePatch?.status, "paid");

// Platform application fee reduces the contractor's net payout, default 0.
const withFee = planCheckoutCompletion(
  {
    amountTotalCents: 1000000,
    surchargeCents: 0,
    overwatchFeeCents: 5000,
    occurredAtIso: "2026-07-03T12:00:00.000Z",
    alreadyRecorded: false,
  },
  { totalDueCents: 1000000, paidCents: 0 },
);
assert.equal(withFee.payment?.netPayoutCents, 995000);

// --- Cents-exact derivation (BILLINGBATCH1 Task 0: the penny bug) ------------

// Percent at the line rounds in cents, never floats.
assert.equal(percentOfCents(2_120_250_00, 90), 1_908_225_00);
assert.equal(percentOfCents(100001, 33.33), 33330); // 33330.3333 rounds at the line
assert.equal(percentOfDollars(2_120_250, 90), 1_908_225);
assert.equal(percentOfDollars(Number.NaN, 90), 0);

// quantizeDollars snaps float drift to exact cents.
assert.equal(quantizeDollars(1908224.9999999998), 1908225);
// A genuinely fractional percent-complete product snaps to its exact cent.
assert.equal(quantizeDollars(2833666.67 * (67.34 / 100)), 1908191.14);

// Sums run in integer cents, rounding each item first.
assert.equal(sumDollarsToCents([0.1, 0.2]), 30);
assert.equal(sumDollarsToCents([285.55, 285.55]), 57110);

// Regression, live case's shape (invoice 2601-001): scheduled values x percent
// complete across many lines must sum to the intended whole-dollar total —
// exactly, with === and no epsilon.
const LIVE_CASE_LINES = Array.from({ length: 100 }, () => ({
  scheduledCents: 21_202_50, // $21,202.50 per SOV line, $2,120,250.00 contract
  percentComplete: 90,
}));
const liveCaseTotalCents = LIVE_CASE_LINES.reduce(
  (sum, line) => sum + percentOfCents(line.scheduledCents, line.percentComplete),
  0,
);
assert.equal(liveCaseTotalCents, 1_908_225_00);
assert.equal(centsToDollars(liveCaseTotalCents), 1_908_225.0);

// Round at each LINE first: summing unrounded float line values and rounding
// once at the end lands on a DIFFERENT total. The line-first cents result is
// the intended one; the float pipeline is the drift this batch removes.
const DRIFT_LINES = Array.from({ length: 3 }, () => ({ scheduled: 1000.01, pct: 33.33 }));
const lineFirstCents = DRIFT_LINES.reduce(
  (sum, line) => sum + percentOfCents(dollarsToCents(line.scheduled), line.pct),
  0,
);
const floatRoundOnceCents = dollarsToCents(
  DRIFT_LINES.reduce((sum, line) => sum + line.scheduled * (line.pct / 100), 0),
);
assert.equal(lineFirstCents, 99990); // $999.90: each line rounds down at the line
assert.equal(floatRoundOnceCents, 99991); // the drifted total a float rollup stores
assert.notEqual(lineFirstCents, floatRoundOnceCents);

// SOV line percent entry -> this-period work, all in cents.
assert.equal(
  lineWorkForPercentCents({
    contractCents: 2_120_250_00,
    targetPercent: 90,
    previousCents: 1_060_125_00, // 50% previously certified
    storedCents: 0,
  }),
  848_100_00, // 90% earned less previous, exact
);
assert.equal(
  lineWorkForPercentCents({
    contractCents: 100000,
    targetPercent: 10,
    previousCents: 20000,
    storedCents: 0,
  }),
  0, // already past the target: floors at zero, never negative
);
assert.equal(
  lineWorkForPercentCents({
    contractCents: 100000,
    targetPercent: 50,
    previousCents: 10000,
    storedCents: 5000,
  }),
  35000, // stored materials count toward the completed target
);

// Invoice totals derive from the pay app in cents: subtotal less retainage
// plus released retainage — the exact live-case shape, exact result.
assert.equal(
  invoiceTotalDueDollars({ subtotal: 2_120_250, retainage: 212_025, retainageReleased: 0 }),
  1_908_225,
);
assert.equal(
  invoiceTotalDueDollars({ subtotal: 1000.01, retainage: 100.01, retainageReleased: 0.01 }),
  900.01,
);
assert.equal(
  invoiceTotalDueDollars({ subtotal: 100, retainage: 250, retainageReleased: 0 }),
  0, // floors at zero
);

// --- Refund reversal (BILLINGBATCH2 Task 0: live bug, invoice 2601-3) --------

// Full refund: the row stops counting (status flips, amount kept for audit).
const fullRefund = planChargeRefund({
  bookedCents: 100000, // $1,000 booked (the 2601-3 shape)
  chargeAmountCents: 100000,
  amountRefundedCents: 100000,
  fullyRefunded: true,
});
assert.equal(fullRefund.ledgerStatus, "refunded");
assert.equal(fullRefund.ledgerAmountCents, 100000);
assert.equal(fullRefund.reversalCents, 100000);

// Partial refund: row stays succeeded, counted amount drops by the refund.
const partialRefund = planChargeRefund({
  bookedCents: 100000,
  chargeAmountCents: 100000,
  amountRefundedCents: 40000,
  fullyRefunded: false,
});
assert.equal(partialRefund.ledgerStatus, "succeeded");
assert.equal(partialRefund.ledgerAmountCents, 60000);
assert.equal(partialRefund.reversalCents, 40000);

// Second partial refund arrives with the CUMULATIVE amount_refunded; the
// already-reduced row lands on the same remaining value.
const secondPartial = planChargeRefund({
  bookedCents: 60000,
  chargeAmountCents: 100000,
  amountRefundedCents: 70000,
  fullyRefunded: false,
});
assert.equal(secondPartial.ledgerStatus, "succeeded");
assert.equal(secondPartial.ledgerAmountCents, 30000);

// Surcharged charge: refunds consume the surcharge last, so refunding only
// the surcharge reverses no invoice progress.
const surchargeOnlyRefund = planChargeRefund({
  bookedCents: 1000000,
  chargeAmountCents: 1029030, // base + estimated card fee
  amountRefundedCents: 29030,
  fullyRefunded: false,
});
assert.equal(surchargeOnlyRefund.ledgerStatus, "succeeded");
assert.equal(surchargeOnlyRefund.ledgerAmountCents, 1000000);
assert.equal(surchargeOnlyRefund.reversalCents, 0);

// Refunds beyond the surcharge start reversing invoice progress.
const deepRefund = planChargeRefund({
  bookedCents: 1000000,
  chargeAmountCents: 1029030,
  amountRefundedCents: 529030,
  fullyRefunded: false,
});
assert.equal(deepRefund.ledgerAmountCents, 500000);
assert.equal(deepRefund.reversalCents, 500000);

// --- Reconcile-from-ledger math (paid_amount/status from the truth) ----------

// The 2601-3 correction: fully refunded ledger, invoice must reopen to sent.
const refundedReconcile = reconcileInvoiceFromLedger({
  totalDueCents: 100000,
  currentStatus: "paid",
  currentPaidAtIso: "2026-07-03T18:00:00.000Z",
  rows: [{ amountCents: 100000, status: "refunded" }],
  nowIso: "2026-07-03T22:00:00.000Z",
});
assert.equal(refundedReconcile.paidCents, 0);
assert.equal(refundedReconcile.status, "sent");
assert.equal(refundedReconcile.paidAtIso, null);

// Partial refund leaves a partially paid invoice.
const partialReconcile = reconcileInvoiceFromLedger({
  totalDueCents: 100000,
  currentStatus: "paid",
  currentPaidAtIso: "2026-07-03T18:00:00.000Z",
  rows: [{ amountCents: 60000, status: "succeeded" }],
  nowIso: "2026-07-03T22:00:00.000Z",
});
assert.equal(partialReconcile.paidCents, 60000);
assert.equal(partialReconcile.status, "partially_paid");

// Fully paid ledger keeps the invoice paid and preserves the original paid_at.
const paidReconcile = reconcileInvoiceFromLedger({
  totalDueCents: 100000,
  currentStatus: "partially_paid",
  currentPaidAtIso: "2026-07-01T12:00:00.000Z",
  rows: [
    { amountCents: 60000, status: "succeeded" },
    { amountCents: 40000, status: "succeeded" },
    { amountCents: 25000, status: "failed" }, // never money
    { amountCents: 10000, status: "pending" }, // not money yet
  ],
  nowIso: "2026-07-03T22:00:00.000Z",
});
assert.equal(paidReconcile.paidCents, 100000);
assert.equal(paidReconcile.status, "paid");
assert.equal(paidReconcile.paidAtIso, "2026-07-01T12:00:00.000Z");

// Reconcile never resurrects a void invoice and never sends a draft.
assert.equal(
  reconcileInvoiceFromLedger({
    totalDueCents: 100000,
    currentStatus: "void",
    currentPaidAtIso: null,
    rows: [{ amountCents: 100000, status: "succeeded" }],
    nowIso: "2026-07-03T22:00:00.000Z",
  }).status,
  "void",
);
assert.equal(
  reconcileInvoiceFromLedger({
    totalDueCents: 100000,
    currentStatus: "draft",
    currentPaidAtIso: null,
    rows: [],
    nowIso: "2026-07-03T22:00:00.000Z",
  }).status,
  "draft",
);

// --- Pending-payment lock (Task 1: the $708K double-collection class) --------

const LOCK_NOW = "2026-07-03T22:00:00.000Z";
const lockBase = {
  onlinePaymentStatus: "pending",
  checkoutSessionId: "cs_test_123",
  paymentLinkSentAtIso: "2026-07-03T20:00:00.000Z",
  openBalanceCents: 70800000, // the live incident's $708K
  nowIso: LOCK_NOW,
};
const lockedState = pendingPaymentLock(lockBase);
assert.equal(lockedState.locked, true);
assert.equal(lockedState.startedAtIso, "2026-07-03T20:00:00.000Z");

// checkout.session.expired clears the lock (status leaves "pending").
assert.equal(pendingPaymentLock({ ...lockBase, onlinePaymentStatus: "expired" }).locked, false);
assert.equal(pendingPaymentLock({ ...lockBase, onlinePaymentStatus: "failed" }).locked, false);
assert.equal(pendingPaymentLock({ ...lockBase, onlinePaymentStatus: "paid" }).locked, false);
// No session, no lock; no open balance, nothing to protect.
assert.equal(pendingPaymentLock({ ...lockBase, checkoutSessionId: "" }).locked, false);
assert.equal(pendingPaymentLock({ ...lockBase, openBalanceCents: 0 }).locked, false);
// Stale pendings self-heal: a session older than its possible lifetime never
// locks an invoice forever (missed expiry webhook, pre-webhook rows).
assert.equal(
  pendingPaymentLock({
    ...lockBase,
    paymentLinkSentAtIso: new Date(
      Date.parse(LOCK_NOW) - (PENDING_LOCK_MAX_AGE_HOURS + 1) * 3_600_000,
    ).toISOString(),
  }).locked,
  false,
);
assert.equal(pendingPaymentLock({ ...lockBase, paymentLinkSentAtIso: null }).locked, false);

// --- SOV rollup recompute (Task 3: visible saves, honest rollups) ------------

const SOV_BUCKETS = [
  { id: "a", original_budget: 100000.1, actual_to_date: 25000.05, ftc: 60000.05 },
  { id: "b", original_budget: 50000.2, actual_to_date: 10000.1, ftc: 45000.2 },
];
const sovBefore = sovTotals(SOV_BUCKETS);
assert.equal(sovBefore.budget, 150000.3);
assert.equal(sovBefore.actual, 35000.15);
assert.equal(sovBefore.ftc, 105000.25);
assert.equal(sovBefore.fac, 140000.4); // exact-cent, never 140000.39999999998
assert.equal(sovBefore.variance, 9999.9);

// A committed cell edit patches the list; every rollup recomputes from it.
const sovPatched = applySovBucketPatch(SOV_BUCKETS, "b", { ftc: 30000.2 });
assert.notEqual(sovPatched, SOV_BUCKETS); // new array, so React re-renders
assert.equal(sovPatched[1].ftc, 30000.2);
assert.equal(sovPatched[0], SOV_BUCKETS[0]); // untouched rows keep identity
const sovAfter = sovTotals(sovPatched);
assert.equal(sovAfter.ftc, 90000.25);
assert.equal(sovAfter.fac, 125000.4);
assert.equal(sovAfter.variance, 24999.9);
// The float trap shape: sums stay exact-cent, never 24999.899999999998.
assert.equal(dollarsToCents(sovAfter.variance), 2499990);

const lineForecast = sovLineForecast(sovPatched[1]);
assert.equal(lineForecast.fac, 40000.3);
assert.equal(lineForecast.variance, 9999.9);

// --- Receivables aging math (GETTINGPAID1 Task 0) -----------------------------

// Day counts are calendar-exact across month boundaries.
assert.equal(daysUntilDue("2026-07-08", "2026-07-03"), 5);
assert.equal(daysUntilDue("2026-07-03", "2026-07-03"), 0);
assert.equal(daysUntilDue("2026-06-18", "2026-07-03"), -15);
assert.equal(daysOverdue("2026-06-18", "2026-07-03"), 15);
assert.equal(daysOverdue("2026-05-31", "2026-07-01"), 31); // across two month ends
assert.equal(daysOverdue("2026-01-31", "2026-03-02"), 30); // February in between
assert.equal(daysOverdue("2025-12-31", "2026-03-31"), 90); // quarter across new year
assert.equal(daysUntilDue(null, "2026-07-03"), null);
assert.equal(daysOverdue(null, "2026-07-03"), 0);
// Full ISO timestamps age by their calendar date.
assert.equal(daysOverdue("2026-06-30T15:30:00.000Z", "2026-07-03"), 3);

// Bucket boundaries: 0 current, 1-30, 31-60, 61-90, then 90+.
assert.equal(receivableAgingBucket(0), "current");
assert.equal(receivableAgingBucket(1), "days_1_30");
assert.equal(receivableAgingBucket(30), "days_1_30");
assert.equal(receivableAgingBucket(31), "days_31_60");
assert.equal(receivableAgingBucket(60), "days_31_60");
assert.equal(receivableAgingBucket(61), "days_61_90");
assert.equal(receivableAgingBucket(90), "days_61_90");
assert.equal(receivableAgingBucket(91), "days_90_plus");
assert.equal(receivableAgingBucket(365), "days_90_plus");

// Collections cue: flags AT the threshold, founder default 15 days.
assert.equal(collectionsFlag(14), false);
assert.equal(collectionsFlag(15), true);
assert.equal(collectionsFlag(16), true);
assert.equal(collectionsFlag(5, 5), true);
assert.equal(collectionsFlag(4, 5), false);
assert.equal(collectionsFlag(15, 0), true); // bad threshold falls back to 15

// Collections log: newest first, date-stamped, plain text.
const logOnce = appendCollectionsNote("", "Called, promised payment Friday", "2026-07-12");
assert.equal(logOnce, "2026-07-12 — Called, promised payment Friday");
const logTwice = appendCollectionsNote(logOnce, "Emailed lien warning", "2026-07-20T09:00:00Z");
assert.equal(logTwice.split("\n")[0], "2026-07-20 — Emailed lien warning");
assert.equal(logTwice.split("\n")[1], logOnce);
assert.equal(appendCollectionsNote(logOnce, "   ", "2026-07-21"), logOnce); // blank = no-op

// Bucket totals sum open balances in integer cents.
const agingTotals = agingBucketTotals(
  [
    { due_date: "2026-07-10", total_due: 1000.01, paid_amount: 0 }, // current
    { due_date: "2026-06-30", total_due: 500.55, paid_amount: 250.55 }, // 3 days: 1-30
    { due_date: "2026-05-15", total_due: 2000.1, paid_amount: 0 }, // 49 days: 31-60
    { due_date: "2026-03-01", total_due: 300, paid_amount: 300 }, // paid: excluded
    { due_date: "2026-01-01", total_due: 990.33, paid_amount: 0.33 }, // 183 days: 90+
  ],
  "2026-07-03",
);
assert.equal(agingTotals.find((b) => b.bucket === "current")?.openBalance, 1000.01);
assert.equal(agingTotals.find((b) => b.bucket === "days_1_30")?.openBalance, 250);
assert.equal(agingTotals.find((b) => b.bucket === "days_31_60")?.openBalance, 2000.1);
assert.equal(agingTotals.find((b) => b.bucket === "days_61_90")?.count, 0);
assert.equal(agingTotals.find((b) => b.bucket === "days_90_plus")?.openBalance, 990);

// --- G703 column arithmetic + G702 reconciliation (GETTINGPAID1 Task 1) ------

const AIA_LINES = [
  {
    cost_code: "03-100",
    description: "Concrete foundations",
    scheduled_value_cents: 63_607_50, // odd cents on purpose
    change_order_value_cents: 4_500_000,
    work_completed_previous_cents: 2_000_000,
    materials_stored_previous_cents: 100_000,
    work_completed_this_period_cents: 1_500_000,
    materials_stored_this_period_cents: 250_000,
    work_completed_to_date_cents: 3_500_000,
    materials_stored_to_date_cents: 350_000,
    total_completed_and_stored_cents: 3_850_000,
    balance_to_finish_cents: 63_607_50 + 4_500_000 - 3_850_000,
    retainage_pct: 10,
    retainage_held_cents: 385_000,
    retainage_released_cents: 0,
  },
  {
    cost_code: "09-200",
    description: "Finishes",
    scheduled_value_cents: 2_000_001, // $20,000.01
    change_order_value_cents: 0,
    work_completed_previous_cents: 500_000,
    materials_stored_previous_cents: 0,
    work_completed_this_period_cents: 333_333,
    materials_stored_this_period_cents: 66_667,
    work_completed_to_date_cents: 833_333,
    materials_stored_to_date_cents: 66_667,
    total_completed_and_stored_cents: 900_000,
    balance_to_finish_cents: 2_000_001 - 900_000,
    retainage_pct: 5,
    retainage_held_cents: 45_000,
    retainage_released_cents: 20_000,
  },
];
const g703Rows = computeG703Rows(AIA_LINES);
const g703Totals = computeG703Totals(g703Rows);

// Column arithmetic per row: C = scheduled + CO, G = D+E+F, I = C - G.
assert.equal(g703Rows[0].scheduledValueCents, 63_607_50 + 4_500_000);
assert.equal(
  g703Rows[0].fromPreviousCents + g703Rows[0].thisPeriodCents + g703Rows[0].storedMaterialCents,
  g703Rows[0].totalCompletedStoredCents,
);
assert.equal(
  g703Rows[1].scheduledValueCents - g703Rows[1].totalCompletedStoredCents,
  g703Rows[1].balanceToFinishCents,
);

// Retainage split rounds at the line: 5a on completed work, 5b on stored
// material, releases consuming the completed-work side first.
assert.equal(g703Rows[0].retainageCompletedWorkCents, 350_000); // 10% of 3.5M
assert.equal(g703Rows[0].retainageStoredMaterialCents, 35_000); // 10% of 350k
assert.equal(g703Rows[1].retainageCompletedWorkCents, 41_667 - 20_000); // 5% of 833,333 -> 41,667 less release
assert.equal(g703Rows[1].retainageStoredMaterialCents, 3_333); // 5% of 66,667 rounds at the line

// Totals row reconciles to the G702 face, penny-exact.
const g702 = computeG702Face({
  originalContractSumCents: AIA_LINES.reduce((s, l) => s + l.scheduled_value_cents, 0),
  netChangeByChangeOrdersCents: AIA_LINES.reduce((s, l) => s + l.change_order_value_cents, 0),
  totals: g703Totals,
  previousCertificatesCents: computePreviousCertificatesCents(AIA_LINES),
});
assert.equal(g702.contractSumToDateCents, g703Totals.scheduledValueCents); // line 3 = column C total
assert.equal(g702.totalCompletedStoredCents, g703Totals.totalCompletedStoredCents); // line 4 = column G total
assert.equal(
  g702.totalRetainageCents,
  g702.retainageCompletedWorkCents + g702.retainageStoredMaterialCents,
); // line 5 = 5a + 5b
assert.equal(
  g702.totalEarnedLessRetainageCents,
  g702.totalCompletedStoredCents - g702.totalRetainageCents,
); // line 6 = 4 - 5
assert.equal(
  g702.currentPaymentDueCents,
  g702.totalEarnedLessRetainageCents - g702.previousCertificatesCents,
); // line 8 = 6 - 7
assert.equal(
  g702.balanceToFinishInclRetainageCents,
  g702.contractSumToDateCents - g702.totalEarnedLessRetainageCents,
); // line 9 = 3 - 6
// Balance column total also reconciles: I total = C total - G total.
assert.equal(
  g703Totals.balanceToFinishCents,
  g703Totals.scheduledValueCents - g703Totals.totalCompletedStoredCents,
);
// Line 7: previous completed/stored less retainage held on it, per line.
assert.equal(g702.previousCertificatesCents, 2_100_000 - 210_000 + (500_000 - 25_000));

// --- Portal Viewed trigger (GETTINGPAID2: no false Viewed stamps) -------------

// The false-positive class: invoices visible, nothing explicitly opened.
// The recording derivation must return null — never the display default.
const VIEW_IDS = ["invoice-a", "invoice-b"];
assert.equal(
  invoiceViewToRecord({
    selectedInvoiceId: null,
    visibleInvoiceIds: VIEW_IDS,
    alreadyRecorded: new Set(),
  }),
  null,
);
// Explicit open records that id, exactly.
assert.equal(
  invoiceViewToRecord({
    selectedInvoiceId: "invoice-b",
    visibleInvoiceIds: VIEW_IDS,
    alreadyRecorded: new Set(),
  }),
  "invoice-b",
);
// Per-visit dedupe: an already-recorded id never records twice.
assert.equal(
  invoiceViewToRecord({
    selectedInvoiceId: "invoice-b",
    visibleInvoiceIds: VIEW_IDS,
    alreadyRecorded: new Set(["invoice-b"]),
  }),
  null,
);
// A selection outside the visible list never records.
assert.equal(
  invoiceViewToRecord({
    selectedInvoiceId: "invoice-zz",
    visibleInvoiceIds: VIEW_IDS,
    alreadyRecorded: new Set(),
  }),
  null,
);
// Full visit sequence: land (null), open A, switch to B, revisit A.
const recorded = new Set<string>();
const visitCalls: string[] = [];
for (const selection of [null, "invoice-a", "invoice-b", "invoice-a"]) {
  const toRecord = invoiceViewToRecord({
    selectedInvoiceId: selection,
    visibleInvoiceIds: VIEW_IDS,
    alreadyRecorded: recorded,
  });
  if (toRecord) {
    recorded.add(toRecord);
    visitCalls.push(toRecord);
  }
}
assert.deepEqual(visitCalls, ["invoice-a", "invoice-b"]);

// --- Overbilling guardrail (GETTINGPAID3 Task 1) ------------------------------

function aiaLine(overrides: Partial<Parameters<typeof computeG703Rows>[0][number]> = {}) {
  return {
    cost_code: "0100",
    description: "Sitework",
    scheduled_value_cents: 10_000_00,
    change_order_value_cents: 0,
    work_completed_previous_cents: 0,
    materials_stored_previous_cents: 0,
    work_completed_this_period_cents: 0,
    materials_stored_this_period_cents: 0,
    work_completed_to_date_cents: 0,
    materials_stored_to_date_cents: 0,
    total_completed_and_stored_cents: 0,
    balance_to_finish_cents: 10_000_00,
    retainage_pct: 10,
    retainage_held_cents: 0,
    retainage_released_cents: 0,
    ...overrides,
  };
}

// A clean SOV (every line at or under 100%) raises nothing.
const cleanSov = [
  aiaLine({ total_completed_and_stored_cents: 8_000_00, balance_to_finish_cents: 2_000_00 }),
  aiaLine({
    cost_code: "0300",
    description: "Structure",
    total_completed_and_stored_cents: 10_000_00,
    balance_to_finish_cents: 0,
  }),
];
assert.deepEqual(overbilledLines(cleanSov), []);

// One line over 100% is flagged with its true overage percent.
const overSov = [
  aiaLine({
    description: "Sitework",
    scheduled_value_cents: 10_000_00, // C
    total_completed_and_stored_cents: 10_880_00, // G -> 108.8%
    balance_to_finish_cents: -880_00,
  }),
  aiaLine({
    cost_code: "0300",
    description: "Structure",
    total_completed_and_stored_cents: 5_000_00,
    balance_to_finish_cents: 5_000_00,
  }),
];
const flagged = overbilledLines(overSov);
assert.equal(flagged.length, 1);
assert.equal(flagged[0].description, "Sitework");
assert.equal(Number(flagged[0].percentComplete.toFixed(1)), 108.8);
assert.equal(flagged[0].overageCents, 880_00);
assert.match(overbilledLineMessage(flagged[0]), /Sitework bills to 108\.8% of scheduled value/);
assert.match(overbilledLineMessage(flagged[0]), /lenders typically reject lines over 100%/);
// Exactly 100% is not overbilled (G == C).
assert.deepEqual(
  overbilledLines([
    aiaLine({ total_completed_and_stored_cents: 10_000_00, balance_to_finish_cents: 0 }),
  ]),
  [],
);
// A change order raises C, so billing into the CO is not overbilling.
assert.deepEqual(
  overbilledLines([
    aiaLine({
      scheduled_value_cents: 10_000_00,
      change_order_value_cents: 2_000_00, // C = 12,000
      total_completed_and_stored_cents: 11_000_00, // 91.7%
      balance_to_finish_cents: 1_000_00,
    }),
  ]),
  [],
);

// --- Builder stepper gate (GETTINGPAID3 Task 0) -------------------------------

const invoiceSnap: AiaBuilderSnapshot = {
  outputFormat: "invoice",
  lineCount: 12,
  linesWithActivity: 4,
  overbilledCount: 0,
};
// Wrong output format blocks at the format step, not silently.
const invoiceGate = aiaGenerateGate(invoiceSnap);
assert.equal(invoiceGate.ready, false);
assert.equal(invoiceGate.blockingStep, "format");
assert.match(invoiceGate.reason, /AIA G702\/G703/);

// AIA selected but no lines: blocks at the SOV import step.
const noLinesGate = aiaGenerateGate({ ...invoiceSnap, outputFormat: "aia_g702", lineCount: 0 });
assert.equal(noLinesGate.ready, false);
assert.equal(noLinesGate.blockingStep, "sov");
assert.match(noLinesGate.reason, /Import your schedule of values first/);

// AIA + lines: ready, even with zero this-period activity (a valid $0
// certificate). Entries are never a hard prerequisite.
const zeroPeriodGate = aiaGenerateGate({
  outputFormat: "aia_g702",
  lineCount: 12,
  linesWithActivity: 0,
  overbilledCount: 0,
});
assert.equal(zeroPeriodGate.ready, true);
assert.equal(zeroPeriodGate.blockingStep, "generate");
assert.equal(zeroPeriodGate.reason, "");

// Step statuses: format always done; sov active until imported; generate
// active once ready.
const noLinesSteps = aiaBuilderSteps({ ...invoiceSnap, outputFormat: "aia_g702", lineCount: 0 });
assert.equal(noLinesSteps.find((s) => s.key === "format")?.status, "done");
assert.equal(noLinesSteps.find((s) => s.key === "sov")?.status, "active");
assert.equal(noLinesSteps.find((s) => s.key === "generate")?.status, "todo");
const readySteps = aiaBuilderSteps(
  zeroPeriodGate.ready
    ? {
        outputFormat: "aia_g702",
        lineCount: 12,
        linesWithActivity: 3,
        overbilledCount: 0,
      }
    : invoiceSnap,
);
assert.equal(readySteps.find((s) => s.key === "sov")?.status, "done");
assert.equal(readySteps.find((s) => s.key === "generate")?.status, "active");
assert.match(readySteps.find((s) => s.key === "entries")?.detail ?? "", /3 of 12 lines/);

// --- CO reaches G702 line 2 (GETTINGPAID3 Task 2 integration) -----------------

// Approve a change order through the CO model, allocate it to an SOV cost
// code, generate the application lines with the SAME code production runs,
// then assert the G702 face separates original contract (line 1) from the
// net change order (line 2) and the G703 total reconciles to line 4.
const SITEWORK_ID = "bucket-sitework";
const FINISHES_ID = "bucket-finishes";
const generated = buildBillingLinesFromBuckets({
  buckets: [
    {
      id: SITEWORK_ID,
      cost_code: "0100",
      bucket: "Sitework",
      original_budget: 220_000,
      retainage_pct: 10,
      billing_method: "percent",
      sort_order: 1,
    },
    {
      id: FINISHES_ID,
      cost_code: "0900",
      bucket: "Finishes",
      original_budget: 780_000,
      retainage_pct: 10,
      billing_method: "percent",
      sort_order: 2,
    },
  ],
  changeOrders: [
    { id: "co-approved", status: "Approved" },
    { id: "co-pending", status: "Pending" },
  ],
  allocations: [
    // Approved CO allocated to Finishes -> flows to line 2.
    { change_order_id: "co-approved", cost_bucket_id: FINISHES_ID, contract_amount: 65_000 },
    // Pending CO allocation must NOT count.
    { change_order_id: "co-pending", cost_bucket_id: SITEWORK_ID, contract_amount: 40_000 },
  ],
  previousLines: [],
  amountBilled: 0,
  defaultRetainagePct: 10,
});
// The CO rides change_order_value_cents on its allocated line only.
const finishesLine = generated.find((line) => line.cost_bucket_id === FINISHES_ID);
const siteworkLine = generated.find((line) => line.cost_bucket_id === SITEWORK_ID);
assert.equal(finishesLine?.change_order_value_cents, 65_000_00);
assert.equal(finishesLine?.scheduled_value_cents, 780_000_00);
assert.equal(siteworkLine?.change_order_value_cents, 0); // pending CO excluded
assert.equal(siteworkLine?.scheduled_value_cents, 220_000_00);

// Feed the generated lines through the G703/G702 math (add completed work so
// the certificate is non-trivial), then check the face.
const coG703Inputs = generated.map((line) => ({
  cost_code: line.cost_code,
  description: line.description,
  scheduled_value_cents: line.scheduled_value_cents,
  change_order_value_cents: line.change_order_value_cents,
  work_completed_previous_cents: 0,
  materials_stored_previous_cents: 0,
  work_completed_this_period_cents: Math.round(
    (line.scheduled_value_cents + line.change_order_value_cents) * 0.25,
  ),
  materials_stored_this_period_cents: 0,
  work_completed_to_date_cents: Math.round(
    (line.scheduled_value_cents + line.change_order_value_cents) * 0.25,
  ),
  materials_stored_to_date_cents: 0,
  total_completed_and_stored_cents: Math.round(
    (line.scheduled_value_cents + line.change_order_value_cents) * 0.25,
  ),
  balance_to_finish_cents: Math.round(
    (line.scheduled_value_cents + line.change_order_value_cents) * 0.75,
  ),
  retainage_pct: line.retainage_pct,
  retainage_held_cents: 0,
  retainage_released_cents: 0,
}));
const coRows = computeG703Rows(coG703Inputs);
const coTotals = computeG703Totals(coRows);
const coFace = computeG702Face({
  // Line 1 sums only base SOV (scheduled_value_cents), EXCLUDING the CO.
  originalContractSumCents: generated.reduce((sum, line) => sum + line.scheduled_value_cents, 0),
  // Line 2 = net change by approved change orders.
  netChangeByChangeOrdersCents: generated.reduce(
    (sum, line) => sum + line.change_order_value_cents,
    0,
  ),
  totals: coTotals,
  previousCertificatesCents: computePreviousCertificatesCents(coG703Inputs),
});
// (a) line 1 = original contract EXCLUDING the CO.
assert.equal(coFace.originalContractSumCents, 1_000_000_00); // 220k + 780k
// (b) line 2 = net CO value (only the approved+allocated one).
assert.equal(coFace.netChangeByChangeOrdersCents, 65_000_00);
// (c) line 3 = 1 + 2.
assert.equal(coFace.contractSumToDateCents, 1_065_000_00);
assert.equal(
  coFace.contractSumToDateCents,
  coFace.originalContractSumCents + coFace.netChangeByChangeOrdersCents,
);
// (d) CO summary is populated (net change is non-zero and positive).
assert.ok(coFace.netChangeByChangeOrdersCents > 0);
// (e) G703 grand total (column C) reconciles to line 3, and column G to line 4.
assert.equal(coTotals.scheduledValueCents, coFace.contractSumToDateCents);
assert.equal(coTotals.totalCompletedStoredCents, coFace.totalCompletedStoredCents);

// --- WIP honesty (WIPHONESTY1): earned % is never borrowed from the project roll-up ---
// Three buckets: assessed at 25%, explicitly assessed at 0%, and never assessed (null).
// A project shown "60% complete" must NOT leak 60% into any of them.
const wipBase: Omit<WIPBucketInput, "cost_bucket_id" | "earned_percent_complete"> = {
  cost_code: "01",
  bucket: "Bucket",
  original_budget: 100_000,
  change_order_additions: 0,
  actual_to_date: 0,
  ftc: 0,
  billed_to_date: 40_000,
  retainage_held: 0,
  retainage_released: 0,
};

// Assessed at 25% earns exactly 25% of contract.
const assessed25 = computeWIPBucket({
  ...wipBase,
  cost_bucket_id: "a",
  earned_percent_complete: 25,
});
assert.equal(assessed25.assessed, true);
assert.equal(assessed25.earned_revenue, 25_000);
assert.equal(assessed25.over_under_billing, 15_000); // billed 40k - earned 25k

// Explicit 0% is a real assessment: earns 0, NOT the project roll-up. This is the `||`-zero bug.
const assessed0 = computeWIPBucket({ ...wipBase, cost_bucket_id: "b", earned_percent_complete: 0 });
assert.equal(assessed0.assessed, true);
assert.equal(assessed0.earned_revenue, 0);
assert.equal(assessed0.over_under_billing, 40_000); // billed 40k - earned 0

// Never assessed: earned and over/under are null ("not assessed"), never 0 and never 60%.
const notAssessed = computeWIPBucket({
  ...wipBase,
  cost_bucket_id: "c",
  earned_percent_complete: null,
});
assert.equal(notAssessed.assessed, false);
assert.equal(notAssessed.earned_revenue, null);
assert.equal(notAssessed.over_under_billing, null);

// Project roll-up excludes the unassessed bucket and reports coverage.
const projectWip = computeProjectWIP(
  { id: "p", name: "Test" },
  [
    { ...wipBase, cost_bucket_id: "a", earned_percent_complete: 25 },
    { ...wipBase, cost_bucket_id: "b", earned_percent_complete: 0 },
    { ...wipBase, cost_bucket_id: "c", earned_percent_complete: null },
  ],
  0,
);
assert.equal(projectWip.bucket_count, 3);
assert.equal(projectWip.assessed_bucket_count, 2);
// Earned totals only the assessed buckets (25k + 0), never inventing earnings for bucket c.
assert.equal(projectWip.total_earned, 25_000);

// --- Change-order → cost-code allocation (Harbor coherence) -------------------

// Allocation totals sum per CO in cents; unallocated is never negative.
const ALLOCS = [
  { change_order_id: "co-a", cost_bucket_id: "b1", contract_amount: 40_000 },
  { change_order_id: "co-a", cost_bucket_id: "b2", contract_amount: 25_000.5 },
  { change_order_id: "co-b", cost_bucket_id: "b1", contract_amount: 10_000 },
];
const allocByCo = allocatedContractByChangeOrder(ALLOCS);
assert.equal(allocByCo.get("co-a"), 65_000.5); // split across two cost codes, cents-exact
assert.equal(allocByCo.get("co-b"), 10_000);
assert.equal(allocByCo.get("co-none"), undefined);

// A $65,000 CO fully allocated leaves nothing; a partial leaves the balance.
assert.equal(unallocatedContract(65_000, 65_000), 0);
assert.equal(unallocatedContract(65_000, 40_000), 25_000);
assert.equal(unallocatedContract(65_000, 70_000), 0); // over-allocation clamps to zero

const partial = summarizeApprovedCo("co-a", 145_000, ALLOCS);
assert.equal(partial.allocated, 65_000.5);
assert.equal(partial.remaining, 79_999.5);
assert.equal(partial.fullyAllocated, false);

const full = summarizeApprovedCo("co-b", 10_000, ALLOCS);
assert.equal(full.allocated, 10_000);
assert.equal(full.remaining, 0);
assert.equal(full.fullyAllocated, true);

// An unallocated approved CO reports its whole value as remaining (the
// "allocate to bill it" nudge).
const none = summarizeApprovedCo("co-c", 85_000, ALLOCS);
assert.equal(none.allocated, 0);
assert.equal(none.remaining, 85_000);
assert.equal(none.fullyAllocated, false);

// --- Exposure → cost-code allocation (At Risk goes live, BUDGETENGINE P1) -----

// An exposure (E/C hold) spreads across cost codes; totals sum in cents.
const EXPO_ALLOCS = [
  { exposure_id: "e-1", cost_bucket_id: "b1", cost_code: "0900", amount: 12_000 },
  { exposure_id: "e-1", cost_bucket_id: "b2", cost_code: "1500", amount: 6_000.5 },
  { exposure_id: "c-1", cost_bucket_id: null, cost_code: "", amount: 5_000 },
];
const allocByExp = allocatedByExposure(EXPO_ALLOCS);
assert.equal(allocByExp.get("e-1"), 18_000.5); // split across two codes, cents-exact
assert.equal(allocByExp.get("c-1"), 5_000);

// Unallocated remainder = general job risk, never negative.
assert.equal(unallocatedExposure(18_000.5, 18_000.5), 0);
assert.equal(unallocatedExposure(30_000, 18_000.5), 11_999.5);
assert.equal(unallocatedExposure(18_000, 25_000), 0); // over-allocation clamps

const expPartial = summarizeExposure("e-1", 30_000, EXPO_ALLOCS);
assert.equal(expPartial.allocated, 18_000.5);
assert.equal(expPartial.remaining, 11_999.5);
assert.equal(expPartial.fullyAllocated, false);

// E-Holds roll into At Risk, C-Holds into Contingency, per cost code; a C-Hold
// left unallocated to a bucket lands in general risk (null bucket).
const RISK = riskByCostCode(
  [
    { id: "e-1", dollar_exposure: 30_000, hold_class: "E-Hold" as const },
    { id: "c-1", dollar_exposure: 5_000, hold_class: "C-Hold" as const },
  ],
  EXPO_ALLOCS,
);
const riskB1 = RISK.find((r) => r.costBucketId === "b1");
assert.equal(riskB1?.atRisk, 12_000); // E-Hold on 0900
assert.equal(riskB1?.contingency, 0);
const riskB2 = RISK.find((r) => r.costBucketId === "b2");
assert.equal(riskB2?.atRisk, 6_000.5);
const generalRisk = RISK.find((r) => r.costBucketId === null);
assert.equal(generalRisk?.contingency, 5_000); // unallocated C-Hold → general contingency
assert.equal(generalRisk?.atRisk, 0);

// --- Budget-vs-cost ledger (BUDGETENGINE Phase 2) -----------------------------

// EAC = Actuals + Open; (Over)/Under = Budget − EAC; At Risk / Contingency come
// from the exposure allocations. All summed in cents, converted once.
const LEDGER = computeBudgetLedger(
  [
    {
      id: "b-mep",
      cost_code: "1500",
      bucket: "MEP",
      original_budget: 480_000,
      actual_to_date: 260_000,
      ftc: 240_000,
    },
    {
      id: "b-fin",
      cost_code: "0900",
      bucket: "Finishes",
      original_budget: 780_000,
      actual_to_date: 180_000,
      ftc: 690_000,
    },
  ],
  [
    { id: "e-1", dollar_exposure: 12_000, hold_class: "E-Hold" as const },
    { id: "c-1", dollar_exposure: 5_000, hold_class: "C-Hold" as const },
  ],
  [
    { exposure_id: "e-1", cost_bucket_id: "b-mep", cost_code: "1500", amount: 12_000 },
    { exposure_id: "c-1", cost_bucket_id: null, cost_code: "", amount: 5_000 },
  ],
);
const mepRow = LEDGER.rows.find((r) => r.costBucketId === "b-mep");
assert.equal(mepRow?.eac, 500_000); // 260k actuals + 240k open
assert.equal(mepRow?.overUnder, -20_000); // 480k budget − 500k EAC = over by 20k
assert.equal(mepRow?.atRisk, 12_000); // E-Hold allocated to MEP
const finRow = LEDGER.rows.find((r) => r.costBucketId === "b-fin");
assert.equal(finRow?.eac, 870_000); // 180k + 690k
assert.equal(finRow?.overUnder, -90_000); // 780k − 870k
// The unallocated C-Hold surfaces as its own general-risk line.
const generalLedgerRow = LEDGER.rows.find((r) => r.costBucketId === null);
assert.equal(generalLedgerRow?.contingency, 5_000);
// Totals accumulate every column in cents.
assert.equal(LEDGER.totals.budget, 1_260_000); // 480k + 780k
assert.equal(LEDGER.totals.eac, 1_370_000); // 500k + 870k
assert.equal(LEDGER.totals.atRisk, 12_000);
assert.equal(LEDGER.totals.contingency, 5_000);
assert.equal(LEDGER.totals.overUnder, -110_000); // 1.26M − 1.37M = over by 110k

// --- Estimate → Budget carry (BUDGETENGINE Phase 3) ---------------------------

// Budget = estimate line COSTS (material + labor) grouped by cost code, summed
// in cents. Scope group names the bucket; a blank cost code is not dropped.
const EST_LINES = [
  {
    cost_code: "1500",
    csi_division: "15",
    scope_group: "MEP rough-in",
    description: "Ductwork",
    total_extended_cents: 200_000_00,
  },
  {
    cost_code: "1500",
    csi_division: "15",
    scope_group: "MEP rough-in",
    description: "Piping",
    total_extended_cents: 80_000_50,
  },
  {
    cost_code: "0900",
    csi_division: "09",
    scope_group: "",
    description: "Paint",
    total_extended_cents: 45_000_00,
  },
  {
    cost_code: "",
    csi_division: "01",
    scope_group: "General",
    description: "Supervision",
    total_extended_cents: 10_000_00,
  },
];
const estBudget = aggregateEstimateToBudget(EST_LINES);
assert.equal(estBudget.length, 3); // 1500, 0900, and the uncoded group
const mepBudget = estBudget.find((b) => b.costCode === "1500");
assert.equal(mepBudget?.budget, 280_000.5); // 200,000.00 + 80,000.50, cents-exact
assert.equal(mepBudget?.description, "MEP rough-in"); // scope group wins
const finBudget = estBudget.find((b) => b.costCode === "0900");
assert.equal(finBudget?.budget, 45_000);
assert.equal(finBudget?.description, "Paint"); // no scope group → first description
const uncoded = estBudget.find((b) => b.costCode === "");
assert.equal(uncoded?.budget, 10_000); // blank cost code kept, not dropped
assert.equal(uncoded?.description, "General");

// End-to-end: allocate a CO to a bucket, then build the lines — the allocated
// value rides change_order_value_cents on that bucket's line (G702 line 2).
const allocatedLines = buildBillingLinesFromBuckets({
  buckets: [
    {
      id: "b-finishes",
      cost_code: "0900",
      bucket: "Finishes",
      original_budget: 780_000,
      retainage_pct: 10,
      billing_method: "percent",
      sort_order: 1,
    },
  ],
  changeOrders: [{ id: "co-a", status: "Approved" }],
  allocations: [{ change_order_id: "co-a", cost_bucket_id: "b-finishes", contract_amount: 65_000 }],
  previousLines: [],
  amountBilled: 0,
  defaultRetainagePct: 10,
});
assert.equal(allocatedLines[0].change_order_value_cents, 65_000_00);
assert.equal(allocatedLines[0].scheduled_value_cents, 780_000_00);

console.log("billing payments smoke: all assertions passed");
