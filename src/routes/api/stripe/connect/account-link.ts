import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  appendStripeForm,
  getAppOrigin,
  isMissingAnySupabaseColumn,
  isMissingSupabaseColumn,
  jsonError,
  jsonOk,
  requireAuthedStripeContext,
  requireManageSettings,
  RouteError,
  stripeGet,
  stripePost,
  type AuthedStripeContext,
} from "@/lib/stripe.server";
import {
  ORGANIZATION_STRIPE_SELECT,
  normalizeStripeMode,
  stripeConnectionForMode,
  stripeModePersistencePatch,
  type OrganizationStripeColumns,
  type StripeMode,
} from "@/lib/stripe-mode";
import {
  stripeConnectDetails,
  type StripeConnectAccountSnapshot,
} from "@/lib/stripe-connect-status";

const connectAccountLinkInput = z.object({
  organizationId: z.string().uuid().optional(),
  returnPath: z.string().max(500).optional(),
  refreshPath: z.string().max(500).optional(),
  mode: z.enum(["test", "live"]).default("live"),
  action: z.enum(["onboard", "activate", "dashboard", "status"]).default("onboard"),
});

type OrganizationRecord = OrganizationStripeColumns & {
  id: string;
  name: string;
  billing_email: string;
};

type StripeConnectAccount = StripeConnectAccountSnapshot & {
  id: string;
  controller?: {
    stripe_dashboard?: { type?: "express" | "full" | "none" | null } | null;
  } | null;
};

type StripeAccountLink = {
  object: "account_link";
  url: string;
  expires_at?: number;
};

type StripeLoginLink = {
  object: "login_link";
  url: string;
};

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
  eq(column: string, value: unknown): DynamicQuery;
  select(columns?: string): DynamicQuery;
  single(): DynamicQuery;
  update(values: unknown): DynamicQuery;
};

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as { from(table: string): DynamicQuery }).from(relation);

const CONNECT_SELECT = `id,name,billing_email,${ORGANIZATION_STRIPE_SELECT}`;
const CONNECT_SELECT_WITHOUT_BILLING_EMAIL = `id,name,${ORGANIZATION_STRIPE_SELECT}`;
const CONNECT_PERSISTENCE_COLUMNS = [
  "stripe_connect_account_id_test",
  "stripe_connect_status_test",
  "stripe_connect_account_id_live",
  "stripe_connect_status_live",
  "stripe_mode",
  "payment_processor_ready",
] as const;
const CONNECT_OPTIONAL_COLUMNS = ["billing_email", ...CONNECT_PERSISTENCE_COLUMNS] as const;

const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const bool = (value: unknown) => (typeof value === "boolean" ? value : Boolean(value));

function normalizedInternalPath(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  return value;
}

function stripeConnectSchemaNotReady(error: { message?: string } | null) {
  return new RouteError(
    "stripe_schema_not_ready",
    "Stripe setup isn't available yet. Try again in a few minutes.",
    409,
    { cause: error?.message ?? "" },
  );
}

function normalizeOrganization(row: Record<string, unknown>): OrganizationRecord {
  return {
    id: str(row.id),
    name: str(row.name, "Company"),
    billing_email: str(row.billing_email),
    stripe_mode: normalizeStripeMode(row.stripe_mode),
    stripe_connect_account_id: str(row.stripe_connect_account_id),
    stripe_connect_status: str(row.stripe_connect_status, "not_connected"),
    payment_processor_ready: bool(row.payment_processor_ready),
    stripe_connect_account_id_test: str(row.stripe_connect_account_id_test),
    stripe_connect_status_test: str(row.stripe_connect_status_test, "not_connected"),
    stripe_connect_account_id_live: str(row.stripe_connect_account_id_live),
    stripe_connect_status_live: str(row.stripe_connect_status_live, "not_connected"),
  };
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
  mode: StripeMode,
  currentMode: StripeMode,
) {
  const status = stripeConnectDetails(account);
  const patch: Record<string, unknown> = stripeModePersistencePatch(
    mode,
    account.id,
    status.status,
  );
  // Legacy aliases stay synchronized with whichever mode is active until a
  // later cleanup removes them. They must never be used to choose a live id.
  if (mode === currentMode) {
    patch.stripe_connect_account_id = account.id;
    patch.stripe_connect_status = status.status;
    patch.payment_processor_ready = status.ready;
  }
  const { error } = await dynamicTable(context.admin, "organizations")
    .update(patch)
    .eq("id", organizationId);
  if (error) {
    if (isMissingAnySupabaseColumn(error, CONNECT_PERSISTENCE_COLUMNS)) {
      throw stripeConnectSchemaNotReady(error);
    }
    throw new Error(error.message);
  }
  return status;
}

