import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ESTIMATE_REGIONS, ESTIMATE_SEED_LIBRARY_ITEMS } from "@/lib/estimate-seed-data";
import type { Json } from "@/integrations/supabase/types";

type DynamicSupabaseError = { code?: string; message: string };
type DynamicSupabaseResult<T = unknown> = { data: T | null; error: DynamicSupabaseError | null };
type DynamicSupabaseQuery = PromiseLike<DynamicSupabaseResult> & {
  select(columns?: string): DynamicSupabaseQuery;
  insert(values: unknown): DynamicSupabaseQuery;
  update(values: unknown): DynamicSupabaseQuery;
  delete(): DynamicSupabaseQuery;
  upsert(values: unknown, options?: { onConflict?: string }): DynamicSupabaseQuery;
  eq(column: string, value: unknown): DynamicSupabaseQuery;
  in(column: string, values: readonly string[]): Promise<DynamicSupabaseResult<unknown[]>>;
  order(
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean },
  ): DynamicSupabaseQuery;
  limit(count: number): DynamicSupabaseQuery;
  single(): Promise<DynamicSupabaseResult>;
  maybeSingle(): Promise<DynamicSupabaseResult>;
};
type DynamicSupabaseClient = {
  from(relation: string): DynamicSupabaseQuery;
};

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as DynamicSupabaseClient).from(relation);

const chunk = <T>(items: readonly T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const str = (value: unknown, fallback = "") => (value == null ? fallback : String(value));
const num = (value: unknown, fallback = 0) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};
const arr = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : []);
const clean = (value: string, max = 500) => value.trim().slice(0, max);
const centsToDollars = (value: number) => Math.round(value) / 100;

export type EstimateStatus = "draft" | "final" | "awarded" | "lost";
export type MarkupBasis = "subtotal" | "material" | "labor";

export interface EstimateCustomMarkup {
  name: string;
  pct: number;
  applies_to: MarkupBasis;
}

export interface EstimateRow {
  id: string;
  organization_id: string;
  created_by: string | null;
  name: string;
  description: string;
  opportunity_id: string | null;
  project_id: string | null;
  project_type: string;
  region: string;
  region_multiplier: number;
  overhead_pct: number;
  profit_pct: number;
  contingency_pct: number;
  bond_pct: number;
  tax_pct: number;
  general_conditions_pct: number;
  custom_markups: EstimateCustomMarkup[];
  subtotal_material_cents: number;
  subtotal_labor_cents: number;
  subtotal_cents: number;
  total_with_markups_cents: number;
  status: EstimateStatus;
  created_at: string;
  updated_at: string;
  line_item_count?: number;
  project_name?: string;
  opportunity_name?: string;
}

