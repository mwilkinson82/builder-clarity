import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { centsToDollars, dollarsToCents } from "@/lib/payments-domain";

type DynamicSupabaseError = { code?: string; message: string };
type DynamicSupabaseResult<T = unknown> = {
  data: T | null;
  error: DynamicSupabaseError | null;
};
type DynamicSupabaseQuery = PromiseLike<DynamicSupabaseResult<unknown[]>> & {
  select(columns?: string): DynamicSupabaseQuery;
  eq(column: string, value: unknown): DynamicSupabaseQuery;
  order(
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean },
  ): DynamicSupabaseQuery;
};
type DynamicSupabaseClient = {
  from(relation: string): DynamicSupabaseQuery;
  rpc(functionName: string, args?: Record<string, unknown>): PromiseLike<DynamicSupabaseResult>;
};

const dynamicClient = (supabase: unknown) => supabase as DynamicSupabaseClient;

const MAX_SAFE_DOLLARS = Number.MAX_SAFE_INTEGER / 100;
const exactPositiveCentMoney = z
  .number()
  .finite()
  .positive()
  .max(MAX_SAFE_DOLLARS)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7, {
    message: "Allocation amount must be exact to the cent.",
  });
const operationKey = z.string().trim().min(1).max(200);

export interface ExposureAllocationRow {
  id: string;
  project_id: string;
  exposure_id: string;
  cost_bucket_id: string;
  cost_code: string;
  amount: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ExposureAllocationCommandResult {
  ok: true;
  allocationId: string;
  projectId: string;
  exposureId: string;
  costBucketId?: string;
  costCode?: string;
  amountCents?: number;
  version?: number;
  updatedAt?: string;
  deduplicated: boolean;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function finiteNumber(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is not a valid number.`);
  return parsed;
}

function commandResult(value: unknown): ExposureAllocationCommandResult {
  const row = record(value);
  const allocationId = stringValue(row.allocationId);
  const projectId = stringValue(row.projectId);
  const exposureId = stringValue(row.exposureId);
  if (!allocationId || !projectId || !exposureId || row.ok !== true) {
    throw new Error("Exposure allocation command returned an invalid result.");
  }
  return {
    ok: true,
    allocationId,
    projectId,
    exposureId,
    costBucketId: stringValue(row.costBucketId) || undefined,
    costCode: stringValue(row.costCode) || undefined,
    amountCents:
      row.amountCents == null ? undefined : finiteNumber(row.amountCents, "Allocation amount"),
    version: row.version == null ? undefined : finiteNumber(row.version, "Allocation version"),
    updatedAt: stringValue(row.updatedAt) || undefined,
    deduplicated: row.deduplicated === true,
  };
}

function commandError(error: DynamicSupabaseError, action: string): Error {
  if (
    error.code === "PGRST202" ||
    /exposure_allocation_atomic|schema cache|could not find the function/i.test(error.message)
  ) {
    return new Error(
      `Exposure allocation integrity is still being enabled. No ${action} was recorded; refresh after Lovable finishes the migration.`,
    );
  }
  return new Error(error.message);
}

const createInput = z.object({
  projectId: z.string().uuid(),
  exposureId: z.string().uuid(),
  costBucketId: z.string().uuid(),
  amount: exactPositiveCentMoney,
  operationKey,
});

export const createExposureAllocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof createInput>) => createInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await dynamicClient(context.supabase).rpc(
      "create_exposure_allocation_atomic",
      {
        p_project_id: data.projectId,
        p_exposure_id: data.exposureId,
        p_cost_bucket_id: data.costBucketId,
        p_amount_cents: dollarsToCents(data.amount),
        p_operation_key: data.operationKey,
      },
    );
    if (error) throw commandError(error, "allocation");
    return commandResult(result);
  });

const updateInput = z.object({
  id: z.string().uuid(),
  costBucketId: z.string().uuid(),
  amount: exactPositiveCentMoney,
  expectedVersion: z.number().int().positive(),
  operationKey,
});

export const updateExposureAllocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof updateInput>) => updateInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await dynamicClient(context.supabase).rpc(
      "update_exposure_allocation_atomic",
      {
        p_allocation_id: data.id,
        p_cost_bucket_id: data.costBucketId,
        p_amount_cents: dollarsToCents(data.amount),
        p_expected_version: data.expectedVersion,
        p_operation_key: data.operationKey,
      },
    );
    if (error) throw commandError(error, "update");
    return commandResult(result);
  });

const deleteInput = z.object({
  id: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  operationKey,
});

export const deleteExposureAllocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof deleteInput>) => deleteInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await dynamicClient(context.supabase).rpc(
      "delete_exposure_allocation_atomic",
      {
        p_allocation_id: data.id,
        p_expected_version: data.expectedVersion,
        p_operation_key: data.operationKey,
      },
    );
    if (error) throw commandError(error, "removal");
    return commandResult(result);
  });

const listInput = z.object({ projectId: z.string().uuid() });

export const listExposureAllocations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof listInput>) => listInput.parse(input))
  .handler(async ({ data, context }): Promise<ExposureAllocationRow[]> => {
    const { data: rows, error } = await dynamicClient(context.supabase)
      .from("exposure_allocations")
      .select(
        "id,project_id,exposure_id,cost_bucket_id,cost_code,amount,version,created_at,updated_at",
      )
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: true });
    if (error) {
      if (
        /exposure_allocations|version|schema cache|does not exist|relation/i.test(error.message)
      ) {
        throw new Error(
          "Exposure allocation financial data is unavailable. The budget has stopped rather than showing incomplete risk totals.",
        );
      }
      throw new Error(error.message);
    }

    return (rows ?? []).map((value) => {
      const row = record(value);
      const costBucketId = stringValue(row.cost_bucket_id);
      if (!costBucketId) throw new Error("An exposure allocation is missing its cost code.");
      return {
        id: stringValue(row.id),
        project_id: stringValue(row.project_id),
        exposure_id: stringValue(row.exposure_id),
        cost_bucket_id: costBucketId,
        cost_code: stringValue(row.cost_code),
        amount: centsToDollars(
          dollarsToCents(finiteNumber(row.amount, "Exposure allocation amount")),
        ),
        version: finiteNumber(row.version, "Exposure allocation version"),
        created_at: stringValue(row.created_at),
        updated_at: stringValue(row.updated_at),
      };
    });
  });
