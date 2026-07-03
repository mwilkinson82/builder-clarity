import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DEFAULT_STRIPE_AMOUNT_THRESHOLD_CENTS,
  dollarsToCents,
  maskAccountTail,
  methodAvailability,
  renderRemittanceMemo,
  resolveEnabledMethods,
  stripeConnectReady,
  type EnabledPaymentMethods,
} from "@/lib/payments-domain";

type PaymentsServerContext = {
  supabase: SupabaseClient;
  userId: string;
};

type DynamicSupabaseClient = {
  from: (relation: string) => ReturnType<SupabaseClient["from"]>;
};

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as DynamicSupabaseClient).from(relation);

async function ensureCurrentOrganization(context: PaymentsServerContext) {
  const { data: organizationId, error } = await context.supabase.rpc("ensure_current_user_account");
  if (error) throw new Error(error.message);
  if (!organizationId)
    throw new Error("No Overwatch company workspace is available for this user.");
  return organizationId as string;
}

function isMissingRestFunction(
  error: { code?: string; message?: string } | null,
  fn: string,
): boolean {
  const message = (error?.message ?? "").toLowerCase();
  return error?.code === "PGRST202" || message.includes(`function ${fn.toLowerCase()}`);
}

/**
 * Missing-relation guard: the Payments Phase 1 migrations land with this PR
 * and are applied outside the repo, so every read of the new tables/columns
 * degrades to "not set up yet" instead of erroring while the deploy is ahead
 * of the database.
 */
function isMissingRelation(error: { code?: string; message?: string } | null): boolean {
  const message = (error?.message ?? "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("could not find the table")
  );
}

async function hasOrgCapability(
  context: PaymentsServerContext,
  organizationId: string,
  capability: string,
): Promise<boolean | null> {
  const { data, error } = await context.supabase.rpc("has_org_capability", {
    p_org_id: organizationId,
    p_capability: capability,
  });
  if (error) {
    if (isMissingRestFunction(error, "has_org_capability")) return null;
    throw new Error(error.message);
  }
  return Boolean(data);
}

/**
 * The Getting paid section is open to billing.manage OR
 * company.manage_settings. Pre-capability-migration fallback: can_manage_org.
 */
async function requireBillingOrSettingsCapability(
  context: PaymentsServerContext,
  organizationId: string,
) {
  const billing = await hasOrgCapability(context, organizationId, "billing.manage");
  if (billing === true) return;
  const settings = await hasOrgCapability(context, organizationId, "company.manage_settings");
  if (settings === true) return;
  if (billing === null || settings === null) {
    const { data: canManage, error } = await context.supabase.rpc("can_manage_org", {
      p_org_id: organizationId,
    });
    if (error) throw new Error(error.message);
    if (canManage) return;
  }
  throw new Error("You do not have permission to manage how this company gets paid.");
}

type PaymentProfileRow = {
  id: string;
  organization_id: string;
  bank_name: string;
  routing_number: string;
  account_number: string;
  wire_instructions: string;
  remittance_memo_template: string;
  default_payment_methods: unknown;
  card_fee_pass_through: boolean;
  stripe_amount_threshold_cents: number;
};

const PROFILE_SELECT =
  "id,organization_id,bank_name,routing_number,account_number,wire_instructions,remittance_memo_template,default_payment_methods,card_fee_pass_through,stripe_amount_threshold_cents";

async function loadPaymentProfileRow(
  supabase: unknown,
  organizationId: string,
): Promise<{ row: PaymentProfileRow | null; schemaMissing: boolean }> {
  const { data, error } = await dynamicTable(supabase, "organization_payment_profiles")
    .select(PROFILE_SELECT)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) {
    if (isMissingRelation(error)) return { row: null, schemaMissing: true };
    throw new Error(error.message);
  }
  return { row: (data as PaymentProfileRow | null) ?? null, schemaMissing: false };
}

export interface CompanyPaymentProfileView {
  exists: boolean;
  schemaMissing: boolean;
  bankName: string;
  routingMasked: string;
  accountMasked: string;
  hasBankDetails: boolean;
  wireInstructions: string;
  remittanceMemoTemplate: string;
  defaultPaymentMethods: EnabledPaymentMethods;
  cardFeePassThrough: boolean;
  stripeAmountThresholdCents: number;
}

function profileView(
  row: PaymentProfileRow | null,
  schemaMissing: boolean,
): CompanyPaymentProfileView {
  return {
    exists: Boolean(row),
    schemaMissing,
    bankName: row?.bank_name ?? "",
    routingMasked: maskAccountTail(row?.routing_number ?? ""),
    accountMasked: maskAccountTail(row?.account_number ?? ""),
    hasBankDetails: Boolean(row?.bank_name && row?.routing_number && row?.account_number),
    wireInstructions: row?.wire_instructions ?? "",
    remittanceMemoTemplate: row?.remittance_memo_template ?? "Reference: Invoice {number}",
    defaultPaymentMethods: resolveEnabledMethods({}, row?.default_payment_methods ?? null),
    cardFeePassThrough: Boolean(row?.card_fee_pass_through),
    stripeAmountThresholdCents:
      Number(row?.stripe_amount_threshold_cents) > 0
        ? Number(row?.stripe_amount_threshold_cents)
        : DEFAULT_STRIPE_AMOUNT_THRESHOLD_CENTS,
  };
}

