import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { findHarborDemoProject, harborDemoSeedAction } from "@/lib/demo-seed";
import {
  calculateEstimateTotals,
  resolveLibraryUnitCosts,
  type CostLibraryLaborBasis,
  type EstimateCustomMarkup,
} from "@/lib/estimates.functions";
import {
  disciplineForSheetNumber,
  normalizeTakeoffUnit,
  SAMPLE_PLAN_SET_MIME,
  takeoffUnitsCompatible,
} from "@/lib/plan-room-math";
import type { Json } from "@/integrations/supabase/types";

type DynamicSupabaseError = { code?: string; message: string };
type DynamicSupabaseResult<T = unknown> = { data: T | null; error: DynamicSupabaseError | null };
type DynamicSupabaseQuery = PromiseLike<DynamicSupabaseResult> & {
  select(columns?: string): DynamicSupabaseQuery;
  insert(values: unknown): DynamicSupabaseQuery;
  update(values: unknown): DynamicSupabaseQuery;
  delete(): DynamicSupabaseQuery;
  eq(column: string, value: unknown): DynamicSupabaseQuery;
  in(column: string, values: readonly string[]): Promise<DynamicSupabaseResult<unknown[]>>;
  order(column: string, options?: { ascending?: boolean }): DynamicSupabaseQuery;
  limit(count: number): DynamicSupabaseQuery;
  single(): Promise<DynamicSupabaseResult>;
  maybeSingle(): Promise<DynamicSupabaseResult>;
};
type DynamicSupabaseClient = {
  from(relation: string): DynamicSupabaseQuery;
};

const PLAN_ROOM_BUCKET = "plan-room";

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as DynamicSupabaseClient).from(relation);

const str = (value: unknown, fallback = "") => (value == null ? fallback : String(value));
const num = (value: unknown, fallback = 0) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};
const clean = (value: string, max = 500) => value.trim().slice(0, max);

function isMissingPlanRoomSchemaError(error: DynamicSupabaseError | null | undefined) {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    error?.code === "42501" ||
    (message.includes("schema cache") &&
      (message.includes("estimate_plan_sets") ||
        message.includes("estimate_plan_sheets") ||
        message.includes("estimate_takeoff_measurements") ||
        message.includes("plan-room"))) ||
    /relation .*estimate_plan_(sets|sheets).* does not exist/i.test(error?.message ?? "") ||
    /relation .*estimate_takeoff_measurements.* does not exist/i.test(error?.message ?? "")
  );
}

function planRoomSchemaPending(message = "Plan Room backend schema is still being prepared.") {
  return {
    plan_sets: [] as PlanSetRow[],
    sheets: [] as PlanSheetRow[],
    measurements: [] as TakeoffMeasurementRow[],
    schema_ready: false,
    schema_message: message,
  };
}

export type TakeoffToolType = "linear" | "area" | "count";

export interface PlanSetRow {
  id: string;
  organization_id: string;
  estimate_id: string;
  created_by: string | null;
  name: string;
  description: string;
  source_file_name: string;
  file_path: string;
  file_mime_type: string;
  file_size_bytes: number;
  page_count: number;
  sample_key: string;
  status: "current" | "superseded" | "archive";
  created_at: string;
  updated_at: string;
}

export interface PlanSheetRow {
  id: string;
  plan_set_id: string;
  estimate_id: string;
  sheet_number: string;
  sheet_name: string;
  discipline: string;
  page_number: number;
  sort_order: number;
  scale_label: string;
  scale_feet_per_pixel: number;
  scale_source: "unset" | "calibrated" | "stated";
  scale_verified_at: string | null;
  thumbnail_path: string;
  width_px: number;
  height_px: number;
  created_at: string;
  updated_at: string;
}

export interface TakeoffMeasurementRow {
  id: string;
  estimate_id: string;
  plan_sheet_id: string;
  estimate_line_item_id: string | null;
  library_item_id: string | null;
  created_by: string | null;
  tool_type: TakeoffToolType;
  label: string;
  unit: string;
  quantity: number;
  waste_pct: number;
  color: string;
  geometry: Json;
  notes: string;
  created_at: string;
  updated_at: string;
}

const normalizeCustomMarkup = (value: unknown): EstimateCustomMarkup[] =>
  (Array.isArray(value) ? value : [])
    .map((item): EstimateCustomMarkup => {
      const raw = item as Record<string, unknown>;
      const basis = str(raw.applies_to, "subtotal");
      return {
        name: clean(str(raw.name, "Markup"), 80) || "Markup",
        pct: Math.max(0, Math.round(num(raw.pct))),
        applies_to: basis === "material" || basis === "labor" ? basis : "subtotal",
      };
    })
    .filter((item) => item.name && item.pct >= 0);

const normalizePlanSet = (row: Record<string, unknown>): PlanSetRow => ({
  id: str(row.id),
  organization_id: str(row.organization_id),
  estimate_id: str(row.estimate_id),
  created_by: (row.created_by as string | null) ?? null,
  name: str(row.name),
  description: str(row.description),
  source_file_name: str(row.source_file_name),
  file_path: str(row.file_path),
  file_mime_type: str(row.file_mime_type),
  file_size_bytes: Math.round(num(row.file_size_bytes)),
  page_count: Math.max(1, Math.round(num(row.page_count, 1))),
  sample_key: str(row.sample_key),
  status: str(row.status, "current") as PlanSetRow["status"],
  created_at: str(row.created_at),
  updated_at: str(row.updated_at),
});

