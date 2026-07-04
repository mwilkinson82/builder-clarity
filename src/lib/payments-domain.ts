// Payments Phase 1 domain logic (Tier 0 direct remittance + Tier 1 Stripe).
//
// Pure functions only: no Supabase, no Stripe, no env reads. Server routes and
// UI call into this module so the money math and the payment state machine can
// be unit-tested without secrets (scripts/billing-payments-smoke.ts).
//
// All amounts in this module are integer cents. Database columns that predate
// this phase store decimal dollars; convert at the boundary with
// dollarsToCents/centsToDollars and keep every intermediate step in cents.

export type PaymentMethodKey = "direct_bank" | "card" | "ach_debit";

export type PaymentSource = "manual" | "stripe";

// Payment record state machine (documented in the payment_ledger migration):
//   manual records are created as 'succeeded' (an authorized user attesting
//   money already arrived) and may only move to 'refunded' or 'void'.
//   stripe records flow pending -> succeeded | failed, and succeeded ->
//   refunded on charge.refunded. 'failed' and 'void' are terminal.
export type PaymentState = "pending" | "succeeded" | "failed" | "refunded" | "void";

const PAYMENT_TRANSITIONS: Record<PaymentSource, Record<PaymentState, PaymentState[]>> = {
  manual: {
    pending: [],
    succeeded: ["refunded", "void"],
    failed: [],
    refunded: [],
    void: [],
  },
  stripe: {
    pending: ["succeeded", "failed"],
    succeeded: ["refunded"],
    failed: [],
    refunded: [],
    void: [],
  },
};

export function initialPaymentState(source: PaymentSource): PaymentState {
  return source === "manual" ? "succeeded" : "pending";
}

export function canTransitionPayment(
  source: PaymentSource,
  from: PaymentState,
  to: PaymentState,
): boolean {
  return PAYMENT_TRANSITIONS[source][from]?.includes(to) ?? false;
}

export function dollarsToCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

export function centsToDollars(cents: number): number {
  if (!Number.isFinite(cents)) return 0;
  return Math.round(cents) / 100;
}

// ---------------------------------------------------------------------------
// Cents-exact derivation math (SOV -> pay application -> invoice)
// ---------------------------------------------------------------------------
// Fractional-cent drift from float-dollar percent math reached a stored
// invoice total (live case: invoice 2601-001, $1,908,224.99 instead of
// $1,908,225.00). Every derivation must round at each LINE, sum in integer
// cents, and only convert back to dollars at the edge.

// Percent applied to a cents base, rounded at the line.
export function percentOfCents(baseCents: number, percent: number): number {
  if (!Number.isFinite(baseCents) || !Number.isFinite(percent)) return 0;
  return Math.round((baseCents * percent) / 100);
}

// Percent applied to a decimal-dollar value; returns exact-cent dollars.
export function percentOfDollars(value: number, percent: number): number {
  return centsToDollars(percentOfCents(dollarsToCents(value), percent));
}

// Snap a decimal-dollar value (possibly carrying float drift) to exact cents.
export function quantizeDollars(value: number): number {
  return centsToDollars(dollarsToCents(value));
}

// Sum decimal-dollar values as integer cents: round each item, then add.
export function sumDollarsToCents(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + dollarsToCents(value), 0);
}

// SOV line percent entry: "complete to date" percent -> this-period work, in
// cents. Rounds the earned value at the line before subtracting prior
// progress and stored materials.
export function lineWorkForPercentCents(input: {
  contractCents: number;
  targetPercent: number;
  previousCents: number;
  storedCents: number;
}): number {
  return Math.max(
    0,
    percentOfCents(input.contractCents, input.targetPercent) -
      Math.round(input.previousCents) -
      Math.round(input.storedCents),
  );
}

// Invoice money derived from a pay application: subtotal less retainage plus
// released retainage, computed in cents. Returns exact-cent dollars.
export function invoiceTotalDueDollars(input: {
  subtotal: number;
  retainage: number;
  retainageReleased: number;
}): number {
  return centsToDollars(
    Math.max(
      0,
      dollarsToCents(input.subtotal) -
        dollarsToCents(input.retainage) +
        dollarsToCents(input.retainageReleased),
    ),
  );
}

export interface PaymentAmountRecord {
  amountCents: number;
  state: PaymentState;
}

export interface InvoicePaymentTotals {
  paidCents: number;
  remainingCents: number;
  status: "paid" | "partially_paid" | "unpaid";
}

