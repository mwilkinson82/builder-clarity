// Workspace B — daily WIP entry server functions (BILLINGDESIGN P2). CRUD over
// public.daily_wip_entries, RLS-scoped to projects the caller can read/manage.
// The table ships in a migration the desk applies; until then every read
// degrades to empty and writes surface a clear "not enabled yet" message, so
// the app never breaks ahead of the migration (mirrors exposure_allocations).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sumLineItems, type CostLineItem } from "@/lib/daily-wip";
import { centsToDollars, dollarsToCents } from "@/lib/payments-domain";

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

type RpcSupabaseClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<DynamicSupabaseResult<Record<string, unknown>>>;
};

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as DynamicSupabaseClient).from(relation);

const num = (value: unknown) => {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);

// Coerce a stored jsonb array into clean cost/resource line items. `quantity`
// and `unit` were added inside the existing JSON shape, so old rows continue to
// normalize to zero/blank physical details without a schema migration.
const normalizeItems = (value: unknown): CostLineItem[] => {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    return {
      description: str(item.description),
      amount: item.amount_cents == null ? num(item.amount) : centsToDollars(num(item.amount_cents)),
      quantity: num(item.quantity),
      unit: str(item.unit),
    };
  });
};

// A repeatable installed-quantity list ({ quantity, unit, description }). Read
// DEFENSIVELY: any non-array (old rows / pre-migration) → empty list.
const normalizeQuantityItems = (
  value: unknown,
): { quantity: number; unit: string; description?: string }[] => {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    return {
      quantity: num(item.quantity),
      unit: str(item.unit),
      description: str(item.description),
    };
  });
};

// The migration hasn't been applied yet — treat as "no entries" for reads.
function isMissingDailyWipTable(error: DynamicSupabaseError | null) {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST205" ||
    /daily_wip_entries|save_daily_wip_entry_atomic|void_daily_wip_entry_atomic|schema cache|does not exist|relation/i.test(
      message,
    )
  );
}

