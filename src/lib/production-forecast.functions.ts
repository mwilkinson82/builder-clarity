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
type RpcSupabaseClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<DynamicSupabaseResult<Record<string, unknown>>>;
};

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
    /production_sov_certifications|production_sov_certification_invalidations|certify_production_sov_position_atomic|wip_reviewed_at|schema cache|does not exist|relation/i.test(
      error?.message ?? "",
    )
  );
}

export interface ProductionSovCertificationRow {
  id: string;
  project_id: string;
  cost_bucket_id: string;
  source_wip_entry_id: string | null;
  source_wip_review_version: number | null;
  source_wip_updated_at: string | null;
  source_wip_reviewed_at: string | null;
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
  invalidated_at: string | null;
  invalidation_reason_code: string | null;
  invalidation_reason_detail: string | null;
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
    source_wip_review_version:
      row.source_wip_review_version == null ? null : num(row.source_wip_review_version),
    source_wip_updated_at: (row.source_wip_updated_at as string | null) ?? null,
    source_wip_reviewed_at: (row.source_wip_reviewed_at as string | null) ?? null,
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
    invalidated_at: (row.invalidated_at as string | null) ?? null,
    invalidation_reason_code:
      row.invalidation_reason_code == null ? null : str(row.invalidation_reason_code),
    invalidation_reason_detail:
      row.invalidation_reason_detail == null ? null : str(row.invalidation_reason_detail),
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

    const invalidationResult = await dynamicTable(
      context.supabase,
      "production_sov_certification_invalidations",
    )
      .select("production_sov_certification_id,invalidated_at,reason_code,reason_detail")
      .eq("project_id", data.projectId);
    if (invalidationResult.error) {
      if (isMissingForecastSchema(invalidationResult.error)) {
        return {
          nextBillingDate:
            ((projectResult.data as Record<string, unknown> | null)?.next_billing_date as
              string | null) ?? null,
          certifications: [],
          certificationEnabled: false,
        };
      }
      throw new Error(invalidationResult.error.message);
    }

    const invalidationByCertificationId = new Map<string, Record<string, unknown>>();
    for (const invalidation of (invalidationResult.data ?? []) as Record<string, unknown>[]) {
      invalidationByCertificationId.set(
        str(invalidation.production_sov_certification_id),
        invalidation,
      );
    }

    const certifications = ((certificationResult.data ?? []) as Record<string, unknown>[]).map(
      (row) => {
        const invalidation = invalidationByCertificationId.get(str(row.id));
        return normalizeProductionSovCertification({
          ...row,
          invalidated_at: invalidation?.invalidated_at ?? null,
          invalidation_reason_code: invalidation?.reason_code ?? null,
          invalidation_reason_detail: invalidation?.reason_detail ?? null,
        });
      },
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
  sourceWipEntryId: z.string().uuid(),
  sourceReviewVersion: z.number().int().nonnegative(),
  expectedCurrentSovPercent: z.number().min(0).max(100),
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
  operationKey: z.string().trim().min(1).max(200),
});

export const certifyProductionSovPosition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => certificationInput.parse(input))
  .handler(async ({ data, context }): Promise<ProductionSovCertificationRow> => {
    const payload = {
      source_period_start: data.sourcePeriodStart,
      source_period_end: data.sourcePeriodEnd,
      certified_percent: data.certifiedPercent,
      target_date: data.targetDate,
      planned_quantity: data.plannedQuantity,
      installed_quantity: data.installedQuantity,
      unit: data.unit,
      recent_daily_pace: data.recentDailyPace,
      required_daily_pace: data.requiredDailyPace,
      note: data.note.trim(),
    };
    const { data: result, error } = await (context.supabase as unknown as RpcSupabaseClient).rpc(
      "certify_production_sov_position_atomic",
      {
        p_project_id: data.projectId,
        p_cost_bucket_id: data.costBucketId,
        p_expected_source_wip_entry_id: data.sourceWipEntryId,
        p_expected_source_review_version: data.sourceReviewVersion,
        p_expected_current_sov_percent: data.expectedCurrentSovPercent,
        p_payload: payload,
        p_operation_key: data.operationKey,
      },
    );
    if (error) {
      if (isMissingForecastSchema(error)) {
        throw new Error("SOV certification isn't available yet.");
      }
      throw new Error(error.message);
    }
    const certification = result?.certification;
    if (!certification || typeof certification !== "object") {
      throw new Error("The SOV certification saved without returning its authoritative record.");
    }
    return normalizeProductionSovCertification(certification as Record<string, unknown>);
  });