async function loadOrganizationForConnect(context: AuthedStripeContext, organizationId: string) {
  const full = await dynamicTable(context.admin, "organizations")
    .select(CONNECT_SELECT)
    .eq("id", organizationId)
    .single();
  if (!full.error) {
    return normalizeOrganization(full.data as unknown as Record<string, unknown>);
  }
  if (!isMissingAnySupabaseColumn(full.error, CONNECT_OPTIONAL_COLUMNS)) {
    throw new Error(full.error.message);
  }

  if (!isMissingSupabaseColumn(full.error, "billing_email")) {
    throw stripeConnectSchemaNotReady(full.error);
  }

  const withoutBillingEmail = await dynamicTable(context.admin, "organizations")
    .select(CONNECT_SELECT_WITHOUT_BILLING_EMAIL)
    .eq("id", organizationId)
    .single();
  if (!withoutBillingEmail.error) {
    return normalizeOrganization({
      ...(withoutBillingEmail.data as Record<string, unknown>),
      billing_email: "",
    });
  }
  if (isMissingAnySupabaseColumn(withoutBillingEmail.error, CONNECT_PERSISTENCE_COLUMNS)) {
    throw stripeConnectSchemaNotReady(withoutBillingEmail.error);
  }
  throw new Error(withoutBillingEmail.error.message);
}

async function createConnectAccount(
  context: AuthedStripeContext,
  organization: OrganizationRecord,
  mode: StripeMode,
) {
  const form = new URLSearchParams();
  appendStripeForm(form, "country", "US");
  appendStripeForm(form, "email", organization.billing_email || context.user.email);
  appendStripeForm(form, "business_type", "company");
  appendStripeForm(form, "business_profile[name]", organization.name);
  appendStripeForm(form, "capabilities[card_payments][requested]", true);
  appendStripeForm(form, "capabilities[transfers][requested]", true);
  // Standard-equivalent responsibility model selected for Overwatch:
  // Stripe/connected account handles processing fees and Stripe is liable for
  // unrecoverable connected-account losses. The contractor gets the full
  // Stripe Dashboard; Overwatch only creates direct charges and may collect a
  // separately configured application fee.
  appendStripeForm(form, "controller[fees][payer]", "account");
  appendStripeForm(form, "controller[losses][payments]", "stripe");
  appendStripeForm(form, "controller[requirement_collection]", "stripe");
  appendStripeForm(form, "controller[stripe_dashboard][type]", "full");
  appendStripeForm(form, "metadata[organization_id]", organization.id);
  appendStripeForm(form, "metadata[user_id]", context.user.id);
  appendStripeForm(form, "metadata[overwatch_mode]", mode);

  return stripePost<StripeConnectAccount>(
    "accounts",
    form,
    `connect-account:${organization.id}:${mode}`,
    undefined,
    mode,
  );
}