const normalizePlanSheet = (row: Record<string, unknown>): PlanSheetRow => ({
  id: str(row.id),
  plan_set_id: str(row.plan_set_id),
  estimate_id: str(row.estimate_id),
  sheet_number: str(row.sheet_number),
  sheet_name: str(row.sheet_name),
  discipline: str(row.discipline),
  page_number: Math.max(1, Math.round(num(row.page_number, 1))),
  sort_order: Math.max(1, Math.round(num(row.sort_order, 1))),
  scale_label: str(row.scale_label),
  scale_feet_per_pixel: num(row.scale_feet_per_pixel),
  // Pre-migration rows have no provenance columns: a scaled sheet was always
  // a two-point calibration, an unscaled one has nothing to trust yet.
  scale_source:
    str(row.scale_source) === "stated"
      ? "stated"
      : str(row.scale_source) === "calibrated" || num(row.scale_feet_per_pixel) > 0
        ? "calibrated"
        : "unset",
  scale_verified_at: row.scale_verified_at == null ? null : str(row.scale_verified_at),
  thumbnail_path: str(row.thumbnail_path),
  width_px: Math.round(num(row.width_px)),
  height_px: Math.round(num(row.height_px)),
  created_at: str(row.created_at),
  updated_at: str(row.updated_at),
});

const normalizeTakeoffMeasurement = (row: Record<string, unknown>): TakeoffMeasurementRow => ({
  id: str(row.id),
  estimate_id: str(row.estimate_id),
  plan_sheet_id: str(row.plan_sheet_id),
  estimate_line_item_id: (row.estimate_line_item_id as string | null) ?? null,
  library_item_id: (row.library_item_id as string | null) ?? null,
  created_by: (row.created_by as string | null) ?? null,
  tool_type: str(row.tool_type, "linear") as TakeoffToolType,
  label: str(row.label),
  unit: str(row.unit),
  quantity: num(row.quantity),
  waste_pct: Math.round(num(row.waste_pct)),
  color: str(row.color, "#1b7a6e"),
  geometry: (row.geometry ?? {}) as Json,
  notes: str(row.notes),
  created_at: str(row.created_at),
  updated_at: str(row.updated_at),
});

