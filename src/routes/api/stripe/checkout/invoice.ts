import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  appendStripeForm,
  getAppOrigin,
  jsonError,
  jsonOk,
  readServerEnv,
  requireAuthedStripeContext,
  requireCanManageProject,
  RouteError,
  stripePost,
  type StripeCheckoutSession,
} from "@/lib/stripe.server";

const invoiceCheckoutInput = z.object({
  invoiceId: z.string().uuid(),
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
};

type ProjectRecord = {
  id: string;
  name: string;
  client: string;
  job_number: string;
  organization_id: string | null;
};

type OrganizationPaymentRecord = {
  id: string;
  stripe_connect_account_id: string;
  stripe_connect_status: string;
  payment_processor_ready: boolean;
};

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as { from(table: string): any }).from(relation);

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
  const rawBps = Number(readServerEnv("OVERWATCH_INVOICE_APPLICATION_FEE_BPS") || 0);
  if (!Number.isFinite(rawBps) || rawBps <= 0) return 0;
  const safeBps = Math.min(rawBps, 3000);
  return cents((openBalance * safeBps) / 10000);
}

export const Route = createFileRoute("/api/stripe/checkout/invoice")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = invoiceCheckoutInput.parse(await request.json());
          const context = await requireAuthedStripeContext(request);

          const { data: invoice, error: invoiceError } = await dynamicTable(context.admin, "billing_invoices")
            .select(
              "id,project_id,billing_application_id,invoice_number,title,subtotal,retainage,total_due,paid_amount,status,sent_at",
            )
            .eq("id", body.invoiceId)
            .single();
          if (invoiceError) throw new Error(invoiceError.message);
          if (!invoice) throw new Error("Invoice not found.");

          const invoiceRecord = invoice as unknown as InvoiceRecord;
          await requireCanManageProject(context, invoiceRecord.project_id);

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

          const { data: organization, error: organizationError } = await dynamicTable(context.admin, "organizations")
            .select("id,stripe_connect_account_id,stripe_connect_status,payment_processor_ready")
            .eq("id", projectRecord.organization_id)
            .single();
          if (organizationError) throw new Error(organizationError.message);
          if (!organization) throw new Error("Organization not found.");

          const orgPayment = organization as unknown as OrganizationPaymentRecord;
          const connectReady =
            orgPayment.payment_processor_ready &&
            orgPayment.stripe_connect_status === "active" &&
            Boolean(orgPayment.stripe_connect_account_id);
          if (!connectReady) {
            throw new RouteError(
              "stripe_connect_not_ready",
              "Online payments are not ready for this company. Finish Stripe Connect setup in Your Company before enabling invoice pay links.",
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

          const label =
            invoiceRecord.invoice_number || invoiceRecord.title || `${projectRecord.name} invoice`;
          const form = new URLSearchParams();
          appendStripeForm(form, "mode", "payment");
          appendStripeForm(form, "client_reference_id", invoiceRecord.id);
          appendStripeForm(form, "success_url", successUrl.toString());
          appendStripeForm(form, "cancel_url", cancelUrl.toString());
          appendStripeForm(form, "line_items[0][quantity]", 1);
          appendStripeForm(form, "line_items[0][price_data][currency]", "usd");
          appendStripeForm(form, "line_items[0][price_data][unit_amount]", cents(openBalance));
          appendStripeForm(form, "line_items[0][price_data][product_data][name]", label);
          appendStripeForm(
            form,
            "line_items[0][price_data][product_data][description]",
            `${projectRecord.name}${projectRecord.job_number ? ` - Job ${projectRecord.job_number}` : ""}`,
          );
          appendStripeForm(form, "metadata[kind]", "client_invoice");
          appendStripeForm(form, "metadata[invoice_id]", invoiceRecord.id);
          appendStripeForm(form, "metadata[project_id]", projectRecord.id);
          appendStripeForm(form, "metadata[organization_id]", projectRecord.organization_id);
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
            "payment_intent_data[metadata][billing_application_id]",
            invoiceRecord.billing_application_id,
          );
          appendStripeForm(
            form,
            "payment_intent_data[transfer_data][destination]",
            orgPayment.stripe_connect_account_id,
          );
          if (feeCents > 0) {
            appendStripeForm(form, "payment_intent_data[application_fee_amount]", feeCents);
            appendStripeForm(
              form,
              "payment_intent_data[metadata][overwatch_fee_amount_cents]",
              feeCents,
            );
          }

          const session = await stripePost<StripeCheckoutSession>(
            "checkout/sessions",
            form,
            `invoice-checkout:${invoiceRecord.id}:${openBalance}`,
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
