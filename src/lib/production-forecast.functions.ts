import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type DynamicSupabaseError = { code?: string; message: string };
type DynamicSupabaseResult<T = unknown> = { data: T | null; error: DynamicSupabaseError | null };
type DynamicSupabaseQuery = PromiseLike<DynamicSupabaseResult> & {
  select(columns?: string): DynamicSupabaseQuery;
  insert(values: unknown): DynamicSupabaseQuery;
  update(values: unknown): DynamicSupabaseQuery;
  eq(column: string, value: unknown): DynamicSupabaseQuery;
  in(column: string, values: unknown[]): DynamicSupabaseQuery;
  order(column: string, options?: { ascending?: boolean }): DynamicSupabaseQuery;
  single(): Promise<DynamicSupabaseResult>;
};
type DynamicSupabaseClient = { from(relation: string): DynamicSupabaseQuery };

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as DynamicSupabaseClient).from(relation);

const num = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const str = (value: unknown): string => (typeof value === "string" ? value : "");

function isMissingForecastSchema(error: DynamicSupabaseError | null): boolean {
  return (
    error?.code === "PGRST205" ||
    /production_sov_certifications|wip_reviewed_at|schema cache|does not exist|relation/i.test(
      error?.message ?? "",
    )
  );
}

export interface ProductionSovCertificationRow {
  id: string;
  project_id: string;
  cost_bucket_id: string;
  source_wip_entry_id: string | null;
  source_period_start: string;
  source_period_end: string;
  current_sov_percent: number;
  recommended_percent: number;
  certified_percent: number;
  target_date: string | null;
  planned_quantity: number | null;
  installed_quantity: number | null;
  unit: string;
  recent_daily_pace: number | null;
  required_daily_pace: number | null;
  calculation_version: string;
  certification_note: string;
  certified_by: string;
  certified_by_name: string | null;
  certified_at: string;
}

export interface ProductionForecastContext {
  nextBillingDate: string | null;
  certifications: ProductionSovCertificationRow[];
  certificationEnabled: boolean;
}

export function normalizeProductionSovCertification(
  row: Record<string, unknown>,
): ProductionSovCertificationRow {
  return {
    id: str(row.id),
    project_id: str(row.project_id),
    cost_bucket_id: str(row.cost_bucket_id),
    source_wip_entry_id: row.source_wip_entry_id == null ? null : str(row.source_wip_entry_id),
    source_period_start: str(row.source_period_start),
    source_period_end: str(row.source_period_end),
    current_sov_percent: num(row.current_sov_percent),
    recommended_percent: num(row.recommended_percent),
    certified_percent: num(row.certified_percent),
    target_date: (row.target_date as string | null) ?? null,
    planned_quantity: row.planned_quantity == null ? null : num(row.planned_quantity),
    installed_quantity: row.installed_quantity == null ? null : num(row.installed_quantity),
    unit: str(row.unit),
    recent_daily_pace: row.recent_daily_pace == null ? null : num(row.recent_daily_pace),
    required_daily_pace: row.required_daily_pace == null ? null : num(row.required_daily_pace),
    calculation_version: str(row.calculation_version),
    certification_note: str(row.certification_note),
    certified_by: str(row.certified_by),
    certified_by_name: row.certified_by_name == null ? null : str(row.certified_by_name),
    certified_at: str(row.certified_at),
  };
}

export const loadProductionForecastContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<ProductionForecastContext> => {
    const projectResult = await dynamicTable(context.supabase, "projects")
      .select("next_billing_date")
      .eq("id", data.projectId)
      .single();
    if (projectResult.error) throw new Error(projectResult.error.message);

    const certificationResult = await dynamicTable(
      context.supabase,
      "production_sov_certifications",
    )
      .select("*")
      .eq("project_id", data.projectId)
      .order("certified_at", { ascending: false });
    if (certificationResult.error) {
      if (isMissingForecastSchema(certificationResult.error)) {
        return {
          nextBillingDate:
            ((projectResult.data as Record<string, unknown> | null)?.next_billing_date as
              string | null) ?? null,
          certifications: [],
          certificationEnabled: false,
        };
      }
      throw new Error(certificationResult.error.message);
    }

    const certifications = ((certificationResult.data ?? []) as Record<string, unknown>[]).map(
      normalizeProductionSovCertification,
    );
    const certifierIds = Array.from(
      new Set(certifications.map((certification) => certification.certified_by).filter(Boolean)),
    );
    const certifierNameById = new Map<string, string>();
    if (certifierIds.length > 0) {
      const profileResult = await dynamicTable(context.supabase, "profiles")
        .select("id,full_name,email")
        .in("id", certifierIds);
      if (!profileResult.error) {
        for (const profile of (profileResult.data ?? []) as Record<string, unknown>[]) {
          const name = str(profile.full_name).trim() || str(profile.email).trim();
          if (name) certifierNameById.set(str(profile.id), name);
        }
      }
    }

    return {
      nextBillingDate:
        ((projectResult.data as Record<string, unknown> | null)?.next_billing_date as
          string | null) ?? null,
      certifications: certifications.map((certification) => ({
        ...certification,
        certified_by_name: certifierNameById.get(certification.certified_by) ?? null,
      })),
      certificationEnabled: true,
    };
  });

