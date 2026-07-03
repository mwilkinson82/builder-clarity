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
  isOverRecording,
  maskAccountTail,
  methodAvailability,
  planCheckoutCompletion,
  renderRemittanceMemo,
  resolveEnabledMethods,
  stripeConnectReady,
  type EnabledPaymentMethods,
} from "../src/lib/payments-domain.ts";

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

console.log("billing payments smoke: all assertions passed");
