import { createFileRoute } from "@tanstack/react-router";
import {
  createSupabaseAdminClient,
  isMissingAnySupabaseColumn,
  jsonError,
  jsonOk,
  readServerEnv,
  RouteError,
  stripeGet,
  verifyStripeWebhookPayload,
} from "@/lib/stripe.server";
import { checkoutSessionOutcome, planCheckoutCompletion } from "@/lib/payments-domain";
import {
  claimWebhookEvent,
  createSupabaseWebhookEventStore,
  DEFAULT_WEBHOOK_STALE_SECONDS,
  type WebhookEventStore,
} from "@/lib/stripe-webhook-idempotency";
import {
  stripeModeColumnNames,
  stripeModePersistencePatch,
  type StripeMode,
} from "@/lib/stripe-mode";
import { stripeConnectDetails } from "@/lib/stripe-connect-status";
import { sendCommercialNotice } from "@/lib/commercial-notifications.server";

type StripeObject = Record<string, unknown> & {
  id?: string;
  metadata?: Record<string, string>;
};

type StripeFeeDetail = {
  amount?: number;
  type?: string;
};

type StripeBalanceTransaction = {
  id?: string;
  amount?: number;
  available_on?: number;
  created?: number;
  currency?: string;
  fee?: number;
  fee_details?: StripeFeeDetail[];
  net?: number;
};

type StripeCharge = {
  id?: string;
  balance_transaction?: string | StripeBalanceTransaction | null;
  receipt_url?: string | null;
};

type StripePaymentIntent = {
  id?: string;
  latest_charge?: string | StripeCharge | null;
};

type StripePaymentEconomics = {
  balanceTransactionId: string;
  chargeId: string;
  grossReceivedCents: number;
  netToStripeBalanceCents: number;
  overwatchFeeCents: number;
  processorFeeCents: number;
  receiptUrl: string;
  settledAtIso: string;
};

function str(value: unknown) {
  return typeof value === "string" ? value : "";
}

function num(value: unknown) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function epochToIso(value: unknown) {
  const seconds = num(value);
  return seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

function stripeObjectId(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return str((value as Record<string, unknown>).id);
  return "";
}

function integerCents(value: unknown, label: string) {
  const cents = num(value);
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error(`Stripe ${label} must be a nonnegative integer-cent amount.`);
  }
  return cents;
}

function safeAddCents(left: number, right: number, label: string) {
  return integerCents(left + right, label);
}

async function loadStripePaymentEconomics(input: {
  expectedGrossCents: number;
  paymentIntentId: string;
  stripeAccount: string;
  stripeMode: StripeMode;
}): Promise<StripePaymentEconomics> {
  if (!input.paymentIntentId || !input.stripeAccount) {
    throw new Error("Stripe payment and connected-account provenance are required.");
  }

  const paymentIntent = await stripeGet<StripePaymentIntent>(
    `payment_intents/${encodeURIComponent(input.paymentIntentId)}?expand[]=latest_charge.balance_transaction`,
    input.stripeMode,
    input.stripeAccount,
  );
  let charge = paymentIntent.latest_charge;
  if (typeof charge === "string") {
    charge = await stripeGet<StripeCharge>(
      `charges/${encodeURIComponent(charge)}?expand[]=balance_transaction`,
      input.stripeMode,
      input.stripeAccount,
    );
  }
  if (!charge || typeof charge !== "object") {
    throw new Error("Stripe payment is missing its latest charge evidence.");
  }

  let balanceTransaction = charge.balance_transaction;
  if (typeof balanceTransaction === "string") {
    balanceTransaction = await stripeGet<StripeBalanceTransaction>(
      `balance_transactions/${encodeURIComponent(balanceTransaction)}`,
      input.stripeMode,
      input.stripeAccount,
    );
  }
  if (!balanceTransaction || typeof balanceTransaction !== "object") {
    throw new Error("Stripe charge is missing its balance-transaction evidence.");
  }

  const balanceTransactionId = str(balanceTransaction.id);
  const chargeId = str(charge.id);
  const grossReceivedCents = integerCents(balanceTransaction.amount, "gross amount");
  const totalFeeCents = integerCents(balanceTransaction.fee, "total fee");
  const netToStripeBalanceCents = integerCents(balanceTransaction.net, "net amount");
  const details = Array.isArray(balanceTransaction.fee_details)
    ? balanceTransaction.fee_details
    : [];
  const detailFeeCents = details.reduce(
    (sum, detail) =>
      safeAddCents(sum, integerCents(detail.amount, "fee detail"), "total fee detail"),
    0,
  );
  const overwatchFeeCents = details
    .filter((detail) => detail.type === "application_fee")
    .reduce(
      (sum, detail) =>
        safeAddCents(sum, integerCents(detail.amount, "application fee"), "OverWatch fee"),
      0,
    );
  const processorFeeCents = detailFeeCents - overwatchFeeCents;
  const settledAtIso =
    epochToIso(balanceTransaction.created) ?? epochToIso(balanceTransaction.available_on);

  if (!balanceTransactionId || !chargeId || !settledAtIso) {
    throw new Error("Stripe charge, balance-transaction, and settlement timestamps are required.");
  }
  if (str(balanceTransaction.currency).toLowerCase() !== "usd") {
    throw new Error("Stripe invoice payments must settle in USD.");
  }
  if (
    grossReceivedCents !== input.expectedGrossCents ||
    detailFeeCents !== totalFeeCents ||
    processorFeeCents < 0 ||
    netToStripeBalanceCents !== grossReceivedCents - totalFeeCents
  ) {
    throw new Error("Stripe balance-transaction economics failed reconciliation.");
  }

  return {
    balanceTransactionId,
    chargeId,
    grossReceivedCents,
    netToStripeBalanceCents,
    overwatchFeeCents,
    processorFeeCents,
    receiptUrl: str(charge.receipt_url),
    settledAtIso,
  };
}

