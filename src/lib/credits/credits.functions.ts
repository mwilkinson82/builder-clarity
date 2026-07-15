// Credits server functions (AITAKEOFF1 Task 0).
// Reads run on the user's own client so RLS proves org membership; the
// ledger itself is written only by server-side flows (scan charge/refund in
// ai-takeoff.functions.ts, purchase grants in the Stripe webhook).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { creditBalance, creditPacksFromEnv, type CreditPack } from "@/lib/credits/credits-domain";

type DynamicSupabaseError = { code?: string; message: string };
type DynamicSupabaseResult<T = unknown> = { data: T | null; error: DynamicSupabaseError | null };
type DynamicSupabaseQuery = PromiseLike<DynamicSupabaseResult> & {
  select(columns?: string): DynamicSupabaseQuery;
  eq(column: string, value: unknown): DynamicSupabaseQuery;
  order(column: string, options?: { ascending?: boolean }): DynamicSupabaseQuery;
  limit(count: number): DynamicSupabaseQuery;
  maybeSingle(): Promise<DynamicSupabaseResult>;
};

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as { from(table: string): DynamicSupabaseQuery }).from(relation);

function isMissingCreditsSchema(error: DynamicSupabaseError | null | undefined) {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    ((message.includes("does not exist") || message.includes("schema cache")) &&
      message.includes("credit_ledger"))
  );
}

function isMissingMonthlyGrantRpc(error: DynamicSupabaseError | null | undefined) {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    error?.code === "PGRST202" ||
    error?.code === "42883" ||
    (message.includes("ensure_monthly_ai_credit_grant") &&
      (message.includes("does not exist") || message.includes("schema cache")))
  );
}

async function ensureMonthlyAllowance(context: { supabase: unknown }, organizationId: string) {
  const { error } = await (
    context.supabase as {
      rpc(fn: string, args: { p_organization_id: string }): Promise<DynamicSupabaseResult<number>>;
    }
  ).rpc("ensure_monthly_ai_credit_grant", { p_organization_id: organizationId });
  if (error && !isMissingMonthlyGrantRpc(error)) throw new Error(error.message);
}

async function resolveOrganizationId(context: { supabase: unknown }) {
  const { data, error } = await (
    context.supabase as { rpc(fn: string): Promise<DynamicSupabaseResult<string>> }
  ).rpc("ensure_current_user_account");
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No Overwatch company workspace is available for this user.");
  return String(data);
}

export interface CreditSummary {
  organizationId: string;
  balanceCredits: number;
  monthlyAllowanceCredits: number;
  planCode: string;
  packs: CreditPack[];
  aiAssistConfigured: boolean;
  aiModel: string;
  /** False until the credits migrations are applied to this environment. */
  schemaReady: boolean;
  /** Gates the scan-diagnostics entry point (AITAKEOFF2 Task 4). */
  isSuperAdmin: boolean;
}

const creditSummaryInput = z.object({}).optional();

/** Balance + purchasable packs + AI configuration state for the panel. */
export const getCreditSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof creditSummaryInput>) => creditSummaryInput.parse(input))
  .handler(async ({ context }): Promise<CreditSummary> => {
    const organizationId = await resolveOrganizationId(context);
    await ensureMonthlyAllowance(context, organizationId);
    const { isVisionConfigured, resolveVisionModel } =
      await import("@/lib/ai-takeoff/vision.server");

    const packs = creditPacksFromEnv(process.env.CREDIT_PACKS_JSON);

    // The gate itself lives on the diagnostics server fn; this flag only
    // decides whether the panel shows the entry point.
    let isSuperAdmin = false;
    try {
      const { data: superFlag } = await (
        context.supabase as unknown as { rpc(fn: string): Promise<{ data: boolean | null }> }
      ).rpc("is_super_admin");
      isSuperAdmin = Boolean(superFlag);
    } catch {
      isSuperAdmin = false;
    }

    const base = {
      organizationId,
      packs,
      aiAssistConfigured: isVisionConfigured(),
      aiModel: resolveVisionModel(),
      isSuperAdmin,
    };

    let planCode = "free";
    let monthlyAllowanceCredits = 0;
    const organizationResult = await dynamicTable(context.supabase, "organizations")
      .select("plan_code,contractor_circle_grant")
      .eq("id", organizationId)
      .maybeSingle();
    if (!organizationResult.error && organizationResult.data) {
      const organization = organizationResult.data as Record<string, unknown>;
      planCode = organization.contractor_circle_grant
        ? "contractor_circle_free"
        : String(organization.plan_code || "free");
      const planResult = await dynamicTable(context.supabase, "subscription_plans")
        .select("monthly_ai_credits")
        .eq("code", planCode)
        .maybeSingle();
      if (!planResult.error && planResult.data) {
        monthlyAllowanceCredits = Number(
          (planResult.data as Record<string, unknown>).monthly_ai_credits ?? 0,
        );
      }
    }

    const ledgerResult = (await dynamicTable(context.supabase, "credit_ledger")
      .select("delta")
      .eq("organization_id", organizationId)) as DynamicSupabaseResult<Array<{ delta: number }>>;
    if (ledgerResult.error) {
      if (isMissingCreditsSchema(ledgerResult.error)) {
        return {
          ...base,
          balanceCredits: 0,
          monthlyAllowanceCredits,
          planCode,
          schemaReady: false,
        };
      }
      throw new Error(ledgerResult.error.message);
    }

    return {
      ...base,
      balanceCredits: creditBalance(ledgerResult.data ?? []),
      monthlyAllowanceCredits,
      planCode,
      schemaReady: true,
    };
  });
