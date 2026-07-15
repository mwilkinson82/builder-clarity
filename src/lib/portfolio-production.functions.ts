import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  commitmentBySubBucket,
  laborHours,
  priorSubPercent,
  rowWorkInPlace,
  subCommitmentKey,
  type DailyWipRowLike,
} from "@/lib/daily-wip";
import type {
  PortfolioProductionAnalyticsRow,
  ProductionProjectMeta,
} from "@/lib/production-analytics";

type DynamicSupabaseError = { code?: string; message: string };
type DynamicSupabaseResult<T = unknown> = { data: T | null; error: DynamicSupabaseError | null };
type DynamicSupabaseQuery = PromiseLike<DynamicSupabaseResult> & {
  select(columns?: string): DynamicSupabaseQuery;
  in(column: string, values: readonly string[]): DynamicSupabaseQuery;
  is(column: string, value: unknown): DynamicSupabaseQuery;
  order(column: string, options?: { ascending?: boolean }): DynamicSupabaseQuery;
};
type DynamicSupabaseClient = { from(relation: string): DynamicSupabaseQuery };

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as DynamicSupabaseClient).from(relation);

const numberValue = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const stringValue = (value: unknown): string => (typeof value === "string" ? value : "");

function isOptionalProductionSchemaError(error: DynamicSupabaseError | null): boolean {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST205" ||
    /daily_wip_entries|subcontract|schema cache|does not exist|relation/i.test(message)
  );
}

export interface PortfolioProductionData {
  projects: ProductionProjectMeta[];
  rows: PortfolioProductionAnalyticsRow[];
}

interface BenchmarkSetting {
  plannedQuantity: number;
  unit: string;
  benchmarkLaborRate: number;
}