type DynamicQueryError = {
  code?: string;
  details?: string;
  hint?: string;
  message: string;
};

type DynamicQueryResult<T = Record<string, unknown>> = {
  data: T | null;
  error: DynamicQueryError | null;
};

type DynamicRpcClient = {
  rpc(
    functionName: string,
    args?: Record<string, unknown>,
  ): Promise<DynamicQueryResult<Record<string, unknown>>>;
};

type DynamicQuery = PromiseLike<DynamicQueryResult> & {
  delete(): DynamicQuery;
  eq(column: string, value: unknown): DynamicQuery;
  insert(values: unknown): DynamicQuery;
  in(column: string, values: unknown[]): DynamicQuery;
  maybeSingle(): DynamicQuery;
  select(columns?: string): DynamicQuery;
  single(): DynamicQuery;
  update(values: unknown): DynamicQuery;
  upsert(
    values: unknown,
    options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): DynamicQuery;
};

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as { from(table: string): DynamicQuery }).from(relation);

const dynamicRpc = (supabase: unknown, functionName: string, args?: Record<string, unknown>) =>
  (supabase as DynamicRpcClient).rpc(functionName, args);

async function updateInvoiceProcessorState(
  admin: unknown,
  input: {
    invoiceId: string;
    status: "pending" | "paid" | "expired" | "failed" | "refunded";
    eventId: string;
    checkoutSessionId?: string;
    paymentIntentId?: string;
  },
) {
  if (!input.eventId) throw new Error("Stripe event id is required for processor idempotency.");
  const { error } = await dynamicRpc(admin, "update_billing_invoice_processor_state_atomic", {
    p_billing_invoice_id: input.invoiceId,
    p_online_payment_status: input.status,
    p_checkout_session_id: input.checkoutSessionId ?? "",
    p_payment_intent_id: input.paymentIntentId ?? "",
    p_payment_url: "",
    p_payment_enabled: input.status === "pending",
    p_payment_link_sent_at: null,
    p_idempotency_key: `stripe:${input.eventId}:processor:${input.status}`,
  });
  if (error) throw new Error(error.message);
}

const CONNECT_PERSISTENCE_COLUMNS = [
  "stripe_connect_account_id_test",
  "stripe_connect_status_test",
  "stripe_connect_account_id_live",
  "stripe_connect_status_live",
  "payment_processor_ready",
] as const;

function isMissingRelationError(error: DynamicQueryError | null) {
  const message = (error?.message ?? "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("could not find the table")
  );
}

/**
 * Stale-claim window (seconds). A row left `processing` this long is assumed
 * to belong to a delivery that died mid-flight, and the next retry re-takes it.
 * Overridable via STRIPE_WEBHOOK_STALE_SECONDS.
 */