async function getOrganizationId(context: { supabase: unknown; userId: string }) {
  const { data: ensuredOrganizationId, error: accountError } = await (
    context.supabase as {
      rpc: (fn: string) => Promise<DynamicSupabaseResult<string>>;
    }
  ).rpc("ensure_current_user_account");
  if (accountError) throw new Error(accountError.message);
  if (!ensuredOrganizationId) throw new Error("No Overwatch company workspace is available.");

  const { data: memberships, error: membershipsError } = await dynamicTable(
    context.supabase,
    "organization_memberships",
  )
    .select("organization_id,status,created_at")
    .eq("user_id", context.userId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (membershipsError) throw new Error(membershipsError.message);

  const firstMembership = (memberships as Record<string, unknown>[] | null)?.find(
    (membership) => membership.organization_id,
  );
  return str(firstMembership?.organization_id, ensuredOrganizationId);
}

async function loadEstimate(context: { supabase: unknown }, estimateId: string) {
  const { data, error } = await dynamicTable(context.supabase, "estimates")
    .select("*")
    .eq("id", estimateId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Estimate not found.");
  return data as Record<string, unknown>;
}

async function loadEstimateLines(context: { supabase: unknown }, estimateId: string) {
  const { data, error } = await dynamicTable(context.supabase, "estimate_line_items")
    .select("*")
    .eq("estimate_id", estimateId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}

async function recalculateEstimateTotalsInternal(
  context: { supabase: unknown },
  estimateId: string,
) {
  const estimate = await loadEstimate(context, estimateId);
  const lines = await loadEstimateLines(context, estimateId);
  const totals = calculateEstimateTotals(
    {
      region_multiplier: num(estimate.region_multiplier, 1),
      overhead_pct: Math.round(num(estimate.overhead_pct, 1000)),
      profit_pct: Math.round(num(estimate.profit_pct, 1000)),
      contingency_pct: Math.round(num(estimate.contingency_pct, 500)),
      bond_pct: Math.round(num(estimate.bond_pct, 150)),
      tax_pct: Math.round(num(estimate.tax_pct)),
      general_conditions_pct: Math.round(num(estimate.general_conditions_pct)),
      custom_markups: normalizeCustomMarkup(estimate.custom_markups),
    },
    lines.map((line) => ({
      quantity: num(line.quantity),
      material_unit_cost_cents: Math.round(num(line.material_unit_cost_cents)),
      labor_unit_cost_cents: Math.round(num(line.labor_unit_cost_cents)),
    })),
  );

  const { error } = await dynamicTable(context.supabase, "estimates")
    .update({
      subtotal_material_cents: totals.material_cents,
      subtotal_labor_cents: totals.labor_cents,
      subtotal_cents: totals.direct_cents,
      total_with_markups_cents: totals.total_cents,
    })
    .eq("id", estimateId);
  if (error) throw new Error(error.message);
  return totals;
}

async function ensureHarborPlanRoomDemo(
  context: { supabase: unknown; userId: string },
  estimate: Record<string, unknown>,
) {
  const estimateId = str(estimate.id);
  const estimateName = str(estimate.name).toLowerCase();
  if (!estimateName.includes("harbor residence")) return true;

  const existing = await dynamicTable(context.supabase, "estimate_plan_sets")
    .select("id")
    .eq("estimate_id", estimateId)
    .limit(1);
  if (isMissingPlanRoomSchemaError(existing.error)) return false;
  if (existing.error) throw new Error(existing.error.message);
  if (((existing.data ?? []) as unknown[]).length > 0) return true;

  // An archived Harbor demo project means the company opted out of the
  // demo: the sample plan set must not come back either. Schema is fine,
  // so report ready — there is just nothing to seed.
  const { data: orgProjects, error: orgProjectsError } = await dynamicTable(
    context.supabase,
    "projects",
  )
    .select("id,name,client,job_number,archived_at")
    .eq("organization_id", str(estimate.organization_id))
    .limit(100);
  if (orgProjectsError) throw new Error(orgProjectsError.message);
  const harborProject = findHarborDemoProject((orgProjects ?? []) as Record<string, unknown>[]);
  if (harborDemoSeedAction(harborProject) === "skip") return true;

  const { data: planSet, error: planSetError } = await dynamicTable(
    context.supabase,
    "estimate_plan_sets",
  )
    .insert({
      organization_id: str(estimate.organization_id),
      estimate_id: estimateId,
      created_by: context.userId,
      name: "Harbor Residence - Permit Set",
      description:
        "Sample plan room set with measured quantities linked back to the Harbor estimate.",
      source_file_name: "Harbor Residence sample drawings",
      file_path: "",
      file_mime_type: "sample/overwatch",
      file_size_bytes: 0,
      page_count: 3,
      sample_key: "harbor-residence",
      status: "current",
    })
    .select("*")
    .single();
  if (planSetError || !planSet) {
    if (isMissingPlanRoomSchemaError(planSetError)) return false;
    throw new Error(planSetError?.message ?? "Sample plan set did not save.");
  }

  const planSetId = str((planSet as Record<string, unknown>).id);
  const sheetsToInsert = [
    {
      sheet_number: "A1.1",
      sheet_name: "Foundation Plan",
      discipline: "Architecture",
      page_number: 1,
      sort_order: 1,
      scale_label: "Sample scale: 0.50 ft/px",
      scale_feet_per_pixel: 0.5,
      width_px: 960,
      height_px: 620,
    },
    {
      sheet_number: "A2.1",
      sheet_name: "Floor Plan",
      discipline: "Architecture",
      page_number: 2,
      sort_order: 2,
      scale_label: "Sample scale: 0.50 ft/px",
      scale_feet_per_pixel: 0.5,
      width_px: 960,
      height_px: 620,
    },
    {
      sheet_number: "A3.1",
      sheet_name: "Roof Plan",
      discipline: "Architecture",
      page_number: 3,
      sort_order: 3,
      scale_label: "Sample scale: 0.50 ft/px",
      scale_feet_per_pixel: 0.5,
      width_px: 960,
      height_px: 620,
    },
  ].map((sheet) => ({
    ...sheet,
    plan_set_id: planSetId,
    estimate_id: estimateId,
  }));

  const { data: sheets, error: sheetsError } = await dynamicTable(
    context.supabase,
    "estimate_plan_sheets",
  )
    .insert(sheetsToInsert)
    .select("*");
  if (isMissingPlanRoomSchemaError(sheetsError)) return false;
  if (sheetsError) throw new Error(sheetsError.message);

  const sheetRows = ((sheets ?? []) as Record<string, unknown>[]).sort(
    (a, b) => num(a.sort_order) - num(b.sort_order),
  );
  const foundationSheetId = str(sheetRows[0]?.id);
  const floorSheetId = str(sheetRows[1]?.id);
  const roofSheetId = str(sheetRows[2]?.id);
  const lines = await loadEstimateLines(context, estimateId);
  const lineByCostCode = new Map(lines.map((line) => [str(line.cost_code), str(line.id)]));

  const measurementRows = [
    {
      plan_sheet_id: foundationSheetId,
      estimate_line_item_id: lineByCostCode.get("03-110") ?? null,
      tool_type: "linear",
      label: "Continuous concrete footings",
      unit: "LF",
      quantity: 560,
      color: "#1b7a6e",
      geometry: {
        points: [
          { x: 0.18, y: 0.28 },
          { x: 0.78, y: 0.28 },
          { x: 0.78, y: 0.66 },
          { x: 0.18, y: 0.66 },
          { x: 0.18, y: 0.28 },
        ],
      },
    },
    {
      plan_sheet_id: foundationSheetId,
      estimate_line_item_id: lineByCostCode.get("03-300") ?? null,
      tool_type: "area",
      label: "Six-inch slab-on-grade package",
      unit: "SF",
      quantity: 6200,
      color: "#946a21",
      geometry: {
        points: [
          { x: 0.2, y: 0.3 },
          { x: 0.76, y: 0.3 },
          { x: 0.76, y: 0.64 },
          { x: 0.2, y: 0.64 },
        ],
      },
    },
    {
      plan_sheet_id: roofSheetId,
      estimate_line_item_id: lineByCostCode.get("07-310") ?? null,
      tool_type: "area",
      label: "Architectural shingle roofing system",
      unit: "SF",
      quantity: 6800,
      color: "#5d5f6f",
      geometry: {
        points: [
          { x: 0.16, y: 0.34 },
          { x: 0.48, y: 0.18 },
          { x: 0.82, y: 0.34 },
          { x: 0.7, y: 0.7 },
          { x: 0.28, y: 0.7 },
        ],
      },
    },
    {
      plan_sheet_id: floorSheetId,
      estimate_line_item_id: lineByCostCode.get("08-500") ?? null,
      tool_type: "count",
      label: "Window package with install labor",
      unit: "EA",
      quantity: 42,
      color: "#b35035",
      geometry: {
        points: [
          { x: 0.16, y: 0.32 },
          { x: 0.78, y: 0.32 },
          { x: 0.78, y: 0.6 },
          { x: 0.16, y: 0.6 },
        ],
      },
    },
  ]
    .filter((row) => row.plan_sheet_id)
    .map((row) => ({
      ...row,
      estimate_id: estimateId,
      library_item_id: null,
      created_by: context.userId,
      waste_pct: 0,
      notes: "Seeded Harbor Residence sample takeoff.",
      geometry: row.geometry as unknown as Json,
    }));

  if (measurementRows.length > 0) {
    const { error: measurementsError } = await dynamicTable(
      context.supabase,
      "estimate_takeoff_measurements",
    ).insert(measurementRows);
    if (isMissingPlanRoomSchemaError(measurementsError)) return false;
    if (measurementsError) throw new Error(measurementsError.message);
  }
  return true;
}

const createPlanSetInput = z.object({
  estimate_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(""),
  source_file_name: z.string().max(500).optional().default(""),
  file_path: z.string().max(1000).optional().default(""),
  file_mime_type: z.string().max(120).optional().default(""),
  file_size_bytes: z.number().int().min(0).max(100000000).optional().default(0),
  page_count: z.number().int().min(1).max(500).optional().default(1),
});

const planSheetPatchFields = {
  sheet_number: z.string().max(40).optional(),
  sheet_name: z.string().max(200).optional(),
  discipline: z.string().max(80).optional(),
  scale_label: z.string().max(120).optional(),
  scale_feet_per_pixel: z.number().min(0).max(100000).optional(),
  scale_source: z.enum(["unset", "calibrated", "stated"]).optional(),
  scale_verified_at: z.string().datetime({ offset: true }).nullable().optional(),
  thumbnail_path: z.string().max(1000).optional(),
  width_px: z.number().int().min(0).max(20000).optional(),
  height_px: z.number().int().min(0).max(20000).optional(),
};

const updatePlanSheetsInput = z.object({
  estimate_id: z.string().uuid(),
  sheets: z
    .array(
      z.object({
        sheet_id: z.string().uuid(),
        patch: z
          .object({
            sheet_number: z.string().max(40).optional(),
            sheet_name: z.string().max(200).optional(),
            discipline: z.string().max(80).optional(),
            thumbnail_path: z.string().max(1000).optional(),
          })
          .refine((patch) => Object.keys(patch).length > 0, "No sheet changes were provided."),
      }),
    )
    .min(1)
    .max(200),
});

const updatePlanSheetInput = z.object({
  sheet_id: z.string().uuid(),
  patch: z
    .object(planSheetPatchFields)
    .refine((patch) => Object.keys(patch).length > 0, "No sheet changes were provided."),
});

const applyScaleToSheetsInput = z.object({
  estimate_id: z.string().uuid(),
  sheets: z
    .array(
      z.object({
        sheet_id: z.string().uuid(),
        scale_feet_per_pixel: z.number().gt(0).max(100000),
        scale_label: z.string().max(120),
        width_px: z.number().int().min(0).max(20000),
        height_px: z.number().int().min(0).max(20000),
      }),
    )
    .min(1)
    .max(200),
});

const measurementInput = z.object({
  estimate_id: z.string().uuid(),
  plan_sheet_id: z.string().uuid(),
  estimate_line_item_id: z.string().uuid().nullable().optional(),
  library_item_id: z.string().uuid().nullable().optional(),
  tool_type: z.enum(["linear", "area", "count"]),
  label: z.string().min(1).max(240),
  unit: z.string().min(1).max(16),
  quantity: z.number().min(0).max(999999999),
  waste_pct: z.number().int().min(0).max(100000).optional().default(0),
  color: z.string().max(40).optional().default("#1b7a6e"),
  geometry: z.unknown().optional().default({}),
  notes: z.string().max(2000).optional().default(""),
});

const updateMeasurementInput = z.object({
  id: z.string().uuid(),
  patch: measurementInput
    .omit({ estimate_id: true, plan_sheet_id: true })
    .partial()
    .refine((patch) => Object.keys(patch).length > 0, "No takeoff changes were provided."),
});

const deleteMeasurementInput = z.object({
  id: z.string().uuid(),
});

const createLineForTakeoffsInput = z.object({
  estimate_id: z.string().uuid(),
  measurement_ids: z.array(z.string().uuid()).min(1).max(200),
  source: z.discriminatedUnion("type", [
    z.object({ type: z.literal("library"), library_item_id: z.string().uuid() }),
    z.object({
      type: z.literal("label"),
      description: z.string().min(1).max(500),
      unit: z.string().min(1).max(16),
    }),
  ]),
});

const syncTakeoffInput = z.object({
  estimate_id: z.string().uuid(),
  estimate_line_item_id: z.string().uuid(),
  // A confirmed sync overwrites a hand-typed quantity after conflict review.
  force: z.boolean().optional().default(false),
  // An explicit override syncs across a takeoff/line unit mismatch.
  force_unit: z.boolean().optional().default(false),
});

export const planRoomBucket = PLAN_ROOM_BUCKET;

export const getPlanRoom = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { estimate_id: string }) =>
    z.object({ estimate_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const estimate = await loadEstimate(context, data.estimate_id);
    const schemaReadyForDemo = await ensureHarborPlanRoomDemo(context, estimate);
    if (!schemaReadyForDemo) {
      return planRoomSchemaPending(
        "Plan Room tables are not available yet. Lovable may still be applying the backend migration or refreshing the Supabase schema cache.",
      );
    }

    const [setsResult, sheetsResult, measurementsResult] = await Promise.all([
      dynamicTable(context.supabase, "estimate_plan_sets")
        .select("*")
        .eq("estimate_id", data.estimate_id)
        .order("updated_at", { ascending: false }),
      dynamicTable(context.supabase, "estimate_plan_sheets")
        .select("*")
        .eq("estimate_id", data.estimate_id)
        .order("sort_order", { ascending: true }),
      dynamicTable(context.supabase, "estimate_takeoff_measurements")
        .select("*")
        .eq("estimate_id", data.estimate_id)
        .order("updated_at", { ascending: false }),
    ]);
    const schemaError = setsResult.error ?? sheetsResult.error ?? measurementsResult.error;
    if (isMissingPlanRoomSchemaError(schemaError)) {
      return planRoomSchemaPending(
        "Plan Room tables are not available yet. Lovable may still be applying the backend migration or refreshing the Supabase schema cache.",
      );
    }
    if (setsResult.error) throw new Error(setsResult.error.message);
    if (sheetsResult.error) throw new Error(sheetsResult.error.message);
    if (measurementsResult.error) throw new Error(measurementsResult.error.message);

    return {
      plan_sets: ((setsResult.data ?? []) as Record<string, unknown>[]).map(normalizePlanSet),
      sheets: ((sheetsResult.data ?? []) as Record<string, unknown>[]).map(normalizePlanSheet),
      measurements: ((measurementsResult.data ?? []) as Record<string, unknown>[]).map(
        normalizeTakeoffMeasurement,
      ),
      schema_ready: true,
      schema_message: "",
    };
  });

// Lightweight check for the estimate workspace's first-run launcher: how many
// real (non-sample) drawing sets this estimate has, without loading sheets or
// measurements and without triggering the Harbor demo seeding.
export const getEstimatePlanSetSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { estimate_id: string }) =>
    z.object({ estimate_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await loadEstimate(context, data.estimate_id);
    const result = await dynamicTable(context.supabase, "estimate_plan_sets")
      .select("id,file_mime_type")
      .eq("estimate_id", data.estimate_id);
    if (isMissingPlanRoomSchemaError(result.error)) {
      return { real_plan_set_count: 0, schema_ready: false };
    }
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data ?? []) as Record<string, unknown>[];
    return {
      real_plan_set_count: rows.filter((row) => str(row.file_mime_type) !== SAMPLE_PLAN_SET_MIME)
        .length,
      schema_ready: true,
    };
  });

