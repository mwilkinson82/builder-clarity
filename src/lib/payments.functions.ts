import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DEFAULT_STRIPE_AMOUNT_THRESHOLD_CENTS,
  DEFAULT_STRIPE_PAYMENT_LIMIT_CENTS,
  dollarsToCents,
  maskAccountTail,
  methodAvailability,
  renderRemittanceMemo,
  resolveEnabledMethods,
  type EnabledPaymentMethods,
} from "@/lib/payments-domain";
import {
  ORGANIZATION_STRIPE_SELECT,
  stripeConnectionForMode,
  type OrganizationStripeColumns,
  type StripeMode,
} from "@/lib/stripe-mode";

type PaymentsServerContext = {
  supabase: SupabaseClient;
  userId: string;
};

type DynamicSupabaseClient = {
  from: (relation: string) => ReturnType<SupabaseClient["from"]>;
  rpc: (
    functionName: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
};

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as DynamicSupabaseClient).from(relation);

const dynamicRpc = (supabase: unknown, functionName: string, args?: Record<string, unknown>) =>
  (supabase as DynamicSupabaseClient).rpc(functionName, args);

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
  if (!error) return false;
  // Genuine "the function is not deployed yet" only. Code-based: PGRST202
  // (PostgREST cannot find it in the schema cache) / 42883 (Postgres
  // undefined_function). A permission-denied error is 42501 ("permission
  // denied for function <fn>") and is a REAL denial — it must fail closed and
  // must never be classified as missing, which would route to a coarser
  // fallback check.
  if (error.code === "PGRST202" || error.code === "42883") return true;
  const message = (error.message ?? "").toLowerCase();
  return message.includes("could not find the function") && message.includes(fn.toLowerCase());
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

/**
 * Bank remittance details (raw routing/account numbers) may only leave the
 * server for callers holding billing.manage OR financials.view on the
 * invoice's project. Pre-migration fallback (house pattern): when the
 * capability RPCs are not deployed yet, only can_manage_project callers keep
 * the pre-split behavior.
 */