/**
 * Masked payment profile for the Getting paid section. Bank numbers never
 * leave the server unmasked through this function; use
 * revealCompanyPaymentProfile for the explicit reveal-on-click.
 */
export const getCompanyPaymentProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as PaymentsServerContext;
    const organizationId = await ensureCurrentOrganization(ctx);
    await requireBillingOrSettingsCapability(ctx, organizationId);
    const { row, schemaMissing } = await loadPaymentProfileRow(ctx.supabase, organizationId);
    return profileView(row, schemaMissing);
  });

export const revealCompanyPaymentProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as PaymentsServerContext;
    const organizationId = await ensureCurrentOrganization(ctx);
    await requireBillingOrSettingsCapability(ctx, organizationId);
    const { row } = await loadPaymentProfileRow(ctx.supabase, organizationId);
    return {
      routingNumber: row?.routing_number ?? "",
      accountNumber: row?.account_number ?? "",
    };
  });

const paymentProfileInput = z.object({
  bankName: z.string().trim().max(200),
  // Empty string = keep the stored number (the form shows masked values and
  // only sends digits when the user re-enters them).
  routingNumber: z
    .string()
    .trim()
    .max(40)
    .regex(/^\d*$/, "Routing number can only contain digits."),
  accountNumber: z
    .string()
    .trim()
    .max(40)
    .regex(/^[\d-]*$/, "Account number can only contain digits and dashes."),
  wireInstructions: z.string().trim().max(4000),
  remittanceMemoTemplate: z.string().trim().max(400),
  defaultPaymentMethods: z
    .object({
      direct_bank: z.boolean(),
      card: z.boolean(),
      ach_debit: z.boolean(),
    })
    .partial()
    .optional(),
  cardFeePassThrough: z.boolean().optional(),
  stripeAmountThresholdCents: z.number().int().min(0).max(100_000_000_000).optional(),
});

export const saveCompanyPaymentProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.infer<typeof paymentProfileInput>) => paymentProfileInput.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as PaymentsServerContext;
    const organizationId = await ensureCurrentOrganization(ctx);
    await requireBillingOrSettingsCapability(ctx, organizationId);

    const { row: existing, schemaMissing } = await loadPaymentProfileRow(
      ctx.supabase,
      organizationId,
    );
    if (schemaMissing) {
      throw new Error(
        "The payments database migration has not been applied yet. Apply the Payments Phase 1 migrations, then save again.",
      );
    }

    const nextMethods = {
      ...resolveEnabledMethods({}, existing?.default_payment_methods ?? null),
      ...(data.defaultPaymentMethods ?? {}),
    };
    const payload: Record<string, unknown> = {
      organization_id: organizationId,
      bank_name: data.bankName,
      wire_instructions: data.wireInstructions,
      remittance_memo_template: data.remittanceMemoTemplate || "Reference: Invoice {number}",
      default_payment_methods: {
        direct_bank: nextMethods.direct_bank,
        card: nextMethods.card,
        ach_debit: nextMethods.ach_debit,
      },
      card_fee_pass_through: data.cardFeePassThrough ?? existing?.card_fee_pass_through ?? false,
      stripe_amount_threshold_cents:
        data.stripeAmountThresholdCents ??
        existing?.stripe_amount_threshold_cents ??
        DEFAULT_STRIPE_AMOUNT_THRESHOLD_CENTS,
    };
    if (data.routingNumber) payload.routing_number = data.routingNumber;
    if (data.accountNumber) payload.account_number = data.accountNumber;

    const query = dynamicTable(ctx.supabase, "organization_payment_profiles");
    const { data: saved, error } = existing
      ? await query.update(payload).eq("id", existing.id).select(PROFILE_SELECT).single()
      : await query.insert(payload).select(PROFILE_SELECT).single();
    if (error) throw new Error(error.message);
    return profileView(saved as unknown as PaymentProfileRow, false);
  });

type OrganizationStripeRow = {
  id: string;
  stripe_connect_account_id: string;
  stripe_connect_status: string;
  payment_processor_ready: boolean;
};

async function loadOrganizationStripe(
  supabase: unknown,
  organizationId: string,
): Promise<OrganizationStripeRow> {
  const { data, error } = await dynamicTable(supabase, "organizations")
    .select("id,stripe_connect_account_id,stripe_connect_status,payment_processor_ready")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) {
    if (isMissingRelation(error) || error.code === "PGRST204") {
      return {
        id: organizationId,
        stripe_connect_account_id: "",
        stripe_connect_status: "not_connected",
        payment_processor_ready: false,
      };
    }
    throw new Error(error.message);
  }
  const row = (data ?? {}) as Partial<OrganizationStripeRow>;
  return {
    id: organizationId,
    stripe_connect_account_id: row.stripe_connect_account_id ?? "",
    stripe_connect_status: row.stripe_connect_status || "not_connected",
    payment_processor_ready: Boolean(row.payment_processor_ready),
  };
}