// Only succeeded payments count toward the invoice. Refunded records stop
// counting the moment they flip, which is what pulls an invoice back from
// "paid" after a Stripe refund.
export function invoicePaymentTotals(
  totalDueCents: number,
  payments: readonly PaymentAmountRecord[],
): InvoicePaymentTotals {
  const paidCents = payments.reduce(
    (sum, payment) => (payment.state === "succeeded" ? sum + Math.round(payment.amountCents) : sum),
    0,
  );
  const remainingCents = Math.max(0, Math.round(totalDueCents) - paidCents);
  const status = paidCents <= 0 ? "unpaid" : remainingCents <= 0 ? "paid" : "partially_paid";
  return { paidCents, remainingCents, status };
}

export function isOverRecording(remainingCents: number, newAmountCents: number): boolean {
  return newAmountCents > Math.max(0, remainingCents);
}

// ---------------------------------------------------------------------------
// Per-invoice payment method toggles
// ---------------------------------------------------------------------------

export interface EnabledPaymentMethods {
  direct_bank: boolean;
  card: boolean;
  ach_debit: boolean;
  // Deliberate contractor override: show Stripe methods even above the
  // company's Stripe amount threshold.
  allow_stripe_over_threshold: boolean;
}

export const FALLBACK_ENABLED_METHODS: EnabledPaymentMethods = {
  direct_bank: true,
  card: true,
  ach_debit: true,
  allow_stripe_over_threshold: false,
};

export const DEFAULT_STRIPE_AMOUNT_THRESHOLD_CENTS = 2_500_000; // $25,000

function readFlag(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = source[key];
  return typeof value === "boolean" ? value : fallback;
}

// Invoice-level jsonb wins key-by-key over company defaults; company defaults
// win over the hard-coded fallback. An empty {} therefore means "inherit".
export function resolveEnabledMethods(
  invoiceMethods: unknown,
  companyDefaults: unknown,
): EnabledPaymentMethods {
  const company = (companyDefaults ?? {}) as Record<string, unknown>;
  const invoice = (invoiceMethods ?? {}) as Record<string, unknown>;
  const resolve = (key: keyof EnabledPaymentMethods) =>
    readFlag(invoice, key, readFlag(company, key, FALLBACK_ENABLED_METHODS[key]));
  return {
    direct_bank: resolve("direct_bank"),
    card: resolve("card"),
    ach_debit: resolve("ach_debit"),
    allow_stripe_over_threshold: resolve("allow_stripe_over_threshold"),
  };
}

export function stripeConnectReady(input: {
  accountId: string;
  connectStatus: string;
  processorReady: boolean;
}): boolean {
  return Boolean(input.accountId) && input.connectStatus === "active" && input.processorReady;
}

export interface MethodAvailabilityInput {
  hasPaymentProfile: boolean;
  stripeReady: boolean;
  enabled: EnabledPaymentMethods;
  invoiceTotalCents: number;
  thresholdCents: number;
}

export interface MethodAvailabilityEntry {
  // Contractor turned the toggle on for this invoice.
  enabled: boolean;
  // The client actually sees a way to pay with it right now.
  available: boolean;
  reason: "" | "no_payment_profile" | "stripe_not_ready" | "over_threshold" | "toggled_off";
}

export interface MethodAvailability {
  direct_bank: MethodAvailabilityEntry;
  card: MethodAvailabilityEntry;
  ach_debit: MethodAvailabilityEntry;
  stripeHiddenByThreshold: boolean;
}

export function methodAvailability(input: MethodAvailabilityInput): MethodAvailability {
  const threshold =
    input.thresholdCents > 0 ? input.thresholdCents : DEFAULT_STRIPE_AMOUNT_THRESHOLD_CENTS;
  const overThreshold =
    input.invoiceTotalCents > threshold && !input.enabled.allow_stripe_over_threshold;

  const entry = (
    enabled: boolean,
    blocked: MethodAvailabilityEntry["reason"],
  ): MethodAvailabilityEntry => {
    if (!enabled) return { enabled, available: false, reason: "toggled_off" };
    if (blocked) return { enabled, available: false, reason: blocked };
    return { enabled, available: true, reason: "" };
  };

  const stripeBlocked: MethodAvailabilityEntry["reason"] = !input.stripeReady
    ? "stripe_not_ready"
    : overThreshold
      ? "over_threshold"
      : "";

  return {
    direct_bank: entry(
      input.enabled.direct_bank,
      input.hasPaymentProfile ? "" : "no_payment_profile",
    ),
    card: entry(input.enabled.card, stripeBlocked),
    ach_debit: entry(input.enabled.ach_debit, stripeBlocked),
    stripeHiddenByThreshold:
      overThreshold && input.stripeReady && (input.enabled.card || input.enabled.ach_debit),
  };
}

// ---------------------------------------------------------------------------
// Remittance presentation
// ---------------------------------------------------------------------------

export function renderRemittanceMemo(template: string, invoiceNumber: string): string {
  const memo = (template || "Reference: Invoice {number}").replaceAll(
    "{number}",
    invoiceNumber || "",
  );
  return memo.trim();
}