export const createPlanSet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof createPlanSetInput>) => createPlanSetInput.parse(input))
  .handler(async ({ data, context }) => {
    const organizationId = await getOrganizationId(context);
    const estimate = await loadEstimate(context, data.estimate_id);
    if (str(estimate.organization_id) !== organizationId) {
      throw new Error("This estimate is not available in your company workspace.");
    }

    const { data: planSet, error: planSetError } = await dynamicTable(
      context.supabase,
      "estimate_plan_sets",
    )
      .insert({
        organization_id: organizationId,
        estimate_id: data.estimate_id,
        created_by: context.userId,
        name: clean(data.name, 200),
        description: clean(data.description, 2000),
        source_file_name: clean(data.source_file_name, 500),
        file_path: clean(data.file_path, 1000),
        file_mime_type: clean(data.file_mime_type, 120),
        file_size_bytes: data.file_size_bytes,
        page_count: data.page_count,
        sample_key: "",
        status: "current",
      })
      .select("*")
      .single();
    if (planSetError || !planSet) {
      throw new Error(planSetError?.message ?? "Drawing set did not save.");
    }

    const planSetId = str((planSet as Record<string, unknown>).id);
    const sheetRows = Array.from({ length: data.page_count }, (_, index) => ({
      plan_set_id: planSetId,
      estimate_id: data.estimate_id,
      // PG = page. A bare P prefix reads as plumbing to every contractor.
      sheet_number: `PG-${String(index + 1).padStart(3, "0")}`,
      sheet_name: index === 0 ? clean(data.name, 180) : `Page ${index + 1}`,
      discipline: "",
      page_number: index + 1,
      sort_order: index + 1,
      scale_label: "",
      scale_feet_per_pixel: 0,
      width_px: 0,
      height_px: 0,
    }));

    const { data: sheets, error: sheetsError } = await dynamicTable(
      context.supabase,
      "estimate_plan_sheets",
    )
      .insert(sheetRows)
      .select("*");
    if (sheetsError) throw new Error(sheetsError.message);

    return {
      plan_set: normalizePlanSet(planSet as Record<string, unknown>),
      sheets: ((sheets ?? []) as Record<string, unknown>[]).map(normalizePlanSheet),
    };
  });