export const setProductionTargetBillingDate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string; targetDate: string | null }) =>
    z
      .object({ projectId: z.string().uuid(), targetDate: z.string().date().nullable() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const result = await dynamicTable(context.supabase, "projects")
      .update({ next_billing_date: data.targetDate })
      .eq("id", data.projectId)
      .select("id,next_billing_date")
      .single();
    if (result.error) throw new Error(result.error.message);
    return {
      projectId: str((result.data as Record<string, unknown>).id),
      targetDate:
        ((result.data as Record<string, unknown>).next_billing_date as string | null) ?? null,
    };
  });

const certificationInput = z.object({
  projectId: z.string().uuid(),
  costBucketId: z.string().uuid(),
  sourcePeriodStart: z.string().date(),
  sourcePeriodEnd: z.string().date(),
  certifiedPercent: z.number().min(0).max(100),
  targetDate: z.string().date().nullable(),
  plannedQuantity: z.number().min(0).nullable(),
  installedQuantity: z.number().min(0).nullable(),
  unit: z.string().max(60),
  recentDailyPace: z.number().min(0).nullable(),
  requiredDailyPace: z.number().min(0).nullable(),
  note: z.string().max(2000),
});

export const certifyProductionSovPosition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => certificationInput.parse(input))
  .handler(async ({ data, context }): Promise<ProductionSovCertificationRow> => {
    const reviewResult = await dynamicTable(context.supabase, "daily_wip_entries")
      .select("id,entry_date,updated_at,percent_basis,percent_complete,wip_reviewed_at")
      .eq("project_id", data.projectId)
      .eq("cost_bucket_id", data.costBucketId)
      .order("entry_date", { ascending: false })
      .order("updated_at", { ascending: false });
    if (reviewResult.error) {
      if (isMissingForecastSchema(reviewResult.error)) {
        throw new Error("SOV certification isn't available yet.");
      }
      throw new Error(reviewResult.error.message);
    }

    const latestReview = ((reviewResult.data ?? []) as Record<string, unknown>[]).find(
      (row) =>
        row.percent_basis === "sov" &&
        Boolean(row.wip_reviewed_at) &&
        str(row.entry_date) <= data.sourcePeriodEnd,
    );
    if (!latestReview) {
      throw new Error(
        "Review this cost code in Daily WIP first. Field-only progress cannot be certified for billing.",
      );
    }

    const bucketResult = await dynamicTable(context.supabase, "cost_buckets")
      .select("id,earned_percent_complete")
      .eq("id", data.costBucketId)
      .eq("project_id", data.projectId)
      .single();
    if (bucketResult.error) throw new Error(bucketResult.error.message);
    const currentSovPercent = Math.min(
      100,
      Math.max(0, num((bucketResult.data as Record<string, unknown>).earned_percent_complete)),
    );

    const payload = {
      project_id: data.projectId,
      cost_bucket_id: data.costBucketId,
      source_wip_entry_id: str(latestReview.id),
      source_period_start: data.sourcePeriodStart,
      source_period_end: data.sourcePeriodEnd,
      current_sov_percent: currentSovPercent,
      recommended_percent: Math.min(100, Math.max(0, num(latestReview.percent_complete))),
      certified_percent: data.certifiedPercent,
      target_date: data.targetDate,
      planned_quantity: data.plannedQuantity,
      installed_quantity: data.installedQuantity,
      unit: data.unit,
      recent_daily_pace: data.recentDailyPace,
      required_daily_pace: data.requiredDailyPace,
      calculation_version: "production-pace-v1",
      certification_note: data.note.trim(),
      certified_by: context.userId,
    };
    const result = await dynamicTable(context.supabase, "production_sov_certifications")
      .insert(payload)
      .select("*")
      .single();
    if (result.error) {
      if (isMissingForecastSchema(result.error)) {
        throw new Error("SOV certification isn't available yet.");
      }
      throw new Error(result.error.message);
    }
    return normalizeProductionSovCertification(result.data as Record<string, unknown>);
  });