export interface EstimateLineItemRow {
  id: string;
  estimate_id: string;
  csi_division: string;
  cost_code: string;
  description: string;
  unit: string;
  quantity: number;
  material_unit_cost_cents: number;
  labor_unit_cost_cents: number;
  material_extended_cents: number;
  labor_extended_cents: number;
  total_extended_cents: number;
  library_item_id: string | null;
  scope_group: string;
  sort_order: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface CostLibraryItemRow {
  id: string;
  organization_id: string;
  external_id: string;
  csi_division: string;
  csi_code: string;
  category: string;
  description: string;
  unit: string;
  material_cost_cents: number;
  labor_cost_cents: number;
  display_material_cost_cents: number;
  display_labor_cost_cents: number;
  crew_size: number | null;
  productivity_per_hour: number | null;
  synonyms: Json[];
  keywords: Json[];
  source: "system" | "user" | "imported";
  base_region: string;
  created_at: string;
  updated_at: string;
}

export interface EstimateTotalsBreakdown {
  material_cents: number;
  labor_cents: number;
  direct_cents: number;
  regional_adjustment_cents: number;
  adjusted_material_cents: number;
  adjusted_labor_cents: number;
  adjusted_direct_cents: number;
  tax_cents: number;
  overhead_cents: number;
  profit_cents: number;
  contingency_cents: number;
  bond_cents: number;
  general_conditions_cents: number;
  custom_markup_cents: number;
  total_cents: number;
  indicated_gp_pct: number;
}

const normalizeCustomMarkup = (value: unknown): EstimateCustomMarkup[] =>
  (Array.isArray(value) ? value : [])
    .map((item): EstimateCustomMarkup => {
      const raw = item as Record<string, unknown>;
      const basis = str(raw.applies_to, "subtotal") as MarkupBasis;
      return {
        name: clean(str(raw.name, "Markup"), 80) || "Markup",
        pct: Math.max(0, Math.round(num(raw.pct))),
        applies_to: basis === "material" || basis === "labor" ? basis : "subtotal",
      };
    })
    .filter((item) => item.name && item.pct >= 0);

const normalizeEstimate = (row: Record<string, unknown>): EstimateRow => ({
  id: str(row.id),
  organization_id: str(row.organization_id),
  created_by: (row.created_by as string | null) ?? null,
  name: str(row.name),
  description: str(row.description),
  opportunity_id: (row.opportunity_id as string | null) ?? null,
  project_id: (row.project_id as string | null) ?? null,
  project_type: str(row.project_type, "commercial"),
  region: str(row.region),
  region_multiplier: num(row.region_multiplier, 1),
  overhead_pct: Math.round(num(row.overhead_pct, 1000)),
  profit_pct: Math.round(num(row.profit_pct, 1000)),
  contingency_pct: Math.round(num(row.contingency_pct, 500)),
  bond_pct: Math.round(num(row.bond_pct, 150)),
  tax_pct: Math.round(num(row.tax_pct)),
  general_conditions_pct: Math.round(num(row.general_conditions_pct)),
  custom_markups: normalizeCustomMarkup(row.custom_markups),
  subtotal_material_cents: Math.round(num(row.subtotal_material_cents)),
  subtotal_labor_cents: Math.round(num(row.subtotal_labor_cents)),
  subtotal_cents: Math.round(num(row.subtotal_cents)),
  total_with_markups_cents: Math.round(num(row.total_with_markups_cents)),
  status: str(row.status, "draft") as EstimateStatus,
  created_at: str(row.created_at),
  updated_at: str(row.updated_at),
});

const normalizeLineItem = (row: Record<string, unknown>): EstimateLineItemRow => {
  const quantity = num(row.quantity);
  const material = Math.round(num(row.material_unit_cost_cents));
  const labor = Math.round(num(row.labor_unit_cost_cents));
  return {
    id: str(row.id),
    estimate_id: str(row.estimate_id),
    csi_division: str(row.csi_division),
    cost_code: str(row.cost_code),
    description: str(row.description),
    unit: str(row.unit),
    quantity,
    material_unit_cost_cents: material,
    labor_unit_cost_cents: labor,
    material_extended_cents: Math.round(num(row.material_extended_cents, quantity * material)),
    labor_extended_cents: Math.round(num(row.labor_extended_cents, quantity * labor)),
    total_extended_cents: Math.round(num(row.total_extended_cents, quantity * (material + labor))),
    library_item_id: (row.library_item_id as string | null) ?? null,
    scope_group: str(row.scope_group),
    sort_order: Math.round(num(row.sort_order)),
    notes: str(row.notes),
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
  };
};

const normalizeLibraryItem = (
  row: Record<string, unknown>,
  regionMultiplier = 1,
): CostLibraryItemRow => {
  const material = Math.round(num(row.material_cost_cents));
  const labor = Math.round(num(row.labor_cost_cents));
  return {
    id: str(row.id),
    organization_id: str(row.organization_id),
    external_id: str(row.external_id),
    csi_division: str(row.csi_division),
    csi_code: str(row.csi_code),
    category: str(row.category),
    description: str(row.description),
    unit: str(row.unit),
    material_cost_cents: material,
    labor_cost_cents: labor,
    display_material_cost_cents: Math.round(material * regionMultiplier),
    display_labor_cost_cents: Math.round(labor * regionMultiplier),
    crew_size: row.crew_size == null ? null : num(row.crew_size),
    productivity_per_hour:
      row.productivity_per_hour == null ? null : num(row.productivity_per_hour),
    synonyms: arr(row.synonyms),
    keywords: arr(row.keywords),
    source: str(row.source, "system") as CostLibraryItemRow["source"],
    base_region: str(row.base_region, "national"),
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
  };
};

const regionMultiplierFor = (region: string | undefined | null) => {
  const value = clean(str(region)).toLowerCase();
  if (!value) return 1;
  const match = ESTIMATE_REGIONS.find(
    (item) => item.code.toLowerCase() === value || item.name.toLowerCase() === value,
  );
  return match?.multiplier_decimal ?? 1;
};

export function calculateEstimateTotals(
  estimate: Pick<
    EstimateRow,
    | "region_multiplier"
    | "overhead_pct"
    | "profit_pct"
    | "contingency_pct"
    | "bond_pct"
    | "tax_pct"
    | "general_conditions_pct"
    | "custom_markups"
  >,
  lines: readonly Pick<
    EstimateLineItemRow,
    "quantity" | "material_unit_cost_cents" | "labor_unit_cost_cents"
  >[],
): EstimateTotalsBreakdown {
  const material_cents = Math.round(
    lines.reduce((sum, line) => sum + line.quantity * line.material_unit_cost_cents, 0),
  );
  const labor_cents = Math.round(
    lines.reduce((sum, line) => sum + line.quantity * line.labor_unit_cost_cents, 0),
  );
  const direct_cents = material_cents + labor_cents;
  const multiplier = Number.isFinite(estimate.region_multiplier)
    ? Math.max(0, estimate.region_multiplier)
    : 1;
  const adjusted_material_cents = Math.round(material_cents * multiplier);
  const adjusted_labor_cents = Math.round(labor_cents * multiplier);
  const adjusted_direct_cents = adjusted_material_cents + adjusted_labor_cents;
  const regional_adjustment_cents = adjusted_direct_cents - direct_cents;
  const byPct = (base: number, pct: number) => Math.round((base * Math.max(0, pct)) / 10000);
  const tax_cents = byPct(adjusted_material_cents, estimate.tax_pct);
  const overhead_cents = byPct(adjusted_direct_cents, estimate.overhead_pct);
  const profit_cents = byPct(adjusted_direct_cents, estimate.profit_pct);
  const contingency_cents = byPct(adjusted_direct_cents, estimate.contingency_pct);
  const bond_cents = byPct(adjusted_direct_cents, estimate.bond_pct);
  const general_conditions_cents = byPct(adjusted_direct_cents, estimate.general_conditions_pct);
  const custom_markup_cents = estimate.custom_markups.reduce((sum, markup) => {
    const base =
      markup.applies_to === "material"
        ? adjusted_material_cents
        : markup.applies_to === "labor"
          ? adjusted_labor_cents
          : adjusted_direct_cents;
    return sum + byPct(base, markup.pct);
  }, 0);
  const total_cents =
    adjusted_direct_cents +
    tax_cents +
    overhead_cents +
    profit_cents +
    contingency_cents +
    bond_cents +
    general_conditions_cents +
    custom_markup_cents;
  return {
    material_cents,
    labor_cents,
    direct_cents,
    regional_adjustment_cents,
    adjusted_material_cents,
    adjusted_labor_cents,
    adjusted_direct_cents,
    tax_cents,
    overhead_cents,
    profit_cents,
    contingency_cents,
    bond_cents,
    general_conditions_cents,
    custom_markup_cents,
    total_cents,
    indicated_gp_pct:
      total_cents > 0 ? ((total_cents - adjusted_direct_cents) / total_cents) * 100 : 0,
  };
}

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

async function ensureCostLibrarySeeded(context: { supabase: unknown }, organizationId: string) {
  const { data: existing, error: existingError } = await dynamicTable(
    context.supabase,
    "cost_library_items",
  )
    .select("id")
    .eq("organization_id", organizationId)
    .limit(1);
  if (existingError) throw new Error(existingError.message);
  if ((existing as unknown[] | null)?.length) return;

  const rows = ESTIMATE_SEED_LIBRARY_ITEMS.map((item) => ({
    organization_id: organizationId,
    external_id: item.external_id,
    csi_division: item.csi_division,
    csi_code: item.csi_code,
    category: item.category,
    description: item.description,
    unit: item.unit,
    material_cost_cents: item.material_cost_cents,
    labor_cost_cents: item.labor_cost_cents,
    crew_size: item.crew_size,
    productivity_per_hour: item.productivity_per_hour,
    synonyms: item.synonyms as Json,
    keywords: item.keywords as Json,
    source: "system",
    base_region: "national",
  }));

  for (const part of chunk(rows, 100)) {
    const { error } = await dynamicTable(context.supabase, "cost_library_items").insert(part);
    if (error && error.code !== "23505") throw new Error(error.message);
  }
}

async function loadEstimate(context: { supabase: unknown }, id: string): Promise<EstimateRow> {
  const { data, error } = await dynamicTable(context.supabase, "estimates")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Estimate not found.");
  return normalizeEstimate(data as Record<string, unknown>);
}

async function loadEstimateLines(context: { supabase: unknown }, estimateId: string) {
  const { data, error } = await dynamicTable(context.supabase, "estimate_line_items")
    .select("*")
    .eq("estimate_id", estimateId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeLineItem);
}

async function recalculateEstimateTotalsInternal(
  context: { supabase: unknown },
  estimateId: string,
) {
  const estimate = await loadEstimate(context, estimateId);
  const lines = await loadEstimateLines(context, estimateId);
  const totals = calculateEstimateTotals(estimate, lines);
  const { data, error } = await dynamicTable(context.supabase, "estimates")
    .update({
      subtotal_material_cents: totals.material_cents,
      subtotal_labor_cents: totals.labor_cents,
      subtotal_cents: totals.direct_cents,
      total_with_markups_cents: totals.total_cents,
    })
    .eq("id", estimateId)
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Estimate totals did not update.");
  return { estimate: normalizeEstimate(data as Record<string, unknown>), totals };
}

const customMarkupSchema = z.object({
  name: z.string().min(1).max(80),
  pct: z.number().int().min(0).max(100000),
  applies_to: z.enum(["subtotal", "material", "labor"]).default("subtotal"),
});

const markupPatchSchema = {
  overhead_pct: z.number().int().min(0).max(100000).optional(),
  profit_pct: z.number().int().min(0).max(100000).optional(),
  contingency_pct: z.number().int().min(0).max(100000).optional(),
  bond_pct: z.number().int().min(0).max(100000).optional(),
  tax_pct: z.number().int().min(0).max(100000).optional(),
  general_conditions_pct: z.number().int().min(0).max(100000).optional(),
  custom_markups: z.array(customMarkupSchema).max(20).optional(),
};

const createEstimateInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(""),
  opportunity_id: z.string().uuid().nullable().optional(),
  project_id: z.string().uuid().nullable().optional(),
  project_type: z.string().max(32).optional().default("commercial"),
  region: z.string().max(64).optional().default(""),
});

