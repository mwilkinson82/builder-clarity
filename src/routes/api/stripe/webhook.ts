import { createFileRoute } from "@tanstack/react-router";
import {
  createSupabaseAdminClient,
  isMissingAnySupabaseColumn,
  jsonError,
  jsonOk,
  RouteError,
  verifyStripeWebhookPayload,
} from "@/lib/stripe.server";
import { planCheckoutCompletion } from "@/lib/payments-domain";

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
  maybeSingle(): DynamicQuery;
  select(columns?: string): DynamicQuery;
  single(): DynamicQuery;
  update(values: unknown): DynamicQuery;
};

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as { from(table: string): DynamicQuery }).from(relation);

const CONNECT_PERSISTENCE_COLUMNS = [
  "stripe_connect_account_id",
  "stripe_connect_status",
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
 * Event-id idempotency: claim the event before processing by inserting into
 * stripe_webhook_events. A duplicate delivery loses the insert (PK conflict)
 * and the whole webhook no-ops with a 2xx so Stripe stops retrying. Returns
 * false when this delivery is a duplicate. Pre-migration (table missing) we
 * process without the guard — same behavior as before this phase.
 */
async function claimWebhookEvent(eventId: string, eventType: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { error } = await dynamicTable(admin, "stripe_webhook_events").insert({
    event_id: eventId,
    event_type: eventType,
  });
  if (!error) return true;
  if (error.code === "23505" || (error.message ?? "").toLowerCase().includes("duplicate")) {
    return false;
  }
  if (isMissingRelationError(error)) return true;
  throw new Error(error.message);
}

/**
 * Processing failed after the claim: release it so Stripe's retry is not
 * swallowed as a duplicate.
 */
async function releaseWebhookEvent(eventId: string) {
  try {
    const admin = createSupabaseAdminClient();
    await dynamicTable(admin, "stripe_webhook_events").delete().eq("event_id", eventId);
  } catch {
    // Best-effort: an orphaned claim only suppresses a retry of a failed
    // event; the failure already returned non-2xx and is visible in Stripe.
  }
}

function sessionMetadata(object: StripeObject) {
  return object.metadata ?? {};
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
    await markInvoicePaid(object);
    return;
  }
  if (metadata.kind === "subscription") {
    await markSubscriptionCheckoutComplete(object);
  }
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
    .select("id,project_id,billing_application_id,total_due,paid_amount")
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
  if (!plan.payment || !plan.invoicePatch) return;

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

async function markChargeRefunded(object: StripeObject) {
  const paymentIntentId = str(object.payment_intent);
  if (!paymentIntentId) return;

  const admin = createSupabaseAdminClient();
  const { data: payment, error: paymentError } = await dynamicTable(admin, "payment_ledger")
    .select("id,invoice_id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();
  if (paymentError) throw new Error(paymentError.message);
  if (!payment) return;

  const { error: updatePaymentError } = await dynamicTable(admin, "payment_ledger")
    .update({
      status: "refunded",
      stripe_charge_id: str(object.id),
      receipt_url: str(object.receipt_url),
      notes: "Stripe charge refunded.",
    })
    .eq("id", payment.id);
  if (updatePaymentError) throw new Error(updatePaymentError.message);

  const { error: updateInvoiceError } = await dynamicTable(admin, "billing_invoices")
    .update({
      online_payment_status: "refunded",
    })
    .eq("id", payment.invoice_id);
  if (updateInvoiceError) throw new Error(updateInvoiceError.message);
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

async function markConnectAccountUpdated(object: StripeObject) {
  const accountId = str(object.id);
  if (!accountId) return;

  const admin = createSupabaseAdminClient();
  const status = connectAccountStatus(object);
  const { error } = await dynamicTable(admin, "organizations")
    .update({
      stripe_connect_status: status.status,
      payment_processor_ready: status.ready,
    })
    .eq("stripe_connect_account_id", accountId);
  if (error) {
    if (isMissingAnySupabaseColumn(error, CONNECT_PERSISTENCE_COLUMNS)) {
      throw stripeConnectSchemaNotReady(error);
    }
    throw new Error(error.message);
  }
}

export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let claimedEventId = "";
        try {
          const rawBody = await request.text();
          const event = await verifyStripeWebhookPayload(
            rawBody,
            request.headers.get("stripe-signature"),
          );
          const object = (event.data?.object ?? {}) as StripeObject;

          // Idempotency: processed event ids are stored; duplicates no-op
          // with a 2xx so Stripe stops retrying a delivery we already took.
          if (event.id && !(await claimWebhookEvent(event.id, event.type))) {
            return jsonOk({ received: true, duplicate: true, eventId: event.id });
          }
          claimedEventId = event.id ?? "";

          switch (event.type) {
            case "checkout.session.completed":
              await handleCheckoutCompleted(object);
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
              await markConnectAccountUpdated(object);
              break;
            default:
              break;
          }

          return jsonOk({ received: true, eventId: event.id, eventType: event.type });
        } catch (error) {
          // Failures return non-2xx (jsonError) so Stripe retries; release
          // the claim so the retry is not swallowed as a duplicate.
          if (claimedEventId) await releaseWebhookEvent(claimedEventId);
          return jsonError(error);
        }
      },
    },
  },
});
