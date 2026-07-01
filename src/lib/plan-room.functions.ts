import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { calculateEstimateTotals, type EstimateCustomMarkup } from "@/lib/estimates.functions";
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

const updatePlanSheetInput = z.object({
  sheet_id: z.string().uuid(),
  patch: z
    .object({
      sheet_number: z.string().max(40).optional(),
      sheet_name: z.string().max(200).optional(),
      discipline: z.string().max(80).optional(),
      scale_label: z.string().max(120).optional(),
      scale_feet_per_pixel: z.number().min(0).max(100000).optional(),
      width_px: z.number().int().min(0).max(20000).optional(),
      height_px: z.number().int().min(0).max(20000).optional(),
    })
    .refine((patch) => Object.keys(patch).length > 0, "No sheet changes were provided."),
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

const syncTakeoffInput = z.object({
  estimate_id: z.string().uuid(),
  estimate_line_item_id: z.string().uuid(),
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
      sheet_number: `P-${String(index + 1).padStart(3, "0")}`,
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
    const { data: row, error } = await dynamicTable(context.supabase, "estimate_plan_sheets")
      .update(patch)
      .eq("id", data.sheet_id)
      .select("*")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Sheet did not update.");
    return { sheet: normalizePlanSheet(row as Record<string, unknown>) };
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

async function syncTakeoffQuantityToLine(
  context: { supabase: unknown },
  estimateId: string,
  lineItemId: string,
) {
  const [lineResult, measurementsResult] = await Promise.all([
    dynamicTable(context.supabase, "estimate_line_items")
      .select("id,estimate_id")
      .eq("id", lineItemId)
      .eq("estimate_id", estimateId)
      .single(),
    dynamicTable(context.supabase, "estimate_takeoff_measurements")
      .select("quantity")
      .eq("estimate_id", estimateId)
      .eq("estimate_line_item_id", lineItemId),
  ]);
  if (lineResult.error || !lineResult.data) {
    throw new Error(lineResult.error?.message ?? "Estimate line was not found.");
  }
  if (measurementsResult.error) throw new Error(measurementsResult.error.message);

  const quantity = ((measurementsResult.data ?? []) as Record<string, unknown>[]).reduce(
    (sum, row) => sum + num(row.quantity),
    0,
  );
  const { error } = await dynamicTable(context.supabase, "estimate_line_items")
    .update({ quantity })
    .eq("id", lineItemId)
    .eq("estimate_id", estimateId);
  if (error) throw new Error(error.message);
  await recalculateEstimateTotalsInternal(context, estimateId);
  return {
    quantity,
    measurement_count: ((measurementsResult.data ?? []) as unknown[]).length,
  };
}

export const syncTakeoffToEstimateLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof syncTakeoffInput>) => syncTakeoffInput.parse(input))
  .handler(async ({ data, context }) => ({
    sync: await syncTakeoffQuantityToLine(context, data.estimate_id, data.estimate_line_item_id),
  }));
