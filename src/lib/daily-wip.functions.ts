// Workspace B — daily WIP entry server functions (BILLINGDESIGN P2). CRUD over
// public.daily_wip_entries, RLS-scoped to projects the caller can read/manage.
// The table ships in a migration the desk applies; until then every read
// degrades to empty and writes surface a clear "not enabled yet" message, so
// the app never breaks ahead of the migration (mirrors exposure_allocations).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sumLineItems, type CostLineItem } from "@/lib/daily-wip";

type DynamicSupabaseError = { code?: string; message: string };
type DynamicSupabaseResult<T = unknown> = { data: T | null; error: DynamicSupabaseError | null };
type DynamicSupabaseQuery = PromiseLike<DynamicSupabaseResult> & {
  select(columns?: string): DynamicSupabaseQuery;
  insert(values: unknown): DynamicSupabaseQuery;
  update(values: unknown): DynamicSupabaseQuery;
  delete(): DynamicSupabaseQuery;
  eq(column: string, value: unknown): DynamicSupabaseQuery;
  order(column: string, options?: { ascending?: boolean }): DynamicSupabaseQuery;
  single(): Promise<DynamicSupabaseResult>;
  maybeSingle(): Promise<DynamicSupabaseResult>;
};
type DynamicSupabaseClient = { from(relation: string): DynamicSupabaseQuery };

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as DynamicSupabaseClient).from(relation);

const num = (value: unknown) => {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);

// Coerce a stored jsonb array into clean { description, amount } line items,
// dropping anything malformed so a bad row can never crash a read.
const normalizeItems = (value: unknown): CostLineItem[] => {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    return { description: str(item.description), amount: num(item.amount) };
  });
};

// The migration hasn't been applied yet — treat as "no entries" for reads.
function isMissingDailyWipTable(error: DynamicSupabaseError | null) {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST205" ||
    /daily_wip_entries|schema cache|does not exist|relation/i.test(message)
  );
}

export interface DailyWipEntryRow {
  id: string;
  project_id: string;
  cost_bucket_id: string | null;
  entry_date: string;
  activity: string;
  crew_count: number;
  hours: number;
  labor_rate: number;
  material_cost: number;
  equipment_cost: number;
  material_items: CostLineItem[];
  equipment_items: CostLineItem[];
  quantity: number;
  unit: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

const normalizeEntry = (row: Record<string, unknown>): DailyWipEntryRow => ({
  id: str(row.id),
  project_id: str(row.project_id),
  cost_bucket_id: (row.cost_bucket_id as string | null) ?? null,
  entry_date: str(row.entry_date),
  activity: str(row.activity),
  crew_count: num(row.crew_count),
  hours: num(row.hours),
  labor_rate: num(row.labor_rate),
  material_cost: num(row.material_cost),
  equipment_cost: num(row.equipment_cost),
  material_items: normalizeItems(row.material_items),
  equipment_items: normalizeItems(row.equipment_items),
  quantity: num(row.quantity),
  unit: str(row.unit),
  notes: str(row.notes),
  created_at: str(row.created_at),
  updated_at: str(row.updated_at),
});

const lineItemInput = z.object({
  description: z.string().max(200).default(""),
  amount: z.number().min(0).default(0),
});

const entryFieldsInput = z.object({
  cost_bucket_id: z.string().uuid().nullable().default(null),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "entry_date must be YYYY-MM-DD"),
  activity: z.string().max(500).default(""),
  crew_count: z.number().min(0).default(0),
  hours: z.number().min(0).default(0),
  labor_rate: z.number().min(0).default(0),
  material_cost: z.number().min(0).default(0),
  equipment_cost: z.number().min(0).default(0),
  material_items: z.array(lineItemInput).max(100).default([]),
  equipment_items: z.array(lineItemInput).max(100).default([]),
  quantity: z.number().min(0).default(0),
  unit: z.string().max(40).default(""),
  notes: z.string().max(4000).default(""),
});

export const listDailyWipEntries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<DailyWipEntryRow[]> => {
    const { data: rows, error } = await dynamicTable(context.supabase, "daily_wip_entries")
      .select("*")
      .eq("project_id", data.projectId)
      .order("entry_date", { ascending: false });
    if (error) {
      if (isMissingDailyWipTable(error)) return [];
      throw new Error(error.message);
    }
    return ((rows ?? []) as Record<string, unknown>[]).map(normalizeEntry);
  });

export const saveDailyWipEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ projectId: z.string().uuid(), id: z.string().uuid().optional() })
      .merge(entryFieldsInput)
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<DailyWipEntryRow> => {
    const { projectId, id, ...fields } = data;
    // Items are the source of truth: when a list is present, the lump cost is its
    // cents-safe sum so material_cost / equipment_cost can never drift from the
    // lines. An empty list falls back to the directly-supplied lump (older callers
    // and rows predating itemization).
    const material_cost = fields.material_items.length
      ? sumLineItems(fields.material_items)
      : fields.material_cost;
    const equipment_cost = fields.equipment_items.length
      ? sumLineItems(fields.equipment_items)
      : fields.equipment_cost;
    const payload = { project_id: projectId, ...fields, material_cost, equipment_cost };
    const table = dynamicTable(context.supabase, "daily_wip_entries");
    // Existing row → update; new row → insert. Not an upsert-on-conflict: a day
    // holds many activity rows, so (project, date) is not unique.
    const query = id
      ? table.update(payload).eq("id", id).select("*").single()
      : table.insert(payload).select("*").single();
    const { data: row, error } = await query;
    if (error) {
      if (isMissingDailyWipTable(error)) {
        throw new Error(
          "Daily WIP isn't enabled on this workspace yet — the daily_wip_entries table hasn't been applied.",
        );
      }
      throw new Error(error.message);
    }
    return normalizeEntry(row as Record<string, unknown>);
  });

export const deleteDailyWipEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await dynamicTable(context.supabase, "daily_wip_entries")
      .delete()
      .eq("id", data.id);
    if (error && !isMissingDailyWipTable(error)) throw new Error(error.message);
    return { id: data.id };
  });
