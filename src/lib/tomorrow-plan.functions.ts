import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type DynamicError = { code?: string; message: string } | null;
type DynamicResult<T = unknown> = { data: T | null; error: DynamicError };
type DynamicQuery = PromiseLike<DynamicResult> & {
  select(columns?: string): DynamicQuery;
  insert(values: unknown): DynamicQuery;
  update(values: unknown): DynamicQuery;
  delete(): DynamicQuery;
  eq(column: string, value: unknown): DynamicQuery;
  order(column: string, options?: { ascending?: boolean }): DynamicQuery;
  single(): Promise<DynamicResult<Record<string, unknown>>>;
};
type DynamicClient = { from(relation: string): DynamicQuery };

const table = (supabase: unknown) => (supabase as DynamicClient).from("tomorrow_plan_items");
const num = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const str = (value: unknown) => (typeof value === "string" ? value : "");
const nullableStr = (value: unknown) => (typeof value === "string" && value ? value : null);
const bool = (value: unknown) => value === true;

const isMissingTable = (error: DynamicError) =>
  Boolean(
    error &&
    (error.code === "PGRST205" ||
      /tomorrow_plan_items|schema cache|does not exist|relation/i.test(error.message)),
  );

export type TomorrowPlanStatus = "ready" | "at_risk" | "blocked";
export type TomorrowPlanConfirmation = "planned" | "confirmed" | "cancelled";

export interface TomorrowPlanItemRow {
  id: string;
  project_id: string;
  plan_date: string;
  schedule_activity_id: string | null;
  cost_bucket_id: string | null;
  subcontractor_id: string | null;
  activity: string;
  work_area: string;
  performer_type: "self_perform" | "subcontractor" | "vendor" | "other";
  performer_name: string;
  crew_count: number;
  people_per_crew: number;
  hours_per_person: number;
  planned_quantity: number;
  unit: string;
  target_rate: number | null;
  materials: string;
  materials_ready: boolean;
  equipment: string;
  equipment_ready: boolean;
  information: string;
  information_ready: boolean;
  inspection: string;
  inspection_ready: boolean;
  work_area_ready: boolean;
  status: TomorrowPlanStatus;
  constraint_summary: string;
  constraint_owner: string;
  confirmation_status: TomorrowPlanConfirmation;
  confirmed_by: string | null;
  confirmed_at: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

const normalize = (row: Record<string, unknown>): TomorrowPlanItemRow => ({
  id: str(row.id),
  project_id: str(row.project_id),
  plan_date: str(row.plan_date),
  schedule_activity_id: nullableStr(row.schedule_activity_id),
  cost_bucket_id: nullableStr(row.cost_bucket_id),
  subcontractor_id: nullableStr(row.subcontractor_id),
  activity: str(row.activity),
  work_area: str(row.work_area),
  performer_type:
    (str(row.performer_type) as TomorrowPlanItemRow["performer_type"]) || "subcontractor",
  performer_name: str(row.performer_name),
  crew_count: num(row.crew_count),
  people_per_crew: num(row.people_per_crew),
  hours_per_person: num(row.hours_per_person),
  planned_quantity: num(row.planned_quantity),
  unit: str(row.unit),
  target_rate: row.target_rate == null ? null : num(row.target_rate),
  materials: str(row.materials),
  materials_ready: bool(row.materials_ready),
  equipment: str(row.equipment),
  equipment_ready: bool(row.equipment_ready),
  information: str(row.information),
  information_ready: bool(row.information_ready),
  inspection: str(row.inspection),
  inspection_ready: bool(row.inspection_ready),
  work_area_ready: bool(row.work_area_ready),
  status: (str(row.status) as TomorrowPlanStatus) || "at_risk",
  constraint_summary: str(row.constraint_summary),
  constraint_owner: str(row.constraint_owner),
  confirmation_status: (str(row.confirmation_status) as TomorrowPlanConfirmation) || "planned",
  confirmed_by: nullableStr(row.confirmed_by),
  confirmed_at: nullableStr(row.confirmed_at),
  notes: str(row.notes),
  created_at: str(row.created_at),
  updated_at: str(row.updated_at),
});

const uuidOrNull = z.string().uuid().nullable().default(null);
const itemFields = z.object({
  plan_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  schedule_activity_id: uuidOrNull,
  cost_bucket_id: uuidOrNull,
  subcontractor_id: uuidOrNull,
  activity: z.string().trim().min(1, "Name the work planned for tomorrow.").max(500),
  work_area: z.string().trim().max(300).default(""),
  performer_type: z.enum(["self_perform", "subcontractor", "vendor", "other"]),
  performer_name: z.string().trim().max(300).default(""),
  crew_count: z.number().min(0).max(1000).default(0),
  people_per_crew: z.number().min(0).max(1000).default(0),
  hours_per_person: z.number().min(0).max(24).default(0),
  planned_quantity: z.number().min(0).max(1_000_000_000).default(0),
  unit: z.string().trim().max(60).default(""),
  target_rate: z.number().min(0).max(1_000_000_000).nullable().default(null),
  materials: z.string().trim().max(1000).default(""),
  materials_ready: z.boolean().default(false),
  equipment: z.string().trim().max(1000).default(""),
  equipment_ready: z.boolean().default(false),
  information: z.string().trim().max(1000).default(""),
  information_ready: z.boolean().default(false),
  inspection: z.string().trim().max(1000).default(""),
  inspection_ready: z.boolean().default(false),
  work_area_ready: z.boolean().default(false),
  status: z.enum(["ready", "at_risk", "blocked"]),
  constraint_summary: z.string().trim().max(2000).default(""),
  constraint_owner: z.string().trim().max(300).default(""),
  confirmation_status: z.enum(["planned", "confirmed", "cancelled"]),
  notes: z.string().trim().max(4000).default(""),
});

export const listTomorrowPlanItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await table(context.supabase)
      .select("*")
      .eq("project_id", data.projectId)
      .order("plan_date", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) {
      if (isMissingTable(error)) return { ready: false as const, items: [] };
      throw new Error(error.message);
    }
    return {
      ready: true as const,
      items: ((rows ?? []) as Record<string, unknown>[]).map(normalize),
    };
  });

export const saveTomorrowPlanItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string; id?: string; item: z.input<typeof itemFields> }) =>
    z
      .object({ projectId: z.string().uuid(), id: z.string().uuid().optional(), item: itemFields })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString();
    const confirmation =
      data.item.confirmation_status === "confirmed"
        ? { confirmed_by: context.userId, confirmed_at: now }
        : { confirmed_by: null, confirmed_at: null };
    const payload = { ...data.item, ...confirmation, updated_at: now };

    const result = data.id
      ? await table(context.supabase)
          .update(payload)
          .eq("id", data.id)
          .eq("project_id", data.projectId)
          .select("*")
          .single()
      : await table(context.supabase)
          .insert({
            ...payload,
            project_id: data.projectId,
            created_by: context.userId,
          })
          .select("*")
          .single();
    if (result.error) {
      if (isMissingTable(result.error)) {
        throw new Error("Tomorrow Plan is waiting for the database update to be published.");
      }
      throw new Error(result.error.message);
    }
    return normalize(result.data ?? {});
  });

export const deleteTomorrowPlanItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string; id: string }) =>
    z.object({ projectId: z.string().uuid(), id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await table(context.supabase)
      .delete()
      .eq("id", data.id)
      .eq("project_id", data.projectId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