const updateEstimateInput = z.object({
  id: z.string().uuid(),
  patch: z
    .object({
      name: z.string().min(1).max(200).optional(),
      description: z.string().max(2000).optional(),
      opportunity_id: z.string().uuid().nullable().optional(),
      project_id: z.string().uuid().nullable().optional(),
      project_type: z.string().max(32).optional(),
      region: z.string().max(64).optional(),
      region_multiplier: z.number().min(0).max(10).optional(),
      status: z.enum(["draft", "final", "awarded", "lost"]).optional(),
      ...markupPatchSchema,
    })
    .refine((patch) => Object.keys(patch).length > 0, "No estimate changes were provided."),
});

const lineItemInput = z.object({
  estimate_id: z.string().uuid(),
  csi_division: z.string().max(8).optional().default(""),
  cost_code: z.string().max(32).optional().default(""),
  description: z.string().min(1).max(500),
  unit: z.string().min(1).max(16),
  quantity: z.number().min(0).max(999999999).default(0),
  material_unit_cost_cents: z.number().int().min(0).max(999999999).default(0),
  labor_unit_cost_cents: z.number().int().min(0).max(999999999).default(0),
  library_item_id: z.string().uuid().nullable().optional(),
  scope_group: z.string().max(200).optional().default(""),
  notes: z.string().max(2000).optional().default(""),
});

