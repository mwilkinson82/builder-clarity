import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  appendStripeForm,
  getAppOrigin,
  jsonError,
  jsonOk,
  readServerEnv,
  requireAuthedStripeContext,
  requireManageSettings,
  stripePost,
  type StripeCheckoutSession,
} from "@/lib/stripe.server";

const subscriptionCheckoutInput = z.object({
  organizationId: z.string().uuid().optional(),
  planCode: z.literal("pro").default("pro"),
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
  stripe_subscription_id: string;
  contractor_circle_grant: boolean;
};

type DynamicResult = {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
};

type DynamicQuery = PromiseLike<DynamicResult> & {
  select(columns: string): DynamicQuery;
  eq(column: string, value: unknown): DynamicQuery;
  update(values: Record<string, unknown>): DynamicQuery;
  maybeSingle(): Promise<DynamicResult>;
  single(): Promise<DynamicResult>;
};

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as { from(table: string): DynamicQuery }).from(relation);

function subscriptionStripeMode() {
  return readServerEnv("OVERWATCH_SUBSCRIPTION_MODE").toLowerCase() === "test" ? "test" : "live";
}

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

async function resolvePlan(
  planCode: "pro",
  context: Awaited<ReturnType<typeof requireAuthedStripeContext>>,
) {
  const { data: plan, error } = await dynamicTable(context.admin, "subscription_plans")
    .select("code,stripe_price_id,checkout_enabled,is_public")
    .eq("code", planCode)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const planPriceId =
    plan && typeof plan.stripe_price_id === "string" && plan.checkout_enabled && plan.is_public
      ? plan.stripe_price_id
      : "";

  if (!planPriceId) {
    throw new Error(
      "This Overwatch plan does not have a Stripe price configured for checkout yet.",
    );
  }

  return { code: planCode, priceId: planPriceId };
}

export const Route = createFileRoute("/api/stripe/checkout/subscription")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = subscriptionCheckoutInput.parse(await request.json());
          const context = await requireAuthedStripeContext(request);
          const organizationId = await resolveOrganizationId(body.organizationId, context);
          await requireManageSettings(context, organizationId);

          const { data: organization, error: orgError } = await dynamicTable(
            context.admin,
            "organizations",
          )
            .select(
              "id,name,plan_code,billing_email,stripe_customer_id,stripe_price_id,stripe_subscription_id,contractor_circle_grant",
            )
            .eq("id", organizationId)
            .single();
          if (orgError) throw new Error(orgError.message);
          if (!organization) throw new Error("Organization not found.");

          const orgRecord = organization as unknown as OrganizationRecord;
          if (orgRecord.contractor_circle_grant) {
            throw new Error(
              "OverWatch Pro is already included with this company's Contractor Circle membership.",
            );
          }
          if (orgRecord.stripe_subscription_id) {
            throw new Error(
              "This company already has an OverWatch subscription. Manage the existing subscription instead of starting another one.",
            );
          }
          const plan = await resolvePlan(body.planCode, context);
          const priceId = plan.priceId;
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
          appendStripeForm(form, "metadata[plan_code]", plan.code);
          appendStripeForm(form, "metadata[user_id]", context.user.id);
          appendStripeForm(form, "subscription_data[metadata][organization_id]", orgRecord.id);
          appendStripeForm(form, "subscription_data[metadata][plan_code]", plan.code);
          appendStripeForm(form, "subscription_data[metadata][user_id]", context.user.id);
          appendStripeForm(form, "customer", orgRecord.stripe_customer_id);
          if (!orgRecord.stripe_customer_id) {
            appendStripeForm(form, "customer_email", orgRecord.billing_email || context.user.email);
          }

          const session = await stripePost<StripeCheckoutSession>(
            "checkout/sessions",
            form,
            `subscription-checkout:${orgRecord.id}:${priceId}`,
            undefined,
            subscriptionStripeMode(),
          );

          const { error: updateError } = await dynamicTable(context.admin, "organizations")
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