async function requireRemittanceAccess(
  context: PaymentsServerContext,
  organizationId: string,
  projectId: string,
) {
  const denied = new Error(
    'Your access does not include invoice bank details — ask an admin for the "Run billing" or "See financials" capability.',
  );
  const billing = await hasOrgCapability(context, organizationId, "billing.manage");
  if (billing === true) return;

  const fin = await dynamicRpc(context.supabase, "can_view_financials", {
    p_project_id: projectId,
  });
  if (!fin.error && fin.data) return;
  if (fin.error && !isMissingRestFunction(fin.error, "can_view_financials")) {
    throw new Error(fin.error.message);
  }

  // The pre-split can_manage_project fallback fires ONLY when the capability
  // layer is genuinely absent (pre-migration) — i.e. BOTH capability RPCs are
  // missing. An explicit `false` from either arm (RPC deployed, caller simply
  // lacks the flag) is a denial, never a fallback: fail closed so a fin-only
  // holder can't be handed bank routing/account numbers via can_manage_project.
  const capabilityLayerMissing =
    billing === null &&
    fin.error != null &&
    isMissingRestFunction(fin.error, "can_view_financials");
  if (capabilityLayerMissing) {
    const manage = await dynamicRpc(context.supabase, "can_manage_project", {
      p_project_id: projectId,
    });
    if (manage.error) throw new Error(manage.error.message);
    if (manage.data) return;
  }
  throw denied;
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

type OrganizationStripeRow = OrganizationStripeColumns & {
  id: string;
  mode: StripeMode;
  accountId: string;
  connectStatus: string;
  ready: boolean;
  stripePaymentLimitCents: number;
};

async function loadOrganizationStripe(
  supabase: unknown,
  organizationId: string,
): Promise<OrganizationStripeRow> {
  let { data, error } = await dynamicTable(supabase, "organizations")
    .select(`id,${ORGANIZATION_STRIPE_SELECT},stripe_payment_limit_cents`)
    .eq("id", organizationId)
    .maybeSingle();
  if (error?.code === "PGRST204") {
    ({ data, error } = await dynamicTable(supabase, "organizations")
      .select(`id,${ORGANIZATION_STRIPE_SELECT}`)
      .eq("id", organizationId)
      .maybeSingle());
  }
  if (error) {
    if (isMissingRelation(error) || error.code === "PGRST204") {
      return {
        id: organizationId,
        mode: "test",
        accountId: "",
        connectStatus: "not_connected",
        ready: false,
        stripePaymentLimitCents: DEFAULT_STRIPE_PAYMENT_LIMIT_CENTS,
      };
    }
    throw new Error(error.message);
  }
  const row = (data ?? {}) as OrganizationStripeColumns;
  const selected = stripeConnectionForMode(row);
  return {
    ...row,
    id: organizationId,
    mode: selected.mode,
    accountId: selected.accountId,
    connectStatus: selected.connectStatus,
    ready: selected.ready,
    stripePaymentLimitCents:
      Number((data as unknown as Record<string, unknown> | null)?.stripe_payment_limit_cents) > 0
        ? Number((data as unknown as Record<string, unknown>).stripe_payment_limit_cents)
        : DEFAULT_STRIPE_PAYMENT_LIMIT_CENTS,
  };
}

export interface PaymentMethodContext {
  organizationId: string;
  hasPaymentProfile: boolean;
  stripeAccountId: string;
  stripeConnectStatus: string;
  stripeReady: boolean;
  stripeMode: StripeMode;
  testStripeAccountId: string;
  testStripeConnectStatus: string;
  testStripeReady: boolean;
  liveStripeAccountId: string;
  liveStripeConnectStatus: string;
  liveStripeReady: boolean;
  defaultPaymentMethods: EnabledPaymentMethods;
  cardFeePassThrough: boolean;
  stripeAmountThresholdCents: number;
  stripePaymentLimitCents: number;
}

async function buildPaymentMethodContext(
  ctx: PaymentsServerContext,
  organizationId: string,
): Promise<PaymentMethodContext> {
  // Phase 3 verified: every caller of this builder sits behind
  // requireBillingOrSettingsCapability, and both billing.manage and
  // company.manage_settings pass the tightened organizations SELECT policy —
  // so these reads stay on the user's client.
  const [{ row: profile }, org] = await Promise.all([
    loadPaymentProfileRow(ctx.supabase, organizationId),
    loadOrganizationStripe(ctx.supabase, organizationId),
  ]);
  const view = profileView(profile, false);
  const testConnection = stripeConnectionForMode(org, "test");
  const liveConnection = stripeConnectionForMode(org, "live");
  return {
    organizationId,
    hasPaymentProfile: view.hasBankDetails,
    stripeAccountId: org.accountId,
    stripeConnectStatus: org.connectStatus,
    stripeReady: org.ready,
    stripeMode: org.mode,
    testStripeAccountId: testConnection.accountId,
    testStripeConnectStatus: testConnection.connectStatus,
    testStripeReady: testConnection.ready,
    liveStripeAccountId: liveConnection.accountId,
    liveStripeConnectStatus: liveConnection.connectStatus,
    liveStripeReady: liveConnection.ready,
    defaultPaymentMethods: view.defaultPaymentMethods,
    cardFeePassThrough: view.cardFeePassThrough,
    stripeAmountThresholdCents: view.stripeAmountThresholdCents,
    stripePaymentLimitCents: org.stripePaymentLimitCents,
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

    // Phase 3: raw routing/account numbers require billing.manage OR
    // financials.view on this project — invoice readability alone is not
    // enough. (Portal clients get remittance through getClientPortalProject's
    // invoicePaymentOptions, never through this function.)
    await requireRemittanceAccess(ctx, organizationId, invoiceRow.project_id as string);

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
 * The client backed out of a Stripe Checkout page. Expire the open session
 * so the pending-payment lock clears immediately instead of holding the pay
 * buttons hostage for the session's 24h lifetime. If Stripe refuses (the
 * session already completed), the lock stays — the payment may have gone
 * through and the webhook is the authority.
 */
export const expireInvoiceCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { invoiceId: string }) =>
    z.object({ invoiceId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as PaymentsServerContext;
    // RLS-scoped read is the access gate: contractors see project invoices,
    // portal clients see client-visible ones. No row, no action.
    const { data: invoice, error: invoiceError } = await dynamicTable(
      ctx.supabase,
      "billing_invoices",
    )
      .select("id,project_id,online_payment_status,stripe_checkout_session_id")
      .eq("id", data.invoiceId)
      .maybeSingle();
    if (invoiceError) throw new Error(invoiceError.message);
    if (!invoice) throw new Error("Invoice not found.");
    const invoiceRow = invoice as Record<string, unknown>;

    const sessionId = String(invoiceRow.stripe_checkout_session_id ?? "");
    if (String(invoiceRow.online_payment_status ?? "") !== "pending" || !sessionId) {
      return { ok: true, cleared: false, reason: "no_pending_session" };
    }

    const stripeServer = await import("@/lib/stripe.server");
    const admin = stripeServer.createSupabaseAdminClient();
    const { data: project, error: projectError } = await dynamicTable(admin, "projects")
      .select("organization_id")
      .eq("id", invoiceRow.project_id as string)
      .maybeSingle();
    if (projectError) throw new Error(projectError.message);
    const organizationId =
      ((project as Record<string, unknown> | null)?.organization_id as string | null) ?? null;
    if (!organizationId) return { ok: true, cleared: false, reason: "no_organization" };

    const org = await loadOrganizationStripe(admin, organizationId);
    if (!org.accountId) {
      return { ok: true, cleared: false, reason: "not_connected" };
    }
    try {
      await stripeServer.expireStripeCheckoutSession(sessionId, org.accountId, org.mode);
    } catch {
      // Session is not open (completed, or already expired). Completed means
      // money may be moving: never clear the lock here — the webhook decides.
      return { ok: true, cleared: false, reason: "session_not_open" };
    }

    const { error: updateError } = await dynamicRpc(
      admin,
      "update_billing_invoice_processor_state_atomic",
      {
        p_billing_invoice_id: data.invoiceId,
        p_online_payment_status: "expired",
        p_checkout_session_id: sessionId,
        p_payment_intent_id: "",
        p_payment_url: "",
        p_payment_enabled: false,
        p_payment_link_sent_at: null,
        p_idempotency_key: `manual-expire:${data.invoiceId}:${sessionId}`,
      },
    );
    if (updateError) throw new Error(updateError.message);
    return { ok: true, cleared: true };
  });

type StripeChargeLite = {
  id: string;
  amount: number;
  amount_refunded: number;
  currency: string;
  status: string;
  paid: boolean;
  refunded: boolean;
  created: number;
  description: string | null;
  payment_intent: string | null;
  receipt_url: string | null;
  balance_transaction?: string | StripeBalanceTransactionLite | null;
  metadata?: Record<string, string> | null;
  payment_method_details?: { type?: string } | null;
};

type StripeFeeDetailLite = {
  amount?: number;
  type?: string;
};

type StripeBalanceTransactionLite = {
  id?: string;
  amount?: number;
  available_on?: number;
  created?: number;
  currency?: string;
  fee?: number;
  fee_details?: StripeFeeDetailLite[];
  net?: number;
};

type StripePaymentIntentLite = {
  id?: string;
  metadata?: Record<string, string> | null;
  latest_charge?: string | StripeChargeLite | null;
};

export interface UnmatchedStripePayment {
  stripeChargeId: string;
  stripePaymentIntentId: string;
  amount: number;
  amountCents: number;
  currency: string;
  paidAtIso: string;
  description: string;
  paymentMethodType: string;
  receiptUrl: string;
  refundedGrossCents: number;
  netAppliedAmountCents: number;
}

export interface ReconcileInvoiceOption {
  id: string;
  label: string;
  projectName: string;
  openBalance: number;
}

function exactNonnegativeStripeCents(value: unknown, label: string) {
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error(`Stripe ${label} must be a nonnegative integer-cent amount.`);
  }
  return cents;
}