const updateLineItemInput = z.object({
  id: z.string().uuid(),
  patch: lineItemInput
    .omit({ estimate_id: true })
    .partial()
    .refine((patch) => Object.keys(patch).length > 0, "No line item changes were provided."),
});

const listCostLibraryInput = z.object({
  csi_division: z.string().max(8).optional().default(""),
  category: z.string().max(64).optional().default(""),
});

const searchCostLibraryInput = z.object({
  query: z.string().max(120),
  csi_division: z.string().max(8).optional().default(""),
  limit: z.number().int().min(1).max(50).optional().default(20),
  region_multiplier: z.number().min(0).max(10).optional().default(1),
});

const costLibraryItemInput = z.object({
  csi_division: z.string().min(1).max(8),
  csi_code: z.string().max(16).optional().default(""),
  category: z.string().max(64).optional().default(""),
  description: z.string().min(1).max(500),
  unit: z.string().min(1).max(16),
  material_cost_cents: z.number().int().min(0).max(999999999).default(0),
  labor_cost_cents: z.number().int().min(0).max(999999999).default(0),
  crew_size: z.number().min(0).max(999).nullable().optional(),
  productivity_per_hour: z.number().min(0).max(999999).nullable().optional(),
  synonyms: z.array(z.string().max(80)).max(40).optional().default([]),
  keywords: z.array(z.string().max(80)).max(60).optional().default([]),
});

const saveMarkupDefaultsInput = z.object({
  ...markupPatchSchema,
  default_region: z.string().max(64).optional().default(""),
  default_region_multiplier: z.number().min(0).max(10).optional(),
});

export const listEstimateRegions = createServerFn({ method: "GET" }).handler(async () => ({
  regions: ESTIMATE_REGIONS,
}));

export const listEstimates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const organizationId = await getOrganizationId(context);
    await ensureCostLibrarySeeded(context, organizationId);

    const { data, error } = await dynamicTable(context.supabase, "estimates")
      .select("*")
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);

    const estimates = ((data ?? []) as Record<string, unknown>[]).map(normalizeEstimate);
    const ids = estimates.map((estimate) => estimate.id);
    if (ids.length === 0) return [];

    const [lineRes, projectRes, opportunityRes] = await Promise.all([
      dynamicTable(context.supabase, "estimate_line_items")
        .select("estimate_id")
        .in("estimate_id", ids),
      dynamicTable(context.supabase, "projects")
        .select("id,name")
        .in(
          "id",
          estimates
            .map((estimate) => estimate.project_id)
            .filter((id): id is string => Boolean(id)),
        ),
      dynamicTable(context.supabase, "pipeline_opportunities")
        .select("id,name")
        .in(
          "id",
          estimates
            .map((estimate) => estimate.opportunity_id)
            .filter((id): id is string => Boolean(id)),
        ),
    ]);
    if (lineRes.error) throw new Error(lineRes.error.message);
    if (
      projectRes.error &&
      projectRes.error.code !== "42P01" &&
      projectRes.error.code !== "PGRST205"
    ) {
      throw new Error(projectRes.error.message);
    }
    const opportunityRows =
      opportunityRes.error &&
      (opportunityRes.error.code === "42P01" || opportunityRes.error.code === "PGRST205")
        ? []
        : ((opportunityRes.data ?? []) as Record<string, unknown>[]);
    if (
      opportunityRes.error &&
      opportunityRows.length === 0 &&
      !["42P01", "PGRST205"].includes(opportunityRes.error.code ?? "")
    ) {
      throw new Error(opportunityRes.error.message);
    }

    const lineCounts = new Map<string, number>();
    for (const row of (lineRes.data ?? []) as Record<string, unknown>[]) {
      const id = str(row.estimate_id);
      lineCounts.set(id, (lineCounts.get(id) ?? 0) + 1);
    }
    const projectNames = new Map(
      ((projectRes.data ?? []) as Record<string, unknown>[]).map((row) => [
        str(row.id),
        str(row.name),
      ]),
    );
    const opportunityNames = new Map(opportunityRows.map((row) => [str(row.id), str(row.name)]));

    return estimates.map((estimate) => ({
      ...estimate,
      line_item_count: lineCounts.get(estimate.id) ?? 0,
      project_name: estimate.project_id ? (projectNames.get(estimate.project_id) ?? "") : "",
      opportunity_name: estimate.opportunity_id
        ? (opportunityNames.get(estimate.opportunity_id) ?? "")
        : "",
    }));
  });

