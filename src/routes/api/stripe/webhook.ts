import { createFileRoute } from "@tanstack/react-router";
import {
  applyInvoiceLedgerReconcile,
  createSupabaseAdminClient,
  isMissingAnySupabaseColumn,
  jsonError,
  jsonOk,
  readServerEnv,
  RouteError,
  verifyStripeWebhookPayload,
} from "@/lib/stripe.server";
import {
  checkoutSessionOutcome,
  planChargeRefund,
  planCheckoutCompletion,
} from "@/lib/payments-domain";
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

type StripeObject = Record<string, unknown> & {
  id?: string;
  metadata?: Record<string, string>;
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

const CONNECT_PERSISTENCE_COLUMNS = [
  "stripe_connect_account_id_test",
  "stripe_connect_status_test",
  "stripe_connect_account_id_live",
  "stripe_connect_status_live",
  "payment_processor_ready",
] as const;

const LEDGER_PHASE1_COLUMNS = ["amount_cents", "currency", "reference", "organization_id"] as const;

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
}

function subscriptionStatus(value: string) {
  if (value === "active" || value === "trialing") return "active";
  if (value === "past_due" || value === "unpaid") return "past_due";
  if (value === "canceled" || value === "incomplete_expired") return "cancelled";
  return value || "unknown";
}

function connectAccountStatus(object: StripeObject) {
  const chargesEnabled = Boolean(object.charges_enabled);
  const payoutsEnabled = Boolean(object.payouts_enabled);
  const detailsSubmitted = Boolean(object.details_submitted);

  if (chargesEnabled && payoutsEnabled && detailsSubmitted) {
    return { status: "active", ready: true };
  }

  return { status: "pending", ready: false };
}

function stripeConnectSchemaNotReady(error: { message?: string } | null) {
  return new RouteError(
    "stripe_schema_not_ready",
    "Stripe webhook processing is waiting on the latest billing database migration.",
    409,
    { cause: error?.message ?? "" },
  );
}