function exactNonnegativeDollarCents(value: unknown, label: string) {
  const dollars = Number(value);
  const cents = Math.round(dollars * 100);
  if (!Number.isFinite(dollars) || dollars < 0 || !Number.isSafeInteger(cents)) {
    throw new Error(`${label} is outside the supported exact-cent range.`);
  }
  return cents;
}

function safeAddCents(left: number, right: number, label: string) {
  return exactNonnegativeStripeCents(left + right, label);
}

type StripeChargePage = {
  data: StripeChargeLite[];
  has_more?: boolean;
};

async function listAllConnectedStripeCharges(input: {
  accountId: string;
  mode: StripeMode;
  stripeGet: <T>(path: string, mode: StripeMode, accountId?: string) => Promise<T>;
}) {
  const charges: StripeChargeLite[] = [];
  let startingAfter = "";
  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (startingAfter) query.set("starting_after", startingAfter);
    const page = await input.stripeGet<StripeChargePage>(
      `charges?${query.toString()}`,
      input.mode,
      input.accountId,
    );
    const rows = Array.isArray(page.data) ? page.data : [];
    charges.push(...rows);
    if (!page.has_more) return charges;
    const cursor = rows.at(-1)?.id ?? "";
    if (!cursor || cursor === startingAfter) {
      throw new Error("Stripe charge pagination did not advance safely.");
    }
    startingAfter = cursor;
  }
  throw new Error(
    "Stripe reconciliation exceeded 10,000 charges. Narrow the accounting period before retrying.",
  );
}

