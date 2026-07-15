import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  appendStripeForm,
  getAppOrigin,
  isMissingSupabaseColumn,
  jsonError,
  jsonOk,
  readServerEnv,
  requireAuthedStripeContext,
  RouteError,
  stripePost,
  type StripeCheckoutSession,
} from "@/lib/stripe.server";
import { billingDocumentLabel } from "@/lib/billing-labels";
import {
  ORGANIZATION_STRIPE_SELECT,
  stripeConnectionForMode,
  type OrganizationStripeColumns,
} from "@/lib/stripe-mode";
import {
  DEFAULT_STRIPE_PAYMENT_LIMIT_CENTS,
  dollarsToCents,
  estimatedCardFeeCents,
  methodAvailability,
  resolveEnabledMethods,
} from "@/lib/payments-domain";
import {
  cappedApplicationFeeFromDollars,
  normalizeApplicationFeeBps,
  normalizeApplicationFeeCapCents,
} from "@/lib/stripe-fee-config";

const invoiceCheckoutInput = z.object({
  invoiceId: z.string().uuid(),
  // Which Stripe rail the payer chose. Omitted = legacy contractor
  // "Enable online pay" link covering every available Stripe method.
  method: z.enum(["card", "ach_debit"]).optional(),
  successPath: z.string().max(500).optional(),
  cancelPath: z.string().max(500).optional(),
});

type InvoiceRecord = {
  id: string;
  project_id: string;
  billing_application_id: string | null;
  invoice_number: string;
  title: string;
  subtotal: number;
  retainage: number;
  total_due: number;
  paid_amount: number;
  status: string;
  sent_at: string | null;
  client_visible?: boolean;
  enabled_payment_methods?: Record<string, boolean> | null;
};

type ProjectRecord = {
  id: string;
  name: string;
  client: string;
  job_number: string;
  organization_id: string | null;
};

type OrganizationPaymentRecord = OrganizationStripeColumns & {
  id: string;
  stripe_payment_limit_cents?: number | null;
};

type DynamicQueryResult<T = unknown> = {
  data: T | null;
  error: { message: string } | null;
};

type DynamicQuery = PromiseLike<DynamicQueryResult> & {
  select(columns?: string): DynamicQuery;
  update(values: unknown): DynamicQuery;
  eq(column: string, value: unknown): DynamicQuery;
  single(): DynamicQuery;
  maybeSingle(): DynamicQuery;
};

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as { from(table: string): DynamicQuery }).from(relation);

function normalizedInternalPath(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  return value;
}

function cents(value: number) {
  return Math.max(0, Math.round(value * 100));
}

function applicationFeeCents(openBalance: number) {
  const basisPoints = normalizeApplicationFeeBps(
    readServerEnv("OVERWATCH_INVOICE_APPLICATION_FEE_BPS"),
  );
  const capCents = normalizeApplicationFeeCapCents(
    readServerEnv("OVERWATCH_INVOICE_APPLICATION_FEE_CAP_CENTS"),
  );
  return cents(cappedApplicationFeeFromDollars(openBalance, basisPoints, capCents));
}