export const getEstimate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const estimate = await loadEstimate(context, data.id);
    await ensureCostLibrarySeeded(context, estimate.organization_id);
    const line_items = await loadEstimateLines(context, data.id);
    const totals = calculateEstimateTotals(estimate, line_items);
    return { estimate, line_items, totals };
  });

export const createEstimate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof createEstimateInput>) => createEstimateInput.parse(input))
  .handler(async ({ data, context }) => {
    const organizationId = await getOrganizationId(context);
    await ensureCostLibrarySeeded(context, organizationId);

    const { data: defaults, error: defaultsError } = await dynamicTable(
      context.supabase,
      "estimate_markup_defaults",
    )
      .select("*")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (defaultsError) throw new Error(defaultsError.message);
    const defaultsRow = defaults as Record<string, unknown> | null;

    const region = clean(data.region || str(defaultsRow?.default_region));
    const regionMultiplier =
      regionMultiplierFor(region) || num(defaultsRow?.default_region_multiplier, 1) || 1;
    const insert = {
      organization_id: organizationId,
      created_by: context.userId,
      name: clean(data.name, 200),
      description: clean(data.description ?? "", 2000),
      opportunity_id: data.opportunity_id ?? null,
      project_id: data.project_id ?? null,
      project_type: clean(data.project_type ?? "commercial", 32) || "commercial",
      region,
      region_multiplier: regionMultiplier,
      overhead_pct: Math.round(num(defaultsRow?.overhead_pct, 1000)),
      profit_pct: Math.round(num(defaultsRow?.profit_pct, 1000)),
      contingency_pct: Math.round(num(defaultsRow?.contingency_pct, 500)),
      bond_pct: Math.round(num(defaultsRow?.bond_pct, 150)),
      tax_pct: Math.round(num(defaultsRow?.tax_pct)),
      general_conditions_pct: Math.round(num(defaultsRow?.general_conditions_pct)),
      custom_markups: normalizeCustomMarkup(defaultsRow?.custom_markups) as unknown as Json,
    };

    const { data: row, error } = await dynamicTable(context.supabase, "estimates")
      .insert(insert)
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Estimate did not save.");
    return { id: str((row as Record<string, unknown>).id) };
  });

export const updateEstimate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof updateEstimateInput>) => updateEstimateInput.parse(input))
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = { ...data.patch };
    if (typeof patch.name === "string") patch.name = clean(patch.name, 200);
    if (typeof patch.description === "string") patch.description = clean(patch.description, 2000);
    if (typeof patch.project_type === "string") patch.project_type = clean(patch.project_type, 32);
    if (typeof patch.region === "string" && patch.region_multiplier == null) {
      const region = clean(patch.region, 64);
      patch.region = region;
      patch.region_multiplier = regionMultiplierFor(region);
    }
    if (Array.isArray(patch.custom_markups)) {
      patch.custom_markups = normalizeCustomMarkup(patch.custom_markups) as unknown as Json;
    }

    const { data: row, error } = await dynamicTable(context.supabase, "estimates")
      .update(patch)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Estimate did not update.");
    const totals = await recalculateEstimateTotalsInternal(context, data.id);
    return { estimate: totals.estimate };
  });

export const recalculateEstimateTotals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => recalculateEstimateTotalsInternal(context, data.id));

export const createLineItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof lineItemInput>) => lineItemInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: existing, error: existingError } = await dynamicTable(
      context.supabase,
      "estimate_line_items",
    )
      .select("sort_order")
      .eq("estimate_id", data.estimate_id)
      .order("sort_order", { ascending: false })
      .limit(1);
    if (existingError) throw new Error(existingError.message);
    const nextOrder =
      ((existing as Record<string, unknown>[] | null)?.reduce(
        (max, row) => Math.max(max, Math.round(num(row.sort_order))),
        0,
      ) ?? 0) + 1;
    const quantity = data.unit.toUpperCase() === "LS" ? 1 : data.quantity;
    const { data: row, error } = await dynamicTable(context.supabase, "estimate_line_items")
      .insert({
        ...data,
        quantity,
        csi_division: clean(data.csi_division, 8),
        cost_code: clean(data.cost_code, 32),
        description: clean(data.description, 500),
        unit: clean(data.unit.toUpperCase(), 16),
        scope_group: clean(data.scope_group, 200),
        notes: clean(data.notes, 2000),
        sort_order: nextOrder,
      })
      .select("*")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Line item did not save.");
    await recalculateEstimateTotalsInternal(context, data.estimate_id);
    return { line_item: normalizeLineItem(row as Record<string, unknown>) };
  });