export interface DailyWipEntryRow {
  id: string;
  project_id: string;
  cost_bucket_id: string | null;
  schedule_activity_id: string | null;
  // SUBCONTRACTORS Slice 2: tag a daily-WIP line to a sub (self-perform ↔ sub).
  subcontractor_id: string | null;
  // Field fallback when the company has not been bought out / added to the
  // project subcontractor directory yet. The PM can later replace it with the
  // canonical subcontractor_id.
  unmatched_vendor_name: string;
  entry_date: string;
  activity: string;
  crew_count: number;
  people_per_crew: number;
  hours: number;
  labor_rate: number;
  material_cost: number;
  equipment_cost: number;
  material_items: CostLineItem[];
  equipment_items: CostLineItem[];
  quantity: number;
  unit: string;
  target_production_rate: number | null;
  // Repeatable installed quantities/counts on this line (500 LF conduit, 24 boxes).
  // The scalar quantity/unit above is the primary/roll-up (the productionRate read).
  quantity_items: { quantity: number; unit: string; description?: string }[];
  // Does this line's % complete measure against the SOV line or the linked CPM
  // schedule activity? A stored + displayed LABEL only — it changes no math.
  percent_basis: "sov" | "cpm";
  // The PM's reviewed value (drives WIP earned value); field_percent_complete is
  // the super's field number; a difference / a stamp = the PM adjusted it.
  percent_complete: number;
  field_percent_complete: number;
  percent_overridden_at: string | null;
  wip_reviewed_at: string | null;
  wip_reviewed_by: string | null;
  version: number;
  review_version: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

const normalizeEntry = (row: Record<string, unknown>): DailyWipEntryRow => ({
  id: str(row.id),
  project_id: str(row.project_id),
  cost_bucket_id: (row.cost_bucket_id as string | null) ?? null,
  schedule_activity_id: (row.schedule_activity_id as string | null) ?? null,
  subcontractor_id: (row.subcontractor_id as string | null) ?? null,
  unmatched_vendor_name: str(row.unmatched_vendor_name),
  entry_date: str(row.entry_date),
  activity: str(row.activity),
  crew_count: num(row.crew_count),
  people_per_crew: num(row.people_per_crew) > 0 ? num(row.people_per_crew) : 2,
  hours: num(row.hours),
  labor_rate: num(row.labor_rate),
  material_cost: num(row.material_cost),
  equipment_cost: num(row.equipment_cost),
  material_items: normalizeItems(row.material_items),
  equipment_items: normalizeItems(row.equipment_items),
  quantity: num(row.quantity),
  unit: str(row.unit),
  target_production_rate:
    row.target_production_rate == null ? null : num(row.target_production_rate),
  quantity_items: Array.isArray(row.quantity_items)
    ? normalizeQuantityItems(row.quantity_items)
    : [],
  percent_basis: (row.percent_basis as "sov" | "cpm") ?? "sov",
  percent_complete: num(row.percent_complete),
  field_percent_complete: num(row.field_percent_complete),
  percent_overridden_at: (row.percent_overridden_at as string | null) ?? null,
  wip_reviewed_at: (row.wip_reviewed_at as string | null) ?? null,
  wip_reviewed_by: (row.wip_reviewed_by as string | null) ?? null,
  version: Math.max(1, Math.trunc(num(row.version) || 1)),
  review_version: Math.max(0, Math.trunc(num(row.review_version))),
  notes: str(row.notes),
  created_at: str(row.created_at),
  updated_at: str(row.updated_at),
});

const lineItemInput = z.object({
  description: z.string().max(200).default(""),
  amount: z.number().min(0).default(0),
  quantity: z.number().min(0).default(0),
  unit: z.string().max(60).default(""),
});

const entryFieldsInput = z.object({
  cost_bucket_id: z.string().uuid().nullable().default(null),
  schedule_activity_id: z.string().uuid().nullable().default(null),
  subcontractor_id: z.string().uuid().nullable().default(null),
  unmatched_vendor_name: z.string().max(200).default(""),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "entry_date must be YYYY-MM-DD"),
  activity: z.string().max(500).default(""),
  crew_count: z.number().min(0).default(0),
  people_per_crew: z.number().int().positive().max(100).default(2),
  hours: z.number().min(0).default(0),
  labor_rate: z.number().min(0).default(0),
  material_cost: z.number().min(0).default(0),
  equipment_cost: z.number().min(0).default(0),
  material_items: z.array(lineItemInput).max(100).default([]),
  equipment_items: z.array(lineItemInput).max(100).default([]),
  quantity: z.number().min(0).default(0),
  unit: z.string().max(40).default(""),
  target_production_rate: z.number().positive().max(1_000_000_000).nullable().default(null),
  // A repeatable list of installed quantities/counts (units are free text so
  // counts like "junction boxes" work). Drives nothing in the math — the scalar
  // quantity/unit remains the productionRate roll-up (led by the primary item).
  quantity_items: z
    .array(
      z.object({
        quantity: z.number(),
        unit: z.string().max(60).default(""),
        description: z.string().max(200).default(""),
      }),
    )
    .max(100)
    .default([]),
  // Label only: is % complete measured against the SOV line or the CPM activity?
  percent_basis: z.enum(["sov", "cpm"]).default("sov"),
  percent_complete: z.number().min(0).max(100).default(0),
  // Who is writing the percent complete: the super in the daily log ("field")
  // sets the field number; the PM in the WIP ("costing") sets the reviewed value
  // and any adjustment is tracked. Defaults to "field" so plain callers (and the
  // super's surface) record the field truth.
  percent_source: z.enum(["field", "costing"]).default("field"),
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
      .object({
        projectId: z.string().uuid(),
        id: z.string().uuid().optional(),
        expected_version: z.number().int().nonnegative(),
        operation_key: z.string().trim().min(1).max(200),
      })
      .merge(entryFieldsInput)
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<DailyWipEntryRow> => {
    if (data.subcontractor_id && data.unmatched_vendor_name.trim()) {
      throw new Error("Choose a project subcontractor or enter an unlisted vendor name, not both.");
    }
    // percent_source is a write-time discriminator, not a column — keep it out of
    // the DB payload.
    const { projectId, id, expected_version, operation_key, percent_source, ...fields } = data;
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
    // Back-compat scalar roll-up beside the itemized list: units aren't summable,
    // so the PRIMARY (first) installed quantity leads. This keeps productionRate
    // (which reads the scalar quantity) working. Empty list → keep the passed
    // scalar (older callers and rows predating quantity_items).
    const primaryQuantity = fields.quantity_items.length ? fields.quantity_items[0] : null;
    const quantity = primaryQuantity ? primaryQuantity.quantity : fields.quantity;
    const unit = primaryQuantity ? primaryQuantity.unit : fields.unit;
    const canonicalItems = (items: CostLineItem[]) =>
      items.map((item) => {
        const amountCents = dollarsToCents(item.amount);
        return {
          description: item.description,
          amount: centsToDollars(amountCents),
          amount_cents: amountCents,
          quantity: item.quantity ?? 0,
          unit: item.unit ?? "",
        };
      });
    const payload = {
      ...fields,
      material_cost_cents: dollarsToCents(material_cost),
      equipment_cost_cents: dollarsToCents(equipment_cost),
      labor_rate_cents: dollarsToCents(fields.labor_rate),
      material_items: canonicalItems(fields.material_items),
      equipment_items: canonicalItems(fields.equipment_items),
      quantity,
      unit,
      percent_source,
    };
    const { data: result, error } = await (context.supabase as unknown as RpcSupabaseClient).rpc(
      "save_daily_wip_entry_atomic",
      {
        p_project_id: projectId,
        p_entry_id: id ?? null,
        p_expected_version: expected_version,
        p_payload: payload,
        p_operation_key: operation_key,
      },
    );
    if (error) {
      if (isMissingDailyWipTable(error)) {
        throw new Error("Daily WIP's audited save workflow isn't enabled on this workspace yet.");
      }
      throw new Error(error.message);
    }
    const row = result?.entry;
    if (!row || typeof row !== "object") {
      throw new Error(
        "Daily WIP saved without returning the authoritative row. Refresh and try again.",
      );
    }
    return normalizeEntry(row as Record<string, unknown>);
  });

export const deleteDailyWipEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        projectId: z.string().uuid(),
        id: z.string().uuid(),
        expected_version: z.number().int().positive(),
        reason: z.string().trim().min(1).max(1000),
        operation_key: z.string().trim().min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as unknown as RpcSupabaseClient).rpc(
      "void_daily_wip_entry_atomic",
      {
        p_project_id: data.projectId,
        p_entry_id: data.id,
        p_expected_version: data.expected_version,
        p_reason: data.reason,
        p_operation_key: data.operation_key,
      },
    );
    if (error) {
      if (isMissingDailyWipTable(error)) {
        throw new Error("Daily WIP's audited removal workflow isn't enabled yet.");
      }
      throw new Error(error.message);
    }
    return { id: data.id };
  });