/**
 * On-demand sweep (BILLINGBATCH2 Task 2): list recent succeeded payments on
 * the org's connected Stripe account and flag any with no ledger row —
 * orphans like a payment that settled before webhooks were wired up. Read
 * only; booking goes through recordUnmatchedStripePayment, which re-reads the
 * connected-account balance transaction before invoking the service-only
 * Stripe receipt command.
 */
export const listUnmatchedStripePayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as PaymentsServerContext;
    const organizationId = await ensureCurrentOrganization(ctx);
    await requireBillingOrSettingsCapability(ctx, organizationId);

    const stripeServer = await import("@/lib/stripe.server");
    const admin = stripeServer.createSupabaseAdminClient();
    const org = await loadOrganizationStripe(admin, organizationId);
    if (!org.accountId) {
      return {
        ready: false as const,
        reason: "Stripe is not connected yet. Connect Stripe before checking for payments.",
        checkedCount: 0,
        partiallyRefundedCount: 0,
        fullyRefundedCount: 0,
        payments: [] as UnmatchedStripePayment[],
        openInvoices: [] as ReconcileInvoiceOption[],
      };
    }
    const chargeRows = await listAllConnectedStripeCharges({
      accountId: org.accountId,
      mode: org.mode,
      stripeGet: stripeServer.stripeGet,
    });
    const settled = chargeRows.filter(
      (charge) => charge.status === "succeeded" && charge.paid && charge.amount > 0,
    );
    const partiallyRefundedCount = settled.filter(
      (charge) => charge.amount_refunded > 0 && charge.amount_refunded < charge.amount,
    ).length;
    const fullyRefundedCount = settled.filter(
      (charge) => charge.refunded || charge.amount_refunded === charge.amount,
    ).length;

    // A charge is "matched" when any ledger row carries its payment intent or
    // charge id — webhook bookings store the intent id, manual bookings from
    // this sweep store it as reference/processor id.
    const intentIds = settled.map((charge) => charge.payment_intent ?? "").filter(Boolean);
    const chargeIds = settled.map((charge) => charge.id);
    const candidateIds = Array.from(new Set([...intentIds, ...chargeIds]));
    const matched = new Set<string>();
    for (const column of [
      "stripe_payment_intent_id",
      "stripe_charge_id",
      "processor_payment_id",
      "reference",
    ]) {
      if (candidateIds.length === 0) break;
      const { data: rows, error } = await dynamicTable(admin, "payment_ledger")
        .select(column)
        .in(column, candidateIds);
      if (error) {
        if (!isMissingRelation(error)) throw new Error(error.message);
        continue;
      }
      ((rows ?? []) as unknown as Record<string, unknown>[]).forEach((row) => {
        const value = String(row[column] ?? "");
        if (value) matched.add(value);
      });
    }

    const payments: UnmatchedStripePayment[] = settled
      .filter(
        (charge) =>
          !matched.has(charge.id) && !(charge.payment_intent && matched.has(charge.payment_intent)),
      )
      .map((charge) => ({
        stripeChargeId: charge.id,
        stripePaymentIntentId: charge.payment_intent ?? "",
        amount: charge.amount / 100,
        amountCents: charge.amount,
        currency: (charge.currency || "usd").toUpperCase(),
        paidAtIso: charge.created > 0 ? new Date(charge.created * 1000).toISOString() : "",
        description: charge.description ?? "",
        paymentMethodType: charge.payment_method_details?.type ?? "",
        receiptUrl: charge.receipt_url ?? "",
        refundedGrossCents: charge.amount_refunded,
        netAppliedAmountCents: Math.max(0, charge.amount - charge.amount_refunded),
      }));

    // All non-void invoices across the company are returned. The browser then
    // filters them by the receipt's *net* A/R effect. That keeps ordinary and
    // partially-refunded receipts away from closed invoices, while still
    // allowing a fully-refunded orphan (net $0) to recover its immutable
    // original-receipt and refund history against the correct closed invoice.
    const { data: projectRows, error: projectsError } = await dynamicTable(admin, "projects")
      .select("id,name")
      .eq("organization_id", organizationId)
      .is("archived_at", null);
    if (projectsError) throw new Error(projectsError.message);
    const projects = (projectRows ?? []) as Array<{ id: string; name: string }>;
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));
    let openInvoices: ReconcileInvoiceOption[] = [];
    if (projects.length > 0) {
      const { data: invoiceRows, error: invoicesError } = await dynamicTable(
        admin,
        "billing_invoices",
      )
        .select("id,project_id,invoice_number,title,total_due,paid_amount,status")
        .in(
          "project_id",
          projects.map((project) => project.id),
        );
      if (invoicesError) throw new Error(invoicesError.message);
      openInvoices = ((invoiceRows ?? []) as Record<string, unknown>[])
        .filter((row) => String(row.status ?? "") !== "void")
        .map((row) => ({
          id: String(row.id),
          label: String(row.invoice_number || row.title || "Invoice"),
          projectName: projectNames.get(String(row.project_id)) ?? "Project",
          openBalance:
            Math.max(
              0,
              dollarsToCents(Number(row.total_due ?? 0)) -
                dollarsToCents(Number(row.paid_amount ?? 0)),
            ) / 100,
        }))
        .sort(
          (a, b) => a.projectName.localeCompare(b.projectName) || a.label.localeCompare(b.label),
        );
    }

    return {
      ready: true as const,
      reason: "",
      mode: org.mode,
      checkedCount: settled.length,
      partiallyRefundedCount,
      fullyRefundedCount,
      payments,
      openInvoices,
    };
  });