export const updateLineItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof updateLineItemInput>) => updateLineItemInput.parse(input))
  .handler(async ({ data, context }) => {
    const current = await dynamicTable(context.supabase, "estimate_line_items")
      .select("estimate_id")
      .eq("id", data.id)
      .single();
    if (current.error || !current.data) {
      throw new Error(current.error?.message ?? "Line item was not found.");
    }
    const patch: Record<string, unknown> = { ...data.patch };
    if (typeof patch.description === "string") patch.description = clean(patch.description, 500);
    if (typeof patch.unit === "string") {
      patch.unit = clean(patch.unit.toUpperCase(), 16);
      if (patch.unit === "LS" && patch.quantity == null) patch.quantity = 1;
    }
    if (typeof patch.cost_code === "string") patch.cost_code = clean(patch.cost_code, 32);
    if (typeof patch.csi_division === "string") patch.csi_division = clean(patch.csi_division, 8);
    if (typeof patch.scope_group === "string") patch.scope_group = clean(patch.scope_group, 200);
    if (typeof patch.notes === "string") patch.notes = clean(patch.notes, 2000);

    const { data: row, error } = await dynamicTable(context.supabase, "estimate_line_items")
      .update(patch)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Line item did not update.");
    await recalculateEstimateTotalsInternal(
      context,
      str((current.data as Record<string, unknown>).estimate_id),
    );
    return { line_item: normalizeLineItem(row as Record<string, unknown>) };
  });

export const deleteLineItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const current = await dynamicTable(context.supabase, "estimate_line_items")
      .select("estimate_id")
      .eq("id", data.id)
      .single();
    if (current.error || !current.data) {
      throw new Error(current.error?.message ?? "Line item was not found.");
    }
    const estimateId = str((current.data as Record<string, unknown>).estimate_id);
    const { error } = await dynamicTable(context.supabase, "estimate_line_items")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await recalculateEstimateTotalsInternal(context, estimateId);
    return { ok: true };
  });

export const reorderLineItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { estimate_id: string; item_ids: string[] }) =>
    z
      .object({
        estimate_id: z.string().uuid(),
        item_ids: z.array(z.string().uuid()).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    for (let index = 0; index < data.item_ids.length; index += 1) {
      const { error } = await dynamicTable(context.supabase, "estimate_line_items")
        .update({ sort_order: index + 1 })
        .eq("id", data.item_ids[index]);
      if (error) throw new Error(error.message);
    }
    await recalculateEstimateTotalsInternal(context, data.estimate_id);
    return { ok: true };
  });

export const duplicateEstimate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const estimate = await loadEstimate(context, data.id);
    const lines = await loadEstimateLines(context, data.id);
    const { data: copy, error } = await dynamicTable(context.supabase, "estimates")
      .insert({
        organization_id: estimate.organization_id,
        created_by: context.userId,
        name: `Copy of ${estimate.name}`.slice(0, 200),
        description: estimate.description,
        opportunity_id: estimate.opportunity_id,
        project_id: null,
        project_type: estimate.project_type,
        region: estimate.region,
        region_multiplier: estimate.region_multiplier,
        overhead_pct: estimate.overhead_pct,
        profit_pct: estimate.profit_pct,
        contingency_pct: estimate.contingency_pct,
        bond_pct: estimate.bond_pct,
        tax_pct: estimate.tax_pct,
        general_conditions_pct: estimate.general_conditions_pct,
        custom_markups: estimate.custom_markups as unknown as Json,
        status: "draft",
      })
      .select("id")
      .single();
    if (error || !copy) throw new Error(error?.message ?? "Estimate copy did not save.");
    const copyId = str((copy as Record<string, unknown>).id);
    if (lines.length > 0) {
      const { error: lineError } = await dynamicTable(
        context.supabase,
        "estimate_line_items",
      ).insert(
        lines.map((line) => ({
          estimate_id: copyId,
          csi_division: line.csi_division,
          cost_code: line.cost_code,
          description: line.description,
          unit: line.unit,
          quantity: line.quantity,
          material_unit_cost_cents: line.material_unit_cost_cents,
          labor_unit_cost_cents: line.labor_unit_cost_cents,
          library_item_id: line.library_item_id,
          scope_group: line.scope_group,
          sort_order: line.sort_order,
          notes: line.notes,
        })),
      );
      if (lineError) throw new Error(lineError.message);
    }
    await recalculateEstimateTotalsInternal(context, copyId);
    return { id: copyId };
  });

const scoreLibraryItem = (item: CostLibraryItemRow, query: string) => {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const haystack = [
    item.description,
    item.category,
    item.csi_code,
    ...item.synonyms.map(String),
    ...item.keywords.map(String),
  ]
    .join(" ")
    .toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  let score = 0;
  if (item.description.toLowerCase().includes(q)) score += 60;
  if (item.description.toLowerCase().startsWith(q)) score += 25;
  for (const token of tokens) {
    if (haystack.includes(token)) score += 12;
    if (item.description.toLowerCase().includes(token)) score += 10;
    if (item.csi_code.toLowerCase().includes(token)) score += 8;
  }
  return score;
};

