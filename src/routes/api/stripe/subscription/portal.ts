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
} from "@/lib/stripe.server";

const portalInput = z.object({
  organizationId: z.string().uuid().optional(),
  returnPath: z.string().max(500).optional(),
});

type DynamicResult = {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
};

type DynamicQuery = PromiseLike<DynamicResult> & {
  select(columns: string): DynamicQuery;
  eq(column: string, value: unknown): DynamicQuery;
  single(): Promise<DynamicResult>;
};

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as { from(table: string): DynamicQuery }).from(relation);

function subscriptionStripeMode() {
  return readServerEnv("OVERWATCH_SUBSCRIPTION_MODE").toLowerCase() === "test" ? "test" : "live";
}

function internalPath(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/team?section=plan";
  }
  return value;
}

async function resolveOrganizationId(
  requested: string | undefined,
  context: Awaited<ReturnType<typeof requireAuthedStripeContext>>,
) {
  if (requested) return requested;
  const { data, error } = await context.authed.rpc("ensure_current_user_account");
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No OverWatch company workspace is available for this user.");
  return String(data);
}

type StripePortalSession = { id: string; url?: string | null };

export const Route = createFileRoute("/api/stripe/subscription/portal")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = portalInput.parse(await request.json());
          const context = await requireAuthedStripeContext(request);
          const organizationId = await resolveOrganizationId(body.organizationId, context);
          await requireManageSettings(context, organizationId);

          const { data: organization, error } = await dynamicTable(context.admin, "organizations")
            .select("id,stripe_customer_id,stripe_mode")
            .eq("id", organizationId)
            .single();
          if (error) throw new Error(error.message);
          const customerId = String(organization?.stripe_customer_id || "");
          if (!customerId) {
            throw new Error("This company does not have an OverWatch billing account yet.");
          }

          const form = new URLSearchParams();
          appendStripeForm(form, "customer", customerId);
          appendStripeForm(
            form,
            "return_url",
            new URL(internalPath(body.returnPath), getAppOrigin(request)).toString(),
          );
          const session = await stripePost<StripePortalSession>(
            "billing_portal/sessions",
            form,
            undefined,
            undefined,
            subscriptionStripeMode(),
          );
          if (!session.url) throw new Error("Stripe did not return a billing portal URL.");
          return jsonOk({ portalUrl: session.url });
        } catch (error) {
          return jsonError(error);
        }
      },
    },
  },
});