export function maskAccountTail(value: string): string {
  const digits = (value || "").replace(/\s+/g, "");
  if (!digits) return "";
  const tail = digits.slice(-4);
  return `•••• ${tail}`;
}

// ---------------------------------------------------------------------------
// Card fee pass-through (estimated surcharge)
// ---------------------------------------------------------------------------

export const CARD_FEE_PERCENT_BPS = 290; // 2.9%
export const CARD_FEE_FIXED_CENTS = 30;

// Estimate of the processor's card fee on a charge of baseCents, added as a
// separate surcharge line when the company enables pass-through. It is an
// estimate (no gross-up): the fee Stripe takes applies to base + surcharge,
// so the contractor absorbs the sliver of fee-on-the-fee. Documented in
// docs/phases/STRIPEPHASE1.md; lawfulness of surcharging is the contractor's
// responsibility in their state.
export function estimatedCardFeeCents(baseCents: number): number {
  if (!Number.isFinite(baseCents) || baseCents <= 0) return 0;
  return Math.round((baseCents * CARD_FEE_PERCENT_BPS) / 10000) + CARD_FEE_FIXED_CENTS;
}

// ---------------------------------------------------------------------------
// Refund reversal (BILLINGBATCH2 Task 0 — live bug: invoice 2601-3)
// ---------------------------------------------------------------------------

export interface ChargeRefundInput {
  // Cents the ledger row currently counts toward the invoice (base amount,
  // surcharge excluded at booking time).
  bookedCents: number;
  // charge.amount — the gross charge including any surcharge.
  chargeAmountCents: number;
  // charge.amount_refunded — CUMULATIVE cents refunded so far.
  amountRefundedCents: number;
  // charge.refunded — true only when the charge is fully refunded.
  fullyRefunded: boolean;
}

export interface ChargeRefundPlan {
  // What the ledger row should become. Full refunds flip status and stop
  // counting (amount preserved for audit); partial refunds stay succeeded
  // with the counted amount reduced.
  ledgerStatus: "succeeded" | "refunded";
  ledgerAmountCents: number;
  // Cents of invoice progress this event reverses (for messaging/tests; the
  // invoice itself is recomputed from the ledger, never decremented blindly).
  reversalCents: number;
}

// charge.refunded planning. Surcharge rule: refunds consume the surcharge
// portion of the charge last, so a refund equal to the surcharge alone
// reverses no invoice progress — the counted remainder is capped by what is
// left of the gross charge.
export function planChargeRefund(input: ChargeRefundInput): ChargeRefundPlan {
  const booked = Math.max(0, Math.round(input.bookedCents));
  const grossLeft = Math.max(
    0,
    Math.round(input.chargeAmountCents) - Math.round(input.amountRefundedCents),
  );
  const remaining = input.fullyRefunded ? 0 : Math.min(booked, grossLeft);
  if (remaining <= 0) {
    return { ledgerStatus: "refunded", ledgerAmountCents: booked, reversalCents: booked };
  }
  return {
    ledgerStatus: "succeeded",
    ledgerAmountCents: remaining,
    reversalCents: booked - remaining,
  };
}

export interface LedgerRowForReconcile {
  amountCents: number;
  status: PaymentState;
}

export interface InvoiceReconcileInput {
  totalDueCents: number;
  // Current invoice status; void and draft are preserved when no payments
  // remain (reconcile never resurrects a void invoice or sends a draft).
  currentStatus: string;
  currentPaidAtIso: string | null;
  rows: readonly LedgerRowForReconcile[];
  nowIso: string;
}

export interface InvoiceReconcilePatch {
  paidCents: number;
  status: "paid" | "partially_paid" | "sent" | "draft" | "void";
  paidAtIso: string | null;
}

// The ledger is the truth: only succeeded rows count (refunded/failed/void/
// pending count zero). Recomputes what the invoice must say — used by the
// refund webhook and by the on-demand reconcile action, so correcting a
// drifted invoice always goes through this one code path.
export function reconcileInvoiceFromLedger(input: InvoiceReconcileInput): InvoiceReconcilePatch {
  const paidCents = input.rows.reduce(
    (sum, row) => (row.status === "succeeded" ? sum + Math.round(row.amountCents) : sum),
    0,
  );
  if (input.currentStatus === "void") {
    return { paidCents, status: "void", paidAtIso: input.currentPaidAtIso };
  }
  const totalDueCents = Math.round(input.totalDueCents);
  if (totalDueCents > 0 && paidCents >= totalDueCents) {
    return {
      paidCents,
      status: "paid",
      paidAtIso: input.currentPaidAtIso ?? input.nowIso,
    };
  }
  if (paidCents > 0) {
    return { paidCents, status: "partially_paid", paidAtIso: null };
  }
  // A balance reopened (or never closed): back to sent — unless the invoice
  // never left draft.
  return {
    paidCents,
    status: input.currentStatus === "draft" ? "draft" : "sent",
    paidAtIso: null,
  };
}