export const searchCostLibrary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof searchCostLibraryInput>) =>
    searchCostLibraryInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const organizationId = await getOrganizationId(context);
    await ensureCostLibrarySeeded(context, organizationId);
    const query = dynamicTable(context.supabase, "cost_library_items")
      .select("*")
      .eq("organization_id", organizationId)
      .order("csi_division", { ascending: true })
      .limit(750);
    const { data: rows, error } = data.csi_division
      ? await query.eq("csi_division", data.csi_division)
      : await query;
    if (error) throw new Error(error.message);
    const items = ((rows ?? []) as Record<string, unknown>[])
      .map((row) => normalizeLibraryItem(row, data.region_multiplier))
      .map((item) => ({ item, score: scoreLibraryItem(item, data.query) }))
      .filter(({ score }) => score > 0 || data.query.trim().length === 0)
      .sort((a, b) => b.score - a.score || a.item.description.localeCompare(b.item.description))
      .slice(0, data.limit)
      .map(({ item }) => item);
    return { items };
  });

export const listCostLibraryItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof listCostLibraryInput>) =>
    listCostLibraryInput.parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const organizationId = await getOrganizationId(context);
    await ensureCostLibrarySeeded(context, organizationId);
    let query = dynamicTable(context.supabase, "cost_library_items")
      .select("*")
      .eq("organization_id", organizationId)
      .order("csi_division", { ascending: true })
      .limit(1000);
    if (data.csi_division) query = query.eq("csi_division", data.csi_division);
    if (data.category) query = query.eq("category", data.category);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    const items = ((rows ?? []) as Record<string, unknown>[]).map((row) =>
      normalizeLibraryItem(row),
    );
    const categories = Array.from(
      new Set(items.map((item) => item.category).filter(Boolean)),
    ).sort();
    const divisions = Array.from(
      new Set(items.map((item) => item.csi_division).filter(Boolean)),
    ).sort();
    return { items, categories, divisions };
  });

export const createCostLibraryItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof costLibraryItemInput>) =>
    costLibraryItemInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const organizationId = await getOrganizationId(context);
    const { data: row, error } = await dynamicTable(context.supabase, "cost_library_items")
      .insert({
        organization_id: organizationId,
        external_id: "",
        ...data,
        source: "user",
        base_region: "national",
        csi_division: clean(data.csi_division, 8),
        csi_code: clean(data.csi_code, 16),
        category: clean(data.category, 64),
        description: clean(data.description, 500),
        unit: clean(data.unit.toUpperCase(), 16),
        synonyms: data.synonyms as unknown as Json,
        keywords: data.keywords as unknown as Json,
      })
      .select("*")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Cost library item did not save.");
    return { item: normalizeLibraryItem(row as Record<string, unknown>) };
  });