async function handleCheckoutCompleted(object: StripeObject) {
  const metadata = sessionMetadata(object);
  if (metadata.kind === "client_invoice") {
    // Cards complete with payment_status "paid" and book immediately. ACH
    // (us_bank_account) completes "unpaid" — authorization only — and books
    // on checkout.session.async_payment_succeeded once funds settle.
    if (checkoutSessionOutcome(str(object.payment_status)) === "book") {
      await markInvoicePaid(object);
    } else {
      await markInvoiceProcessing(object);
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

async function handleCheckoutAsyncSucceeded(object: StripeObject) {
  const metadata = sessionMetadata(object);
  if (metadata.kind === "credit_pack") {
    await grantCreditPackPurchase(object);
    return;
  }
  if (metadata.kind !== "client_invoice") return;
  await markInvoicePaid(object);
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
async function markInvoiceProcessing(object: StripeObject) {
  const metadata = sessionMetadata(object);
  if (!metadata.invoice_id) return;
  const admin = createSupabaseAdminClient();
  const { error } = await dynamicTable(admin, "billing_invoices")
    .update({
      online_payment_status: "pending",
    })
    .eq("id", metadata.invoice_id)
    .eq("stripe_checkout_session_id", str(object.id));
  if (error) throw new Error(error.message);
}

// Async payment failed after checkout completed (e.g. ACH returned:
// insufficient funds, closed account). No payment was ever booked for the
// session, so only the invoice's online payment state flips.
async function markInvoiceAsyncFailed(object: StripeObject) {
  const metadata = sessionMetadata(object);
  if (metadata.kind !== "client_invoice" || !metadata.invoice_id) return;
  const admin = createSupabaseAdminClient();
  const { error } = await dynamicTable(admin, "billing_invoices")
    .update({
      online_payment_status: "failed",
    })
    .eq("id", metadata.invoice_id)
    .eq("stripe_checkout_session_id", str(object.id));
  if (error) throw new Error(error.message);
}

async function handleCheckoutExpired(object: StripeObject) {
  const admin = createSupabaseAdminClient();
  const sessionId = str(object.id);
  const metadata = sessionMetadata(object);

  if (metadata.kind === "client_invoice" && metadata.invoice_id) {
    await dynamicTable(admin, "billing_invoices")
      .update({
        online_payment_status: "expired",
      })
      .eq("id", metadata.invoice_id)
      .eq("stripe_checkout_session_id", sessionId);
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

async function markInvoicePaid(object: StripeObject) {
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
  const paymentIntentId = str(object.payment_intent);

  // Second idempotency layer under the event-id guard: the same checkout
  // session never produces two payment records even if Stripe emits distinct
  // events that both resolve to a completion.
  const { data: existingPayment, error: existingError } = await dynamicTable(
    admin,
    "payment_ledger",
  )
    .select("id")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  // All money math in integer cents (payments-domain owns the rules: the
  // surcharge covers fees and never counts as progress against the invoice).
  const plan = planCheckoutCompletion(
    {
      amountTotalCents: Math.round(num(object.amount_total)),
      surchargeCents: Math.round(num(metadata.surcharge_cents)),
      overwatchFeeCents: Math.round(num(metadata.overwatch_fee_amount_cents)),
      occurredAtIso: new Date().toISOString(),
      alreadyRecorded: Boolean(existingPayment),
    },
    {
      totalDueCents: Math.round(num(invoice.total_due) * 100),
      paidCents: Math.round(num(invoice.paid_amount) * 100),
    },
  );
  if (!plan.payment || !plan.invoicePatch) {
    // The payment ledger can already exist when a previous delivery booked the
    // money but notification delivery failed. Re-attempt the idempotent notice
    // so Stripe retries heal the secondary experience without double-booking.
    if (existingPayment) await ensureInvoicePaidNotifications(admin, invoice, object);
    return;
  }

  const insertPayload: Record<string, unknown> = {
    project_id: invoice.project_id,
    invoice_id: invoice.id,
    billing_application_id: invoice.billing_application_id,
    amount: plan.payment.amountCents / 100,
    amount_cents: plan.payment.amountCents,
    currency: "usd",
    reference: paymentIntentId || sessionId,
    organization_id: metadata.organization_id || null,
    processor_fee: 0,
    overwatch_fee: plan.payment.overwatchFeeCents / 100,
    net_payout: plan.payment.netPayoutCents / 100,
    payment_method: "stripe_checkout",
    processor: "stripe",
    processor_payment_id: paymentIntentId || sessionId,
    status: plan.payment.state,
    paid_at: new Date().toISOString(),
    notes: "Stripe Checkout payment completed.",
    stripe_checkout_session_id: sessionId,
    stripe_payment_intent_id: paymentIntentId,
  };
  let { error: insertError } = await dynamicTable(admin, "payment_ledger").insert(insertPayload);
  if (insertError && isMissingAnySupabaseColumn(insertError, LEDGER_PHASE1_COLUMNS)) {
    for (const column of LEDGER_PHASE1_COLUMNS) delete insertPayload[column];
    ({ error: insertError } = await dynamicTable(admin, "payment_ledger").insert(insertPayload));
  }
  if (insertError) throw new Error(insertError.message);

  const paidAmount = plan.invoicePatch.paidCents / 100;
  const status = plan.invoicePatch.status;
  const { error: updateInvoiceError } = await dynamicTable(admin, "billing_invoices")
    .update({
      paid_amount: paidAmount,
      status,
      paid_at: plan.invoicePatch.paidAtIso,
      online_payment_status: "paid",
      stripe_payment_intent_id: paymentIntentId,
    })
    .eq("id", invoice.id);
  if (updateInvoiceError) throw new Error(updateInvoiceError.message);

  if (invoice.billing_application_id) {
    const { error: updatePayAppError } = await dynamicTable(admin, "billing_applications")
      .update({
        paid_to_date: paidAmount,
        status: status === "paid" ? "paid" : "partial",
      })
      .eq("id", invoice.billing_application_id);
    if (updatePayAppError) throw new Error(updatePayAppError.message);
  }

  await ensureInvoicePaidNotifications(admin, invoice, object);
}

async function markInvoiceFailed(object: StripeObject) {
  const metadata = sessionMetadata(object);
  const invoiceId = metadata.invoice_id;
  if (!invoiceId) return;

  const admin = createSupabaseAdminClient();
  const { error } = await dynamicTable(admin, "billing_invoices")
    .update({
      online_payment_status: "failed",
      stripe_payment_intent_id: str(object.id),
    })
    .eq("id", invoiceId);
  if (error) throw new Error(error.message);
}

// Refunds reverse the invoice, not just the ledger row (live bug: invoice
// 2601-3 stayed "paid" after a full refund). The ledger row is patched per
// the refund plan, then the invoice + linked pay app are recomputed from the
// ledger's succeeded-minus-refunded truth — the same reconcile path the
// founder can trigger on demand.
async function markChargeRefunded(object: StripeObject) {
  const paymentIntentId = str(object.payment_intent);
  if (!paymentIntentId) return;

  const admin = createSupabaseAdminClient();
  const { data: payment, error: paymentError } = await dynamicTable(admin, "payment_ledger")
    .select("id,invoice_id,amount,amount_cents,status,notes")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();
  if (paymentError) throw new Error(paymentError.message);
  if (!payment) return;

  const bookedCents =
    num(payment.amount_cents) > 0
      ? Math.round(num(payment.amount_cents))
      : Math.round(num(payment.amount) * 100);
  const plan = planChargeRefund({
    bookedCents,
    chargeAmountCents: Math.round(num(object.amount)),
    amountRefundedCents: Math.round(num(object.amount_refunded)),
    fullyRefunded: Boolean(object.refunded),
  });

  const fullyReversed = plan.ledgerStatus === "refunded";
  const refundNote = fullyReversed
    ? "Stripe charge refunded."
    : `Stripe charge partially refunded: $${(plan.reversalCents / 100).toFixed(2)} of $${(
        bookedCents / 100
      ).toFixed(2)} reversed.`;
  const { error: updatePaymentError } = await dynamicTable(admin, "payment_ledger")
    .update({
      status: plan.ledgerStatus,
      amount: plan.ledgerAmountCents / 100,
      amount_cents: plan.ledgerAmountCents,
      stripe_charge_id: str(object.id),
      receipt_url: str(object.receipt_url),
      notes: [str(payment.notes), refundNote].filter(Boolean).join("\n"),
    })
    .eq("id", payment.id);
  if (updatePaymentError) throw new Error(updatePaymentError.message);

  await applyInvoiceLedgerReconcile(admin, payment.invoice_id as string);

  if (fullyReversed) {
    const { error: updateInvoiceError } = await dynamicTable(admin, "billing_invoices")
      .update({
        online_payment_status: "refunded",
      })
      .eq("id", payment.invoice_id);
    if (updateInvoiceError) throw new Error(updateInvoiceError.message);
  }
}

async function markSubscriptionCheckoutComplete(object: StripeObject) {
  const metadata = sessionMetadata(object);
  const organizationId = metadata.organization_id;
  if (!organizationId) return;

  const admin = createSupabaseAdminClient();
  const { error } = await dynamicTable(admin, "organizations")
    .update({
      stripe_customer_id: str(object.customer),
      stripe_subscription_id: str(object.subscription),
      stripe_checkout_session_id: str(object.id),
      billing_status: "active",
    })
    .eq("id", organizationId);
  if (error) throw new Error(error.message);
}

async function markSubscriptionUpdated(object: StripeObject) {
  const subscriptionId = str(object.id);
  const customerId = str(object.customer);
  const metadata = sessionMetadata(object);
  const organizationId = metadata.organization_id;
  if (!subscriptionId && !organizationId && !customerId) return;

  const admin = createSupabaseAdminClient();
  const patch = {
    stripe_subscription_id: subscriptionId,
    stripe_customer_id: customerId,
    billing_status: subscriptionStatus(str(object.status)),
    subscription_current_period_end: epochToIso(object.current_period_end),
    subscription_cancel_at_period_end: Boolean(object.cancel_at_period_end),
  };

  let query = dynamicTable(admin, "organizations").update(patch);
  if (organizationId) query = query.eq("id", organizationId);
  else if (subscriptionId) query = query.eq("stripe_subscription_id", subscriptionId);
  else query = query.eq("stripe_customer_id", customerId);

  const { error } = await query;
  if (error) throw new Error(error.message);
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
        await handleCheckoutCompleted(object);
        break;
      case "checkout.session.async_payment_succeeded":
        await handleCheckoutAsyncSucceeded(object);
        break;
      case "checkout.session.async_payment_failed":
        await markInvoiceAsyncFailed(object);
        break;
      case "checkout.session.expired":
        await handleCheckoutExpired(object);
        break;
      case "payment_intent.payment_failed":
        await markInvoiceFailed(object);
        break;
      case "charge.refunded":
        await markChargeRefunded(object);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await markSubscriptionUpdated(object);
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