// ---------------------------------------------------------------------------
// Pending-payment lock (BILLINGBATCH2 Task 1 — the double-collection class)
// ---------------------------------------------------------------------------

// A Stripe checkout session outlives the click that created it. While one is
// pending (created or ACH processing, neither resolved nor expired), every
// pay surface must lock instead of collecting a second payment against the
// same invoice. Stripe sessions expire after 24h; anything older than the
// window is treated as stale so a missed expiry webhook can never lock an
// invoice forever.
export const PENDING_LOCK_MAX_AGE_HOURS = 25;

export interface PendingPaymentLockInput {
  onlinePaymentStatus: string;
  checkoutSessionId: string;
  paymentLinkSentAtIso: string | null;
  openBalanceCents: number;
  nowIso: string;
}

export interface PendingPaymentLockState {
  locked: boolean;
  startedAtIso: string | null;
}

export function pendingPaymentLock(input: PendingPaymentLockInput): PendingPaymentLockState {
  if (input.onlinePaymentStatus !== "pending") return { locked: false, startedAtIso: null };
  if (!input.checkoutSessionId) return { locked: false, startedAtIso: null };
  if (input.openBalanceCents <= 0) return { locked: false, startedAtIso: null };
  if (!input.paymentLinkSentAtIso) return { locked: false, startedAtIso: null };
  const startedMs = Date.parse(input.paymentLinkSentAtIso);
  const nowMs = Date.parse(input.nowIso);
  if (!Number.isFinite(startedMs) || !Number.isFinite(nowMs)) {
    return { locked: false, startedAtIso: null };
  }
  const ageHours = (nowMs - startedMs) / 3_600_000;
  if (ageHours < 0 || ageHours > PENDING_LOCK_MAX_AGE_HOURS) {
    return { locked: false, startedAtIso: null };
  }
  return { locked: true, startedAtIso: input.paymentLinkSentAtIso };
}

// ---------------------------------------------------------------------------
// Stripe webhook -> payment record planning
// ---------------------------------------------------------------------------

// ACH debits are asynchronous (up to 4 business days): for them,
// checkout.session.completed is only authorization — payment_status arrives
// as "unpaid" and the money lands later via
// checkout.session.async_payment_succeeded (or _failed). Booking must wait.
export function checkoutSessionOutcome(paymentStatus: string): "book" | "await_async" {
  return paymentStatus === "paid" || paymentStatus === "no_payment_required"
    ? "book"
    : "await_async";
}

export interface CheckoutCompletionInput {
  amountTotalCents: number;
  surchargeCents: number;
  overwatchFeeCents: number;
  occurredAtIso: string;
  alreadyRecorded: boolean;
}

export interface InvoicePaymentSnapshot {
  totalDueCents: number;
  paidCents: number;
}

export interface CheckoutCompletionPlan {
  payment: {
    amountCents: number;
    overwatchFeeCents: number;
    netPayoutCents: number;
    state: "succeeded";
  } | null;
  invoicePatch: {
    paidCents: number;
    status: "paid" | "partially_paid";
    paidAtIso: string | null;
  } | null;
}

// Decides what a checkout.session.completed event should write. Idempotency:
// when the session was already recorded (matched by checkout session id or by
// a stored webhook event id), the plan is a full no-op — same event twice
// yields exactly one payment record and no double-count on the invoice.
export function planCheckoutCompletion(
  input: CheckoutCompletionInput,
  invoice: InvoicePaymentSnapshot,
): CheckoutCompletionPlan {
  if (input.alreadyRecorded) return { payment: null, invoicePatch: null };

  const fallbackCents = Math.max(0, invoice.totalDueCents - invoice.paidCents);
  const grossCents = input.amountTotalCents > 0 ? input.amountTotalCents : fallbackCents;
  // The surcharge covers processor fees; it is not progress against the
  // invoice, so only the base amount lands on paid_amount.
  const amountCents = Math.max(0, grossCents - Math.max(0, input.surchargeCents));
  const overwatchFeeCents = Math.max(0, input.overwatchFeeCents);

  const paidCents = invoice.paidCents + amountCents;
  const paid = paidCents >= invoice.totalDueCents;

  return {
    payment: {
      amountCents,
      overwatchFeeCents,
      netPayoutCents: Math.max(0, grossCents - overwatchFeeCents),
      state: "succeeded",
    },
    invoicePatch: {
      paidCents,
      status: paid ? "paid" : "partially_paid",
      paidAtIso: paid ? input.occurredAtIso : null,
    },
  };
}