export interface PaymentMethodContext {
  organizationId: string;
  hasPaymentProfile: boolean;
  stripeAccountId: string;
  stripeConnectStatus: string;
  stripeReady: boolean;
  defaultPaymentMethods: EnabledPaymentMethods;
  cardFeePassThrough: boolean;
  stripeAmountThresholdCents: number;
}

async function buildPaymentMethodContext(
  ctx: PaymentsServerContext,
  organizationId: string,
): Promise<PaymentMethodContext> {
  const [{ row: profile }, org] = await Promise.all([
    loadPaymentProfileRow(ctx.supabase, organizationId),
    loadOrganizationStripe(ctx.supabase, organizationId),
  ]);
  const view = profileView(profile, false);
  return {
    organizationId,
    hasPaymentProfile: view.hasBankDetails,
    stripeAccountId: org.stripe_connect_account_id,
    stripeConnectStatus: org.stripe_connect_status,
    stripeReady: stripeConnectReady({
      accountId: org.stripe_connect_account_id,
      connectStatus: org.stripe_connect_status,
      processorReady: org.payment_processor_ready,
    }),
    defaultPaymentMethods: view.defaultPaymentMethods,
    cardFeePassThrough: view.cardFeePassThrough,
    stripeAmountThresholdCents: view.stripeAmountThresholdCents,
  };
}

/**
 * Direct bank transfer details for one invoice (used on the contractor's
 * invoice PDF). Returns null unless the invoice has direct bank transfer
 * enabled AND the caller can read the payment profile (billing.manage or
 * company.manage_settings — enforced by RLS on the profile table).
 */
export const getInvoiceRemittance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { invoiceId: string }) =>
    z.object({ invoiceId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as PaymentsServerContext;
    const { data: invoice, error: invoiceError } = await dynamicTable(
      ctx.supabase,
      "billing_invoices",
    )
      .select("id,project_id,invoice_number,total_due,enabled_payment_methods")
      .eq("id", data.invoiceId)
      .maybeSingle();
    if (invoiceError) {
      if (isMissingRelation(invoiceError) || invoiceError.code === "PGRST204") return null;
      throw new Error(invoiceError.message);
    }
    if (!invoice) return null;
    const invoiceRow = invoice as Record<string, unknown>;

    const { data: project, error: projectError } = await dynamicTable(ctx.supabase, "projects")
      .select("organization_id")
      .eq("id", invoiceRow.project_id as string)
      .maybeSingle();
    if (projectError) throw new Error(projectError.message);
    const organizationId =
      ((project as Record<string, unknown> | null)?.organization_id as string | null) ?? null;
    if (!organizationId) return null;

    const { row: profile } = await loadPaymentProfileRow(ctx.supabase, organizationId);
    const view = profileView(profile, false);
    if (!view.hasBankDetails) return null;

    const enabled = resolveEnabledMethods(
      invoiceRow.enabled_payment_methods ?? {},
      profile?.default_payment_methods ?? null,
    );
    const availability = methodAvailability({
      hasPaymentProfile: view.hasBankDetails,
      stripeReady: false, // irrelevant for the direct-bank decision
      enabled,
      invoiceTotalCents: dollarsToCents(Number(invoiceRow.total_due ?? 0)),
      thresholdCents: view.stripeAmountThresholdCents,
    });
    if (!availability.direct_bank.available) return null;

    return {
      bankName: profile?.bank_name ?? "",
      routingNumber: profile?.routing_number ?? "",
      accountNumber: profile?.account_number ?? "",
      wireInstructions: profile?.wire_instructions ?? "",
      memo: renderRemittanceMemo(
        view.remittanceMemoTemplate,
        String(invoiceRow.invoice_number ?? ""),
      ),
    };
  });

/**
 * Method availability inputs for the invoice create/send/edit form and the
 * billing dashboard nudge. Reads are RLS-scoped: members without profile read
 * access see hasPaymentProfile=false, which only ever hides options, never
 * exposes bank details.
 */
export const getPaymentMethodContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId?: string } | undefined) =>
    z.object({ projectId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as PaymentsServerContext;
    let organizationId: string | null = null;
    if (data.projectId) {
      const { data: project, error } = await dynamicTable(ctx.supabase, "projects")
        .select("id,organization_id")
        .eq("id", data.projectId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      organizationId = (project as { organization_id?: string } | null)?.organization_id ?? null;
    }
    if (!organizationId) organizationId = await ensureCurrentOrganization(ctx);
    return buildPaymentMethodContext(ctx, organizationId);
  });