export const listPortfolioProduction = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PortfolioProductionData> => {
    const { error: accountError } = await (
      context.supabase as unknown as {
        rpc: (fn: string) => Promise<DynamicSupabaseResult<string>>;
      }
    ).rpc("ensure_current_user_account");
    if (accountError) throw new Error(accountError.message);

    const projectsResult = await dynamicTable(context.supabase, "projects")
      .select("id,name,job_number,project_manager,archived_at")
      .is("archived_at", null)
      .order("created_at", { ascending: false });
    if (projectsResult.error) throw new Error(projectsResult.error.message);

    const projects: ProductionProjectMeta[] = (
      (projectsResult.data ?? []) as Record<string, unknown>[]
    ).map((project) => ({
      id: stringValue(project.id),
      name: stringValue(project.name) || "Untitled project",
      jobNumber: stringValue(project.job_number),
      projectManager: stringValue(project.project_manager) || "Unassigned",
    }));
    const projectIds = projects.map((project) => project.id).filter(Boolean);
    if (projectIds.length === 0) return { projects, rows: [] };

    const readPortfolioRows = async (relation: string): Promise<Record<string, unknown>[]> => {
      const result = await dynamicTable(context.supabase, relation)
        .select("*")
        .in("project_id", projectIds);
      if (result.error) {
        if (isOptionalProductionSchemaError(result.error)) return [];
        throw new Error(result.error.message);
      }
      return (result.data ?? []) as Record<string, unknown>[];
    };

    const [entryRows, bucketRows, subcontractRows, allocationRows, directoryRows] =
      await Promise.all([
        readPortfolioRows("daily_wip_entries"),
        readPortfolioRows("cost_buckets"),
        readPortfolioRows("subcontracts"),
        readPortfolioRows("subcontract_allocations"),
        (async () => {
          const result = await dynamicTable(context.supabase, "subcontractors").select("id,name");
          if (result.error) {
            if (isOptionalProductionSchemaError(result.error)) return [];
            throw new Error(result.error.message);
          }
          return (result.data ?? []) as Record<string, unknown>[];
        })(),
      ]);

    const projectById = new Map(projects.map((project) => [project.id, project]));
    const bucketById = new Map(
      bucketRows.map((bucket) => [
        stringValue(bucket.id),
        {
          costCode: stringValue(bucket.cost_code),
          scopeName: stringValue(bucket.bucket) || "Uncoded scope",
        },
      ]),
    );
    const subcontractorNameById = new Map(
      directoryRows.map((row) => [stringValue(row.id), stringValue(row.name)]),
    );
    const normalizedSubcontracts = subcontractRows.map((row) => ({
      id: stringValue(row.id),
      subcontractor_id: stringValue(row.subcontractor_id),
      status: stringValue(row.status) || "draft",
    }));
    const normalizedAllocations = allocationRows.map((row) => ({
      subcontract_id: stringValue(row.subcontract_id),
      cost_bucket_id: stringValue(row.cost_bucket_id) || null,
      amount: numberValue(row.amount),
    }));
    const commitmentLookup = commitmentBySubBucket(normalizedSubcontracts, normalizedAllocations);
    const subcontractorByBuyout = new Map(
      normalizedSubcontracts.map((subcontract) => [subcontract.id, subcontract.subcontractor_id]),
    );

    const benchmarkSettings = new Map<string, BenchmarkSetting>();
    const conflictingBenchmarkKeys = new Set<string>();
    for (const allocation of allocationRows) {
      const subcontractorId = subcontractorByBuyout.get(stringValue(allocation.subcontract_id));
      const costBucketId = stringValue(allocation.cost_bucket_id) || null;
      const key = subCommitmentKey(subcontractorId, costBucketId);
      const plannedQuantity = numberValue(allocation.planned_quantity);
      const unit = stringValue(allocation.unit).trim();
      const benchmarkLaborRate = numberValue(allocation.benchmark_labor_rate);
      if (!key || plannedQuantity <= 0 || !unit || conflictingBenchmarkKeys.has(key)) continue;

      const next = { plannedQuantity, unit, benchmarkLaborRate };
      const prior = benchmarkSettings.get(key);
      if (!prior) {
        benchmarkSettings.set(key, next);
      } else if (
        prior.unit.toLowerCase() === next.unit.toLowerCase() &&
        prior.benchmarkLaborRate === next.benchmarkLaborRate
      ) {
        benchmarkSettings.set(key, {
          ...prior,
          plannedQuantity: prior.plannedQuantity + next.plannedQuantity,
        });
      } else {
        benchmarkSettings.delete(key);
        conflictingBenchmarkKeys.add(key);
      }
    }

    const normalizedEntries = entryRows.map((row) => ({
      id: stringValue(row.id),
      project_id: stringValue(row.project_id),
      entry_date: stringValue(row.entry_date),
      updated_at: stringValue(row.updated_at),
      subcontractor_id: stringValue(row.subcontractor_id) || null,
      unmatched_vendor_name: stringValue(row.unmatched_vendor_name),
      cost_bucket_id: stringValue(row.cost_bucket_id) || null,
      activity: stringValue(row.activity),
      crew_count: numberValue(row.crew_count),
      people_per_crew: numberValue(row.people_per_crew) || 2,
      hours: numberValue(row.hours),
      labor_rate: numberValue(row.labor_rate),
      material_cost: numberValue(row.material_cost),
      equipment_cost: numberValue(row.equipment_cost),
      quantity: numberValue(row.quantity),
      unit: stringValue(row.unit),
      target_production_rate:
        row.target_production_rate == null ? null : numberValue(row.target_production_rate),
      percent_complete: numberValue(row.percent_complete),
    }));

    return {
      projects,
      rows: normalizedEntries.flatMap((entry): PortfolioProductionAnalyticsRow[] => {
        const project = projectById.get(entry.project_id);
        if (!project) return [];
        const bucket = entry.cost_bucket_id ? bucketById.get(entry.cost_bucket_id) : undefined;
        const performerName = entry.subcontractor_id
          ? subcontractorNameById.get(entry.subcontractor_id) || "Subcontractor"
          : entry.unmatched_vendor_name.trim() || "Self-perform";
        const isExternal = Boolean(entry.subcontractor_id || entry.unmatched_vendor_name.trim());
        const performerKey = entry.subcontractor_id
          ? `sub:${entry.subcontractor_id}`
          : entry.unmatched_vendor_name.trim()
            ? `vendor:${entry.unmatched_vendor_name.trim().toLowerCase()}`
            : "self-perform";
        const commitmentKey = subCommitmentKey(entry.subcontractor_id, entry.cost_bucket_id);
        const commitment = commitmentKey ? (commitmentLookup.get(commitmentKey) ?? null) : null;
        const benchmark = commitmentKey ? benchmarkSettings.get(commitmentKey) : undefined;
        const benchmarkTarget =
          benchmark &&
          benchmark.plannedQuantity > 0 &&
          benchmark.benchmarkLaborRate > 0 &&
          commitment != null &&
          commitment > 0
            ? (benchmark.plannedQuantity * benchmark.benchmarkLaborRate) / commitment
            : null;
        const priorPercent = priorSubPercent(entry, normalizedEntries);
        const dailyWipEntry = entry as DailyWipRowLike;

        return [
          {
            id: entry.id,
            date: entry.entry_date,
            projectId: project.id,
            projectName: project.name,
            jobNumber: project.jobNumber,
            projectManager: project.projectManager,
            performerKey,
            performerName,
            performerType: isExternal ? "subcontractor" : "self-perform",
            costBucketId: entry.cost_bucket_id ?? "",
            costCode: bucket?.costCode ?? "",
            scopeName: bucket?.scopeName ?? "Uncoded scope",
            activity: entry.activity,
            quantity: entry.quantity,
            unit: entry.unit,
            laborHours: laborHours(dailyWipEntry),
            targetRate: benchmarkTarget ?? entry.target_production_rate,
            fieldValue: rowWorkInPlace(dailyWipEntry, commitment, priorPercent),
          },
        ];
      }),
    };
  });
