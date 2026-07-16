import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  PLAN_SCOPE_BRIEF_NEXT_ACTIONS,
  PLAN_SCOPE_BRIEF_REVIEW_STATUSES,
  type PlanScopeBriefNextAction,
  type PlanScopeBriefReview,
  type PlanScopeBriefReviewStatus,
} from "@/lib/plan-scope-brief-review";
import {
  PLAN_SCOPE_BRIEF_REVIEW_KINDS,
  PLAN_SCOPE_BRIEF_TRADES,
  type PlanScopeBriefReviewKind,
  type PlanScopeBriefTrade,
} from "@/lib/plan-scope-brief";

type DynamicError = { code?: string; message: string };
type DynamicResult<T = unknown> = { data: T | null; error: DynamicError | null };
type DynamicQuery = PromiseLike<DynamicResult> & {
  select(columns?: string): DynamicQuery;
  eq(column: string, value: unknown): DynamicQuery;
  in(column: string, values: readonly string[]): Promise<DynamicResult<unknown[]>>;
  order(column: string, options?: { ascending?: boolean }): DynamicQuery;
  limit(count: number): DynamicQuery;
};
type DynamicClient = {
  from(relation: string): DynamicQuery;
  rpc(name: string, args: Record<string, unknown>): Promise<DynamicResult<unknown[]>>;
};

const dynamicClient = (supabase: unknown) => supabase as DynamicClient;
const str = (value: unknown) => (value == null ? "" : String(value));

function isScopeBriefReviewSchemaPending(error: DynamicError | null | undefined) {
  const message = error?.message?.toLowerCase() ?? "";
  return Boolean(
    error &&
    (error.code === "42P01" ||
      error.code === "PGRST202" ||
      error.code === "PGRST205" ||
      message.includes("estimate_scope_brief_reviews") ||
      message.includes("save_estimate_scope_brief_review")),
  );
}

function normalizeScopeBriefReview(
  row: Record<string, unknown>,
  profileNames = new Map<string, string>(),
): PlanScopeBriefReview {
  const status = str(row.status);
  const nextAction = str(row.next_action);
  const trade = str(row.trade);
  const reviewKind = str(row.review_kind);
  const reviewedBy = row.reviewed_by == null ? null : str(row.reviewed_by);
  return {
    id: str(row.id),
    estimate_id: str(row.estimate_id),
    plan_set_id: str(row.plan_set_id),
    ai_operation_id: str(row.ai_operation_id),
    item_id: str(row.item_id),
    version: Math.max(1, Math.round(Number(row.version) || 1)),
    trade: (PLAN_SCOPE_BRIEF_TRADES.includes(trade as PlanScopeBriefTrade)
      ? trade
      : "Other") as PlanScopeBriefTrade,
    review_kind: (PLAN_SCOPE_BRIEF_REVIEW_KINDS.includes(reviewKind as PlanScopeBriefReviewKind)
      ? reviewKind
      : "coordination") as PlanScopeBriefReviewKind,
    scope_label: str(row.scope_label),
    plan_sheet_id: str(row.plan_sheet_id),
    source_line: str(row.source_line),
    source_excerpt: str(row.source_excerpt),
    status: (PLAN_SCOPE_BRIEF_REVIEW_STATUSES.includes(status as PlanScopeBriefReviewStatus)
      ? status
      : "deferred") as PlanScopeBriefReviewStatus,
    next_action: (PLAN_SCOPE_BRIEF_NEXT_ACTIONS.includes(nextAction as PlanScopeBriefNextAction)
      ? nextAction
      : "none") as PlanScopeBriefNextAction,
    review_notes: str(row.review_notes),
    reviewed_by: reviewedBy,
    reviewed_by_name: (reviewedBy && profileNames.get(reviewedBy)) || "Team member",
    reviewed_at: str(row.reviewed_at),
    created_at: str(row.created_at),
  };
}

const getReviewsInput = z.object({
  estimate_id: z.string().uuid(),
  plan_set_id: z.string().uuid(),
});

export const getPlanScopeBriefReviews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof getReviewsInput>) => getReviewsInput.parse(input))
  .handler(async ({ data, context }) => {
    const client = dynamicClient(context.supabase);
    const result = await client
      .from("estimate_scope_brief_reviews")
      .select("*")
      .eq("estimate_id", data.estimate_id)
      .eq("plan_set_id", data.plan_set_id)
      .order("reviewed_at", { ascending: false })
      .limit(1000);
    if (isScopeBriefReviewSchemaPending(result.error)) return { reviews: [], ready: false };
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data ?? []) as Record<string, unknown>[];
    const reviewerIds = [
      ...new Set(
        rows
          .map((row) => row.reviewed_by)
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      ),
    ];
    const profileNames = new Map<string, string>();
    if (reviewerIds.length > 0) {
      const profiles = await client
        .from("profiles")
        .select("id,email,full_name")
        .in("id", reviewerIds);
      for (const profile of (profiles.data ?? []) as Record<string, unknown>[]) {
        profileNames.set(
          str(profile.id),
          str(profile.full_name).trim() || str(profile.email).trim() || "Team member",
        );
      }
    }
    return {
      reviews: rows.map((row) => normalizeScopeBriefReview(row, profileNames)),
      ready: true,
    };
  });

const saveReviewInput = z.object({
  ai_operation_id: z.string().uuid(),
  item_id: z
    .string()
    .regex(/^scope-brief-[a-z0-9]+$/)
    .max(80),
  status: z.enum(PLAN_SCOPE_BRIEF_REVIEW_STATUSES),
  next_action: z.enum(PLAN_SCOPE_BRIEF_NEXT_ACTIONS),
  review_notes: z.string().trim().max(1000),
});

export const savePlanScopeBriefReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof saveReviewInput>) => saveReviewInput.parse(input))
  .handler(async ({ data, context }) => {
    const result = await dynamicClient(context.supabase).rpc("save_estimate_scope_brief_review", {
      p_ai_operation_id: data.ai_operation_id,
      p_item_id: data.item_id,
      p_status: data.status,
      p_next_action: data.next_action,
      p_review_notes: data.review_notes,
    });
    if (isScopeBriefReviewSchemaPending(result.error)) {
      throw new Error("Scope Brief decisions are waiting for their Lovable database migration.");
    }
    if (result.error) throw new Error(result.error.message);
    const row = ((result.data ?? [])[0] ?? null) as Record<string, unknown> | null;
    if (!row) throw new Error("The Scope Brief decision did not save.");
    return { review: normalizeScopeBriefReview(row) };
  });