function isMissingSheetColumn(error: DynamicSupabaseError | null | undefined) {
  const message = error?.message ?? "";
  return Boolean(
    error &&
    (error.code === "PGRST204" ||
      error.code === "42703" ||
      (/scale_source|scale_verified_at|thumbnail_path/i.test(message) &&
        /schema cache|column|could not find|does not exist/i.test(message))),
  );
}

async function updatePlanSheetRow(
  context: { supabase: unknown },
  sheetId: string,
  patch: Record<string, unknown>,
) {
  // Whenever the sheet number changes, the discipline follows its prefix
  // (A- architectural, S- structural...) unless the caller set it explicitly.
  if (typeof patch.sheet_number === "string" && patch.discipline === undefined) {
    patch.discipline = disciplineForSheetNumber(patch.sheet_number);
  }
  let result = await dynamicTable(context.supabase, "estimate_plan_sheets")
    .update(patch)
    .eq("id", sheetId)
    .select("*")
    .single();
  if (
    result.error &&
    ("scale_source" in patch || "scale_verified_at" in patch || "thumbnail_path" in patch) &&
    isMissingSheetColumn(result.error)
  ) {
    // Pre-migration fallback: save what the schema can hold; the new columns
    // land once the migration applies.
    const {
      scale_source: _scaleSource,
      scale_verified_at: _scaleVerifiedAt,
      thumbnail_path: _thumbnailPath,
      ...legacyPatch
    } = patch;
    if (Object.keys(legacyPatch).length === 0) {
      result = await dynamicTable(context.supabase, "estimate_plan_sheets")
        .select("*")
        .eq("id", sheetId)
        .single();
    } else {
      result = await dynamicTable(context.supabase, "estimate_plan_sheets")
        .update(legacyPatch)
        .eq("id", sheetId)
        .select("*")
        .single();
    }
  }
  if (result.error || !result.data) {
    throw new Error(result.error?.message ?? "Sheet did not update.");
  }
  return normalizePlanSheet(result.data as Record<string, unknown>);
}

