import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  appendStripeForm,
  getAppOrigin,
  jsonError,
  jsonOk,
  requireAuthedStripeContext,
  requireCanManageOrganization,
  stripeGet,
  stripePost,
  type AuthedStripeContext,
} from "@/lib/stripe.server";

const connectAccountLinkInput = z.object({
  organizationId: z.string().uuid().optional(),
  returnPath: z.string().max(500).optional(),
  refreshPath: z.string().max(500).optional(),
});

type OrganizationRecord = {
  id: string;
  name: string;
  billing_email: string;
  stripe_connect_account_id: string;
  stripe_connect_status: string;
  payment_processor_ready: boolean;
};

type StripeConnectAccount = {
  id: string;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
};

type StripeAccountLink = {
  object: "account_link";
  url: string;
  expires_at?: number;
};

function normalizedInternalPath(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  return value;
}

function connectStatus(account: StripeConnectAccount) {
  if (account.charges_enabled && account.payouts_enabled && account.details_submitted) {
    return { status: "active", ready: true };
  }

  if (account.details_submitted) {
    return { status: "pending_review", ready: false };
  }

  return { status: "onboarding_started", ready: false };
}

async function resolveOrganizationId(
  organizationId: string | undefined,
  context: AuthedStripeContext,
) {
  if (organizationId) return organizationId;
  const { data, error } = await context.authed.rpc("ensure_current_user_account");
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No Overwatch company workspace is available for this user.");
  return data as string;
}

async function syncConnectAccountStatus(
  context: AuthedStripeContext,
  organizationId: string,
  account: StripeConnectAccount,
) {
  const status = connectStatus(account);
  const { error } = await context.admin
    .from("organizations")
    .update({
      stripe_connect_account_id: account.id,
      stripe_connect_status: status.status,
      payment_processor_ready: status.ready,
    })
    .eq("id", organizationId);
  if (error) throw new Error(error.message);
  return status;
}

async function createConnectAccount(
  context: AuthedStripeContext,
  organization: OrganizationRecord,
) {
  const form = new URLSearchParams();
  appendStripeForm(form, "country", "US");
  appendStripeForm(form, "email", organization.billing_email || context.user.email);
  appendStripeForm(form, "business_type", "company");
  appendStripeForm(form, "business_profile[name]", organization.name);
  appendStripeForm(form, "capabilities[card_payments][requested]", true);
  appendStripeForm(form, "capabilities[transfers][requested]", true);
  appendStripeForm(form, "controller[fees][payer]", "application");
  appendStripeForm(form, "controller[losses][payments]", "application");
  appendStripeForm(form, "controller[requirement_collection]", "stripe");
  appendStripeForm(form, "controller[stripe_dashboard][type]", "express");
  appendStripeForm(form, "metadata[organization_id]", organization.id);
  appendStripeForm(form, "metadata[user_id]", context.user.id);

  return stripePost<StripeConnectAccount>("accounts", form, `connect-account:${organization.id}`);
}

export const Route = createFileRoute("/api/stripe/connect/account-link")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = connectAccountLinkInput.parse(await request.json());
          const context = await requireAuthedStripeContext(request);
          const organizationId = await resolveOrganizationId(body.organizationId, context);
          await requireCanManageOrganization(context, organizationId);

          const { data: organization, error: orgError } = await context.admin
            .from("organizations")
            .select(
              "id,name,billing_email,stripe_connect_account_id,stripe_connect_status,payment_processor_ready",
            )
            .eq("id", organizationId)
            .single();
          if (orgError) throw new Error(orgError.message);
          if (!organization) throw new Error("Organization not found.");

          const orgRecord = organization as OrganizationRecord;
          const account = orgRecord.stripe_connect_account_id
            ? await stripeGet<StripeConnectAccount>(
                `accounts/${orgRecord.stripe_connect_account_id}`,
              )
            : await createConnectAccount(context, orgRecord);

          const status = await syncConnectAccountStatus(context, orgRecord.id, account);
          const origin = getAppOrigin(request);
          const returnUrl = new URL(
            normalizedInternalPath(body.returnPath, "/team?stripe=return"),
            origin,
          );
          const refreshUrl = new URL(
            normalizedInternalPath(body.refreshPath, "/team?stripe=refresh"),
            origin,
          );

          const form = new URLSearchParams();
          appendStripeForm(form, "account", account.id);
          appendStripeForm(form, "refresh_url", refreshUrl.toString());
          appendStripeForm(form, "return_url", returnUrl.toString());
          appendStripeForm(form, "type", "account_onboarding");

          const accountLink = await stripePost<StripeAccountLink>("account_links", form);

          return jsonOk({
            accountId: account.id,
            accountLinkUrl: accountLink.url,
            connectStatus: status.status,
            paymentProcessorReady: status.ready,
            organizationId: orgRecord.id,
            returnUrl: returnUrl.toString(),
            refreshUrl: refreshUrl.toString(),
          });
        } catch (error) {
          return jsonError(error);
        }
      },
    },
  },
});
