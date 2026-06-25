import { createFileRoute } from "@tanstack/react-router";
import {
  createSupabaseAdminClient,
  jsonError,
  jsonOk,
  verifyStripeWebhookPayload,
} from "@/lib/stripe.server";

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

function sessionMetadata(object: StripeObject) {
  return object.metadata ?? {};
}

function subscriptionStatus(value: string) {
  if (value === "active" || value === "trialing") return "active";
  if (value === "past_due" || value === "unpaid") return "past_due";
  if (value === "canceled" || value === "incomplete_expired") return "cancelled";
  return value || "unknown";
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
    await admin
      .from("billing_invoices")
      .update({
        online_payment_status: "expired",
      })
      .eq("id", metadata.invoice_id)
      .eq("stripe_checkout_session_id", sessionId);
    return;
  }

  if (metadata.kind === "subscription" && metadata.organization_id) {
    await admin
      .from("organizations")
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

  const { data: invoice, error: invoiceError } = await admin
    .from("billing_invoices")
    .select("id,project_id,billing_application_id,total_due,paid_amount")
    .eq("id", invoiceId)
    .single();
  if (invoiceError || !invoice) throw new Error(invoiceError?.message || "Invoice not found.");

  const sessionId = str(object.id);
  const paymentIntentId = str(object.payment_intent);
  const chargeAmount = num(object.amount_total) / 100;
  const amount =
    chargeAmount > 0
      ? chargeAmount
      : Math.max(0, num(invoice.total_due) - num(invoice.paid_amount));
  const overwatchFee = Math.max(0, num(metadata.overwatch_fee_amount_cents) / 100);
  const netPayout = Math.max(0, amount - overwatchFee);

  const { data: existingPayment, error: existingError } = await admin
    .from("payment_ledger")
    .select("id")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  if (!existingPayment) {
    const { error: insertError } = await admin.from("payment_ledger").insert({
      project_id: invoice.project_id,
      invoice_id: invoice.id,
      billing_application_id: invoice.billing_application_id,
      amount,
      processor_fee: 0,
      overwatch_fee: overwatchFee,
      net_payout: netPayout,
      payment_method: "stripe_checkout",
      processor: "stripe",
      processor_payment_id: paymentIntentId || sessionId,
      status: "succeeded",
      paid_at: new Date().toISOString(),
      notes: "Stripe Checkout payment completed.",
      stripe_checkout_session_id: sessionId,
      stripe_payment_intent_id: paymentIntentId,
    });
    if (insertError) throw new Error(insertError.message);
  }

  const paidAmount = num(invoice.paid_amount) + amount;
  const status = paidAmount >= num(invoice.total_due) ? "paid" : "partially_paid";
  const paidAt = status === "paid" ? new Date().toISOString() : null;
  const { error: updateInvoiceError } = await admin
    .from("billing_invoices")
    .update({
      paid_amount: paidAmount,
      status,
      paid_at: paidAt,
      online_payment_status: "paid",
      stripe_payment_intent_id: paymentIntentId,
    })
    .eq("id", invoice.id);
  if (updateInvoiceError) throw new Error(updateInvoiceError.message);

  if (invoice.billing_application_id) {
    const { error: updatePayAppError } = await admin
      .from("billing_applications")
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
  const { error } = await admin
    .from("billing_invoices")
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
  const { data: payment, error: paymentError } = await admin
    .from("payment_ledger")
    .select("id,invoice_id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();
  if (paymentError) throw new Error(paymentError.message);
  if (!payment) return;

  const { error: updatePaymentError } = await admin
    .from("payment_ledger")
    .update({
      status: "refunded",
      stripe_charge_id: str(object.id),
      receipt_url: str(object.receipt_url),
      notes: "Stripe charge refunded.",
    })
    .eq("id", payment.id);
  if (updatePaymentError) throw new Error(updatePaymentError.message);

  const { error: updateInvoiceError } = await admin
    .from("billing_invoices")
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
  const { error } = await admin
    .from("organizations")
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

  let query = admin.from("organizations").update(patch);
  if (organizationId) query = query.eq("id", organizationId);
  else if (subscriptionId) query = query.eq("stripe_subscription_id", subscriptionId);
  else query = query.eq("stripe_customer_id", customerId);

  const { error } = await query;
  if (error) throw new Error(error.message);
}

export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const rawBody = await request.text();
          const event = await verifyStripeWebhookPayload(
            rawBody,
            request.headers.get("stripe-signature"),
          );
          const object = (event.data?.object ?? {}) as StripeObject;

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
            default:
              break;
          }

          return jsonOk({ received: true, eventId: event.id, eventType: event.type });
        } catch (error) {
          return jsonError(error);
        }
      },
    },
  },
});
