import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildCpmProgressRecommendations,
  resolveCpmProgressDecision,
  type CpmProgressActivity,
  type CpmProgressBasis,
  type CpmProgressControl,
  type CpmProgressEvidenceEntry,
  type CpmProgressRecommendation,
  type CpmProgressReview,
} from "@/lib/cpm-progress";

type DynamicError = { code?: string; message: string } | null;
type DynamicResult<T = unknown> = { data: T | null; error: DynamicError };
type DynamicQuery = PromiseLike<DynamicResult> & {
  select(columns?: string): DynamicQuery;
  insert(values: unknown): DynamicQuery;
  upsert(values: unknown, options?: { onConflict?: string }): DynamicQuery;
  eq(column: string, value: unknown): DynamicQuery;
  in(column: string, values: unknown[]): DynamicQuery;
  order(column: string, options?: { ascending?: boolean }): DynamicQuery;
  single(): Promise<DynamicResult>;
};
type DynamicClient = {
  from(relation: string): DynamicQuery;
  rpc(name: string, args: Record<string, unknown>): Promise<DynamicResult>;
};

const client = (supabase: unknown) => supabase as DynamicClient;
const table = (supabase: unknown, relation: string) => client(supabase).from(relation);
const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

function isMissingProgressSchema(error: DynamicError): boolean {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST205" ||
    error?.code === "PGRST202" ||
    /schedule_activity_progress_(controls|reviews)|apply_wip_schedule_progress_review|schema cache|does not exist|relation/i.test(
      message,
    )
  );
}

function normalizeActivity(row: Record<string, unknown>): CpmProgressActivity {
  return {
    id: str(row.id),
    activityId: str(row.activity_id),
    name: str(row.name),
    division: str(row.division),
    currentPercent: num(row.percent_complete),
  };
}

function normalizeEvidence(row: Record<string, unknown>): CpmProgressEvidenceEntry {
  return {
    id: str(row.id),
    scheduleActivityId: str(row.schedule_activity_id),
    entryDate: str(row.entry_date),
    updatedAt: str(row.updated_at),
    activity: str(row.activity),
    quantity: num(row.quantity),
    unit: str(row.unit),
    percentBasis: row.percent_basis === "cpm" ? "cpm" : "sov",
    reviewedPercent: num(row.percent_complete),
    reviewedAt: row.wip_reviewed_at == null ? null : str(row.wip_reviewed_at),
  };
}

function normalizeControl(row: Record<string, unknown>): CpmProgressControl {
  return {
    scheduleActivityId: str(row.schedule_activity_id),
    basis: row.basis === "installed_quantity" ? "installed_quantity" : "reviewed_percent",
    plannedQuantity: row.planned_quantity == null ? null : num(row.planned_quantity),
    unit: str(row.unit),
  };
}

function normalizeReview(row: Record<string, unknown>): CpmProgressReview {
  return {
    id: str(row.id),
    scheduleActivityId: str(row.schedule_activity_id),
    basis: row.basis === "installed_quantity" ? "installed_quantity" : "reviewed_percent",
    currentPercent: num(row.current_percent),
    recommendedPercent: num(row.recommended_percent),
    acceptedPercent: num(row.accepted_percent),
    decision:
      row.decision === "overridden" ? "overridden" : row.decision === "kept" ? "kept" : "accepted",
    note: str(row.review_note),
    reviewedBy: str(row.reviewed_by),
    reviewedByName: null,
    reviewedAt: str(row.reviewed_at),
  };
}

export interface CpmProgressReviewContext {
  enabled: boolean;
  recommendations: CpmProgressRecommendation[];
}

async function readCpmProgressReviewContext(
  supabase: unknown,
  projectId: string,
): Promise<CpmProgressReviewContext> {
  const [activitiesResult, evidenceResult, controlsResult, reviewsResult] = await Promise.all([
    table(supabase, "schedule_activities")
      .select("id,activity_id,name,division,percent_complete")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true }),
    table(supabase, "daily_wip_entries")
      .select(
        "id,schedule_activity_id,entry_date,updated_at,activity,quantity,unit,percent_basis,percent_complete,wip_reviewed_at",
      )
      .eq("project_id", projectId)
      .order("entry_date", { ascending: false }),
    table(supabase, "schedule_activity_progress_controls").select("*").eq("project_id", projectId),
    table(supabase, "schedule_activity_progress_reviews")
      .select("*")
      .eq("project_id", projectId)
      .order("reviewed_at", { ascending: false }),
  ]);

  if (activitiesResult.error) throw new Error(activitiesResult.error.message);
  if (evidenceResult.error) throw new Error(evidenceResult.error.message);
  if (controlsResult.error || reviewsResult.error) {
    const schemaError = controlsResult.error ?? reviewsResult.error;
    if (isMissingProgressSchema(schemaError)) return { enabled: false, recommendations: [] };
    throw new Error(schemaError?.message ?? "Unable to load CPM progress review.");
  }

  const activities = ((activitiesResult.data ?? []) as Record<string, unknown>[]).map(
    normalizeActivity,
  );
  const evidence = ((evidenceResult.data ?? []) as Record<string, unknown>[]).map(
    normalizeEvidence,
  );
  const controls = ((controlsResult.data ?? []) as Record<string, unknown>[]).map(normalizeControl);
  const reviews = ((reviewsResult.data ?? []) as Record<string, unknown>[]).map(normalizeReview);
  const reviewerIds = Array.from(
    new Set(reviews.map((review) => review.reviewedBy).filter(Boolean)),
  );
  const reviewerNames = new Map<string, string>();

  if (reviewerIds.length > 0) {
    const profileResult = await table(supabase, "profiles")
      .select("id,full_name,email")
      .in("id", reviewerIds);
    if (!profileResult.error) {
      for (const profile of (profileResult.data ?? []) as Record<string, unknown>[]) {
        const name = str(profile.full_name).trim() || str(profile.email).trim();
        if (name) reviewerNames.set(str(profile.id), name);
      }
    }
  }

  return {
    enabled: true,
    recommendations: buildCpmProgressRecommendations({
      activities,
      entries: evidence,
      controls,
      reviews: reviews.map((review) => ({
        ...review,
        reviewedByName: reviewerNames.get(review.reviewedBy) ?? null,
      })),
    }),
  };
}