const unmatchedStripePaymentInput = z.object({
  invoiceId: z.string().uuid(),
  stripeChargeId: z
    .string()
    .trim()
    .min(4)
    .max(255)
    .regex(/^ch_[A-Za-z0-9]+$/, "A valid Stripe charge id is required."),
});

/**
 * Books one unmatched connected-account receipt without trusting any amount,
 * fee, date, method, or metadata supplied by the browser. The server reloads
 * Stripe's charge, PaymentIntent, and balance transaction, verifies their
 * integer-cent equation, then calls the service-only parent-first DB command.
 */
export const recordUnmatchedStripePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof unmatchedStripePaymentInput>) =>
    unmatchedStripePaymentInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as PaymentsServerContext;
    const organizationId = await ensureCurrentOrganization(ctx);
    await requireBillingOrSettingsCapability(ctx, organizationId);

    const stripeServer = await import("@/lib/stripe.server");
    const admin = stripeServer.createSupabaseAdminClient();
    const org = await loadOrganizationStripe(admin, organizationId);
    if (!org.accountId) {
      throw new Error("Stripe is not connected for this company.");
    }

    const { data: invoice, error: invoiceError } = await dynamicTable(admin, "billing_invoices")
      .select("id,project_id,total_due,paid_amount,status")
      .eq("id", data.invoiceId)
      .maybeSingle();
    if (invoiceError) throw new Error(invoiceError.message);
    if (!invoice) throw new Error("Invoice not found.");
    const invoiceRow = invoice as Record<string, unknown>;

    const { data: project, error: projectError } = await dynamicTable(admin, "projects")
      .select("organization_id")
      .eq("id", String(invoiceRow.project_id ?? ""))
      .maybeSingle();
    if (projectError) throw new Error(projectError.message);
    if (
      String((project as Record<string, unknown> | null)?.organization_id ?? "") !== organizationId
    ) {
      throw new Error("The selected invoice does not belong to this company.");
    }
    if (
      !["sent", "viewed", "overdue", "partially_paid", "paid"].includes(
        String(invoiceRow.status ?? ""),
      )
    ) {
      throw new Error("A Stripe receipt can only be recorded against an issued invoice.");
    }

    const charge = await stripeServer.stripeGet<StripeChargeLite>(
      `charges/${encodeURIComponent(data.stripeChargeId)}?expand[]=balance_transaction`,
      org.mode,
      org.accountId,
    );
    if (charge.status !== "succeeded" || !charge.paid) {
      throw new Error("Only a settled Stripe charge can be recorded.");
    }
    if (charge.currency.toLowerCase() !== "usd") {
      throw new Error("Stripe invoice receipts must settle in USD.");
    }
    const chargeAmountCents = exactNonnegativeStripeCents(charge.amount, "charge amount");
    const cumulativeRefundedGrossCents = exactNonnegativeStripeCents(
      charge.amount_refunded,
      "cumulative refund",
    );
    if (cumulativeRefundedGrossCents > chargeAmountCents) {
      throw new Error("Stripe cumulative refunds exceed the original charge.");
    }

    const paymentIntentId = charge.payment_intent ?? "";
    if (!paymentIntentId) {
      throw new Error("The Stripe charge is missing its PaymentIntent provenance.");
    }
    const paymentIntent = await stripeServer.stripeGet<StripePaymentIntentLite>(
      `payment_intents/${encodeURIComponent(paymentIntentId)}`,
      org.mode,
      org.accountId,
    );
    const metadata = paymentIntent.metadata ?? charge.metadata ?? {};
    if (metadata.invoice_id && metadata.invoice_id !== data.invoiceId) {
      throw new Error("Stripe metadata ties this receipt to a different invoice.");
    }
    if (metadata.project_id && metadata.project_id !== String(invoiceRow.project_id ?? "")) {
      throw new Error("Stripe metadata ties this receipt to a different project.");
    }

    let balanceTransaction = charge.balance_transaction;
    if (typeof balanceTransaction === "string") {
      balanceTransaction = await stripeServer.stripeGet<StripeBalanceTransactionLite>(
        `balance_transactions/${encodeURIComponent(balanceTransaction)}`,
        org.mode,
        org.accountId,
      );
    }
    if (!balanceTransaction || typeof balanceTransaction !== "object") {
      throw new Error("The Stripe charge is missing balance-transaction evidence.");
    }

    const grossCents = exactNonnegativeStripeCents(balanceTransaction.amount, "gross amount");
    const totalFeeCents = exactNonnegativeStripeCents(balanceTransaction.fee, "total fee");
    const netCents = exactNonnegativeStripeCents(balanceTransaction.net, "net amount");
    const feeDetails = Array.isArray(balanceTransaction.fee_details)
      ? balanceTransaction.fee_details
      : [];
    const feeDetailTotalCents = feeDetails.reduce(
      (sum, detail) =>
        safeAddCents(
          sum,
          exactNonnegativeStripeCents(detail.amount, "fee detail"),
          "fee-detail total",
        ),
      0,
    );
    const overwatchFeeCents = feeDetails
      .filter((detail) => detail.type === "application_fee")
      .reduce(
        (sum, detail) =>
          safeAddCents(
            sum,
            exactNonnegativeStripeCents(detail.amount, "application fee"),
            "application-fee total",
          ),
        0,
      );
    const surchargeCents = exactNonnegativeStripeCents(metadata.surcharge_cents || 0, "surcharge");
    const amountCents = grossCents - surchargeCents;
    const balanceTransactionId = String(balanceTransaction.id ?? "");
    if (
      !balanceTransactionId ||
      String(balanceTransaction.currency ?? "").toLowerCase() !== "usd" ||
      grossCents !== chargeAmountCents ||
      feeDetailTotalCents !== totalFeeCents ||
      netCents !== grossCents - totalFeeCents ||
      surchargeCents > grossCents ||
      amountCents <= 0
    ) {
      throw new Error("Stripe balance-transaction economics failed reconciliation.");
    }

    const remainingGrossCents = grossCents - cumulativeRefundedGrossCents;
    const refundedInvoiceAmountCents = amountCents - Math.min(amountCents, remainingGrossCents);
    const netAppliedAmountCents = amountCents - refundedInvoiceAmountCents;
    const openBalanceCents =
      exactNonnegativeDollarCents(invoiceRow.total_due, "Invoice total") -
      exactNonnegativeDollarCents(invoiceRow.paid_amount, "Invoice paid amount");
    if (!Number.isSafeInteger(openBalanceCents) || openBalanceCents < 0) {
      throw new Error("The selected invoice has an invalid open balance.");
    }
    if (netAppliedAmountCents > openBalanceCents) {
      throw new Error(
        "This Stripe receipt's net cash exceeds the selected invoice's open balance.",
      );
    }

    const settlementEpoch = Number(balanceTransaction.created || balanceTransaction.available_on);
    if (!Number.isSafeInteger(settlementEpoch) || settlementEpoch <= 0) {
      throw new Error("Stripe balance-transaction settlement time is missing.");
    }
    const paidAt = new Date(settlementEpoch * 1000).toISOString();
    const refundEventKey = cumulativeRefundedGrossCents
      ? `recovery:${charge.id}:${cumulativeRefundedGrossCents}`
      : "";
    const { error: paymentError } = await dynamicRpc(
      admin,
      "record_stripe_invoice_payment_atomic",
      {
        p_invoice_id: data.invoiceId,
        p_amount_cents: amountCents,
        p_stripe_balance_transaction_id: balanceTransactionId,
        p_balance_transaction_gross_cents: grossCents,
        p_balance_transaction_fee_cents: totalFeeCents,
        p_balance_transaction_net_cents: netCents,
        p_balance_transaction_currency: "usd",
        p_surcharge_cents: surchargeCents,
        p_gross_received_cents: grossCents,
        p_overwatch_fee_cents: overwatchFeeCents,
        p_paid_at: paidAt,
        p_payment_method: charge.payment_method_details?.type || "stripe",
        p_processor_payment_id: paymentIntentId,
        p_reference: paymentIntentId,
        p_notes: cumulativeRefundedGrossCents
          ? `Recovered Stripe receipt and ${cumulativeRefundedGrossCents} cents of linked refund history (${charge.id}).`
          : `Recorded from Stripe reconciliation (${charge.id}).`,
        p_checkout_session_id: "",
        p_payment_intent_id: paymentIntentId,
        p_charge_id: charge.id,
        p_receipt_url: charge.receipt_url ?? "",
        p_cumulative_refunded_gross_cents: cumulativeRefundedGrossCents,
        p_refund_processor_event_id: refundEventKey,
        p_refund_idempotency_key: refundEventKey,
      },
    );
    if (paymentError) throw new Error(paymentError.message);

    return {
      ok: true,
      invoiceId: data.invoiceId,
      paymentIntentId,
      chargeId: charge.id,
      amountCents,
      refundedGrossCents: cumulativeRefundedGrossCents,
      netAppliedAmountCents,
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
    // Phase 3: Stripe account ids, Connect statuses, and the payment limit
    // are billing/settings data — no longer returned to every authed member.
    await requireBillingOrSettingsCapability(ctx, organizationId);
    return buildPaymentMethodContext(ctx, organizationId);
  });