export const Route = createFileRoute("/api/stripe/connect/account-link")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = connectAccountLinkInput.parse(await request.json());
          const context = await requireAuthedStripeContext(request);
          const organizationId = await resolveOrganizationId(body.organizationId, context);
          await requireManageSettings(context, organizationId);

          const orgRecord = await loadOrganizationForConnect(context, organizationId);
          if (!orgRecord.id) throw new Error("Organization not found.");
          const currentMode = normalizeStripeMode(orgRecord.stripe_mode);
          const selected = stripeConnectionForMode(orgRecord, body.mode);

          if (body.action === "status") {
            if (!selected.accountId) {
              return jsonOk({
                organizationId: orgRecord.id,
                mode: body.mode,
                connectDetails: stripeConnectDetails({}),
              });
            }
            const account = await stripeGet<StripeConnectAccount>(
              `accounts/${selected.accountId}`,
              body.mode,
            );
            const connectDetails = await syncConnectAccountStatus(
              context,
              orgRecord.id,
              account,
              body.mode,
              currentMode,
            );
            return jsonOk({
              organizationId: orgRecord.id,
              mode: body.mode,
              accountId: account.id,
              connectStatus: connectDetails.status,
              paymentProcessorReady: connectDetails.ready,
              connectDetails,
            });
          }

          if (body.action === "activate") {
            if (!selected.accountId) {
              throw new RouteError(
                "stripe_live_account_missing",
                "Finish live Stripe setup before activating live payments.",
                409,
              );
            }
            const account = await stripeGet<StripeConnectAccount>(
              `accounts/${selected.accountId}`,
              body.mode,
            );
            const status = await syncConnectAccountStatus(
              context,
              orgRecord.id,
              account,
              body.mode,
              currentMode,
            );
            if (!status.ready) {
              throw new RouteError(
                "stripe_live_account_not_ready",
                "Stripe still needs information for this live account. Resume verification before activating live payments.",
                409,
              );
            }
            const { error } = await dynamicTable(context.admin, "organizations")
              .update({
                stripe_mode: body.mode,
                stripe_connect_account_id: account.id,
                stripe_connect_status: status.status,
                payment_processor_ready: status.ready,
              })
              .eq("id", orgRecord.id);
            if (error) throw new Error(error.message);
            return jsonOk({
              activated: true,
              mode: body.mode,
              accountId: account.id,
              connectStatus: status.status,
              paymentProcessorReady: status.ready,
              connectDetails: status,
              organizationId: orgRecord.id,
            });
          }

          if (body.action === "dashboard") {
            if (!selected.accountId) {
              throw new RouteError(
                "stripe_account_missing",
                "Finish Stripe setup before opening the Stripe Dashboard.",
                409,
              );
            }
            const account = await stripeGet<StripeConnectAccount>(
              `accounts/${selected.accountId}`,
              body.mode,
            );
            const connectDetails = await syncConnectAccountStatus(
              context,
              orgRecord.id,
              account,
              body.mode,
              currentMode,
            );
            const dashboardType = account.controller?.stripe_dashboard?.type;
            const dashboardUrl =
              dashboardType === "express"
                ? (
                    await stripePost<StripeLoginLink>(
                      `accounts/${account.id}/login_links`,
                      new URLSearchParams(),
                      undefined,
                      undefined,
                      body.mode,
                    )
                  ).url
                : "https://dashboard.stripe.com/";
            return jsonOk({
              dashboardUrl,
              dashboardType: dashboardType ?? "full",
              mode: body.mode,
              organizationId: orgRecord.id,
              connectDetails,
            });
          }

          const account = selected.accountId
            ? await stripeGet<StripeConnectAccount>(`accounts/${selected.accountId}`, body.mode)
            : await createConnectAccount(context, orgRecord, body.mode);

          const status = await syncConnectAccountStatus(
            context,
            orgRecord.id,
            account,
            body.mode,
            currentMode,
          );
          const origin = getAppOrigin(request);
          const returnUrl = new URL(
            normalizedInternalPath(body.returnPath, `/team?stripe=return&mode=${body.mode}`),
            origin,
          );
          const refreshUrl = new URL(
            normalizedInternalPath(body.refreshPath, `/team?stripe=refresh&mode=${body.mode}`),
            origin,
          );

          const form = new URLSearchParams();
          appendStripeForm(form, "account", account.id);
          appendStripeForm(form, "refresh_url", refreshUrl.toString());
          appendStripeForm(form, "return_url", returnUrl.toString());
          appendStripeForm(form, "type", "account_onboarding");

          const accountLink = await stripePost<StripeAccountLink>(
            "account_links",
            form,
            undefined,
            undefined,
            body.mode,
          );

          return jsonOk({
            accountId: account.id,
            accountLinkUrl: accountLink.url,
            connectStatus: status.status,
            paymentProcessorReady: status.ready,
            connectDetails: status,
            organizationId: orgRecord.id,
            mode: body.mode,
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
