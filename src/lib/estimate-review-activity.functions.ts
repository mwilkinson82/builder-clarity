import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ESTIMATE_REVIEW_ACTIVITY_TYPES,
  emptyEstimateReviewActivityState,
  type EstimateReviewActivity,
  type EstimateReviewActivityState,
  type EstimateReviewActivityType,
  type EstimateReviewSignoffStatus,
} from "@/lib/estimate-review-activity";

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
  rpc(name: string, args: Record<string, unknown>): Promise<DynamicResult>;
};

const dynamicClient = (supabase: unknown) => supabase as DynamicClient;
const str = (value: unknown) => (value == null ? "" : String(value));
const num = (value: unknown) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
};

function isEstimateReviewSchemaPending(error: DynamicError | null | undefined) {
  const message = error?.message?.toLowerCase() ?? "";
  return Boolean(
    error &&
    (error.code === "42P01" ||
      error.code === "PGRST202" ||
      error.code === "PGRST205" ||
      message.includes("estimate_review_activities") ||
      message.includes("get_estimate_review_state") ||
      message.includes("record_estimate_review_activity")),
  );
}

function normalizeActivity(
  row: Record<string, unknown>,
  profileNames = new Map<string, string>(),
): EstimateReviewActivity {
  const rawType = str(row.activity_type);
  const activityType = ESTIMATE_REVIEW_ACTIVITY_TYPES.includes(
    rawType as EstimateReviewActivityType,
  )
    ? (rawType as EstimateReviewActivityType)
    : "signoff";
  const reviewedBy = str(row.reviewed_by);
  return {
    id: str(row.id),
    estimate_id: str(row.estimate_id),
    sequence: Math.max(1, Math.round(num(row.sequence))),
    activity_type: activityType,
    note: str(row.note),
    snapshot_hash: str(row.snapshot_hash),
    blocker_count: Math.max(0, Math.round(num(row.blocker_count))),
    follow_up_count: Math.max(0, Math.round(num(row.follow_up_count))),
    total_cents: Math.max(0, Math.round(num(row.total_cents))),
    reviewed_by: reviewedBy,
    reviewed_by_name: profileNames.get(reviewedBy) || "Team member",
    reviewed_at: str(row.reviewed_at),
    created_at: str(row.created_at),
  };
}

function normalizeState(
  raw: Record<string, unknown>,
  activities: EstimateReviewActivity[],
  profileNames: Map<string, string>,
): EstimateReviewActivityState {
  const rawStatus = str(raw.status);
  const status: EstimateReviewSignoffStatus =
    rawStatus === "current" || rawStatus === "stale" || rawStatus === "unsigned"
      ? rawStatus
      : "unavailable";
  const reviewerId = raw.latest_signoff_reviewed_by ? str(raw.latest_signoff_reviewed_by) : null;
  return {
    ready: status !== "unavailable",
    status,
    current_snapshot_hash: str(raw.current_snapshot_hash),
    blocker_count: Math.max(0, Math.round(num(raw.blocker_count))),
    follow_up_count: Math.max(0, Math.round(num(raw.follow_up_count))),
    latest_signoff_id: raw.latest_signoff_id ? str(raw.latest_signoff_id) : null,
    latest_signoff_sequence:
      raw.latest_signoff_sequence == null
        ? null
        : Math.max(1, Math.round(num(raw.latest_signoff_sequence))),
    latest_signoff_hash: raw.latest_signoff_hash ? str(raw.latest_signoff_hash) : null,
    latest_signoff_reviewed_by: reviewerId,
    latest_signoff_reviewed_at: raw.latest_signoff_reviewed_at
      ? str(raw.latest_signoff_reviewed_at)
      : null,
    latest_signoff_note: str(raw.latest_signoff_note),
    latest_signoff_reviewed_by_name: (reviewerId && profileNames.get(reviewerId)) || "Team member",
    activities,
  };
}

export const getEstimateReviewActivityState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { estimate_id: string }) =>
    z.object({ estimate_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const client = dynamicClient(context.supabase);
    const stateResult = await client.rpc("get_estimate_review_state", {
      p_estimate_id: data.estimate_id,
    });
    if (isEstimateReviewSchemaPending(stateResult.error)) {
      return emptyEstimateReviewActivityState();
    }
    if (stateResult.error) throw new Error(stateResult.error.message);

    const activitiesResult = await client
      .from("estimate_review_activities")
      .select(
        "id,estimate_id,sequence,activity_type,note,snapshot_hash,blocker_count,follow_up_count,total_cents,reviewed_by,reviewed_at,created_at",
      )
      .eq("estimate_id", data.estimate_id)
      .order("sequence", { ascending: false })
      .limit(50);
    if (isEstimateReviewSchemaPending(activitiesResult.error)) {
      return emptyEstimateReviewActivityState();
    }
    if (activitiesResult.error) throw new Error(activitiesResult.error.message);

    const rows = (activitiesResult.data ?? []) as Record<string, unknown>[];
    const stateRaw = (stateResult.data ?? {}) as Record<string, unknown>;
    const reviewerIds = [
      ...new Set(
        [...rows.map((row) => row.reviewed_by), stateRaw.latest_signoff_reviewed_by].filter(
          (value): value is string => typeof value === "string" && value.length > 0,
        ),
      ),
    ];
    const profileNames = new Map<string, string>();
    if (reviewerIds.length > 0) {
      const profiles = await client
        .from("profiles")
        .select("id,email,full_name")
        .in("id", reviewerIds);
      if (!profiles.error) {
        for (const profile of (profiles.data ?? []) as Record<string, unknown>[]) {
          profileNames.set(
            str(profile.id),
            str(profile.full_name).trim() || str(profile.email).trim() || "Team member",
          );
        }
      }
    }
    const activities = rows.map((row) => normalizeActivity(row, profileNames));
    return normalizeState(stateRaw, activities, profileNames);
  });

const recordActivityInput = z.object({
  estimate_id: z.string().uuid(),
  activity_type: z.enum(ESTIMATE_REVIEW_ACTIVITY_TYPES),
  note: z.string().trim().min(3).max(2000),
});

export const recordEstimateReviewActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof recordActivityInput>) => recordActivityInput.parse(input))
  .handler(async ({ data, context }) => {
    const result = await dynamicClient(context.supabase).rpc("record_estimate_review_activity", {
      p_estimate_id: data.estimate_id,
      p_activity_type: data.activity_type,
      p_note: data.note,
    });
    if (isEstimateReviewSchemaPending(result.error)) {
      throw new Error("Estimator sign-off isn't available yet.");
    }
    if (result.error) throw new Error(result.error.message);
    const rows = Array.isArray(result.data) ? result.data : [];
    const row = (rows[0] ?? null) as Record<string, unknown> | null;
    if (!row) throw new Error("Estimate review activity did not save.");
    return { activity: normalizeActivity(row) };
  });