export const updateCostLibraryItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; patch: Partial<z.input<typeof costLibraryItemInput>> }) =>
    z
      .object({
        id: z.string().uuid(),
        patch: costLibraryItemInput.partial(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const current = await dynamicTable(context.supabase, "cost_library_items")
      .select("source")
      .eq("id", data.id)
      .single();
    if (current.error || !current.data) {
      throw new Error(current.error?.message ?? "Cost library item was not found.");
    }
    if (str((current.data as Record<string, unknown>).source) === "system") {
      throw new Error("System library items are read-only.");
    }
    const patch: Record<string, unknown> = { ...data.patch };
    if (typeof patch.unit === "string") patch.unit = clean(patch.unit.toUpperCase(), 16);
    if (typeof patch.description === "string") patch.description = clean(patch.description, 500);
    if (typeof patch.csi_division === "string") patch.csi_division = clean(patch.csi_division, 8);
    if (typeof patch.csi_code === "string") patch.csi_code = clean(patch.csi_code, 16);
    if (typeof patch.category === "string") patch.category = clean(patch.category, 64);
    const { data: row, error } = await dynamicTable(context.supabase, "cost_library_items")
      .update(patch)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Cost library item did not update.");
    return { item: normalizeLibraryItem(row as Record<string, unknown>) };
  });

export const deleteCostLibraryItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await dynamicTable(context.supabase, "cost_library_items")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveEstimateMarkupDefaults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof saveMarkupDefaultsInput>) =>
    saveMarkupDefaultsInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const organizationId = await getOrganizationId(context);
    const region = clean(data.default_region ?? "", 64);
    const { error } = await dynamicTable(context.supabase, "estimate_markup_defaults").upsert(
      {
        organization_id: organizationId,
        overhead_pct: data.overhead_pct ?? 1000,
        profit_pct: data.profit_pct ?? 1000,
        contingency_pct: data.contingency_pct ?? 500,
        bond_pct: data.bond_pct ?? 150,
        tax_pct: data.tax_pct ?? 0,
        general_conditions_pct: data.general_conditions_pct ?? 0,
        custom_markups: normalizeCustomMarkup(data.custom_markups) as unknown as Json,
        default_region: region,
        default_region_multiplier: data.default_region_multiplier ?? regionMultiplierFor(region),
      },
      { onConflict: "organization_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

async function convertEstimateToSovInternal(
  context: { supabase: unknown; userId: string },
  estimateId: string,
  projectId: string,
) {
  const estimate = await loadEstimate(context, estimateId);
  const lines = await loadEstimateLines(context, estimateId);
  if (lines.length === 0)
    throw new Error("Add at least one line item before pushing to a project.");
  const totals = calculateEstimateTotals(estimate, lines);

  const groups = new Map<string, { label: string; code: string; cents: number }>();
  for (const line of lines) {
    const code = line.scope_group ? "" : line.csi_division || "00";
    const key = line.scope_group || line.csi_division || "Uncoded";
    const label =
      line.scope_group ||
      (line.csi_division ? `CSI ${line.csi_division}` : "Uncoded Estimate Scope");
    const group = groups.get(key) ?? { label, code, cents: 0 };
    group.cents += Math.round(line.total_extended_cents * estimate.region_multiplier);
    groups.set(key, group);
  }

  const { error: deleteError } = await dynamicTable(context.supabase, "cost_buckets")
    .delete()
    .eq("project_id", projectId);
  if (deleteError) throw new Error(deleteError.message);

  const rows = Array.from(groups.values()).map((group, index) => ({
    project_id: projectId,
    cost_code: group.code,
    bucket: group.label,
    original_budget: centsToDollars(group.cents),
    actual_to_date: 0,
    ftc: centsToDollars(group.cents),
    source_type: "original_sov",
    source_date: new Date().toISOString().slice(0, 10),
    source_note: `Estimate: ${estimate.name}`,
    sort_order: index + 1,
  }));
  const { error: insertError } = await dynamicTable(context.supabase, "cost_buckets").insert(rows);
  if (insertError) throw new Error(insertError.message);

  const { error: projectError } = await dynamicTable(context.supabase, "projects")
    .update({
      original_cost_budget: centsToDollars(totals.adjusted_direct_cents),
      original_contract: centsToDollars(totals.total_cents),
    })
    .eq("id", projectId);
  if (projectError) throw new Error(projectError.message);

  await dynamicTable(context.supabase, "estimates")
    .update({
      project_id: projectId,
      status: estimate.status === "draft" ? "final" : estimate.status,
    })
    .eq("id", estimateId);

  const history = await dynamicTable(context.supabase, "sov_imports").insert({
    project_id: projectId,
    imported_by: context.userId,
    mode: "replace",
    source_type: "estimate",
    source_name: estimate.name,
    source_sheet: "Estimate",
    profile: "estimate",
    confidence: "high",
    has_header: true,
    raw_rows: lines.length,
    staged_rows: rows.length,
    inserted_count: rows.length,
    updated_count: 0,
    skipped_count: 0,
    merged_rows: Math.max(0, lines.length - rows.length),
    total_budget: centsToDollars(totals.adjusted_direct_cents),
    original_cost_budget: centsToDollars(totals.adjusted_direct_cents),
    selected_budget_column: null,
    selected_budget_label: "Estimate total",
    column_map: {},
    amount_choices: [],
    warnings: [],
  });

  return {
    ok: true,
    bucket_count: rows.length,
    import_history_saved: !history.error,
    import_history_error: history.error?.message ?? "",
  };
}

export const convertEstimateToSOV = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { estimate_id: string; project_id: string }) =>
    z.object({ estimate_id: z.string().uuid(), project_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) =>
    convertEstimateToSovInternal(context, data.estimate_id, data.project_id),
  );

export const convertEstimateToProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { estimate_id: string }) =>
    z.object({ estimate_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const estimate = await loadEstimate(context, data.estimate_id);
    const lines = await loadEstimateLines(context, data.estimate_id);
    if (lines.length === 0)
      throw new Error("Add at least one line item before creating a project.");
    const totals = calculateEstimateTotals(estimate, lines);
    let client = "";
    if (estimate.opportunity_id) {
      const opportunity = await dynamicTable(context.supabase, "pipeline_opportunities")
        .select("client")
        .eq("id", estimate.opportunity_id)
        .maybeSingle();
      if (!opportunity.error && opportunity.data) {
        client = str((opportunity.data as Record<string, unknown>).client);
      }
    }
    const { data: project, error } = await dynamicTable(context.supabase, "projects")
      .insert({
        owner_id: context.userId,
        organization_id: estimate.organization_id,
        name: estimate.name,
        job_number: "",
        client: client || estimate.description || estimate.name,
        project_manager: "",
        phase: "Early",
        original_contract: centsToDollars(totals.total_cents),
        original_cost_budget: centsToDollars(totals.adjusted_direct_cents),
      })
      .select("id")
      .single();
    if (error || !project) throw new Error(error?.message ?? "Project did not save.");
    const projectId = str((project as Record<string, unknown>).id);
    await convertEstimateToSovInternal(context, data.estimate_id, projectId);
    if (estimate.opportunity_id) {
      await dynamicTable(context.supabase, "pipeline_opportunities")
        .update({
          converted_project_id: projectId,
          converted_at: new Date().toISOString(),
          estimated_contract: centsToDollars(totals.total_cents),
          estimated_cost: centsToDollars(totals.adjusted_direct_cents),
        })
        .eq("id", estimate.opportunity_id);
    }
    return { project_id: projectId };
  });
