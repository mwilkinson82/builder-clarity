import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  appendStripeForm,
  getAppOrigin,
  jsonError,
  jsonOk,
  requireAuthedStripeContext,
  requireCanManageOrganization,
  stripePost,
  type StripeCheckoutSession,
} from "@/lib/stripe.server";

const subscriptionCheckoutInput = z.object({
  organizationId: z.string().uuid().optional(),
  priceId: z.string().max(200).optional(),
  successPath: z.string().max(500).optional(),
  cancelPath: z.string().max(500).optional(),
});

type OrganizationRecord = {
  id: string;
  name: string;
  plan_code: string;
  billing_email: string;
  stripe_customer_id: string;
  stripe_price_id: string;
};

function normalizedInternalPath(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  return value;
}

async function resolveOrganizationId(
  organizationId: string | undefined,
  context: Awaited<ReturnType<typeof requireAuthedStripeContext>>,
) {
  if (organizationId) return organizationId;
  const { data, error } = await context.authed.rpc("ensure_current_user_account");
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No Overwatch company workspace is available for this user.");
  return data as string;
}

async function resolvePriceId(
  bodyPriceId: string | undefined,
  organization: OrganizationRecord,
  context: Awaited<ReturnType<typeof requireAuthedStripeContext>>,
) {
  if (bodyPriceId) return bodyPriceId;
  if (organization.stripe_price_id) return organization.stripe_price_id;

  const { data: plan, error } = await context.admin
    .from("subscription_plans")
    .select("stripe_price_id,checkout_enabled")
    .eq("code", organization.plan_code)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const planPriceId =
    plan && typeof plan.stripe_price_id === "string" && plan.checkout_enabled
      ? plan.stripe_price_id
      : "";

  if (!planPriceId) {
    throw new Error(
      "This Overwatch plan does not have a Stripe price configured for checkout yet.",
    );
  }

  return planPriceId;
}

export const Route = createFileRoute("/api/stripe/checkout/subscription")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = subscriptionCheckoutInput.parse(await request.json());
          const context = await requireAuthedStripeContext(request);
          const organizationId = await resolveOrganizationId(body.organizationId, context);
          await requireCanManageOrganization(context, organizationId);

          const { data: organization, error: orgError } = await context.admin
            .from("organizations")
            .select("id,name,plan_code,billing_email,stripe_customer_id,stripe_price_id")
            .eq("id", organizationId)
            .single();
          if (orgError) throw new Error(orgError.message);
          if (!organization) throw new Error("Organization not found.");

          const orgRecord = organization as OrganizationRecord;
          const priceId = await resolvePriceId(body.priceId, orgRecord, context);
          const origin = getAppOrigin(request);
          const successUrl = new URL(
            normalizedInternalPath(body.successPath, "/team?checkout=success"),
            origin,
          );
          const cancelUrl = new URL(
            normalizedInternalPath(body.cancelPath, "/team?checkout=cancelled"),
            origin,
          );

          const form = new URLSearchParams();
          appendStripeForm(form, "mode", "subscription");
          appendStripeForm(form, "client_reference_id", orgRecord.id);
          appendStripeForm(form, "success_url", successUrl.toString());
          appendStripeForm(form, "cancel_url", cancelUrl.toString());
          appendStripeForm(form, "line_items[0][price]", priceId);
          appendStripeForm(form, "line_items[0][quantity]", 1);
          appendStripeForm(form, "metadata[kind]", "subscription");
          appendStripeForm(form, "metadata[organization_id]", orgRecord.id);
          appendStripeForm(form, "metadata[user_id]", context.user.id);
          appendStripeForm(form, "subscription_data[metadata][organization_id]", orgRecord.id);
          appendStripeForm(form, "subscription_data[metadata][user_id]", context.user.id);
          appendStripeForm(form, "customer", orgRecord.stripe_customer_id);
          if (!orgRecord.stripe_customer_id) {
            appendStripeForm(form, "customer_email", orgRecord.billing_email || context.user.email);
          }

          const session = await stripePost<StripeCheckoutSession>(
            "checkout/sessions",
            form,
            `subscription-checkout:${orgRecord.id}:${priceId}`,
          );

          const { error: updateError } = await context.admin
            .from("organizations")
            .update({
              stripe_price_id: priceId,
              stripe_checkout_session_id: session.id,
              billing_status: "checkout_pending",
            })
            .eq("id", orgRecord.id);
          if (updateError) throw new Error(updateError.message);

          return jsonOk({
            sessionId: session.id,
            checkoutUrl: session.url ?? "",
            organizationId: orgRecord.id,
          });
        } catch (error) {
          return jsonError(error);
        }
      },
    },
  },
});