export const loadCpmProgressReviewContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) =>
    readCpmProgressReviewContext(context.supabase, data.projectId),
  );

const saveControlInput = z
  .object({
    projectId: z.string().uuid(),
    scheduleActivityId: z.string().uuid(),
    basis: z.enum(["reviewed_percent", "installed_quantity"]),
    plannedQuantity: z.number().positive().max(1_000_000_000).nullable(),
    unit: z.string().trim().max(60),
  })
  .superRefine((value, ctx) => {
    if (value.basis === "installed_quantity" && (value.plannedQuantity == null || !value.unit)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Installed quantity needs a planned quantity and unit.",
      });
    }
  });

export const saveCpmProgressControl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => saveControlInput.parse(input))
  .handler(async ({ data, context }): Promise<CpmProgressControl> => {
    const payload = {
      project_id: data.projectId,
      schedule_activity_id: data.scheduleActivityId,
      basis: data.basis,
      planned_quantity: data.basis === "installed_quantity" ? data.plannedQuantity : null,
      unit: data.basis === "installed_quantity" ? data.unit : "",
      updated_by: context.userId,
    };
    const result = await table(context.supabase, "schedule_activity_progress_controls")
      .upsert(payload, { onConflict: "schedule_activity_id" })
      .select("*")
      .single();
    if (result.error) {
      if (isMissingProgressSchema(result.error)) {
        throw new Error("CPM progress review is waiting on its Lovable database migration.");
      }
      throw new Error(result.error.message);
    }
    return normalizeControl(result.data as Record<string, unknown>);
  });

export const applyCpmProgressReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        projectId: z.string().uuid(),
        scheduleActivityId: z.string().uuid(),
        decision: z.enum(["accepted", "kept", "overridden"]),
        acceptedPercent: z.number().min(0).max(100),
        note: z.string().trim().max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<CpmProgressReview> => {
    const reviewContext = await readCpmProgressReviewContext(context.supabase, data.projectId);
    if (!reviewContext.enabled) {
      throw new Error("CPM progress review is waiting on its Lovable database migration.");
    }
    const recommendation = reviewContext.recommendations.find(
      (row) => row.id === data.scheduleActivityId,
    );
    if (
      !recommendation ||
      recommendation.recommendedPercent == null ||
      !recommendation.sourceEntryId ||
      !recommendation.sourcePeriodStart ||
      !recommendation.sourcePeriodEnd
    ) {
      throw new Error("This activity does not have enough reviewed Daily WIP evidence yet.");
    }
    const resolution = resolveCpmProgressDecision({
      decision: data.decision,
      currentPercent: recommendation.currentPercent,
      recommendedPercent: recommendation.recommendedPercent,
      requestedPercent: data.acceptedPercent,
      note: data.note,
    });

    const sourceSnapshot = {
      entry_ids: recommendation.sourceEntryIds,
      evidence_count: recommendation.evidenceCount,
      explanation: recommendation.explanation,
      activity_id: recommendation.activityId,
      activity_name: recommendation.name,
    };
    const result = await client(context.supabase).rpc("apply_wip_schedule_progress_review", {
      p_project_id: data.projectId,
      p_schedule_activity_id: data.scheduleActivityId,
      p_source_wip_entry_id: recommendation.sourceEntryId,
      p_source_period_start: recommendation.sourcePeriodStart,
      p_source_period_end: recommendation.sourcePeriodEnd,
      p_basis: recommendation.basis,
      p_planned_quantity: recommendation.plannedQuantity,
      p_installed_quantity: recommendation.installedQuantity,
      p_unit: recommendation.unit,
      p_current_percent: recommendation.currentPercent,
      p_recommended_percent: recommendation.recommendedPercent,
      p_accepted_percent: resolution.acceptedPercent,
      p_decision: data.decision,
      p_note: resolution.reviewNote,
      p_source_snapshot: sourceSnapshot,
    });
    if (result.error) {
      if (isMissingProgressSchema(result.error)) {
        throw new Error("CPM progress review is waiting on its Lovable database migration.");
      }
      throw new Error(result.error.message);
    }
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    return normalizeReview(row as Record<string, unknown>);
  });

export type { CpmProgressBasis };