export const updatePlanSheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof updatePlanSheetInput>) =>
    updatePlanSheetInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = { ...data.patch };
    for (const key of ["sheet_number", "sheet_name", "discipline", "scale_label"]) {
      if (typeof patch[key] === "string") patch[key] = clean(String(patch[key]), 200);
    }
    const sheet = await updatePlanSheetRow(context, data.sheet_id, patch);
    return { sheet };
  });

export const updatePlanSheets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof updatePlanSheetsInput>) =>
    updatePlanSheetsInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    await loadEstimate(context, data.estimate_id);
    const updated: PlanSheetRow[] = [];
    for (const entry of data.sheets) {
      const patch: Record<string, unknown> = { ...entry.patch };
      for (const key of ["sheet_number", "sheet_name", "discipline"]) {
        if (typeof patch[key] === "string") patch[key] = clean(String(patch[key]), 200);
      }
      updated.push(await updatePlanSheetRow(context, entry.sheet_id, patch));
    }
    return { sheets: updated };
  });

export const applyScaleToSheets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof applyScaleToSheetsInput>) =>
    applyScaleToSheetsInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    await loadEstimate(context, data.estimate_id);
    const updated: PlanSheetRow[] = [];
    for (const entry of data.sheets) {
      updated.push(
        await updatePlanSheetRow(context, entry.sheet_id, {
          scale_feet_per_pixel: entry.scale_feet_per_pixel,
          scale_label: clean(entry.scale_label, 200),
          width_px: entry.width_px,
          height_px: entry.height_px,
          // Bulk apply always comes from a stated-scale preset, which stays
          // untrusted until the user verifies it against a known dimension.
          scale_source: "stated",
          scale_verified_at: null,
        }),
      );
    }
    return { sheets: updated };
  });

export const createTakeoffMeasurement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof measurementInput>) => measurementInput.parse(input))
  .handler(async ({ data, context }) => {
    await loadEstimate(context, data.estimate_id);
    const { data: row, error } = await dynamicTable(
      context.supabase,
      "estimate_takeoff_measurements",
    )
      .insert({
        estimate_id: data.estimate_id,
        plan_sheet_id: data.plan_sheet_id,
        estimate_line_item_id: data.estimate_line_item_id ?? null,
        library_item_id: data.library_item_id ?? null,
        created_by: context.userId,
        tool_type: data.tool_type,
        label: clean(data.label, 240),
        unit: clean(data.unit.toUpperCase(), 16),
        quantity: data.quantity,
        waste_pct: data.waste_pct,
        color: clean(data.color, 40) || "#1b7a6e",
        geometry: data.geometry as Json,
        notes: clean(data.notes, 2000),
      })
      .select("*")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Takeoff did not save.");

    if (data.estimate_line_item_id) {
      await syncTakeoffQuantityToLine(context, data.estimate_id, data.estimate_line_item_id);
    }
    return { measurement: normalizeTakeoffMeasurement(row as Record<string, unknown>) };
  });

export const updateTakeoffMeasurement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof updateMeasurementInput>) =>
    updateMeasurementInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const current = await dynamicTable(context.supabase, "estimate_takeoff_measurements")
      .select("estimate_id,estimate_line_item_id")
      .eq("id", data.id)
      .single();
    if (current.error || !current.data) {
      throw new Error(current.error?.message ?? "Takeoff was not found.");
    }
    const estimateId = str((current.data as Record<string, unknown>).estimate_id);
    const previousLineId = (current.data as Record<string, unknown>).estimate_line_item_id as
      string | null;
    const patch: Record<string, unknown> = { ...data.patch };
    if (typeof patch.label === "string") patch.label = clean(patch.label, 240);
    if (typeof patch.unit === "string") patch.unit = clean(patch.unit.toUpperCase(), 16);
    if (typeof patch.color === "string") patch.color = clean(patch.color, 40);
    if (typeof patch.notes === "string") patch.notes = clean(patch.notes, 2000);
    if (patch.geometry != null) patch.geometry = patch.geometry as Json;

    const { data: row, error } = await dynamicTable(
      context.supabase,
      "estimate_takeoff_measurements",
    )
      .update(patch)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Takeoff did not update.");

    const measurement = normalizeTakeoffMeasurement(row as Record<string, unknown>);
    const nextLineId = measurement.estimate_line_item_id;
    if (previousLineId && previousLineId !== nextLineId) {
      await syncTakeoffQuantityToLine(context, estimateId, previousLineId);
    }
    if (nextLineId) {
      await syncTakeoffQuantityToLine(context, estimateId, nextLineId);
    }
    return { measurement };
  });

