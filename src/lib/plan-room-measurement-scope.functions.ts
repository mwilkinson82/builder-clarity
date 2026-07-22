import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { parseMeasurementVisualGuide } from "@/lib/plan-room-measurement-assistant";
import type {
  MeasurementScopeDecisionStatus,
  MeasurementScopeQueueItem,
  MeasurementScopeStatus,
} from "@/lib/plan-room-measurement-scope";

type DynamicError = { code?: string; message: string };
type DynamicResult<T = unknown> = { data: T | null; error: DynamicError | null };
type DynamicQuery = PromiseLike<DynamicResult> & {
  select(columns?: string): DynamicQuery;
  insert(values: unknown): DynamicQuery;
  update(values: unknown): DynamicQuery;
  eq(column: string, value: unknown): DynamicQuery;
  in(column: string, values: readonly string[]): Promise<DynamicResult<unknown[]>>;
  order(column: string, options?: { ascending?: boolean }): DynamicQuery;
  limit(count: number): DynamicQuery;
  single(): Promise<DynamicResult>;
};
type DynamicClient = {
  from(relation: string): DynamicQuery;
  rpc(name: string, args: Record<string, unknown>): Promise<DynamicResult<unknown[]>>;
};

const dynamicClient = (supabase: unknown) => supabase as DynamicClient;
const str = (value: unknown) => (value == null ? "" : String(value));

function isScopeQueueSchemaPending(error: DynamicError | null | undefined) {
  const message = error?.message?.toLowerCase() ?? "";
  return Boolean(
    error &&
    (error.code === "42P01" ||
      error.code === "PGRST202" ||
      error.code === "PGRST205" ||
      message.includes("estimate_measurement_scope_items") ||
      message.includes("record_estimate_measurement_scope_decision") ||
      message.includes("complete_estimate_measurement_scope_item")),
  );
}

function normalizedAnchor(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const x = Number(raw.x);
  const y = Number(raw.y);
  const width = Number(raw.width);
  const height = Number(raw.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
    width: Math.min(1, Math.max(0.002, width)),
    height: Math.min(1, Math.max(0.002, height)),
  };
}

function normalizeScopeItem(
  row: Record<string, unknown>,
  profileNames = new Map<string, string>(),
): MeasurementScopeQueueItem {
  const decisionBy = row.decision_by == null ? null : str(row.decision_by);
  const completedBy = row.completed_by == null ? null : str(row.completed_by);
  const toolType = row.tool_type === "area" ? "area" : "linear";
  const guide = parseMeasurementVisualGuide(row.guide_geometry, toolType);
  return {
    id: str(row.id),
    estimate_id: str(row.estimate_id),
    plan_sheet_id: str(row.plan_sheet_id),
    ai_operation_id: row.ai_operation_id == null ? null : str(row.ai_operation_id),
    suggestion_key: str(row.suggestion_key),
    scope_key: str(row.scope_key),
    label: str(row.label),
    tool_type: toolType,
    unit: row.unit === "SF" ? "SF" : "LF",
    source_line: str(row.source_line),
    source_excerpt: str(row.source_excerpt),
    source_anchor: normalizedAnchor(row.source_anchor),
    guide,
    guide_source: guide && row.guide_source === "ai_visual_hint" ? "ai_visual_hint" : null,
    status: (["accepted", "rejected", "deferred", "completed"].includes(str(row.status))
      ? str(row.status)
      : "deferred") as MeasurementScopeStatus,
    decision_by: decisionBy,
    decision_by_name: (decisionBy && profileNames.get(decisionBy)) || "Team member",
    decision_at: str(row.decision_at),
    takeoff_measurement_id:
      row.takeoff_measurement_id == null ? null : str(row.takeoff_measurement_id),
    estimate_line_item_id:
      row.estimate_line_item_id == null ? null : str(row.estimate_line_item_id),
    library_item_id: row.library_item_id == null ? null : str(row.library_item_id),
    completed_by: completedBy,
    completed_by_name: (completedBy && profileNames.get(completedBy)) || "Team member",
    completed_at: row.completed_at == null ? null : str(row.completed_at),
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
  };
}

