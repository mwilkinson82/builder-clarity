import type { Json } from "@/integrations/supabase/types";
import { computeApiCostCents, creditBalance } from "@/lib/credits/credits-domain";
import { CRM_ASSIST_CREDITS } from "@/lib/crm-action-suite-domain";

export type DynamicError = { code?: string; message: string };
export type DynamicResult<T = unknown> = { data: T | null; error: DynamicError | null };
export type DynamicQuery = PromiseLike<DynamicResult> & {
  select(columns?: string): DynamicQuery;
  insert(values: unknown): DynamicQuery;
  update(values: unknown): DynamicQuery;
  eq(column: string, value: unknown): DynamicQuery;
  in(column: string, values: readonly unknown[]): DynamicQuery;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): DynamicQuery;
  limit(count: number): DynamicQuery;
  single(): Promise<DynamicResult>;
  maybeSingle(): Promise<DynamicResult>;
};
type DynamicClient = {
  from(relation: string): DynamicQuery;
  rpc(fn: string, args?: Record<string, unknown>): Promise<DynamicResult>;
};

export type CrmServerContext = { supabase: unknown; userId: string };
export const table = (supabase: unknown, relation: string) =>
  (supabase as DynamicClient).from(relation);
export const str = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : value == null ? fallback : String(value);
export const nullableStr = (value: unknown) => {
  const normalized = str(value).trim();
  return normalized || null;
};
export const num = (value: unknown, fallback = 0) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
};

export function missingCrmActionSchema(error: DynamicError | null | undefined) {
  return Boolean(
    error &&
    /crm_(outbound_messages|meeting_briefs|onboarding_plans|onboarding_tasks)|ai_crm_assist/i.test(
      error.message,
    ) &&
    /(schema cache|does not exist|could not find|relation|column|check constraint)/i.test(
      error.message,
    ),
  );
}

export async function currentOrganizationId(context: CrmServerContext) {
  const ensured = await (context.supabase as DynamicClient).rpc("ensure_current_user_account");
  if (ensured.error) throw new Error(ensured.error.message);
  if (!ensured.data) throw new Error("No Overwatch company workspace is available for this user.");
  const memberships = await table(context.supabase, "organization_memberships")
    .select("organization_id,status,created_at")
    .eq("user_id", context.userId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1);
  if (memberships.error) throw new Error(memberships.error.message);
  const first = Array.isArray(memberships.data) ? memberships.data[0] : null;
  return str((first as Record<string, unknown> | null)?.organization_id, str(ensured.data));
}

async function isSuperAdmin(supabase: unknown) {
  try {
    const response = await (supabase as DynamicClient).rpc("is_super_admin");
    return Boolean(response.data);
  } catch {
    return false;
  }
}

async function refundFailedOperation(input: {
  admin: unknown;
  operationId: string;
  organizationId: string;
  userId: string;
  chargedCredits: number;
  message: string;
}) {
  const transitioned = await table(input.admin, "ai_operations")
    .update({
      status: "failed",
      error: input.message.slice(0, 2000),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.operationId)
    .eq("status", "pending")
    .select("id");
  if (transitioned.error) throw new Error(transitioned.error.message);
  if (
    !Array.isArray(transitioned.data) ||
    transitioned.data.length === 0 ||
    input.chargedCredits === 0
  )
    return;
  const refund = await table(input.admin, "credit_ledger").insert({
    organization_id: input.organizationId,
    delta: input.chargedCredits,
    reason: "refund",
    reference: input.operationId,
    created_by: input.userId,
  });
  if (refund.error) throw new Error(refund.error.message);
}

export async function runCrmAiOperation<T>(input: {
  context: CrmServerContext;
  organizationId: string;
  requestContext: Record<string, unknown>;
  prompt: string;
  parse: (raw: string) => T;
}) {
  const { isOpenAiConfigured, resolveOpenAiModel, callOpenAiVision } =
    await import("@/lib/ai-takeoff/openai.server");
  if (!isOpenAiConfigured()) {
    throw new Error(
      "CRM AI is not configured. The existing OpenAI key must be available in Lovable.",
    );
  }
  const superAdmin = await isSuperAdmin(input.context.supabase);
  const chargedCredits = superAdmin ? 0 : CRM_ASSIST_CREDITS;
  if (!superAdmin) {
    const grant = await (input.context.supabase as DynamicClient).rpc(
      "ensure_monthly_ai_credit_grant",
      { p_organization_id: input.organizationId },
    );
    if (grant.error && grant.error.code !== "PGRST202" && grant.error.code !== "42883") {
      throw new Error(grant.error.message);
    }
    const ledger = await table(input.context.supabase, "credit_ledger")
      .select("delta")
      .eq("organization_id", input.organizationId);
    if (ledger.error) throw new Error(ledger.error.message);
    if (
      creditBalance((Array.isArray(ledger.data) ? ledger.data : []) as Array<{ delta: number }>) <
      chargedCredits
    ) {
      throw new Error(
        "This CRM assist needs 1 AI credit. Add credits or wait for the next plan grant.",
      );
    }
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const model = resolveOpenAiModel();
  const operation = await table(supabaseAdmin, "ai_operations")
    .insert({
      organization_id: input.organizationId,
      created_by: input.context.userId,
      operation_type: "ai_crm_assist",
      model_used: model,
      credits_charged: chargedCredits,
      status: "pending",
      request_context: input.requestContext as unknown as Json,
    })
    .select("id")
    .single();
  if (operation.error || !operation.data) {
    throw new Error(
      missingCrmActionSchema(operation.error)
        ? "CRM AI is waiting for its Lovable database migration."
        : (operation.error?.message ?? "CRM AI could not start."),
    );
  }
  const operationId = str((operation.data as Record<string, unknown>).id);
  if (chargedCredits > 0) {
    const spend = await table(supabaseAdmin, "credit_ledger").insert({
      organization_id: input.organizationId,
      delta: -chargedCredits,
      reason: "ai_crm_assist",
      reference: operationId,
      created_by: input.context.userId,
    });
    if (spend.error) {
      await refundFailedOperation({
        admin: supabaseAdmin,
        operationId,
        organizationId: input.organizationId,
        userId: input.context.userId,
        chargedCredits: 0,
        message: `Credit charge failed: ${spend.error.message}`,
      });
      throw new Error("The AI credit could not be charged. No CRM data was sent to AI.");
    }
  }

  try {
    const response = await callOpenAiVision({
      model,
      instruction: input.prompt,
      images: [],
      maxTokens: 3_500,
    });
    const result = input.parse(response.text);
    const completed = await table(supabaseAdmin, "ai_operations")
      .update({
        status: "succeeded",
        model_used: response.model,
        input_tokens: response.inputTokens,
        output_tokens: response.outputTokens,
        api_cost_cents: computeApiCostCents(
          response.model,
          response.inputTokens,
          response.outputTokens,
        ),
        result: result as unknown as Json,
        updated_at: new Date().toISOString(),
      })
      .eq("id", operationId);
    if (completed.error) throw new Error(completed.error.message);
    return { result, operationId, creditsCharged: chargedCredits, model: response.model };
  } catch (error) {
    const message = error instanceof Error ? error.message : "CRM AI generation failed.";
    await refundFailedOperation({
      admin: supabaseAdmin,
      operationId,
      organizationId: input.organizationId,
      userId: input.context.userId,
      chargedCredits,
      message,
    });
    throw new Error(message);
  }
}