// A CPM schedule activity, trimmed to what the WIP activity picker needs.
export interface ScheduleActivityOption {
  id: string;
  activity_id: string;
  name: string;
  division: string;
}

// The schedule module may not be provisioned on every workspace — degrade to an
// empty list rather than breaking the WIP form.
function isMissingRelation(error: DynamicSupabaseError | null) {
  const message = error?.message ?? "";
  return error?.code === "PGRST205" || /schema cache|does not exist|relation/i.test(message);
}

// Lean read of the CPM schedule activities, for the WIP entry's activity picker.
// CROSS-MODULE READ: public.schedule_activities is owned by the CPM/Schedule
// module. This only SELECTs a few label columns (no writes, no CPM files edited)
// so a day's work can be tagged to the schedule activity it progressed; RLS still
// scopes it to projects the caller can read. Deliberately lighter than
// listSchedule (which fetches ~8 tables and has demo-seed side effects).
export const listScheduleActivitiesForWip = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<ScheduleActivityOption[]> => {
    const { data: rows, error } = await dynamicTable(context.supabase, "schedule_activities")
      .select("id, activity_id, name, division, sort_order")
      .eq("project_id", data.projectId)
      .order("sort_order", { ascending: true });
    if (error) {
      if (isMissingRelation(error)) return [];
      throw new Error(error.message);
    }
    return ((rows ?? []) as Record<string, unknown>[]).map((row) => ({
      id: str(row.id),
      activity_id: str(row.activity_id),
      name: str(row.name),
      division: str(row.division),
    }));
  });