export const deleteTakeoffMeasurement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof deleteMeasurementInput>) =>
    deleteMeasurementInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const current = await dynamicTable(context.supabase, "estimate_takeoff_measurements")
      .select("estimate_id,estimate_line_item_id")
      .eq("id", data.id)
      .single();
    if (current.error || !current.data) {
      throw new Error(current.error?.message ?? "Takeoff was not found.");
    }
    const estimateId = str((current.data as Record<string, unknown>).estimate_id);
    const lineId = (current.data as Record<string, unknown>).estimate_line_item_id as string | null;
    const { error } = await dynamicTable(context.supabase, "estimate_takeoff_measurements")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    if (lineId) await syncTakeoffQuantityToLine(context, estimateId, lineId);
    return { ok: true };
  });

function isMissingQuantityProvenanceColumn(error: DynamicSupabaseError | null | undefined) {
  const message = error?.message ?? "";
  return Boolean(
    error &&
    (error.code === "PGRST204" ||
      error.code === "42703" ||
      (/quantity_source|takeoff_quantity|takeoff_synced_at|takeoff_unit/i.test(message) &&
        /schema cache|column|could not find|does not exist/i.test(message))),
  );
}

async function syncTakeoffQuantityToLine(
  context: { supabase: unknown },
  estimateId: string,
  lineItemId: string,
  options: { force?: boolean; forceUnit?: boolean } = {},
) {
  let lineResult = await dynamicTable(context.supabase, "estimate_line_items")
    .select("id,estimate_id,unit,quantity,quantity_source,takeoff_quantity")
    .eq("id", lineItemId)
    .eq("estimate_id", estimateId)
    .single();
  // Pre-migration fallback: without the provenance columns the sync behaves
  // like it always has (last write wins).
  let provenanceReady = true;
  if (lineResult.error && isMissingQuantityProvenanceColumn(lineResult.error)) {
    provenanceReady = false;
    lineResult = await dynamicTable(context.supabase, "estimate_line_items")
      .select("id,estimate_id,unit,quantity")
      .eq("id", lineItemId)
      .eq("estimate_id", estimateId)
      .single();
  }
  if (lineResult.error || !lineResult.data) {
    throw new Error(lineResult.error?.message ?? "Estimate line was not found.");
  }

  const measurementsResult = await dynamicTable(context.supabase, "estimate_takeoff_measurements")
    .select("quantity,waste_pct,unit")
    .eq("estimate_id", estimateId)
    .eq("estimate_line_item_id", lineItemId);
  if (measurementsResult.error) throw new Error(measurementsResult.error.message);

  const measurements = (measurementsResult.data ?? []) as Record<string, unknown>[];
  // Waste-applied rollup: each measurement contributes quantity x
  // (1 + waste_pct / 100). Rounded to the column's 4 decimal places.
  const rollup = measurements.reduce(
    (sum, row) => sum + num(row.quantity) * (1 + num(row.waste_pct) / 100),
    0,
  );
  const quantity = Math.round(rollup * 10000) / 10000;

  const line = lineResult.data as Record<string, unknown>;
  const lineUnit = str(line.unit);
  const currentQuantity = num(line.quantity);
  const lastTakeoffQuantity = line.takeoff_quantity == null ? null : num(line.takeoff_quantity);
  const quantitySource = str(line.quantity_source, "manual");

  // Unit guard: unit-blind sync mixes dimensions silently (a 4.83 LF takeoff
  // must not price a per-SF row as 4.83 SF). Comparison is by alias family;
  // an explicit force_unit override syncs anyway and is recorded via the
  // takeoff_unit column disagreeing with the line unit.
  const measurementUnits = measurements
    .map((row) => str(row.unit))
    .filter((unit) => unit.trim().length > 0);
  const takeoffUnit = normalizeTakeoffUnit(measurementUnits[0] ?? "");
  const mismatchedUnit = measurementUnits.find((unit) => !takeoffUnitsCompatible(unit, lineUnit));
  if (mismatchedUnit != null && !options.forceUnit) {
    return {
      conflict: false as const,
      unit_conflict: true as const,
      quantity: currentQuantity,
      takeoff_quantity: quantity,
      takeoff_unit: normalizeTakeoffUnit(mismatchedUnit),
      line_unit: lineUnit,
      measurement_count: measurements.length,
    };
  }

  // Anti-clobber: a hand-typed quantity that no longer matches the last
  // synced takeoff number only gets replaced after the user confirms (force).
  // A line that was never synced counts as hand-typed when nonzero.
  const manualQuantityDiffers =
    lastTakeoffQuantity == null ? currentQuantity > 0 : currentQuantity !== lastTakeoffQuantity;
  if (
    provenanceReady &&
    !options.force &&
    quantitySource === "manual" &&
    currentQuantity !== quantity &&
    manualQuantityDiffers
  ) {
    return {
      conflict: true as const,
      unit_conflict: false as const,
      quantity: currentQuantity,
      takeoff_quantity: quantity,
      takeoff_unit: takeoffUnit,
      line_unit: lineUnit,
      measurement_count: measurements.length,
    };
  }

  // Provenance patches degrade in steps: full metadata, then Phase 1
  // provenance without takeoff_unit, then the legacy quantity-only write.
  const updatePatches: Record<string, unknown>[] = provenanceReady
    ? [
        {
          takeoff_quantity: quantity,
          takeoff_synced_at: new Date().toISOString(),
          takeoff_unit: takeoffUnit || null,
          quantity_source: "takeoff",
          quantity,
        },
        {
          takeoff_quantity: quantity,
          takeoff_synced_at: new Date().toISOString(),
          quantity_source: "takeoff",
          quantity,
        },
        { quantity },
      ]
    : [{ quantity }];
  let updateError: DynamicSupabaseError | null = null;
  for (const patch of updatePatches) {
    const result = await dynamicTable(context.supabase, "estimate_line_items")
      .update(patch)
      .eq("id", lineItemId)
      .eq("estimate_id", estimateId);
    updateError = result.error;
    if (!updateError || !isMissingQuantityProvenanceColumn(updateError)) break;
  }
  if (updateError) throw new Error(updateError.message);

  await recalculateEstimateTotalsInternal(context, estimateId);
  return {
    conflict: false as const,
    unit_conflict: false as const,
    quantity,
    takeoff_quantity: quantity,
    takeoff_unit: takeoffUnit,
    line_unit: lineUnit,
    measurement_count: measurements.length,
  };
}