export const Route = createFileRoute("/api/stripe/checkout/invoice")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = invoiceCheckoutInput.parse(await request.json());
          const context = await requireAuthedStripeContext(request);

          const INVOICE_SELECT_BASE =
            "id,project_id,billing_application_id,invoice_number,title,subtotal,retainage,total_due,paid_amount,status,sent_at,client_visible";
          let { data: invoice, error: invoiceError } = await dynamicTable(
            context.admin,
            "billing_invoices",
          )
            .select(`${INVOICE_SELECT_BASE},enabled_payment_methods`)
            .eq("id", body.invoiceId)
            .single();
          if (invoiceError && isMissingSupabaseColumn(invoiceError, "enabled_payment_methods")) {
            // Payments Phase 1 migration not applied yet: fall back to the
            // legacy column set ({} toggles inherit defaults downstream).
            ({ data: invoice, error: invoiceError } = await dynamicTable(
              context.admin,
              "billing_invoices",
            )
              .select(INVOICE_SELECT_BASE)
              .eq("id", body.invoiceId)
              .single());
          }
          if (invoiceError) throw new Error(invoiceError.message);
          if (!invoice) throw new Error("Invoice not found.");

          const invoiceRecord = invoice as unknown as InvoiceRecord;

          // Contractors with project-manage access can always create a link.
          // Portal clients can start checkout only for invoices they can
          // already see, with billing visibility granted.
          const { data: canManage } = await context.authed.rpc("can_manage_project", {
            p_project_id: invoiceRecord.project_id,
          });
          if (!canManage) {
            const { data: clientBilling, error: clientBillingError } = await context.authed.rpc(
              "can_view_client_billing",
              { p_project_id: invoiceRecord.project_id },
            );
            if (clientBillingError) {
              throw new RouteError("project_access_check_failed", clientBillingError.message, 500);
            }
            if (!clientBilling || !invoiceRecord.client_visible) {
              throw new RouteError(
                "forbidden",
                "You do not have permission to pay this invoice online.",
                403,
              );
            }
          }

          const { data: project, error: projectError } = await context.admin
            .from("projects")
            .select("id,name,client,job_number,organization_id")
            .eq("id", invoiceRecord.project_id)
            .single();
          if (projectError) throw new Error(projectError.message);
          if (!project) throw new Error("Project not found.");

          const projectRecord = project as ProjectRecord;
          if (!projectRecord.organization_id) {
            throw new RouteError(
              "payment_processor_not_configured",
              "Assign this project to a company before enabling online payments.",
              409,
            );
          }

          let { data: organization, error: organizationError } = await dynamicTable(
            context.admin,
            "organizations",
          )
            .select(`id,${ORGANIZATION_STRIPE_SELECT},stripe_payment_limit_cents`)
            .eq("id", projectRecord.organization_id)
            .single();
          if (
            organizationError &&
            isMissingSupabaseColumn(organizationError, "stripe_payment_limit_cents")
          ) {
            // Safe deploy ordering: code may reach Lovable moments before the
            // guardrail migration. Default to the conservative cap, never to
            // unlimited checkout.
            ({ data: organization, error: organizationError } = await dynamicTable(
              context.admin,
              "organizations",
            )
              .select(`id,${ORGANIZATION_STRIPE_SELECT}`)
              .eq("id", projectRecord.organization_id)
              .single());
          }
          if (organizationError) throw new Error(organizationError.message);
          if (!organization) throw new Error("Organization not found.");

          const orgPayment = organization as unknown as OrganizationPaymentRecord;
          const stripeConnection = stripeConnectionForMode(orgPayment);
          if (!stripeConnection.ready) {
            throw new RouteError(
              "stripe_connect_not_ready",
              stripeConnection.mode === "live"
                ? "Live online payments are not ready for this company. Finish live Stripe verification in Your Company before enabling invoice pay links."
                : "Sandbox online payments are not ready for this company. Finish Stripe Connect setup in Your Company before testing invoice pay links.",
              409,
            );
          }

          const openBalance = Math.max(0, invoiceRecord.total_due - invoiceRecord.paid_amount);
          if (openBalance <= 0) {
            return Response.json(
              {
                ok: false,
                code: "invoice_already_paid",
                error: "This invoice has no open balance.",
              },
              { status: 400 },
            );
          }

          // Company payment settings: per-invoice toggles resolve against the
          // profile's defaults; the amount guardrail steers requisition-sized
          // invoices to the direct bank rail unless deliberately overridden.
          const { data: paymentProfile, error: paymentProfileError } = await dynamicTable(
            context.admin,
            "organization_payment_profiles",
          )
            .select(
              "bank_name,routing_number,account_number,default_payment_methods,card_fee_pass_through,stripe_amount_threshold_cents",
            )
            .eq("organization_id", projectRecord.organization_id)
            .maybeSingle();
          // Pre-migration (missing table) simply means no profile yet.
          const profile = paymentProfileError
            ? null
            : ((paymentProfile ?? null) as Record<string, unknown> | null);

          const enabledMethods = resolveEnabledMethods(
            invoiceRecord.enabled_payment_methods ?? {},
            profile?.default_payment_methods ?? null,
          );
          const availability = methodAvailability({
            hasPaymentProfile: Boolean(
              profile?.bank_name && profile?.routing_number && profile?.account_number,
            ),
            stripeReady: true, // connectReady was enforced above
            enabled: enabledMethods,
            invoiceTotalCents: dollarsToCents(openBalance),
            thresholdCents: Number(profile?.stripe_amount_threshold_cents ?? 0),
            platformLimitCents:
              Number(orgPayment.stripe_payment_limit_cents) > 0
                ? Number(orgPayment.stripe_payment_limit_cents)
                : DEFAULT_STRIPE_PAYMENT_LIMIT_CENTS,
          });
          if (body.method && !availability[body.method].available) {
            const reason = availability[body.method].reason;
            throw new RouteError(
              reason === "platform_limit"
                ? "payment_exceeds_overwatch_limit"
                : "payment_method_not_available",
              reason === "platform_limit"
                ? `This payment is above the company's current OverWatch online-payment ceiling of $${(
                    (Number(orgPayment.stripe_payment_limit_cents) > 0
                      ? Number(orgPayment.stripe_payment_limit_cents)
                      : DEFAULT_STRIPE_PAYMENT_LIMIT_CENTS) / 100
                  ).toLocaleString(
                    "en-US",
                  )}. Use the direct bank instructions or have the company request a higher limit after Stripe approval.`
                : reason === "over_threshold"
                  ? "This invoice is above the company's preferred online payment threshold. Use the direct bank transfer details on the invoice."
                  : "This payment method is not enabled for this invoice.",
              409,
            );
          }
          const stripeMethods = body.method
            ? [body.method]
            : (["card", "ach_debit"] as const).filter((method) => availability[method].available);
          if (stripeMethods.length === 0) {
            throw new RouteError(
              "payment_method_not_available",
              "No online payment methods are enabled for this invoice. The invoice carries direct bank transfer details instead.",
              409,
            );
          }

          // Card fee pass-through: an estimated-fee surcharge line, only when
          // the payer explicitly chose card and the company enabled it.
          // Whether surcharging is lawful in their state is the contractor's
          // responsibility (docs/phases/STRIPEPHASE1.md).
          const surchargeCents =
            body.method === "card" && Boolean(profile?.card_fee_pass_through)
              ? estimatedCardFeeCents(cents(openBalance))
              : 0;

          const origin = getAppOrigin(request);
          const defaultProjectPath = `/projects/${projectRecord.id}?tab=billing`;
          const successUrl = new URL(
            normalizedInternalPath(
              body.successPath,
              `${defaultProjectPath}&payment=success&invoice=${invoiceRecord.id}`,
            ),
            origin,
          );
          const cancelUrl = new URL(
            normalizedInternalPath(
              body.cancelPath,
              `${defaultProjectPath}&payment=cancelled&invoice=${invoiceRecord.id}`,
            ),
            origin,
          );

          const label = billingDocumentLabel(
            invoiceRecord.invoice_number,
            invoiceRecord.title,
            `${projectRecord.name} invoice`,
          );
          const form = new URLSearchParams();
          appendStripeForm(form, "mode", "payment");
          appendStripeForm(form, "client_reference_id", invoiceRecord.id);
          appendStripeForm(form, "success_url", successUrl.toString());
          appendStripeForm(form, "cancel_url", cancelUrl.toString());
          stripeMethods.forEach((method, index) => {
            appendStripeForm(
              form,
              `payment_method_types[${index}]`,
              method === "card" ? "card" : "us_bank_account",
            );
          });
          appendStripeForm(form, "line_items[0][quantity]", 1);
          appendStripeForm(form, "line_items[0][price_data][currency]", "usd");
          appendStripeForm(form, "line_items[0][price_data][unit_amount]", cents(openBalance));
          appendStripeForm(form, "line_items[0][price_data][product_data][name]", label);
          appendStripeForm(
            form,
            "line_items[0][price_data][product_data][description]",
            `${projectRecord.name}${projectRecord.job_number ? ` - Job ${projectRecord.job_number}` : ""}`,
          );
          if (surchargeCents > 0) {
            appendStripeForm(form, "line_items[1][quantity]", 1);
            appendStripeForm(form, "line_items[1][price_data][currency]", "usd");
            appendStripeForm(form, "line_items[1][price_data][unit_amount]", surchargeCents);
            appendStripeForm(
              form,
              "line_items[1][price_data][product_data][name]",
              "Card processing fee (estimated)",
            );
          }
          appendStripeForm(form, "metadata[kind]", "client_invoice");
          appendStripeForm(form, "metadata[surcharge_cents]", surchargeCents || null);
          appendStripeForm(
            form,
            "payment_intent_data[metadata][surcharge_cents]",
            surchargeCents || null,
          );
          appendStripeForm(form, "metadata[invoice_id]", invoiceRecord.id);
          appendStripeForm(form, "metadata[project_id]", projectRecord.id);
          appendStripeForm(form, "metadata[organization_id]", projectRecord.organization_id);
          appendStripeForm(form, "metadata[stripe_mode]", stripeConnection.mode);
          appendStripeForm(
            form,
            "metadata[overwatch_payment_limit_cents]",
            Number(orgPayment.stripe_payment_limit_cents) > 0
              ? Number(orgPayment.stripe_payment_limit_cents)
              : DEFAULT_STRIPE_PAYMENT_LIMIT_CENTS,
          );
          appendStripeForm(
            form,
            "metadata[billing_application_id]",
            invoiceRecord.billing_application_id,
          );
          const feeCents = applicationFeeCents(openBalance);
          appendStripeForm(form, "metadata[overwatch_fee_amount_cents]", feeCents);
          appendStripeForm(form, "payment_intent_data[metadata][kind]", "client_invoice");
          appendStripeForm(form, "payment_intent_data[metadata][invoice_id]", invoiceRecord.id);
          appendStripeForm(form, "payment_intent_data[metadata][project_id]", projectRecord.id);
          appendStripeForm(
            form,
            "payment_intent_data[metadata][stripe_mode]",
            stripeConnection.mode,
          );
          appendStripeForm(
            form,
            "payment_intent_data[metadata][billing_application_id]",
            invoiceRecord.billing_application_id,
          );
          if (feeCents > 0) {
            appendStripeForm(form, "payment_intent_data[application_fee_amount]", feeCents);
            appendStripeForm(
              form,
              "payment_intent_data[metadata][overwatch_fee_amount_cents]",
              feeCents,
            );
          }

          // Direct charge per the spec and Stripe's Connect docs: the session
          // is created ON the connected account (Stripe-Account header), so
          // the contractor is the merchant of record, funds settle to their
          // balance, and refund/dispute liability sits with them — not the
          // platform. The platform fee, when configured, rides along as
          // payment_intent_data[application_fee_amount].
          const session = await stripePost<StripeCheckoutSession>(
            "checkout/sessions",
            form,
            `invoice-checkout:${invoiceRecord.id}:${stripeConnection.mode}:${openBalance}:${stripeMethods.join("+")}:${surchargeCents}`,
            stripeConnection.accountId,
            stripeConnection.mode,
          );

          const now = new Date().toISOString();
          const { error: updateError } = await dynamicTable(context.admin, "billing_invoices")
            .update({
              payment_enabled: true,
              payment_url: session.url ?? "",
              stripe_checkout_session_id: session.id,
              stripe_payment_intent_id:
                typeof session.payment_intent === "string" ? session.payment_intent : "",
              online_payment_status: "pending",
              payment_link_sent_at: now,
              status: invoiceRecord.status === "draft" ? "sent" : invoiceRecord.status,
              sent_at: invoiceRecord.sent_at ?? now,
            })
            .eq("id", invoiceRecord.id);
          if (updateError) throw new Error(updateError.message);

          return jsonOk({
            sessionId: session.id,
            checkoutUrl: session.url ?? "",
            invoiceId: invoiceRecord.id,
          });
        } catch (error) {
          return jsonError(error);
        }
      },
    },
  },
});
