import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import {
  normalizeRevisionImpactItems,
  revisionImpactDispositions,
  revisionImpactReviewInputSchema,
  type PlanRevisionImpactReview,
  type RevisionImpactDisposition,
} from "@/lib/plan-revision-impact";

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

function isRevisionImpactSchemaPending(error: DynamicError | null | undefined) {
  const message = error?.message?.toLowerCase() ?? "";
  return Boolean(
    error &&
    (error.code === "42P01" ||
      error.code === "PGRST202" ||
      error.code === "PGRST205" ||
      message.includes("estimate_plan_revision_impact_reviews") ||
      message.includes("save_estimate_plan_revision_impact_review")),
  );
}

function normalizeReview(
  row: Record<string, unknown>,
  profileNames = new Map<string, string>(),
): PlanRevisionImpactReview {
  const disposition = str(row.disposition);
  const reviewedBy = row.reviewed_by == null ? null : str(row.reviewed_by);
  return {
    id: str(row.id),
    estimate_id: str(row.estimate_id),
    revision_match_id: str(row.revision_match_id),
    revision_sheet_id: str(row.revision_sheet_id),
    base_sheet_id: str(row.base_sheet_id),
    version: Math.max(1, Math.round(Number(row.version) || 1)),
    disposition: (revisionImpactDispositions.includes(disposition as RevisionImpactDisposition)
      ? disposition
      : "needs_follow_up") as RevisionImpactDisposition,
    summary_notes: str(row.summary_notes),
    impacts: normalizeRevisionImpactItems(row.impacts),
    reviewed_by: reviewedBy,
    reviewed_by_name: (reviewedBy && profileNames.get(reviewedBy)) || "Team member",
    reviewed_at: str(row.reviewed_at),
    created_at: str(row.created_at),
  };
}

export const getPlanRevisionImpactReviews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { estimate_id: string }) =>
    z.object({ estimate_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const client = dynamicClient(context.supabase);
    const result = await client
      .from("estimate_plan_revision_impact_reviews")
      .select("*")
      .eq("estimate_id", data.estimate_id)
      .order("reviewed_at", { ascending: false })
      .limit(500);
    if (isRevisionImpactSchemaPending(result.error)) return { reviews: [], ready: false };
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
    return { reviews: rows.map((row) => normalizeReview(row, profileNames)), ready: true };
  });

export const savePlanRevisionImpactReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof revisionImpactReviewInputSchema>) =>
    revisionImpactReviewInputSchema.parse(input),
  )
  .handler(async ({ data, context }) => {
    const result = await dynamicClient(context.supabase).rpc(
      "save_estimate_plan_revision_impact_review",
      {
        p_revision_match_id: data.revision_match_id,
        p_disposition: data.disposition,
        p_summary_notes: data.summary_notes,
        p_impacts: data.impacts as unknown as Json,
      },
    );
    if (isRevisionImpactSchemaPending(result.error)) {
      throw new Error("The revision impact register isn't available yet.");
    }
    if (result.error) throw new Error(result.error.message);
    const row = ((result.data ?? [])[0] ?? null) as Record<string, unknown> | null;
    if (!row) throw new Error("The revision impact review did not save.");
    return { review: normalizeReview(row) };
  });