function webhookStaleSeconds() {
  const raw = Number.parseInt(readServerEnv("STRIPE_WEBHOOK_STALE_SECONDS"), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_WEBHOOK_STALE_SECONDS;
}

function sessionMetadata(object: StripeObject) {
  return object.metadata ?? {};
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function notificationEnabled(preferences: unknown) {
  const prefs = objectRecord(preferences);
  return prefs.billing !== false && prefs["billing.paid"] !== false;
}

function canReceiveBillingNotification(row: Record<string, unknown>) {
  const capabilities = objectRecord(row.capabilities);
  return row.role === "owner" || row.role === "admin" || capabilities["billing.manage"] === true;
}

function currencyFromCents(amountCents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    amountCents / 100,
  );
}

async function ensureInvoicePaidNotifications(
  admin: unknown,
  invoice: Record<string, unknown>,
  object: StripeObject,
) {
  const projectId = str(invoice.project_id);
  if (!projectId) return;

  const { data: project, error: projectError } = await dynamicTable(admin, "projects")
    .select("id,name,job_number,organization_id,owner_id")
    .eq("id", projectId)
    .single();
  if (projectError || !project) throw new Error(projectError?.message || "Project not found.");

  const organizationId = str(project.organization_id);
  if (!organizationId) return;
  const [organizationMembers, projectMembers] = await Promise.all([
    dynamicTable(admin, "organization_memberships")
      .select("user_id,role,status,capabilities")
      .eq("organization_id", organizationId)
      .eq("status", "active"),
    dynamicTable(admin, "project_memberships")
      .select("user_id,role,status")
      .eq("project_id", projectId)
      .eq("status", "active"),
  ]);
  if (organizationMembers.error) throw new Error(organizationMembers.error.message);
  if (projectMembers.error) throw new Error(projectMembers.error.message);

  const recipientIds = new Set<string>();
  const projectOwnerId = str(project.owner_id);
  if (projectOwnerId) recipientIds.add(projectOwnerId);
  for (const row of (organizationMembers.data ?? []) as unknown as Record<string, unknown>[]) {
    if (canReceiveBillingNotification(row) && str(row.user_id)) recipientIds.add(str(row.user_id));
  }
  for (const row of (projectMembers.data ?? []) as unknown as Record<string, unknown>[]) {
    if ((row.role === "owner" || row.role === "manager") && str(row.user_id)) {
      recipientIds.add(str(row.user_id));
    }
  }
  if (recipientIds.size === 0) return;

  const profiles = await dynamicTable(admin, "profiles")
    .select("id,notification_prefs")
    .in("id", [...recipientIds]);
  if (profiles.error) throw new Error(profiles.error.message);
  const enabledIds = ((profiles.data ?? []) as unknown as Record<string, unknown>[])
    .filter((profile) => notificationEnabled(profile.notification_prefs))
    .map((profile) => str(profile.id))
    .filter(Boolean);
  if (enabledIds.length === 0) return;

  const metadata = sessionMetadata(object);
  const sessionId = str(object.id);
  const invoiceId = str(invoice.id);
  const invoiceLabel = str(invoice.invoice_number) || "Invoice";
  const projectName = str(project.name) || "Project";
  const amountCents = Math.max(
    0,
    Math.round(num(object.amount_total)) - Math.round(num(metadata.surcharge_cents)),
  );
  const amountLabel = currencyFromCents(amountCents);
  const { error } = await dynamicTable(admin, "notifications").upsert(
    enabledIds.map((recipientId) => ({
      recipient_id: recipientId,
      organization_id: organizationId,
      actor_id: null,
      type: "billing.paid",
      title: `${amountLabel} payment received`,
      body: `${invoiceLabel} for ${projectName} was paid through Stripe and recorded in OverWatch.`,
      project_id: projectId,
      entity_type: "billing_invoice",
      entity_id: invoiceId,
      url: `/projects/${projectId}?tab=billing&invoice=${invoiceId}`,
      dedupe_key: `billing.paid:${sessionId}`,
      data: {
        invoice_id: invoiceId,
        invoice_number: invoiceLabel,
        project_id: projectId,
        project_name: projectName,
        amount_cents: amountCents,
        stripe_checkout_session_id: sessionId,
        stripe_payment_intent_id: str(object.payment_intent),
        stripe_mode: str(metadata.stripe_mode),
      },
    })),
    { onConflict: "recipient_id,dedupe_key", ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
  await sendCommercialNotice(admin, {
    organizationId,
    kind: "pro_activated",
    eventId: str(object.id) || str(object.subscription),
  }).catch((noticeError) => {
    console.error("Pro activation notice failed", { organization_id: organizationId, noticeError });
  });
}

function subscriptionStatus(value: string) {
  if (value === "active" || value === "trialing") return "active";
  if (value === "past_due") return "past_due";
  if (value === "unpaid") return "suspended";
  if (value === "canceled" || value === "incomplete_expired") return "cancelled";
  return value || "unknown";
}

function subscriptionPriceId(object: StripeObject) {
  const items = objectRecord(object.items);
  const data = Array.isArray(items.data) ? items.data : [];
  const firstItem = objectRecord(data[0]);
  return str(objectRecord(firstItem.price).id);
}

type CommercialPlan = {
  code: string;
  stripe_price_id: string;
  project_limit: number;
  seat_limit: number;
  storage_limit_mb: number;
  daily_report_limit_per_month: number;
};

async function loadCommercialPlan(admin: unknown, planCode: string, priceId = "") {
  let query = dynamicTable(admin, "subscription_plans").select(
    "code,stripe_price_id,project_limit,seat_limit,storage_limit_mb,daily_report_limit_per_month",
  );
  query = planCode ? query.eq("code", planCode) : query.eq("stripe_price_id", priceId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data)
    throw new Error(`OverWatch plan configuration was not found for ${planCode || priceId}.`);
  return data as unknown as CommercialPlan;
}

function planEntitlementPatch(plan: CommercialPlan) {
  return {
    plan_code: plan.code,
    project_limit: plan.project_limit,
    seat_limit: plan.seat_limit,
    storage_limit_mb: plan.storage_limit_mb,
    daily_report_limit_per_month: plan.daily_report_limit_per_month,
  };
}

function connectAccountStatus(object: StripeObject) {
  return stripeConnectDetails(object);
}

function stripeConnectSchemaNotReady(error: { message?: string } | null) {
  return new RouteError(
    "stripe_schema_not_ready",
    "Stripe webhook processing is waiting on the latest billing database migration.",
    409,
    { cause: error?.message ?? "" },
  );
}

async function handleCheckoutCompleted(
  object: StripeObject,
  stripeAccount: string,
  stripeMode: StripeMode,
  eventId: string,
) {
  const metadata = sessionMetadata(object);
  if (metadata.kind === "client_invoice") {
    // Cards complete with payment_status "paid" and book immediately. ACH
    // (us_bank_account) completes "unpaid" — authorization only — and books
    // on checkout.session.async_payment_succeeded once funds settle.
    if (checkoutSessionOutcome(str(object.payment_status)) === "book") {
      await markInvoicePaid(object, stripeAccount, stripeMode, eventId);
    } else {
      await markInvoiceProcessing(object, eventId);
    }
    return;
  }
  if (metadata.kind === "credit_pack") {
    // AI credit pack (AITAKEOFF1): card-only checkout, so completion books
    // immediately; the async branch below is a safety net.
    if (checkoutSessionOutcome(str(object.payment_status)) === "book") {
      await grantCreditPackPurchase(object);
    }
    return;
  }
  if (metadata.kind === "subscription") {
    await markSubscriptionCheckoutComplete(object);
  }
}

async function handleCheckoutAsyncSucceeded(
  object: StripeObject,
  stripeAccount: string,
  stripeMode: StripeMode,
  eventId: string,
) {
  const metadata = sessionMetadata(object);
  if (metadata.kind === "credit_pack") {
    await grantCreditPackPurchase(object);
    return;
  }
  if (metadata.kind !== "client_invoice") return;
  await markInvoicePaid(object, stripeAccount, stripeMode, eventId);
}

function isMissingCreditLedger(error: DynamicQueryError | null) {
  const message = (error?.message ?? "").toLowerCase();
  return isMissingRelationError(error) && message.includes("credit_ledger");
}

// Credits the AI credit ledger for a completed credit-pack checkout
// (AITAKEOFF1 Task 0). Idempotent twice over: the event-id claim upstream,
// plus one purchase entry per checkout session (unique partial index on
// credit_ledger.reference).
async function grantCreditPackPurchase(object: StripeObject) {
  const metadata = sessionMetadata(object);
  const organizationId = str(metadata.organization_id);
  const credits = Math.round(num(metadata.credits));
  const sessionId = str(object.id);
  if (!organizationId || !sessionId || credits <= 0) return;

  const admin = createSupabaseAdminClient();
  const { data: existing, error: existingError } = await dynamicTable(admin, "credit_ledger")
    .select("id")
    .eq("reason", "purchase")
    .eq("reference", sessionId)
    .maybeSingle();
  if (existingError) {
    if (isMissingCreditLedger(existingError)) {
      // Non-2xx so Stripe retries after the credits migration is applied —
      // a paid pack must never silently drop.
      throw new RouteError(
        "credits_schema_not_ready",
        "Credit pack purchase is waiting on the AI credits database migration.",
        409,
        { cause: existingError.message },
      );
    }
    throw new Error(existingError.message);
  }
  if (existing) return;

  const { error: insertError } = await dynamicTable(admin, "credit_ledger").insert({
    organization_id: organizationId,
    delta: credits,
    reason: "purchase",
    reference: sessionId,
    created_by: str(metadata.user_id) || null,
  });
  if (insertError) {
    // A racing duplicate delivery losing the unique index is already granted.
    if (insertError.code === "23505") return;
    if (isMissingCreditLedger(insertError)) {
      throw new RouteError(
        "credits_schema_not_ready",
        "Credit pack purchase is waiting on the AI credits database migration.",
        409,
        { cause: insertError.message },
      );
    }
    throw new Error(insertError.message);
  }
}

// Async payment (ACH debit) settled later: bank confirmation still pending.
async function markInvoiceProcessing(object: StripeObject, eventId: string) {
  const metadata = sessionMetadata(object);
  if (!metadata.invoice_id) return;
  const admin = createSupabaseAdminClient();
  await updateInvoiceProcessorState(admin, {
    invoiceId: metadata.invoice_id,
    status: "pending",
    eventId,
    checkoutSessionId: str(object.id),
    paymentIntentId: stripeObjectId(object.payment_intent),
  });
}

// Async payment failed after checkout completed (e.g. ACH returned:
// insufficient funds, closed account). No payment was ever booked for the
// session, so only the invoice's online payment state flips.
async function markInvoiceAsyncFailed(object: StripeObject, eventId: string) {
  const metadata = sessionMetadata(object);
  if (metadata.kind !== "client_invoice" || !metadata.invoice_id) return;
  const admin = createSupabaseAdminClient();
  await updateInvoiceProcessorState(admin, {
    invoiceId: metadata.invoice_id,
    status: "failed",
    eventId,
    checkoutSessionId: str(object.id),
    paymentIntentId: stripeObjectId(object.payment_intent),
  });
}

async function handleCheckoutExpired(object: StripeObject, eventId: string) {
  const admin = createSupabaseAdminClient();
  const sessionId = str(object.id);
  const metadata = sessionMetadata(object);

  if (metadata.kind === "client_invoice" && metadata.invoice_id) {
    await updateInvoiceProcessorState(admin, {
      invoiceId: metadata.invoice_id,
      status: "expired",
      eventId,
      checkoutSessionId: sessionId,
      paymentIntentId: stripeObjectId(object.payment_intent),
    });
    return;
  }

  if (metadata.kind === "subscription" && metadata.organization_id) {
    await dynamicTable(admin, "organizations")
      .update({
        billing_status: "checkout_expired",
      })
      .eq("id", metadata.organization_id)
      .eq("stripe_checkout_session_id", sessionId);
  }
}

async function markInvoicePaid(
  object: StripeObject,
  stripeAccount: string,
  stripeMode: StripeMode,
  eventId: string,
) {
  const admin = createSupabaseAdminClient();
  const metadata = sessionMetadata(object);
  const invoiceId = metadata.invoice_id;
  if (!invoiceId) return;

  const { data: invoice, error: invoiceError } = await dynamicTable(admin, "billing_invoices")
    .select("id,project_id,billing_application_id,invoice_number,title,total_due,paid_amount")
    .eq("id", invoiceId)
    .single();
  if (invoiceError || !invoice) throw new Error(invoiceError?.message || "Invoice not found.");

  const sessionId = str(object.id);
  const paymentIntentId = stripeObjectId(object.payment_intent);
  const surchargeCents = integerCents(metadata.surcharge_cents, "surcharge");
  const grossReceivedCents = integerCents(object.amount_total, "checkout gross amount");
  const economics = await loadStripePaymentEconomics({
    expectedGrossCents: grossReceivedCents,
    paymentIntentId,
    stripeAccount,
    stripeMode,
  });
  const paidAt = economics.settledAtIso;

  // All money math in integer cents (payments-domain owns the rules: the
  // surcharge covers fees and never counts as progress against the invoice).
  const plan = planCheckoutCompletion(
    {
      amountTotalCents: grossReceivedCents,
      surchargeCents,
      overwatchFeeCents: integerCents(
        metadata.overwatch_fee_amount_cents,
        "expected OverWatch fee",
      ),
      occurredAtIso: paidAt,
      alreadyRecorded: false,
    },
    {
      totalDueCents: integerCents(Math.round(num(invoice.total_due) * 100), "invoice total"),
      paidCents: integerCents(Math.round(num(invoice.paid_amount) * 100), "invoice paid amount"),
    },
  );
  if (!plan.payment) throw new Error("Stripe Checkout did not produce a valid payment plan.");

  // Financial truth is written only through the parent-first database command.
  // It owns idempotency, invoice locking, overpayment prevention, receipt
  // economics, and invoice/pay-application reconciliation.
  const { error: paymentError } = await dynamicRpc(admin, "record_stripe_invoice_payment_atomic", {
    p_invoice_id: invoice.id,
    p_amount_cents: plan.payment.amountCents,
    p_stripe_balance_transaction_id: economics.balanceTransactionId,
    p_balance_transaction_gross_cents: economics.grossReceivedCents,
    p_balance_transaction_fee_cents: safeAddCents(
      economics.processorFeeCents,
      economics.overwatchFeeCents,
      "balance-transaction fee",
    ),
    p_balance_transaction_net_cents: economics.netToStripeBalanceCents,
    p_balance_transaction_currency: "usd",
    p_surcharge_cents: surchargeCents,
    p_gross_received_cents: grossReceivedCents,
    p_overwatch_fee_cents: economics.overwatchFeeCents,
    p_paid_at: paidAt,
    p_payment_method: "stripe_checkout",
    p_processor_payment_id: paymentIntentId || sessionId,
    p_reference: paymentIntentId || sessionId,
    p_notes: "Stripe Checkout payment completed.",
    p_checkout_session_id: sessionId,
    p_payment_intent_id: paymentIntentId,
    p_charge_id: economics.chargeId,
    p_receipt_url: economics.receiptUrl,
  });
  if (paymentError) throw new Error(paymentError.message);

  await updateInvoiceProcessorState(admin, {
    invoiceId: str(invoice.id),
    status: "paid",
    eventId,
    checkoutSessionId: sessionId,
    paymentIntentId,
  });

  await ensureInvoicePaidNotifications(admin, invoice, object);
}

async function markInvoiceFailed(object: StripeObject, eventId: string) {
  const metadata = sessionMetadata(object);
  const invoiceId = metadata.invoice_id;
  if (!invoiceId) return;

  const admin = createSupabaseAdminClient();
  await updateInvoiceProcessorState(admin, {
    invoiceId,
    status: "failed",
    eventId,
    paymentIntentId: str(object.id),
  });
}

// Refunds append immutable receipt events and reverse the invoice through one
// parent-first database command. Original cash, surcharge, and fee evidence is
// never rewritten.
async function markChargeRefunded(object: StripeObject, eventId: string) {
  const paymentIntentId = str(object.payment_intent);
  if (!paymentIntentId) return;

  const admin = createSupabaseAdminClient();
  const { data: payment, error: paymentError } = await dynamicTable(admin, "payment_ledger")
    .select("id,invoice_id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();
  if (paymentError) throw new Error(paymentError.message);
  if (!payment) {
    throw new RouteError(
      "stripe_payment_not_recorded",
      "The Stripe refund arrived before its payment receipt. Stripe will retry.",
      409,
    );
  }

  const cumulativeRefundedGrossCents = integerCents(
    object.amount_refunded,
    "cumulative refunded amount",
  );
  const refundNote = object.refunded
    ? "Stripe charge fully refunded."
    : `Stripe charge cumulative refund: $${(cumulativeRefundedGrossCents / 100).toFixed(2)}.`;
  const { data: refundResult, error: refundError } = await dynamicRpc(
    admin,
    "refund_invoice_payment_atomic",
    {
      p_payment_id: payment.id,
      p_cumulative_refunded_gross_cents: cumulativeRefundedGrossCents,
      p_notes: refundNote,
      p_processor_event_id: eventId,
      p_idempotency_key: eventId,
      p_stripe_charge_id: str(object.id),
      p_receipt_url: str(object.receipt_url),
    },
  );
  if (refundError) throw new Error(refundError.message);

  if (str(refundResult?.status) === "refunded") {
    await updateInvoiceProcessorState(admin, {
      invoiceId: str(payment.invoice_id),
      status: "refunded",
      eventId,
      paymentIntentId,
    });
  }
}

async function markSubscriptionCheckoutComplete(object: StripeObject) {
  const metadata = sessionMetadata(object);
  const organizationId = metadata.organization_id;
  if (!organizationId) return;

  const admin = createSupabaseAdminClient();
  const plan = await loadCommercialPlan(admin, metadata.plan_code || "pro");
  const { error } = await dynamicTable(admin, "organizations")
    .update({
      ...planEntitlementPatch(plan),
      stripe_customer_id: str(object.customer),
      stripe_subscription_id: str(object.subscription),
      stripe_checkout_session_id: str(object.id),
      stripe_price_id: plan.stripe_price_id,
      billing_status: "active",
      entitlement_source: "stripe",
      contractor_circle_grant: false,
      billing_grace_ends_at: null,
    })
    .eq("id", organizationId);
  if (error) throw new Error(error.message);
}

async function markSubscriptionUpdated(object: StripeObject, stripeEventId = "") {
  const subscriptionId = str(object.id);
  const customerId = str(object.customer);
  const metadata = sessionMetadata(object);
  const organizationId = metadata.organization_id;
  if (!subscriptionId && !organizationId && !customerId) return;

  const admin = createSupabaseAdminClient();
  let organizationQuery = dynamicTable(admin, "organizations").select(
    "id,plan_code,billing_status,billing_grace_ends_at,contractor_circle_grant,entitlement_source",
  );
  if (organizationId) organizationQuery = organizationQuery.eq("id", organizationId);
  else if (subscriptionId) {
    organizationQuery = organizationQuery.eq("stripe_subscription_id", subscriptionId);
  } else organizationQuery = organizationQuery.eq("stripe_customer_id", customerId);
  const { data: organization, error: organizationError } = await organizationQuery.maybeSingle();
  if (organizationError) throw new Error(organizationError.message);
  if (!organization) return;

  const organizationRecord = organization as Record<string, unknown>;
  const normalizedStatus = subscriptionStatus(str(object.status));
  const patch: Record<string, unknown> = {
    stripe_subscription_id: subscriptionId,
    stripe_customer_id: customerId,
    billing_status: normalizedStatus,
    subscription_current_period_end: epochToIso(object.current_period_end),
    subscription_cancel_at_period_end: Boolean(object.cancel_at_period_end),
  };

  if (!organizationRecord.contractor_circle_grant) {
    if (normalizedStatus === "active") {
      const priceId = subscriptionPriceId(object);
      const plan = await loadCommercialPlan(admin, metadata.plan_code || "", priceId);
      Object.assign(patch, planEntitlementPatch(plan), {
        stripe_price_id: plan.stripe_price_id || priceId,
        entitlement_source: "stripe",
        billing_grace_ends_at: null,
      });
    } else if (normalizedStatus === "past_due") {
      const existingGrace = str(organizationRecord.billing_grace_ends_at);
      Object.assign(patch, {
        entitlement_source: "stripe",
        billing_grace_ends_at:
          existingGrace || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
    } else if (normalizedStatus === "cancelled" || normalizedStatus === "suspended") {
      const freePlan = await loadCommercialPlan(admin, "free");
      Object.assign(patch, planEntitlementPatch(freePlan), {
        stripe_subscription_id: "",
        stripe_price_id: "",
        entitlement_source: "free",
        billing_grace_ends_at: null,
      });
    }
  }

  const { error } = await dynamicTable(admin, "organizations")
    .update(patch)
    .eq("id", str(organizationRecord.id));
  if (error) throw new Error(error.message);

  const previousStatus = str(organizationRecord.billing_status);
  const previousSource = str(organizationRecord.entitlement_source);
  const eventId = stripeEventId || str(object.id) || subscriptionId;
  if (normalizedStatus === "active" && previousStatus !== "active") {
    await sendCommercialNotice(admin, {
      organizationId: str(organizationRecord.id),
      kind: "pro_activated",
      eventId,
    }).catch((noticeError) => {
      console.error("Pro activation notice failed", {
        organization_id: organizationId,
        noticeError,
      });
    });
  } else if (normalizedStatus === "past_due" && previousStatus !== "past_due") {
    await sendCommercialNotice(admin, {
      organizationId: str(organizationRecord.id),
      kind: "payment_past_due",
      eventId,
      graceEndsAt: String(patch.billing_grace_ends_at || ""),
    }).catch((noticeError) => {
      console.error("Past-due notice failed", { organization_id: organizationId, noticeError });
    });
  } else if (
    (normalizedStatus === "cancelled" || normalizedStatus === "suspended") &&
    previousSource === "stripe"
  ) {
    await sendCommercialNotice(admin, {
      organizationId: str(organizationRecord.id),
      kind: "subscription_ended",
      eventId,
    }).catch((noticeError) => {
      console.error("Subscription-ended notice failed", {
        organization_id: organizationId,
        noticeError,
      });
    });
  }
}

async function markConnectAccountUpdated(object: StripeObject, livemode: boolean) {
  const accountId = str(object.id);
  if (!accountId) return;

  const admin = createSupabaseAdminClient();
  const status = connectAccountStatus(object);
  const mode: StripeMode = livemode ? "live" : "test";
  const columns = stripeModeColumnNames(mode);
  const { error } = await dynamicTable(admin, "organizations")
    .update(stripeModePersistencePatch(mode, accountId, status.status))
    .eq(columns.accountId, accountId);
  if (error) {
    if (isMissingAnySupabaseColumn(error, CONNECT_PERSISTENCE_COLUMNS)) {
      throw stripeConnectSchemaNotReady(error);
    }
    throw new Error(error.message);
  }

  // Keep the temporary legacy aliases synchronized only when this event is
  // for the organization's active mode. A live event must never overwrite a
  // company that is still deliberately running its sandbox connection.
  const { error: activeModeError } = await dynamicTable(admin, "organizations")
    .update({
      stripe_connect_account_id: accountId,
      stripe_connect_status: status.status,
      payment_processor_ready: status.ready,
    })
    .eq(columns.accountId, accountId)
    .eq("stripe_mode", mode);
  if (activeModeError) throw new Error(activeModeError.message);
}

// Exported for direct testing (STRIPEIDEMPOTENCY1 Task 3). The route below is a
// thin wrapper so the full claim -> process -> mark-processed/release flow can
// be driven with a fake Supabase and a stubbed signature verifier.
export async function handleStripeWebhook(request: Request): Promise<Response> {
  // Set only once we own processing of a fresh/re-taken claim. It carries
  // the store so success marks the row `processed` and failure releases
  // it (best-effort). A duplicate or a concurrent in-flight claim leaves
  // this null -- we never touch a row we do not own.
  let completion: { store: WebhookEventStore; eventId: string } | null = null;
  try {
    const rawBody = await request.text();
    const event = await verifyStripeWebhookPayload(
      rawBody,
      request.headers.get("stripe-signature"),
    );
    const object = (event.data?.object ?? {}) as StripeObject;

    // Idempotency records OUTCOME, not sighting: a row is `processed` only
    // once its handler completes. `already_processed` is a true duplicate
    // (200). `in_flight` is a concurrent, still-fresh delivery that may
    // yet fail -- return non-2xx so Stripe retries, never a 200.
    if (event.id) {
      const store = createSupabaseWebhookEventStore(createSupabaseAdminClient());
      const claim = await claimWebhookEvent(store, event.id, event.type, {
        nowMs: Date.now(),
        staleSeconds: webhookStaleSeconds(),
        livemode: Boolean(event.livemode),
      });
      if (claim === "already_processed") {
        return jsonOk({ received: true, duplicate: true, eventId: event.id });
      }
      if (claim === "in_flight") {
        throw new RouteError(
          "webhook_event_in_flight",
          "Another delivery of this event is still processing. Stripe will retry.",
          409,
        );
      }
      // "fresh" | "retry_stale": we own it and must mark it `processed` on
      // success. "no_store" (pre-migration): process without the guard.
      if (claim !== "no_store") {
        completion = { store, eventId: event.id };
      }
    }

    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(
          object,
          str(event.account),
          event.livemode ? "live" : "test",
          str(event.id),
        );
        break;
      case "checkout.session.async_payment_succeeded":
        await handleCheckoutAsyncSucceeded(
          object,
          str(event.account),
          event.livemode ? "live" : "test",
          str(event.id),
        );
        break;
      case "checkout.session.async_payment_failed":
        await markInvoiceAsyncFailed(object, str(event.id));
        break;
      case "checkout.session.expired":
        await handleCheckoutExpired(object, str(event.id));
        break;
      case "payment_intent.payment_failed":
        await markInvoiceFailed(object, str(event.id));
        break;
      case "charge.refunded":
        await markChargeRefunded(object, str(event.id));
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await markSubscriptionUpdated(object, str(event.id));
        break;
      case "account.updated":
        await markConnectAccountUpdated(object, Boolean(event.livemode));
        break;
      default:
        // Well-formed but unhandled (e.g. payout.*, balance.available):
        // fall through, mark processed, and 200. Never 400 these.
        break;
    }

    // Handler ran to completion -- the ONLY place a row becomes
    // `processed`. If this write fails it throws, the row stays
    // `processing`, and the next retry re-processes: the invariant holds.
    if (completion) {
      await completion.store.markProcessed(completion.eventId, new Date().toISOString());
    }

    return jsonOk({
      received: true,
      eventId: event.id,
      eventType: event.type,
      livemode: Boolean(event.livemode),
    });
  } catch (error) {
    // Failures return non-2xx (jsonError) so Stripe retries. Best-effort
    // release deletes the claim so the retry need not wait out the stale
    // window -- but if it fails, the row stays `processing` and the retry
    // still re-processes. The delete is no longer load-bearing.
    if (completion) await completion.store.release(completion.eventId);
    return jsonError(error);
  }
}

export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: ({ request }) => handleStripeWebhook(request),
    },
  },
});
