import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_STRIPE_PAYMENT_LIMIT_CENTS } from "@/lib/payments-domain";
import { normalizeApplicationFeeBps } from "@/lib/stripe-fee-config";

type ServerContext = {
  supabase: SupabaseClient;
  userId: string;
};

function missingSchema(error: { code?: string; message?: string } | null) {
  const message = (error?.message ?? "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST204" ||
    error?.code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("could not find the table") ||
    message.includes("could not find the column")
  );
}

async function currentOrganization(context: ServerContext) {
  const { data, error } = await context.supabase.rpc("ensure_current_user_account");
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No Overwatch company workspace is available for this user.");
  return data as string;
}

async function requireBillingManager(context: ServerContext, organizationId: string) {
  const { data, error } = await context.supabase.rpc("has_org_capability", {
    p_org_id: organizationId,
    p_capability: "billing.manage",
  });
  if (!error && data) return;
  if (error && error.code !== "PGRST202") throw new Error(error.message);

  // Deploy-order fallback for databases that have not loaded the capability
  // function yet. This still requires owner/admin organization management.
  const fallback = await context.supabase.rpc("can_manage_org", { p_org_id: organizationId });
  if (fallback.error) throw new Error(fallback.error.message);
  if (!fallback.data) {
    throw new Error("You do not have permission to request a higher payment limit.");
  }
}

export interface StripePaymentLimitContext {
  currentLimitCents: number;
  applicationFeeBps: number;
  liveAccountId: string;
  liveConnectStatus: string;
  requestSchemaReady: boolean;
  latestRequest: {
    id: string;
    requestedLimitCents: number;
    status: string;
    stripeRequestReference: string;
    createdAt: string;
  } | null;
}

export const getStripePaymentLimitContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StripePaymentLimitContext> => {
    const server = context as unknown as ServerContext;
    const organizationId = await currentOrganization(server);
    await requireBillingManager(server, organizationId);

    let organization = await server.supabase
      .from("organizations")
      .select(
        "stripe_payment_limit_cents,stripe_connect_account_id_live,stripe_connect_status_live",
      )
      .eq("id", organizationId)
      .single();
    if (organization.error && missingSchema(organization.error)) {
      organization = await server.supabase
        .from("organizations")
        .select("stripe_connect_account_id_live,stripe_connect_status_live")
        .eq("id", organizationId)
        .single();
    }
    if (organization.error) throw new Error(organization.error.message);

    const row = (organization.data ?? {}) as Record<string, unknown>;
    const latest = await server.supabase
      .from("stripe_limit_requests")
      .select("id,requested_limit_cents,status,stripe_request_reference,created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest.error && !missingSchema(latest.error)) throw new Error(latest.error.message);
    const latestRow = (latest.data ?? null) as Record<string, unknown> | null;

    return {
      currentLimitCents:
        Number(row.stripe_payment_limit_cents) > 0
          ? Number(row.stripe_payment_limit_cents)
          : DEFAULT_STRIPE_PAYMENT_LIMIT_CENTS,
      applicationFeeBps: normalizeApplicationFeeBps(
        process.env.OVERWATCH_INVOICE_APPLICATION_FEE_BPS ||
          import.meta.env.VITE_OVERWATCH_INVOICE_APPLICATION_FEE_BPS,
      ),
      liveAccountId:
        typeof row.stripe_connect_account_id_live === "string"
          ? row.stripe_connect_account_id_live
          : "",
      liveConnectStatus:
        typeof row.stripe_connect_status_live === "string"
          ? row.stripe_connect_status_live
          : "not_connected",
      requestSchemaReady: !latest.error,
      latestRequest: latestRow
        ? {
            id: String(latestRow.id ?? ""),
            requestedLimitCents: Number(latestRow.requested_limit_cents ?? 0),
            status: String(latestRow.status ?? "submitted"),
            stripeRequestReference: String(latestRow.stripe_request_reference ?? ""),
            createdAt: String(latestRow.created_at ?? ""),
          }
        : null,
    };
  });

const requestInput = z.object({
  requestedLimitDollars: z.number().finite().positive().max(100_000_000),
  stripeRequestReference: z.string().trim().max(300).default(""),
  reason: z.string().trim().max(2000).default(""),
});

export const requestStripePaymentLimit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => requestInput.parse(input))
  .handler(async ({ data, context }) => {
    const server = context as unknown as ServerContext;
    const organizationId = await currentOrganization(server);
    await requireBillingManager(server, organizationId);

    const orgResult = await server.supabase
      .from("organizations")
      .select("stripe_payment_limit_cents,stripe_connect_account_id_live")
      .eq("id", organizationId)
      .single();
    if (orgResult.error) {
      if (missingSchema(orgResult.error)) {
        throw new Error("Payment-limit requests are waiting on the latest Lovable migration.");
      }
      throw new Error(orgResult.error.message);
    }
    if (!orgResult.data?.stripe_connect_account_id_live) {
      throw new Error(
        "Create the company's live Stripe connected account before requesting more capacity.",
      );
    }

    const currentLimitCents = Math.max(
      DEFAULT_STRIPE_PAYMENT_LIMIT_CENTS,
      Number(orgResult.data.stripe_payment_limit_cents ?? 0),
    );
    const requestedLimitCents = Math.round(data.requestedLimitDollars * 100);
    if (requestedLimitCents <= currentLimitCents) {
      throw new Error("Request an amount above the company's current online-payment ceiling.");
    }

    const { data: request, error } = await server.supabase
      .from("stripe_limit_requests")
      .insert({
        organization_id: organizationId,
        requested_by: server.userId,
        current_limit_cents: currentLimitCents,
        requested_limit_cents: requestedLimitCents,
        reason: data.reason,
        stripe_request_reference: data.stripeRequestReference,
        status: data.stripeRequestReference ? "under_review" : "stripe_pending",
      })
      .select("id,status,requested_limit_cents")
      .single();
    if (error) {
      if (error.code === "23505") {
        throw new Error("This company already has an open payment-limit request.");
      }
      if (missingSchema(error)) {
        throw new Error("Payment-limit requests are waiting on the latest Lovable migration.");
      }
      throw new Error(error.message);
    }

    return {
      id: request.id,
      status: request.status,
      requestedLimitCents: Number(request.requested_limit_cents),
      stripeSupportUrl: "https://support.stripe.com/contact",
    };
  });