// Link-or-create: a takeoff can become an estimate row in one gesture.
// Library source prices the row through the item's labor basis; label source
// creates a $0 "needs pricing" row so the contractor labels now, prices later.
// The caller runs the normal sync afterwards, so the Phase 1/2 waste, unit,
// and anti-clobber guards all apply unchanged.
export const createLineItemForTakeoffs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof createLineForTakeoffsInput>) =>
    createLineForTakeoffsInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    await loadEstimate(context, data.estimate_id);

    let insertRow: Record<string, unknown>;
    let libraryItemId: string | null = null;
    if (data.source.type === "library") {
      const itemResult = await dynamicTable(context.supabase, "cost_library_items")
        .select("*")
        .eq("id", data.source.library_item_id)
        .single();
      if (itemResult.error || !itemResult.data) {
        throw new Error(itemResult.error?.message ?? "Cost library item was not found.");
      }
      const item = itemResult.data as Record<string, unknown>;
      const basis = str(item.labor_basis);
      const resolved = resolveLibraryUnitCosts({
        description: str(item.description),
        material_cost_cents: Math.round(num(item.material_cost_cents)),
        labor_cost_cents: Math.round(num(item.labor_cost_cents)),
        labor_basis: (basis === "per_hour" || basis === "installed"
          ? basis
          : "per_unit") as CostLibraryLaborBasis,
        crew_size: item.crew_size == null ? null : num(item.crew_size),
        productivity_per_hour:
          item.productivity_per_hour == null ? null : num(item.productivity_per_hour),
      });
      if (!resolved.ok) throw new Error(resolved.message);
      libraryItemId = str(item.id);
      insertRow = {
        estimate_id: data.estimate_id,
        csi_division: str(item.csi_division),
        cost_code: str(item.csi_code),
        description: str(item.description),
        unit: str(item.unit).toUpperCase(),
        quantity: 0,
        material_unit_cost_cents: resolved.material_cost_cents,
        labor_unit_cost_cents: resolved.labor_cost_cents,
        library_item_id: libraryItemId,
        notes: "Created from a Plan Room takeoff.",
      };
    } else {
      insertRow = {
        estimate_id: data.estimate_id,
        description: clean(data.source.description, 500),
        unit: clean(data.source.unit.toUpperCase(), 16),
        quantity: 0,
        material_unit_cost_cents: 0,
        labor_unit_cost_cents: 0,
        notes: "Created from a Plan Room takeoff. Needs pricing.",
      };
    }

    const orderResult = await dynamicTable(context.supabase, "estimate_line_items")
      .select("sort_order")
      .eq("estimate_id", data.estimate_id)
      .order("sort_order", { ascending: false })
      .limit(1);
    if (orderResult.error) throw new Error(orderResult.error.message);
    const maxOrder = ((orderResult.data ?? []) as Record<string, unknown>[]).reduce(
      (max, row) => Math.max(max, Math.round(num(row.sort_order))),
      0,
    );

    const lineResult = await dynamicTable(context.supabase, "estimate_line_items")
      .insert({ ...insertRow, sort_order: maxOrder + 1 })
      .select("id")
      .single();
    if (lineResult.error || !lineResult.data) {
      throw new Error(lineResult.error?.message ?? "Estimate row did not save.");
    }
    const lineId = str((lineResult.data as Record<string, unknown>).id);

    const linkResult = await dynamicTable(context.supabase, "estimate_takeoff_measurements")
      .update({
        estimate_line_item_id: lineId,
        ...(libraryItemId ? { library_item_id: libraryItemId } : {}),
      })
      .eq("estimate_id", data.estimate_id)
      .in("id", data.measurement_ids);
    if (linkResult.error) throw new Error(linkResult.error.message);

    return { line_item_id: lineId };
  });

export const syncTakeoffToEstimateLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof syncTakeoffInput>) => syncTakeoffInput.parse(input))
  .handler(async ({ data, context }) => ({
    sync: await syncTakeoffQuantityToLine(context, data.estimate_id, data.estimate_line_item_id, {
      force: data.force,
      forceUnit: data.force_unit,
    }),
  }));