const anchorInput = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
  })
  .nullable();

const guidePointInput = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

const guideGeometryInput = z
  .object({
    kind: z.enum(["linear_route", "area_region"]),
    points: z.array(guidePointInput).min(2).max(16),
    source: z.literal("ai_visual_hint"),
  })
  .nullable();

const scopeDecisionInput = z.object({
  estimate_id: z.string().uuid(),
  plan_sheet_id: z.string().uuid(),
  ai_operation_id: z.string().uuid().nullable(),
  suggestion_key: z.string().min(1).max(160),
  scope_key: z.string().min(1).max(180),
  label: z.string().min(1).max(120),
  tool_type: z.enum(["linear", "area"]),
  unit: z.enum(["LF", "SF"]),
  source_line: z.string().min(1).max(12),
  source_excerpt: z.string().min(3).max(260),
  source_anchor: anchorInput,
  guide_geometry: guideGeometryInput,
  status: z.enum(["accepted", "rejected", "deferred"]),
});

export const getMeasurementScopeQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { estimate_id: string }) =>
    z.object({ estimate_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const client = dynamicClient(context.supabase);
    const result = await client
      .from("estimate_measurement_scope_items")
      .select("*")
      .eq("estimate_id", data.estimate_id)
      .order("decision_at", { ascending: false })
      .limit(500);
    if (isScopeQueueSchemaPending(result.error)) return { items: [], ready: false };
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data ?? []) as Record<string, unknown>[];
    const reviewerIds = [
      ...new Set(
        rows
          .flatMap((row) => [row.decision_by, row.completed_by])
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
    return { items: rows.map((row) => normalizeScopeItem(row, profileNames)), ready: true };
  });

export const saveMeasurementScopeDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof scopeDecisionInput>) => scopeDecisionInput.parse(input))
  .handler(async ({ data, context }) => {
    const result = await dynamicClient(context.supabase).rpc(
      "record_estimate_measurement_scope_decision",
      {
        p_estimate_id: data.estimate_id,
        p_plan_sheet_id: data.plan_sheet_id,
        p_ai_operation_id: data.ai_operation_id,
        p_suggestion_key: data.suggestion_key,
        p_scope_key: data.scope_key,
        p_label: data.label,
        p_tool_type: data.tool_type,
        p_unit: data.unit,
        p_source_line: data.source_line,
        p_source_excerpt: data.source_excerpt,
        p_source_anchor: (data.source_anchor ?? {}) as Json,
        p_guide_geometry: (data.guide_geometry ?? {}) as Json,
        p_status: data.status satisfies MeasurementScopeDecisionStatus,
      },
    );
    if (isScopeQueueSchemaPending(result.error)) {
      throw new Error("The measurement scope queue isn't available yet.");
    }
    if (result.error) throw new Error(result.error.message);
    const row = ((result.data ?? [])[0] ?? null) as Record<string, unknown> | null;
    if (!row) throw new Error("The measurement scope decision did not save.");
    return { item: normalizeScopeItem(row) };
  });

const completeScopeInput = z.object({
  scope_item_id: z.string().uuid(),
  takeoff_measurement_id: z.string().uuid(),
});

export const completeMeasurementScopeItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof completeScopeInput>) => completeScopeInput.parse(input))
  .handler(async ({ data, context }) => {
    const result = await dynamicClient(context.supabase).rpc(
      "complete_estimate_measurement_scope_item",
      {
        p_scope_item_id: data.scope_item_id,
        p_takeoff_measurement_id: data.takeoff_measurement_id,
      },
    );
    if (isScopeQueueSchemaPending(result.error)) {
      throw new Error("The measurement scope queue isn't available yet.");
    }
    if (result.error) throw new Error(result.error.message);
    const row = ((result.data ?? [])[0] ?? null) as Record<string, unknown> | null;
    if (!row) throw new Error("The completed scope did not save.");
    return { item: normalizeScopeItem(row) };
  });
