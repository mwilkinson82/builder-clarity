import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { findHarborDemoProject, harborDemoSeedAction } from "@/lib/demo-seed";
import { ESTIMATE_REGIONS, ESTIMATE_SEED_LIBRARY_ITEMS } from "@/lib/estimate-seed-data";
import type { Json } from "@/integrations/supabase/types";
import { takeoffUnitsCompatible } from "@/lib/plan-room-math";
import {
  buildEstimateQuantitySourceReview,
  emptyEstimateQuantitySourceReview,
  type EstimateTakeoffReviewSource,
} from "@/lib/estimate-quantity-source-review";

type DynamicSupabaseError = { code?: string; message: string };
type DynamicSupabaseResult<T = unknown> = { data: T | null; error: DynamicSupabaseError | null };
type DynamicSupabaseQuery = PromiseLike<DynamicSupabaseResult> & {
  select(columns?: string): DynamicSupabaseQuery;
  insert(values: unknown): DynamicSupabaseQuery;
  update(values: unknown): DynamicSupabaseQuery;
  delete(): DynamicSupabaseQuery;
  upsert(values: unknown, options?: { onConflict?: string }): DynamicSupabaseQuery;
  eq(column: string, value: unknown): DynamicSupabaseQuery;
  neq(column: string, value: unknown): DynamicSupabaseQuery;
  or(filters: string): DynamicSupabaseQuery;
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
  rpc(functionName: string, args?: Record<string, unknown>): Promise<DynamicSupabaseResult>;
};

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as DynamicSupabaseClient).from(relation);
const dynamicRpc = (supabase: unknown, functionName: string, args?: Record<string, unknown>) =>
  (supabase as DynamicSupabaseClient).rpc(functionName, args);

const ATOMIC_ESTIMATE_IMPORT_PENDING =
  "The atomic estimate-import update is still being applied. The original worksheet was not changed; try again after the Lovable migration completes.";

function isMissingAtomicEstimateImport(error: DynamicSupabaseError | null) {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST202" ||
    error?.code === "42883" ||
    /schema cache|could not find the function|function .* does not exist/i.test(message)
  );
}

const ESTIMATE_CREATE_COMMAND_PENDING =
  "Estimate creation is still being enabled on the backend. Nothing was saved; wait for Lovable to finish the migration, then try again.";

// Raw INSERT authority on public.estimates and public.estimate_line_items is
// revoked in the same migration batch that ships the create commands, so there
// is deliberately no direct-insert fallback anywhere in this module.
function isMissingEstimateCreateCommand(error: DynamicSupabaseError | null) {
  const message = error?.message ?? "";
  return Boolean(
    error &&
    (error.code === "PGRST202" ||
      error.code === "42883" ||
      /could not find the function|schema cache|does not exist/i.test(message)),
  );
}

// Header keys create_estimate_atomic accepts. project_id is intentionally not
// creatable: a non-null project marks an estimate as converted (its financial
// content becomes immutable), so project linking happens after creation via
// update_estimate_header_atomic instead.
const ESTIMATE_CREATE_HEADER_KEYS = [
  "name",
  "description",
  "opportunity_id",
  "project_type",
  "kind",
  "region",
  "region_multiplier",
  "overhead_pct",
  "profit_pct",
  "contingency_pct",
  "bond_pct",
  "tax_pct",
  "general_conditions_pct",
  "custom_markups",
] as const;

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
const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;

export type EstimateStatus = "draft" | "final" | "awarded" | "lost";
const ESTIMATE_FOLDER_VALUES = ["sales_process", "won", "not_won", "archived"] as const;
export type EstimateFolder = (typeof ESTIMATE_FOLDER_VALUES)[number];
export type MarkupBasis = "subtotal" | "material" | "labor";
export type EstimateKind = "estimate" | "master_sheet";
export const MASTER_ESTIMATE_PROJECT_TYPE = "master_sheet";
export type CostLibraryLaborBasis = "per_unit" | "per_hour" | "installed";
export const COST_LIBRARY_LABOR_BASES: Array<{
  value: CostLibraryLaborBasis;
  label: string;
  description: string;
}> = [
  {
    value: "per_unit",
    label: "Per Unit",
    description: "Labor $ is the labor price for one takeoff unit (LF, SF, EA...).",
  },
  {
    value: "per_hour",
    label: "Per Crew Hour",
    description:
      "Labor $ is the crew rate for one hour. Needs crew size and production per hour to price a unit.",
  },
  {
    value: "installed",
    label: "Installed",
    description: "Labor $ already includes material and labor for one unit. Material $ stays 0.",
  },
];
export const ESTIMATE_FOLDERS: Array<{
  value: EstimateFolder;
  label: string;
  description: string;
}> = [
  {
    value: "sales_process",
    label: "Sales Process",
    description: "Bids you are still working, pricing, or following up on.",
  },
  {
    value: "won",
    label: "Won Estimates",
    description: "Jobs you won and may push into active projects.",
  },
  {
    value: "not_won",
    label: "Not Won",
    description: "Bids you lost or decided not to chase.",
  },
  {
    value: "archived",
    label: "Archived",
    description: "Old estimates you want to keep out of the way.",
  },
];

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
  kind: EstimateKind;
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
  folder: EstimateFolder;
  is_canonical_demo: boolean;
  canonical_demo_key: string | null;
  canonical_demo_version: number | null;
  canonical_expected_total_cents: number | null;
  created_at: string;
  updated_at: string;
  line_item_count?: number;
  project_name?: string;
  opportunity_name?: string;
}

export type LineQuantitySource = "manual" | "takeoff" | "assembly";

export interface EstimateAssemblyOutputSource {
  link_id: string;
  assembly_id: string;
  measurement_id: string;
  estimate_line_item_id: string;
  output_key: string;
  output_label: string;
  output_unit: string;
  output_quantity: number;
  formula_version: string;
  status: "current" | "stale";
  last_synced_at: string;
  stale_at: string | null;
}

export interface EstimateLineItemRow {
  id: string;
  estimate_id: string;
  csi_division: string;
  cost_code: string;
  description: string;
  unit: string;
  quantity: number;
  quantity_source: LineQuantitySource;
  takeoff_quantity: number | null;
  takeoff_synced_at: string | null;
  assembly_output_quantity: number | null;
  assembly_output_synced_at: string | null;
  assembly_output_source: EstimateAssemblyOutputSource | null;
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
  labor_basis: CostLibraryLaborBasis;
  display_material_cost_cents: number;
  display_labor_cost_cents: number;
  crew_size: number | null;
  productivity_per_hour: number | null;
  synonyms: Json[];
  keywords: Json[];
  source: "system" | "user" | "imported";
  base_region: string;
  source_vendor: string;
  source_reference: string;
  effective_date: string | null;
  expires_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  escalation_pct: number;
  version_no: number;
  created_at: string;
  updated_at: string;
}

export interface CostLibraryPriceHistoryRow {
  id: string;
  cost_library_item_id: string;
  version_no: number;
  material_cost_cents: number;
  labor_cost_cents: number;
  labor_basis: CostLibraryLaborBasis;
  source_vendor: string;
  source_reference: string;
  effective_date: string | null;
  changed_at: string;
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

const normalizeEstimateStatus = (value: unknown): EstimateStatus => {
  const status = str(value, "draft");
  return status === "final" || status === "awarded" || status === "lost" ? status : "draft";
};

const estimateFolderFromStatus = (status: EstimateStatus): EstimateFolder => {
  if (status === "awarded") return "won";
  if (status === "lost") return "not_won";
  return "sales_process";
};

const normalizeEstimateFolder = (value: unknown, status: EstimateStatus): EstimateFolder => {
  const folder = str(value);
  return ESTIMATE_FOLDER_VALUES.includes(folder as EstimateFolder)
    ? (folder as EstimateFolder)
    : estimateFolderFromStatus(status);
};

const isMissingEstimateFolderColumn = (error: { code?: string; message?: string } | null) => {
  const message = error?.message ?? "";
  return Boolean(
    error &&
    (error.code === "PGRST204" ||
      error.code === "42703" ||
      (/folder/i.test(message) && /schema cache|column|could not find/i.test(message))),
  );
};

const isMissingEstimateKindColumn = (error: { code?: string; message?: string } | null) => {
  const message = error?.message ?? "";
  return Boolean(
    error &&
    (error.code === "PGRST204" ||
      error.code === "42703" ||
      (/kind/i.test(message) &&
        /schema cache|column|could not find|does not exist/i.test(message))),
  );
};

const isMissingLaborBasisColumn = (error: { code?: string; message?: string } | null) => {
  const message = error?.message ?? "";
  return Boolean(
    error &&
    (error.code === "PGRST204" ||
      error.code === "42703" ||
      (/labor_basis/i.test(message) &&
        /schema cache|column|could not find|does not exist/i.test(message))),
  );
};

const isMissingQuantityProvenanceColumn = (error: { code?: string; message?: string } | null) => {
  const message = error?.message ?? "";
  return Boolean(
    error &&
    (error.code === "PGRST204" ||
      error.code === "42703" ||
      (/quantity_source|takeoff_quantity|takeoff_synced_at/i.test(message) &&
        /schema cache|column|could not find|does not exist/i.test(message))),
  );
};

const isMissingCanonicalDemoColumn = (error: { code?: string; message?: string } | null) => {
  const message = error?.message ?? "";
  return Boolean(
    error &&
    (error.code === "PGRST204" ||
      error.code === "42703" ||
      (/is_canonical_demo|canonical_demo_key|canonical_demo_version|canonical_expected_total_cents/i.test(
        message,
      ) &&
        /schema cache|column|could not find|does not exist/i.test(message))),
  );
};

const LABOR_BASIS_PENDING_MESSAGE =
  "Labor pricing basis is still being enabled on the backend. Wait for the database migration to finish, then try again.";

const INSTALLED_MATERIAL_MESSAGE =
  "Installed costs already include material in the labor price. Set Material $/Unit to 0, or pick a different labor basis.";

const normalizeEstimate = (row: Record<string, unknown>): EstimateRow => {
  const status = normalizeEstimateStatus(row.status);
  const projectType = str(row.project_type, "commercial");
  // Transition tolerance: rows written before the kind column landed flag
  // master sheets via project_type, so treat either signal as master.
  const kind: EstimateKind =
    str(row.kind) === "master_sheet" || projectType === MASTER_ESTIMATE_PROJECT_TYPE
      ? "master_sheet"
      : "estimate";
  return {
    id: str(row.id),
    organization_id: str(row.organization_id),
    created_by: (row.created_by as string | null) ?? null,
    name: str(row.name),
    description: str(row.description),
    opportunity_id: (row.opportunity_id as string | null) ?? null,
    project_id: (row.project_id as string | null) ?? null,
    project_type: projectType,
    kind,
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
    status,
    folder: normalizeEstimateFolder(row.folder, status),
    is_canonical_demo: row.is_canonical_demo === true,
    canonical_demo_key: row.canonical_demo_key ? str(row.canonical_demo_key) : null,
    canonical_demo_version:
      row.canonical_demo_version == null ? null : Math.round(num(row.canonical_demo_version)),
    canonical_expected_total_cents:
      row.canonical_expected_total_cents == null
        ? null
        : Math.round(num(row.canonical_expected_total_cents)),
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
  };
};

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
    quantity_source:
      str(row.quantity_source) === "takeoff"
        ? "takeoff"
        : str(row.quantity_source) === "assembly"
          ? "assembly"
          : "manual",
    takeoff_quantity: row.takeoff_quantity == null ? null : num(row.takeoff_quantity),
    takeoff_synced_at: row.takeoff_synced_at == null ? null : str(row.takeoff_synced_at),
    assembly_output_quantity:
      row.assembly_output_quantity == null ? null : num(row.assembly_output_quantity),
    assembly_output_synced_at:
      row.assembly_output_synced_at == null ? null : str(row.assembly_output_synced_at),
    assembly_output_source: null,
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

const normalizeLaborBasis = (value: unknown): CostLibraryLaborBasis => {
  const basis = str(value);
  return basis === "per_hour" || basis === "installed" ? basis : "per_unit";
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
    labor_basis: normalizeLaborBasis(row.labor_basis),
    display_material_cost_cents: Math.round(material * regionMultiplier),
    display_labor_cost_cents: Math.round(labor * regionMultiplier),
    crew_size: row.crew_size == null ? null : num(row.crew_size),
    productivity_per_hour:
      row.productivity_per_hour == null ? null : num(row.productivity_per_hour),
    synonyms: arr(row.synonyms),
    keywords: arr(row.keywords),
    source: str(row.source, "system") as CostLibraryItemRow["source"],
    base_region: str(row.base_region, "national"),
    source_vendor: str(row.source_vendor),
    source_reference: str(row.source_reference),
    effective_date: row.effective_date ? str(row.effective_date) : null,
    expires_at: row.expires_at ? str(row.expires_at) : null,
    verified_at: row.verified_at ? str(row.verified_at) : null,
    verified_by: row.verified_by ? str(row.verified_by) : null,
    escalation_pct: Math.round(num(row.escalation_pct)),
    version_no: Math.max(1, Math.round(num(row.version_no, 1))),
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

export type LibraryUnitCostResolution =
  | { ok: true; material_cost_cents: number; labor_cost_cents: number }
  | { ok: false; message: string };

// Converts a cost library row into per-unit material and labor costs based on
// its labor basis. per_hour rows need crew_size and productivity_per_hour;
// callers must block the pull (not guess) when the resolution fails.
export function resolveLibraryUnitCosts(
  item: Pick<
    CostLibraryItemRow,
    | "description"
    | "material_cost_cents"
    | "labor_cost_cents"
    | "labor_basis"
    | "crew_size"
    | "productivity_per_hour"
  >,
): LibraryUnitCostResolution {
  if (item.labor_basis === "per_hour") {
    const crewSize = item.crew_size ?? 0;
    const productivity = item.productivity_per_hour ?? 0;
    if (crewSize <= 0 || productivity <= 0) {
      return {
        ok: false,
        message: `"${item.description}" is priced per crew hour. Add its crew size and production per hour in the Cost Library, then pull it again.`,
      };
    }
    return {
      ok: true,
      material_cost_cents: item.material_cost_cents,
      labor_cost_cents: Math.round((item.labor_cost_cents * crewSize) / productivity),
    };
  }
  if (item.labor_basis === "installed") {
    return { ok: true, material_cost_cents: 0, labor_cost_cents: item.labor_cost_cents };
  }
  return {
    ok: true,
    material_cost_cents: item.material_cost_cents,
    labor_cost_cents: item.labor_cost_cents,
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
    .select("external_id,source")
    .eq("organization_id", organizationId)
    .limit(5000);
  if (existingError) throw new Error(existingError.message);

  const existingSystemIds = new Set(
    ((existing ?? []) as Record<string, unknown>[])
      .filter((row) => str(row.source) === "system")
      .map((row) => str(row.external_id))
      .filter(Boolean),
  );

  const rows = ESTIMATE_SEED_LIBRARY_ITEMS.filter(
    (item) => item.external_id && !existingSystemIds.has(item.external_id),
  ).map((item) => ({
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

async function ensureHarborDemoEstimate(
  context: { supabase: unknown; userId: string },
  organizationId: string,
) {
  let existingResult = await dynamicTable(context.supabase, "estimates")
    .select("id,name,project_id,is_canonical_demo,canonical_demo_key")
    .eq("organization_id", organizationId)
    .limit(500);
  if (existingResult.error && isMissingCanonicalDemoColumn(existingResult.error)) {
    // Until Lovable applies the migration, preserve the legacy seed behavior
    // without presenting a sample as protected when the database cannot lock it.
    existingResult = await dynamicTable(context.supabase, "estimates")
      .select("id,name,project_id")
      .eq("organization_id", organizationId)
      .limit(500);
    if (existingResult.error) throw new Error(existingResult.error.message);
    const legacyRows = (existingResult.data ?? []) as Record<string, unknown>[];
    if (
      legacyRows.some(
        (estimate) => str(estimate.name).toLowerCase() === HARBOR_DEMO_ESTIMATE_NAME.toLowerCase(),
      )
    ) {
      return;
    }
    // Do not attempt a partially protected seed. The next list request after
    // the migration lands will create the canonical sample atomically.
    return;
  } else if (existingResult.error) {
    throw new Error(existingResult.error.message);
  } else {
    const existingRows = (existingResult.data ?? []) as Record<string, unknown>[];
    if (
      existingRows.some(
        (estimate) =>
          estimate.is_canonical_demo === true &&
          str(estimate.canonical_demo_key) === HARBOR_CANONICAL_DEMO_KEY,
      )
    ) {
      return;
    }
  }

  const { data: projects, error: projectsError } = await dynamicTable(context.supabase, "projects")
    .select("id,name,client,job_number,archived_at")
    .eq("organization_id", organizationId)
    .limit(100);
  if (projectsError) throw new Error(projectsError.message);

  const harborProject = findHarborDemoProject((projects ?? []) as Record<string, unknown>[]);
  // An archived demo project means the company opted out of the demo:
  // the sample estimate must not come back either.
  if (harborDemoSeedAction(harborProject) === "skip") return;

  const externalIds = Array.from(
    new Set(HARBOR_CANONICAL_ESTIMATE_LINES.map((line) => line.external_id).filter(Boolean)),
  );
  const libraryResult =
    externalIds.length > 0
      ? await dynamicTable(context.supabase, "cost_library_items")
          .select("id,external_id")
          .eq("organization_id", organizationId)
          .in("external_id", externalIds)
      : { data: [], error: null };
  if (libraryResult.error) throw new Error(libraryResult.error.message);

  const libraryIds = new Map(
    ((libraryResult.data ?? []) as Record<string, unknown>[]).map((row) => [
      str(row.external_id),
      str(row.id),
    ]),
  );

  // The estimate row, every canonical line, and the authoritative totals are
  // one create_estimate_atomic transaction. The deterministic key plus the
  // command's content fingerprint make the seed idempotent: a crash between
  // create and protect resumes with the same estimate id, never a duplicate.
  // The command always creates a draft; the worksheet is frozen further down
  // only after all lines and totals exist (final estimates reject line DML).
  const summary = await createEstimateAtomicCommand(context, {
    organizationId,
    header: {
      name: HARBOR_CANONICAL_ESTIMATE_NAME,
      description:
        "Read-only estimating workbench sample. Create a working copy before changing quantities, pricing, takeoffs, or drawings.",
      project_type: "residential",
      kind: "estimate",
      region: "national",
      region_multiplier: 1,
      overhead_pct: 800,
      profit_pct: 1200,
      contingency_pct: 500,
      bond_pct: 0,
      tax_pct: 0,
      general_conditions_pct: 450,
      custom_markups: [],
    },
    initialLines: harborSeedLineInputs(
      HARBOR_CANONICAL_ESTIMATE_LINES,
      libraryIds,
      "Canonical Harbor Residence learning estimate. Duplicate before editing.",
    ),
    // Org-scoped: the create-operation journal is unique per (actor, key) and
    // the fingerprint includes the organization, so a super admin seeding a
    // second company must not collide with the first seed's key.
    operationKey: `canonical:harbor-residence-v1:create:${organizationId}`,
    fallbackMessage: "Harbor sample estimate did not save.",
  });

  const estimateId = str(summary.id);
  const commandTotals =
    summary.totals && typeof summary.totals === "object" && !Array.isArray(summary.totals)
      ? (summary.totals as Record<string, unknown>)
      : {};
  const totalCents = Math.round(num(commandTotals.total_with_markups_cents));
  if (totalCents !== HARBOR_CANONICAL_TOTAL_CENTS) {
    throw new Error(`Canonical Harbor sample total drifted to ${totalCents} cents.`);
  }

  const finalizeResult = await dynamicRpc(context.supabase, "update_estimate_header_atomic", {
    p_estimate_id: estimateId,
    p_patch: { status: "final" },
    p_operation_key: `canonical:${estimateId}:finalize:v1`,
  });
  if (finalizeResult.error) throw new Error(finalizeResult.error.message);

  const { error: protectError } = await dynamicTable(context.supabase, "estimates")
    .update({
      is_canonical_demo: true,
      canonical_demo_key: HARBOR_CANONICAL_DEMO_KEY,
      canonical_demo_version: 1,
      canonical_expected_total_cents: HARBOR_CANONICAL_TOTAL_CENTS,
    })
    .eq("id", estimateId);
  if (protectError) throw new Error(protectError.message);

  // Old seeded demos remain useful company data, but they must not masquerade
  // as the protected sample in the list.
  await dynamicTable(context.supabase, "estimates")
    .update({ name: HARBOR_WORKING_COPY_NAME })
    .eq("organization_id", organizationId)
    .eq("name", HARBOR_DEMO_ESTIMATE_NAME)
    .neq("id", estimateId);
}

// Estimate creation is one database command: header validation, optional
// initial lines, authoritative totals, and the idempotency journal all commit
// together, keyed per (user, operation_key) with a content fingerprint.
async function createEstimateAtomicCommand(
  context: { supabase: unknown },
  input: {
    organizationId: string;
    header: Record<string, unknown>;
    initialLines?: Array<Record<string, unknown>>;
    operationKey: string;
    fallbackMessage: string;
  },
): Promise<Record<string, unknown>> {
  const header: Record<string, unknown> = {};
  for (const key of ESTIMATE_CREATE_HEADER_KEYS) {
    if (input.header[key] !== undefined) header[key] = input.header[key];
  }
  const result = await dynamicRpc(context.supabase, "create_estimate_atomic", {
    p_organization_id: input.organizationId,
    p_header: header,
    p_initial_lines: input.initialLines ?? [],
    p_operation_key: input.operationKey,
  });
  if (result.error) {
    if (isMissingEstimateCreateCommand(result.error)) {
      throw new Error(ESTIMATE_CREATE_COMMAND_PENDING);
    }
    throw new Error(result.error.message);
  }
  if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
    throw new Error(input.fallbackMessage);
  }
  const summary = result.data as Record<string, unknown>;
  if (!str(summary.id)) throw new Error(input.fallbackMessage);
  return summary;
}

// Same idempotency pattern for appending lines to a draft estimate: the rows,
// the sort-order assignment, and the totals recalculation are one transaction.
async function createEstimateLineItemsAtomicCommand(
  context: { supabase: unknown },
  input: {
    estimateId: string;
    lines: Array<Record<string, unknown>>;
    operationKey: string;
    fallbackMessage: string;
  },
): Promise<Record<string, unknown>> {
  const result = await dynamicRpc(context.supabase, "create_estimate_line_items_atomic", {
    p_estimate_id: input.estimateId,
    p_lines: input.lines,
    p_operation_key: input.operationKey,
  });
  if (result.error) {
    if (isMissingEstimateCreateCommand(result.error)) {
      throw new Error(ESTIMATE_CREATE_COMMAND_PENDING);
    }
    throw new Error(result.error.message);
  }
  if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
    throw new Error(input.fallbackMessage);
  }
  return result.data as Record<string, unknown>;
}

async function insertEstimateRow(
  context: { supabase: unknown },
  insert: Record<string, unknown> & { kind: EstimateKind },
  fallbackMessage: string,
  operationKey?: string,
) {
  // Callers with a natural retry identity pass a deterministic operationKey;
  // user-initiated creates mint a fresh key per request.
  const summary = await createEstimateAtomicCommand(context, {
    organizationId: str(insert.organization_id),
    header: insert,
    operationKey: operationKey ?? crypto.randomUUID(),
    fallbackMessage,
  });
  return str(summary.id);
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

function isMissingAssemblyOutputSourceRelation(error: DynamicSupabaseError | null) {
  const message = error?.message.toLowerCase() ?? "";
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    ((message.includes("does not exist") || message.includes("schema cache")) &&
      message.includes("estimate_takeoff_assembly_output_links"))
  );
}

async function loadAssemblyOutputSources(
  context: { supabase: unknown },
  estimateId: string,
): Promise<Map<string, EstimateAssemblyOutputSource>> {
  const { data, error } = await dynamicTable(
    context.supabase,
    "estimate_takeoff_assembly_output_links",
  )
    .select(
      "id,assembly_id,output_key,estimate_line_item_id,formula_version,output_label,output_unit,output_quantity,status,last_synced_at,stale_at",
    )
    .eq("estimate_id", estimateId);

  if (error) {
    if (isMissingAssemblyOutputSourceRelation(error)) return new Map();
    throw new Error(error.message);
  }

  const links = (data ?? []) as Record<string, unknown>[];
  const assemblyIds = Array.from(new Set(links.map((row) => str(row.assembly_id)).filter(Boolean)));
  const measurementByAssemblyId = new Map<string, string>();

  if (assemblyIds.length > 0) {
    const assembliesResult = await dynamicTable(context.supabase, "estimate_takeoff_assemblies")
      .select("id,takeoff_measurement_id")
      .in("id", assemblyIds);
    if (assembliesResult.error) throw new Error(assembliesResult.error.message);
    for (const row of (assembliesResult.data ?? []) as Record<string, unknown>[]) {
      measurementByAssemblyId.set(str(row.id), str(row.takeoff_measurement_id));
    }
  }

  const sources = new Map<string, EstimateAssemblyOutputSource>();
  for (const row of links) {
    const estimateLineItemId = str(row.estimate_line_item_id);
    const assemblyId = str(row.assembly_id);
    const measurementId = measurementByAssemblyId.get(assemblyId) ?? "";
    if (!estimateLineItemId || !assemblyId || !measurementId) continue;
    sources.set(estimateLineItemId, {
      link_id: str(row.id),
      assembly_id: assemblyId,
      measurement_id: measurementId,
      estimate_line_item_id: estimateLineItemId,
      output_key: str(row.output_key),
      output_label: str(row.output_label),
      output_unit: str(row.output_unit),
      output_quantity: num(row.output_quantity),
      formula_version: str(row.formula_version),
      status: str(row.status) === "stale" ? "stale" : "current",
      last_synced_at: str(row.last_synced_at),
      stale_at: row.stale_at == null ? null : str(row.stale_at),
    });
  }
  return sources;
}

function isMissingQuantitySourceReviewSchema(error: DynamicSupabaseError | null) {
  const message = error?.message.toLowerCase() ?? "";
  return Boolean(
    error &&
    (error.code === "42P01" ||
      error.code === "PGRST205" ||
      ((error.code === "42703" || error.code === "PGRST204") &&
        message.includes("calculation_status")) ||
      ((message.includes("does not exist") || message.includes("schema cache")) &&
        (message.includes("estimate_takeoff_measurements") ||
          message.includes("estimate_plan_sheets")))),
  );
}

async function loadEstimateQuantitySourceReview(
  context: { supabase: unknown },
  estimateId: string,
  lines: EstimateLineItemRow[],
  assemblySources: Map<string, EstimateAssemblyOutputSource>,
) {
  const [takeoffsResult, sheetsResult] = await Promise.all([
    dynamicTable(context.supabase, "estimate_takeoff_measurements")
      .select(
        "id,estimate_line_item_id,plan_sheet_id,label,unit,quantity,calculation_status,updated_at",
      )
      .eq("estimate_id", estimateId),
    dynamicTable(context.supabase, "estimate_plan_sheets")
      .select("id,sheet_number,sheet_name")
      .eq("estimate_id", estimateId),
  ]);

  const schemaError = takeoffsResult.error ?? sheetsResult.error;
  if (isMissingQuantitySourceReviewSchema(schemaError)) {
    return emptyEstimateQuantitySourceReview(false);
  }
  if (takeoffsResult.error) throw new Error(takeoffsResult.error.message);
  if (sheetsResult.error) throw new Error(sheetsResult.error.message);

  const takeoffs: EstimateTakeoffReviewSource[] = (
    (takeoffsResult.data ?? []) as Record<string, unknown>[]
  ).map((row) => {
    const rawStatus = str(row.calculation_status, "review_required");
    const calculationStatus: EstimateTakeoffReviewSource["calculation_status"] =
      rawStatus === "current" ||
      rawStatus === "unverified_scale" ||
      rawStatus === "stale" ||
      rawStatus === "review_required"
        ? rawStatus
        : "review_required";
    return {
      id: str(row.id),
      estimate_line_item_id:
        row.estimate_line_item_id == null ? null : str(row.estimate_line_item_id),
      plan_sheet_id: str(row.plan_sheet_id),
      label: str(row.label),
      unit: str(row.unit),
      quantity: num(row.quantity),
      calculation_status: calculationStatus,
      updated_at: str(row.updated_at),
    };
  });

  return buildEstimateQuantitySourceReview({
    takeoffs,
    assemblies: Array.from(assemblySources.values()).map((source) => ({
      link_id: source.link_id,
      measurement_id: source.measurement_id,
      estimate_line_item_id: source.estimate_line_item_id,
      output_label: source.output_label,
      output_unit: source.output_unit,
      output_quantity: source.output_quantity,
      formula_version: source.formula_version,
      status: source.status,
      last_synced_at: source.last_synced_at,
      stale_at: source.stale_at,
    })),
    lines: lines.map((line) => ({ id: line.id, description: line.description })),
    sheets: ((sheetsResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: str(row.id),
      sheet_number: str(row.sheet_number),
      sheet_name: str(row.sheet_name),
    })),
  });
}

export async function recalculateEstimateTotalsInternal(
  context: { supabase: unknown },
  estimateId: string,
) {
  const result = await dynamicRpc(context.supabase, "recalculate_estimate_totals_atomic", {
    p_estimate_id: estimateId,
  });
  if (result.error) throw new Error(result.error.message);
  if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
    throw new Error("Estimate totals did not update.");
  }
  const summary = result.data as Record<string, unknown>;
  const estimate = await loadEstimate(context, estimateId);
  return {
    estimate,
    totals: {
      material_cents: Math.round(num(summary.subtotal_material_cents)),
      labor_cents: Math.round(num(summary.subtotal_labor_cents)),
      direct_cents: Math.round(num(summary.subtotal_cents)),
      total_cents: Math.round(num(summary.total_with_markups_cents)),
    },
  };
}

const customMarkupSchema = z.object({
  name: z.string().min(1).max(80),
  pct: z.number().int().min(0).max(100000),
  applies_to: z.enum(["subtotal", "material", "labor"]).default("subtotal"),
});
const estimateFolderSchema = z.enum(ESTIMATE_FOLDER_VALUES);

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
  kind: z.enum(["estimate", "master_sheet"]).optional().default("estimate"),
  region: z.string().max(64).optional().default(""),
});

const updateEstimateInput = z.object({
  id: z.string().uuid(),
  operation_key: z.string().uuid(),
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
      folder: estimateFolderSchema.optional(),
      ...markupPatchSchema,
    })
    .refine((patch) => Object.keys(patch).length > 0, "No estimate changes were provided."),
});

const lineItemObject = z.object({
  estimate_id: z.string().uuid(),
  csi_division: z.string().max(8).optional().default(""),
  cost_code: z.string().max(32).optional().default(""),
  description: z.string().min(1).max(500),
  unit: z.string().min(1).max(16),
  quantity: z.number().min(0).max(999999999).default(0),
  material_unit_cost_cents: z.number().int().min(0).max(MAX_SAFE_CENTS).default(0),
  labor_unit_cost_cents: z.number().int().min(0).max(MAX_SAFE_CENTS).default(0),
  library_item_id: z.string().uuid().nullable().optional(),
  scope_group: z.string().max(200).optional().default(""),
  notes: z.string().max(2000).optional().default(""),
});

function validateEstimateLineExtension(
  line: { quantity: number; material_unit_cost_cents: number; labor_unit_cost_cents: number },
  context: z.RefinementCtx,
) {
  const materialExtension = Math.round(line.quantity * line.material_unit_cost_cents);
  const laborExtension = Math.round(line.quantity * line.labor_unit_cost_cents);
  const totalExtension = materialExtension + laborExtension;
  if (
    !Number.isSafeInteger(materialExtension) ||
    !Number.isSafeInteger(laborExtension) ||
    !Number.isSafeInteger(totalExtension) ||
    totalExtension > MAX_SAFE_CENTS
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "The extended estimate-line value exceeds the supported accounting range.",
      path: ["quantity"],
    });
  }
}

const lineItemInput = lineItemObject
  .extend({
    // Optional today so a client that retries can already deduplicate;
    // caller-owned deterministic keys are the follow-up.
    operation_key: z.string().trim().min(1).max(200).optional(),
  })
  .superRefine(validateEstimateLineExtension);

const updateLineItemInput = z.object({
  id: z.string().uuid(),
  operation_key: z.string().uuid(),
  patch: lineItemObject
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
  unit: z.string().max(16).optional().default(""),
  limit: z.number().int().min(1).max(50).optional().default(20),
  region_multiplier: z.number().min(0).max(10).optional().default(1),
});

const costLibraryItemInput = z.object({
  csi_division: z.string().min(1).max(8),
  csi_code: z.string().max(16).optional().default(""),
  category: z.string().max(64).optional().default(""),
  description: z.string().min(1).max(500),
  unit: z.string().min(1).max(16),
  material_cost_cents: z.number().int().min(0).max(MAX_SAFE_CENTS).default(0),
  labor_cost_cents: z.number().int().min(0).max(MAX_SAFE_CENTS).default(0),
  labor_basis: z.enum(["per_unit", "per_hour", "installed"]).optional().default("per_unit"),
  crew_size: z.number().min(0).max(999).nullable().optional(),
  productivity_per_hour: z.number().min(0).max(999999).nullable().optional(),
  source_vendor: z.string().max(200).optional().default(""),
  source_reference: z.string().max(500).optional().default(""),
  effective_date: z.string().date().nullable().optional(),
  expires_at: z.string().date().nullable().optional(),
  escalation_pct: z.number().int().min(-10000).max(100000).optional().default(0),
  synonyms: z.array(z.string().max(80)).max(40).optional().default([]),
  keywords: z.array(z.string().max(80)).max(60).optional().default([]),
});

const importCostLibraryItemsInput = z.object({
  items: z.array(costLibraryItemInput).min(1).max(500),
});

const estimateLineImportItemInput = lineItemObject
  .omit({ estimate_id: true })
  .extend({
    quantity: z.number().gt(0).max(999999999),
  })
  .superRefine(validateEstimateLineExtension);

const importEstimateLineItemsInput = z.object({
  estimate_id: z.string().uuid(),
  mode: z.enum(["append", "replace"]).optional().default("append"),
  rows: z.array(estimateLineImportItemInput).min(1).max(500),
  idempotency_key: z.string().trim().min(1).max(200),
});

const createBlankLineItemsInput = z.object({
  estimate_id: z.string().uuid(),
  count: z.number().int().min(1).max(25),
  // Optional today so a client that retries can already deduplicate;
  // caller-owned deterministic keys are the follow-up.
  operation_key: z.string().trim().min(1).max(200).optional(),
});

const duplicateEstimateInput = z.object({
  id: z.string().uuid(),
  as_project_estimate: z.boolean().optional().default(false),
  operation_key: z.string().uuid(),
});

const deleteEstimateInput = z.object({
  id: z.string().uuid(),
  operation_key: z.string().uuid(),
});

const saveMarkupDefaultsInput = z.object({
  ...markupPatchSchema,
  default_region: z.string().max(64).optional().default(""),
  default_region_multiplier: z.number().min(0).max(10).optional(),
});

const HARBOR_DEMO_ESTIMATE_NAME = "Harbor Residence - Sample Estimate";
const HARBOR_CANONICAL_ESTIMATE_NAME = "Harbor Residence — Canonical Sample";
const HARBOR_WORKING_COPY_NAME = "Harbor Residence — Working Copy";
const HARBOR_CANONICAL_DEMO_KEY = "harbor-residence-v1";
const HARBOR_CANONICAL_TOTAL_CENTS = 160_613_700;
const HARBOR_SAMPLE_MASTER_SHEET_NAME = "Harbor Residence - Sample Master Sheet";

const HARBOR_DEMO_ESTIMATE_LINES = [
  {
    external_id: "temp-fence",
    csi_division: "01",
    cost_code: "01-500",
    scope_group: "General Conditions",
    description: "Temporary chain link fence and site protection",
    unit: "LF",
    quantity: 420,
    material_unit_cost_cents: 500,
    labor_unit_cost_cents: 0,
  },
  {
    external_id: "dumpster",
    csi_division: "01",
    cost_code: "01-740",
    scope_group: "General Conditions",
    description: "Dumpster rental and hauling allowance",
    unit: "EA",
    quantity: 10,
    material_unit_cost_cents: 45000,
    labor_unit_cost_cents: 0,
  },
  {
    external_id: "grading",
    csi_division: "31",
    cost_code: "31-220",
    scope_group: "Sitework",
    description: "Clearing, grading, and site logistics package",
    unit: "LS",
    quantity: 1,
    material_unit_cost_cents: 1800000,
    labor_unit_cost_cents: 3200000,
  },
  {
    external_id: "excavation-footing",
    csi_division: "31",
    cost_code: "31-230",
    scope_group: "Sitework",
    description: "Foundation excavation and backfill",
    unit: "CY",
    quantity: 580,
    material_unit_cost_cents: 0,
    labor_unit_cost_cents: 4800,
  },
  {
    external_id: "footing-24x12",
    csi_division: "03",
    cost_code: "03-110",
    scope_group: "Concrete",
    description: "Continuous concrete footings",
    unit: "LF",
    quantity: 560,
    material_unit_cost_cents: 1300,
    labor_unit_cost_cents: 1600,
  },
  {
    external_id: "slab-6in",
    csi_division: "03",
    cost_code: "03-300",
    scope_group: "Concrete",
    description: "Six-inch slab-on-grade package",
    unit: "SF",
    quantity: 6200,
    material_unit_cost_cents: 425,
    labor_unit_cost_cents: 320,
  },
  {
    external_id: "rebar-5",
    csi_division: "03",
    cost_code: "03-520",
    scope_group: "Concrete",
    description: "Reinforcing steel allowance",
    unit: "LB",
    quantity: 7200,
    material_unit_cost_cents: 95,
    labor_unit_cost_cents: 55,
  },
  {
    external_id: "lumber-framing",
    csi_division: "06",
    cost_code: "06-100",
    scope_group: "Structure",
    description: "Rough framing material and labor package",
    unit: "LS",
    quantity: 1,
    material_unit_cost_cents: 24500000,
    labor_unit_cost_cents: 13200000,
  },
  {
    external_id: "wood-trusses",
    csi_division: "06",
    cost_code: "06-175",
    scope_group: "Structure",
    description: "Roof trusses and installation",
    unit: "SF",
    quantity: 6800,
    material_unit_cost_cents: 1350,
    labor_unit_cost_cents: 425,
  },
  {
    external_id: "plywood-sheathing",
    csi_division: "06",
    cost_code: "06-300",
    scope_group: "Structure",
    description: "Wall and roof sheathing",
    unit: "SF",
    quantity: 9200,
    material_unit_cost_cents: 285,
    labor_unit_cost_cents: 140,
  },
  {
    external_id: "roofing-asphalt-shingle",
    csi_division: "07",
    cost_code: "07-310",
    scope_group: "Envelope",
    description: "Architectural shingle roofing system",
    unit: "SF",
    quantity: 6800,
    material_unit_cost_cents: 575,
    labor_unit_cost_cents: 325,
  },
  {
    external_id: "window-vinyl",
    csi_division: "08",
    cost_code: "08-500",
    scope_group: "Envelope",
    description: "Window package with install labor",
    unit: "EA",
    quantity: 42,
    material_unit_cost_cents: 185000,
    labor_unit_cost_cents: 24000,
  },
  {
    external_id: "wood-door",
    csi_division: "08",
    cost_code: "08-140",
    scope_group: "Envelope",
    description: "Exterior and interior door package",
    unit: "EA",
    quantity: 31,
    material_unit_cost_cents: 62000,
    labor_unit_cost_cents: 18000,
  },
  {
    external_id: "stucco",
    csi_division: "09",
    cost_code: "09-240",
    scope_group: "Envelope",
    description: "Stucco and exterior cladding package",
    unit: "SF",
    quantity: 7900,
    material_unit_cost_cents: 850,
    labor_unit_cost_cents: 725,
  },
  {
    external_id: "labor-plumbing-rough",
    csi_division: "22",
    cost_code: "22-100",
    scope_group: "MEP",
    description: "Plumbing rough-in and fixture allowance",
    unit: "LS",
    quantity: 1,
    material_unit_cost_cents: 8200000,
    labor_unit_cost_cents: 5800000,
  },
  {
    external_id: "light-fixture",
    csi_division: "26",
    cost_code: "26-100",
    scope_group: "MEP",
    description: "Electrical rough-in, trim, and lighting allowance",
    unit: "LS",
    quantity: 1,
    material_unit_cost_cents: 11000000,
    labor_unit_cost_cents: 7400000,
  },
  {
    external_id: "labor-residential-hvac",
    csi_division: "23",
    cost_code: "23-100",
    scope_group: "MEP",
    description: "Residential HVAC equipment and installation",
    unit: "LS",
    quantity: 1,
    material_unit_cost_cents: 7200000,
    labor_unit_cost_cents: 4400000,
  },
  {
    external_id: "batt-insulation-r19",
    csi_division: "07",
    cost_code: "07-210",
    scope_group: "Interior Buildout",
    description: "Wall and attic insulation package",
    unit: "SF",
    quantity: 18500,
    material_unit_cost_cents: 125,
    labor_unit_cost_cents: 68,
  },
  {
    external_id: "drywall-1-2",
    csi_division: "09",
    cost_code: "09-290",
    scope_group: "Interior Buildout",
    description: "Drywall hang, finish, and texture",
    unit: "SF",
    quantity: 28000,
    material_unit_cost_cents: 78,
    labor_unit_cost_cents: 165,
  },
  {
    external_id: "ceramic-tile-floor",
    csi_division: "09",
    cost_code: "09-301",
    scope_group: "Finishes",
    description: "Tile floors and wet-wall finishes",
    unit: "SF",
    quantity: 2900,
    material_unit_cost_cents: 890,
    labor_unit_cost_cents: 840,
  },
  {
    external_id: "hardwood-flooring",
    csi_division: "09",
    cost_code: "09-640",
    scope_group: "Finishes",
    description: "Hardwood flooring package",
    unit: "SF",
    quantity: 4100,
    material_unit_cost_cents: 1050,
    labor_unit_cost_cents: 580,
  },
  {
    external_id: "labor-cabinets",
    csi_division: "06",
    cost_code: "06-410",
    scope_group: "Finishes",
    description: "Custom cabinet package with install",
    unit: "LS",
    quantity: 1,
    material_unit_cost_cents: 18000000,
    labor_unit_cost_cents: 3400000,
  },
  {
    external_id: "countertop",
    csi_division: "12",
    cost_code: "12-360",
    scope_group: "Finishes",
    description: "Stone countertops and slab install",
    unit: "SF",
    quantity: 380,
    material_unit_cost_cents: 7200,
    labor_unit_cost_cents: 1500,
  },
  {
    external_id: "interior-paint",
    csi_division: "09",
    cost_code: "09-910",
    scope_group: "Finishes",
    description: "Interior prime and finish paint",
    unit: "SF",
    quantity: 18500,
    material_unit_cost_cents: 58,
    labor_unit_cost_cents: 135,
  },
  {
    external_id: "finish-carpentry",
    csi_division: "06",
    cost_code: "06-600",
    scope_group: "Finishes",
    description: "Finish carpentry, trim, and punch labor",
    unit: "LS",
    quantity: 1,
    material_unit_cost_cents: 7400000,
    labor_unit_cost_cents: 9600000,
  },
  {
    external_id: "",
    csi_division: "01",
    cost_code: "01-310",
    scope_group: "General Conditions",
    description: "Project supervision, warranty, and closeout allowance",
    unit: "MO",
    quantity: 10,
    material_unit_cost_cents: 0,
    labor_unit_cost_cents: 2400000,
  },
] as const;

const HARBOR_SAMPLE_MASTER_SHEET_LINES = HARBOR_DEMO_ESTIMATE_LINES.filter((line) =>
  [
    "01-500",
    "01-740",
    "31-220",
    "03-300",
    "06-100",
    "06-175",
    "07-310",
    "08-500",
    "09-290",
    "09-301",
    "09-640",
    "06-410",
    "12-360",
    "22-100",
    "26-100",
  ].includes(line.cost_code),
);

const HARBOR_CANONICAL_ESTIMATE_LINES = HARBOR_SAMPLE_MASTER_SHEET_LINES.map((line) =>
  line.cost_code === "31-220" ? { ...line, material_unit_cost_cents: 1_632_523 } : { ...line },
);

type HarborSeedLine = {
  external_id: string;
  csi_division: string;
  cost_code: string;
  scope_group: string;
  description: string;
  unit: string;
  quantity: number;
  material_unit_cost_cents: number;
  labor_unit_cost_cents: number;
};

// Maps seed rows onto the line keys create_estimate_atomic accepts. Sort order
// is assigned by the command from array position, matching the seed order.
function harborSeedLineInputs(
  lines: readonly HarborSeedLine[],
  libraryIds: Map<string, string>,
  notes: string,
) {
  return lines.map((line) => ({
    csi_division: line.csi_division,
    cost_code: line.cost_code,
    description: line.description,
    unit: line.unit,
    quantity: line.unit === "LS" ? 1 : line.quantity,
    material_unit_cost_cents: line.material_unit_cost_cents,
    labor_unit_cost_cents: line.labor_unit_cost_cents,
    library_item_id: line.external_id ? (libraryIds.get(line.external_id) ?? null) : null,
    scope_group: line.scope_group,
    notes,
  }));
}

async function ensureHarborSampleMasterSheet(
  context: { supabase: unknown; userId: string },
  organizationId: string,
) {
  let existingResult = await dynamicTable(context.supabase, "estimates")
    .select("id,name,project_type,kind")
    .eq("organization_id", organizationId)
    .limit(500);
  if (existingResult.error && isMissingEstimateKindColumn(existingResult.error)) {
    existingResult = await dynamicTable(context.supabase, "estimates")
      .select("id,name,project_type")
      .eq("organization_id", organizationId)
      .limit(500);
  }
  if (existingResult.error) throw new Error(existingResult.error.message);

  const estimates = (existingResult.data ?? []) as Record<string, unknown>[];
  if (
    estimates.some(
      (estimate) =>
        (str(estimate.kind) === "master_sheet" ||
          str(estimate.project_type) === MASTER_ESTIMATE_PROJECT_TYPE) &&
        str(estimate.name).toLowerCase() === HARBOR_SAMPLE_MASTER_SHEET_NAME.toLowerCase(),
    )
  ) {
    return;
  }

  const { data: projects, error: projectsError } = await dynamicTable(context.supabase, "projects")
    .select("id,name,client,job_number,archived_at")
    .eq("organization_id", organizationId)
    .limit(100);
  if (projectsError) throw new Error(projectsError.message);

  const harborProject = findHarborDemoProject((projects ?? []) as Record<string, unknown>[]);
  // Same opt-out rule as the sample estimate: archived demo, no reseed.
  if (harborDemoSeedAction(harborProject) === "skip") return;

  const externalIds = Array.from(
    new Set(HARBOR_SAMPLE_MASTER_SHEET_LINES.map((line) => line.external_id).filter(Boolean)),
  );
  const libraryResult =
    externalIds.length > 0
      ? await dynamicTable(context.supabase, "cost_library_items")
          .select("id,external_id")
          .eq("organization_id", organizationId)
          .in("external_id", externalIds)
      : { data: [], error: null };
  if (libraryResult.error) throw new Error(libraryResult.error.message);

  const libraryIds = new Map(
    ((libraryResult.data ?? []) as Record<string, unknown>[]).map((row) => [
      str(row.external_id),
      str(row.id),
    ]),
  );

  // One create_estimate_atomic transaction seeds the master sheet and all of
  // its sample lines; the org-scoped deterministic key makes reseeds no-ops.
  // The sample is no longer linked to the demo project: a non-null project_id
  // marks an estimate as converted, which would freeze this editable sample.
  await createEstimateAtomicCommand(context, {
    organizationId,
    header: {
      name: HARBOR_SAMPLE_MASTER_SHEET_NAME,
      description:
        "Sample reusable master sheet seeded from Harbor Residence. Open it to see the format, copy it for your company, or create a project estimate from it.",
      project_type: "commercial",
      kind: "master_sheet",
      region: "national",
      region_multiplier: 1,
      overhead_pct: 800,
      profit_pct: 1200,
      contingency_pct: 500,
      bond_pct: 0,
      tax_pct: 0,
      general_conditions_pct: 450,
      custom_markups: [],
    },
    initialLines: harborSeedLineInputs(
      HARBOR_SAMPLE_MASTER_SHEET_LINES,
      libraryIds,
      "Sample master sheet line. Copy the master, update pricing, then create an estimate.",
    ),
    operationKey: `harbor-sample-master-sheet:v1:${organizationId}`,
    fallbackMessage: "Harbor sample master sheet did not save.",
  });
}

export const listEstimateRegions = createServerFn({ method: "GET" }).handler(async () => ({
  regions: ESTIMATE_REGIONS,
}));

async function listEstimateRowsOfKind(
  context: { supabase: unknown },
  organizationId: string,
  kind: EstimateKind,
) {
  const baseQuery = () =>
    dynamicTable(context.supabase, "estimates")
      .select("*")
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false });

  let result =
    kind === "master_sheet"
      ? await baseQuery().or(`kind.eq.master_sheet,project_type.eq.${MASTER_ESTIMATE_PROJECT_TYPE}`)
      : await baseQuery().eq("kind", "estimate");
  if (result.error && isMissingEstimateKindColumn(result.error)) {
    // The kind column has not landed in this environment yet; filter on the
    // legacy project_type overload instead.
    result =
      kind === "master_sheet"
        ? await baseQuery().eq("project_type", MASTER_ESTIMATE_PROJECT_TYPE)
        : await baseQuery();
  }
  if (result.error) throw new Error(result.error.message);

  // normalizeEstimate treats either signal as master, so this drops
  // pre-migration master rows the kind filter alone would let leak through.
  return ((result.data ?? []) as Record<string, unknown>[])
    .map(normalizeEstimate)
    .filter((estimate) => estimate.kind === kind);
}

async function withEstimateListMeta(
  context: { supabase: unknown },
  estimates: EstimateRow[],
): Promise<EstimateRow[]> {
  const ids = estimates.map((estimate) => estimate.id);
  if (ids.length === 0) return [];
  const projectIds = estimates
    .map((estimate) => estimate.project_id)
    .filter((id): id is string => Boolean(id));
  const opportunityIds = estimates
    .map((estimate) => estimate.opportunity_id)
    .filter((id): id is string => Boolean(id));

  const [lineRes, projectRes, opportunityRes] = await Promise.all([
    dynamicTable(context.supabase, "estimate_line_items")
      .select("estimate_id")
      .in("estimate_id", ids),
    projectIds.length
      ? dynamicTable(context.supabase, "projects").select("id,name").in("id", projectIds)
      : Promise.resolve({ data: [], error: null }),
    opportunityIds.length
      ? dynamicTable(context.supabase, "pipeline_opportunities")
          .select("id,name")
          .in("id", opportunityIds)
      : Promise.resolve({ data: [], error: null }),
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
}

export const listEstimates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const organizationId = await getOrganizationId(context);
    await ensureCostLibrarySeeded(context, organizationId);
    await ensureHarborDemoEstimate(context, organizationId);
    await ensureHarborSampleMasterSheet(context, organizationId);

    const estimates = await listEstimateRowsOfKind(context, organizationId, "estimate");
    return withEstimateListMeta(context, estimates);
  });

export const listMasterSheets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const organizationId = await getOrganizationId(context);
    await ensureCostLibrarySeeded(context, organizationId);
    await ensureHarborSampleMasterSheet(context, organizationId);

    const masters = await listEstimateRowsOfKind(context, organizationId, "master_sheet");
    return withEstimateListMeta(context, masters);
  });

export const getEstimate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const estimate = await loadEstimate(context, data.id);
    await ensureCostLibrarySeeded(context, estimate.organization_id);
    const line_items = await loadEstimateLines(context, data.id);
    const assemblySources = await loadAssemblyOutputSources(context, data.id);
    const tracedLineItems = line_items.map((line) => ({
      ...line,
      assembly_output_source: assemblySources.get(line.id) ?? null,
    }));
    const quantity_source_review = await loadEstimateQuantitySourceReview(
      context,
      data.id,
      tracedLineItems,
      assemblySources,
    );
    const totals = calculateEstimateTotals(estimate, line_items);
    return { estimate, line_items: tracedLineItems, quantity_source_review, totals };
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
    const projectType = clean(data.project_type ?? "commercial", 32) || "commercial";
    // Transition tolerance: legacy callers flag master sheets via project_type.
    const kind: EstimateKind =
      data.kind === "master_sheet" || projectType === MASTER_ESTIMATE_PROJECT_TYPE
        ? "master_sheet"
        : "estimate";
    // data.project_id is deliberately not sent: creation cannot link a project
    // (a non-null project marks the estimate as converted and freezes its
    // lines). Linking happens afterwards through updateEstimate.
    const id = await insertEstimateRow(
      context,
      {
        organization_id: organizationId,
        name: clean(data.name, 200),
        description: clean(data.description ?? "", 2000),
        opportunity_id: data.opportunity_id ?? null,
        project_type: projectType === MASTER_ESTIMATE_PROJECT_TYPE ? "commercial" : projectType,
        kind,
        region,
        region_multiplier: regionMultiplier,
        overhead_pct: Math.round(num(defaultsRow?.overhead_pct, 1000)),
        profit_pct: Math.round(num(defaultsRow?.profit_pct, 1000)),
        contingency_pct: Math.round(num(defaultsRow?.contingency_pct, 500)),
        bond_pct: Math.round(num(defaultsRow?.bond_pct, 150)),
        tax_pct: Math.round(num(defaultsRow?.tax_pct)),
        general_conditions_pct: Math.round(num(defaultsRow?.general_conditions_pct)),
        custom_markups: normalizeCustomMarkup(defaultsRow?.custom_markups) as unknown as Json,
      },
      "Estimate did not save.",
    );
    return { id };
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

    const result = await dynamicRpc(context.supabase, "update_estimate_header_atomic", {
      p_estimate_id: data.id,
      p_patch: patch,
      p_operation_key: data.operation_key,
    });
    if (result.error && "folder" in patch && isMissingEstimateFolderColumn(result.error)) {
      throw new Error(
        "Estimate folders are still being enabled on the backend. Wait for Lovable to finish the migration, then try again.",
      );
    }
    if (result.error) throw new Error(result.error.message);
    const totals = await recalculateEstimateTotalsInternal(context, data.id);
    return { estimate: totals.estimate };
  });

export const deleteEstimate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof deleteEstimateInput>) => deleteEstimateInput.parse(input))
  .handler(async ({ data, context }) => {
    const organizationId = await getOrganizationId(context);
    const current = await dynamicTable(context.supabase, "estimates")
      .select("id,name,project_type")
      .eq("id", data.id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (current.error) throw new Error(current.error.message);
    if (!current.data) throw new Error("Estimate was not found.");

    const result = await dynamicRpc(context.supabase, "update_estimate_header_atomic", {
      p_estimate_id: data.id,
      p_patch: { folder: "archived" },
      p_operation_key: data.operation_key,
    });
    if (result.error && isMissingEstimateFolderColumn(result.error)) {
      throw new Error(
        "Estimate archiving is still being enabled on the backend. Wait for Lovable to finish the migration, then try again.",
      );
    }
    if (result.error) throw new Error(result.error.message);

    const row = current.data as Record<string, unknown>;
    return {
      ok: true,
      archived: true,
      name: str(row.name),
      project_type: str(row.project_type, "commercial"),
    };
  });

export const recalculateEstimateTotals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => recalculateEstimateTotalsInternal(context, data.id));

export const createLineItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof lineItemInput>) => lineItemInput.parse(input))
  .handler(async ({ data, context }) => {
    // Caller-owned deterministic operation keys are the follow-up; until then
    // mint one per request so database-side retries can never double-insert.
    const operationKey = data.operation_key ?? crypto.randomUUID();
    const unit = clean(data.unit.toUpperCase(), 16);
    const summary = await createEstimateLineItemsAtomicCommand(context, {
      estimateId: data.estimate_id,
      lines: [
        {
          csi_division: clean(data.csi_division, 8),
          cost_code: clean(data.cost_code, 32),
          description: clean(data.description, 500),
          unit,
          quantity: unit === "LS" ? 1 : data.quantity,
          material_unit_cost_cents: data.material_unit_cost_cents,
          labor_unit_cost_cents: data.labor_unit_cost_cents,
          library_item_id: data.library_item_id ?? null,
          scope_group: clean(data.scope_group, 200),
          notes: clean(data.notes, 2000),
        },
      ],
      operationKey,
      fallbackMessage: "Line item did not save.",
    });
    const created = Array.isArray(summary.line_items) ? summary.line_items : [];
    const row = created[0];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("Line item did not save.");
    }
    return { line_item: normalizeLineItem(row as Record<string, unknown>) };
  });

export const createBlankLineItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof createBlankLineItemsInput>) =>
    createBlankLineItemsInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    // Caller-owned deterministic operation keys are the follow-up; until then
    // mint one per request so database-side retries can never double-insert.
    const operationKey = data.operation_key ?? crypto.randomUUID();
    const rows = Array.from({ length: data.count }, () => ({
      csi_division: "",
      cost_code: "",
      description: "New estimate item",
      unit: "EA",
      quantity: 0,
      material_unit_cost_cents: 0,
      labor_unit_cost_cents: 0,
      library_item_id: null,
      scope_group: "",
      notes: "",
    }));

    const summary = await createEstimateLineItemsAtomicCommand(context, {
      estimateId: data.estimate_id,
      lines: rows,
      operationKey,
      fallbackMessage: "Blank estimate rows did not save.",
    });
    const created = Array.isArray(summary.line_items) ? summary.line_items : [];
    return {
      created_count: Math.max(0, Math.round(num(summary.created_count))),
      line_items: (created as Record<string, unknown>[]).map(normalizeLineItem),
    };
  });

export const importEstimateLineItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof importEstimateLineItemsInput>) =>
    importEstimateLineItemsInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const rows = data.rows.map((line) => {
      const unit = clean(line.unit.toUpperCase(), 16);
      return {
        csi_division: clean(line.csi_division, 8),
        cost_code: clean(line.cost_code, 32),
        description: clean(line.description, 500),
        unit,
        quantity: unit === "LS" ? 1 : line.quantity,
        material_unit_cost_cents: line.material_unit_cost_cents,
        labor_unit_cost_cents: line.labor_unit_cost_cents,
        library_item_id: line.library_item_id ?? null,
        scope_group: clean(line.scope_group, 200),
        notes: clean(line.notes, 2000),
      };
    });

    // Replace/delete, insert, and total recalculation are one database
    // transaction. There is deliberately no direct-query fallback because a
    // failed replacement must leave the original worksheet untouched.
    const result = await dynamicRpc(context.supabase, "import_estimate_line_items_atomic", {
      p_estimate_id: data.estimate_id,
      p_mode: data.mode,
      p_rows: rows,
      p_idempotency_key: data.idempotency_key,
    });
    if (result.error) {
      if (isMissingAtomicEstimateImport(result.error)) {
        throw new Error(ATOMIC_ESTIMATE_IMPORT_PENDING);
      }
      throw new Error(result.error.message);
    }
    if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
      throw new Error("The estimate import completed without returning its transaction summary.");
    }
    return {
      created_count: Math.max(
        0,
        Math.round(num((result.data as Record<string, unknown>).created_count)),
      ),
    };
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
    // Grid edits are hand-typed quantities; record that so takeoff syncs know
    // not to clobber them silently.
    if (patch.quantity != null) patch.quantity_source = "manual";

    const result = await dynamicRpc(context.supabase, "update_estimate_line_item_atomic", {
      p_line_item_id: data.id,
      p_patch: patch,
      p_operation_key: data.operation_key,
    });
    if (result.error) throw new Error(result.error.message);
    if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
      throw new Error("Line item update completed without an authoritative result.");
    }
    const lineItem = (result.data as Record<string, unknown>).line_item;
    if (!lineItem || typeof lineItem !== "object" || Array.isArray(lineItem)) {
      throw new Error("Line item update did not return the saved row.");
    }
    return { line_item: normalizeLineItem(lineItem as Record<string, unknown>) };
  });

export const deleteLineItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; estimate_id: string; operation_key: string }) =>
    z
      .object({
        id: z.string().uuid(),
        estimate_id: z.string().uuid(),
        operation_key: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const current = await dynamicTable(context.supabase, "estimate_line_items")
      .select("estimate_id")
      .eq("id", data.id)
      .single();
    if (current.error || !current.data) {
      throw new Error(current.error?.message ?? "Line item was not found.");
    }
    const result = await dynamicRpc(context.supabase, "delete_estimate_line_item_atomic", {
      p_estimate_id: data.estimate_id,
      p_line_item_id: data.id,
      p_operation_key: data.operation_key,
    });
    if (result.error) throw new Error(result.error.message);
    return { ok: true };
  });

export const reorderLineItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      estimate_id: string;
      expected_item_ids: string[];
      item_ids: string[];
      operation_key: string;
    }) =>
      z
        .object({
          estimate_id: z.string().uuid(),
          expected_item_ids: z.array(z.string().uuid()).max(500),
          item_ids: z.array(z.string().uuid()).max(500),
          operation_key: z.string().uuid(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const result = await dynamicRpc(context.supabase, "reorder_estimate_line_items_atomic", {
      p_estimate_id: data.estimate_id,
      p_expected_item_ids: data.expected_item_ids,
      p_item_ids: data.item_ids,
      p_operation_key: data.operation_key,
    });
    if (result.error) throw new Error(result.error.message);
    return { ok: true };
  });

export const duplicateEstimate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof duplicateEstimateInput>) =>
    duplicateEstimateInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const result = await dynamicRpc(context.supabase, "duplicate_estimate_atomic", {
      p_source_estimate_id: data.id,
      p_mode: data.as_project_estimate ? "project_estimate" : "same_kind",
      p_operation_key: data.operation_key,
    });
    if (result.error) throw new Error(result.error.message);
    const response = result.data as Record<string, unknown> | null;
    const id = str(response?.id);
    if (!id) throw new Error("Estimate copy did not return its saved record.");
    return { id, deduplicated: response?.deduplicated === true };
  });

const scoreLibraryItem = (item: CostLibraryItemRow, query: string) => {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const haystack = [
    item.description,
    item.category,
    item.csi_code,
    item.material_cost_cents > 0 ? "material" : "",
    item.labor_cost_cents > 0 ? "labor crew production productivity" : "",
    item.material_cost_cents > 0 && item.labor_cost_cents > 0 ? "installed assembly" : "",
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
      .filter((item) => !data.unit || takeoffUnitsCompatible(data.unit, item.unit))
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

export const getCostLibraryPriceHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { item_id: string }) =>
    z.object({ item_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const result = await dynamicTable(context.supabase, "cost_library_price_history")
      .select("*")
      .eq("cost_library_item_id", data.item_id)
      .order("version_no", { ascending: false })
      .limit(100);
    if (result.error) {
      const message = result.error.message.toLowerCase();
      if (
        result.error.code === "42P01" ||
        result.error.code === "PGRST205" ||
        message.includes("cost_library_price_history")
      ) {
        return { ready: false, items: [] as CostLibraryPriceHistoryRow[] };
      }
      throw new Error(result.error.message);
    }
    return {
      ready: true,
      items: ((result.data ?? []) as Record<string, unknown>[]).map(
        (row): CostLibraryPriceHistoryRow => ({
          id: str(row.id),
          cost_library_item_id: str(row.cost_library_item_id),
          version_no: Math.max(1, Math.round(num(row.version_no, 1))),
          material_cost_cents: Math.round(num(row.material_cost_cents)),
          labor_cost_cents: Math.round(num(row.labor_cost_cents)),
          labor_basis: normalizeLaborBasis(row.labor_basis),
          source_vendor: str(row.source_vendor),
          source_reference: str(row.source_reference),
          effective_date: row.effective_date ? str(row.effective_date) : null,
          changed_at: str(row.changed_at),
        }),
      ),
    };
  });

export const createCostLibraryItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof costLibraryItemInput>) =>
    costLibraryItemInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const organizationId = await getOrganizationId(context);
    if (data.labor_basis === "installed" && data.material_cost_cents > 0) {
      throw new Error(INSTALLED_MATERIAL_MESSAGE);
    }
    const insertRow = {
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
    };
    let result = await dynamicTable(context.supabase, "cost_library_items")
      .insert(insertRow)
      .select("*")
      .single();
    if (result.error && isMissingLaborBasisColumn(result.error)) {
      if (data.labor_basis !== "per_unit") throw new Error(LABOR_BASIS_PENDING_MESSAGE);
      const { labor_basis: _laborBasis, ...legacyRow } = insertRow;
      result = await dynamicTable(context.supabase, "cost_library_items")
        .insert(legacyRow)
        .select("*")
        .single();
    }
    if (result.error || !result.data) {
      throw new Error(result.error?.message ?? "Cost library item did not save.");
    }
    return { item: normalizeLibraryItem(result.data as Record<string, unknown>) };
  });

export const importCostLibraryItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof importCostLibraryItemsInput>) =>
    importCostLibraryItemsInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const organizationId = await getOrganizationId(context);
    const keyFor = (row: { csi_code: string; description: string; unit: string }) =>
      [row.csi_code.trim().toLowerCase(), row.description.trim().toLowerCase(), row.unit.trim()]
        .join("\u001f")
        .slice(0, 700);
    for (const item of data.items) {
      if (item.labor_basis === "installed" && item.material_cost_cents > 0) {
        throw new Error(`"${clean(item.description, 120)}": ${INSTALLED_MATERIAL_MESSAGE}`);
      }
    }
    const rowByKey = new Map(
      data.items.map((item) => {
        const row = {
          organization_id: organizationId,
          external_id: "",
          csi_division: clean(item.csi_division, 8),
          csi_code: clean(item.csi_code, 16),
          category: clean(item.category, 64),
          description: clean(item.description, 500),
          unit: clean(item.unit.toUpperCase(), 16),
          material_cost_cents: item.material_cost_cents,
          labor_cost_cents: item.labor_cost_cents,
          labor_basis: item.labor_basis,
          crew_size: item.crew_size ?? null,
          productivity_per_hour: item.productivity_per_hour ?? null,
          synonyms: item.synonyms as unknown as Json,
          keywords:
            item.keywords.length > 0
              ? (item.keywords as unknown as Json)
              : (item.description
                  .toLowerCase()
                  .split(/[^a-z0-9]+/)
                  .filter(Boolean) as unknown as Json),
          source: "imported",
          base_region: "national",
        };
        return [keyFor(row), row] as const;
      }),
    );
    const rows = Array.from(rowByKey.values());

    const { data: existing, error: existingError } = await dynamicTable(
      context.supabase,
      "cost_library_items",
    )
      .select("*")
      .eq("organization_id", organizationId)
      .limit(5000);
    if (existingError) throw new Error(existingError.message);

    const existingByKey = new Map<string, Record<string, unknown>>();
    for (const row of ((existing ?? []) as Record<string, unknown>[]).filter(
      (row) => str(row.source) !== "system",
    )) {
      existingByKey.set(
        keyFor({
          csi_code: str(row.csi_code),
          description: str(row.description),
          unit: str(row.unit).toUpperCase(),
        }),
        row,
      );
    }

    const inserts: typeof rows = [];
    const updates: Array<{ id: string; row: (typeof rows)[number] }> = [];
    for (const row of rows) {
      const existingRow = existingByKey.get(keyFor(row));
      const id = str(existingRow?.id);
      if (id) {
        updates.push({ id, row });
      } else {
        inserts.push(row);
      }
    }

    // Pre-migration fallback: retry without labor_basis, but only when every
    // staged row uses the default basis so an explicit choice never saves
    // silently wrong.
    const stripLaborBasis = (row: (typeof rows)[number]) => {
      const { labor_basis: _laborBasis, ...legacy } = row;
      return legacy;
    };
    const requireLaborBasisColumn = () => {
      if (rows.some((row) => row.labor_basis !== "per_unit")) {
        throw new Error(LABOR_BASIS_PENDING_MESSAGE);
      }
    };

    const updatedRows: Record<string, unknown>[] = [];
    for (const update of updates) {
      let updateResult = await dynamicTable(context.supabase, "cost_library_items")
        .update(update.row)
        .eq("id", update.id)
        .select("*")
        .single();
      if (updateResult.error && isMissingLaborBasisColumn(updateResult.error)) {
        requireLaborBasisColumn();
        updateResult = await dynamicTable(context.supabase, "cost_library_items")
          .update(stripLaborBasis(update.row))
          .eq("id", update.id)
          .select("*")
          .single();
      }
      if (updateResult.error || !updateResult.data) {
        throw new Error(updateResult.error?.message ?? "Imported cost item did not update.");
      }
      updatedRows.push(updateResult.data as Record<string, unknown>);
    }

    let insertedResult = inserts.length
      ? await dynamicTable(context.supabase, "cost_library_items").insert(inserts).select("*")
      : { data: [], error: null };
    if (insertedResult.error && isMissingLaborBasisColumn(insertedResult.error)) {
      requireLaborBasisColumn();
      insertedResult = await dynamicTable(context.supabase, "cost_library_items")
        .insert(inserts.map(stripLaborBasis))
        .select("*");
    }
    if (insertedResult.error) throw new Error(insertedResult.error.message);

    return {
      created_count: ((insertedResult.data ?? []) as unknown[]).length,
      updated_count: updatedRows.length,
      imported_count: rows.length,
      items: [...((insertedResult.data ?? []) as Record<string, unknown>[]), ...updatedRows].map(
        (row) => normalizeLibraryItem(row),
      ),
    };
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
    let current = await dynamicTable(context.supabase, "cost_library_items")
      .select("source,material_cost_cents,labor_basis")
      .eq("id", data.id)
      .single();
    if (current.error && isMissingLaborBasisColumn(current.error)) {
      current = await dynamicTable(context.supabase, "cost_library_items")
        .select("source,material_cost_cents")
        .eq("id", data.id)
        .single();
    }
    if (current.error || !current.data) {
      throw new Error(current.error?.message ?? "Cost library item was not found.");
    }
    const currentRow = current.data as Record<string, unknown>;
    if (str(currentRow.source) === "system") {
      throw new Error("System library items are read-only.");
    }
    const nextBasis = data.patch.labor_basis ?? normalizeLaborBasis(currentRow.labor_basis);
    const nextMaterial =
      data.patch.material_cost_cents ?? Math.round(num(currentRow.material_cost_cents));
    if (nextBasis === "installed" && nextMaterial > 0) {
      throw new Error(INSTALLED_MATERIAL_MESSAGE);
    }
    const patch: Record<string, unknown> = { ...data.patch };
    if (typeof patch.unit === "string") patch.unit = clean(patch.unit.toUpperCase(), 16);
    if (typeof patch.description === "string") patch.description = clean(patch.description, 500);
    if (typeof patch.csi_division === "string") patch.csi_division = clean(patch.csi_division, 8);
    if (typeof patch.csi_code === "string") patch.csi_code = clean(patch.csi_code, 16);
    if (typeof patch.category === "string") patch.category = clean(patch.category, 64);
    let result = await dynamicTable(context.supabase, "cost_library_items")
      .update(patch)
      .eq("id", data.id)
      .select("*")
      .single();
    if (result.error && isMissingLaborBasisColumn(result.error) && "labor_basis" in patch) {
      if (patch.labor_basis !== "per_unit") throw new Error(LABOR_BASIS_PENDING_MESSAGE);
      const { labor_basis: _laborBasis, ...legacyPatch } = patch;
      if (Object.keys(legacyPatch).length === 0) {
        result = await dynamicTable(context.supabase, "cost_library_items")
          .select("*")
          .eq("id", data.id)
          .single();
      } else {
        result = await dynamicTable(context.supabase, "cost_library_items")
          .update(legacyPatch)
          .eq("id", data.id)
          .select("*")
          .single();
      }
    }
    if (result.error || !result.data) {
      throw new Error(result.error?.message ?? "Cost library item did not update.");
    }
    return { item: normalizeLibraryItem(result.data as Record<string, unknown>) };
  });

export const deleteCostLibraryItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
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
  projectId: string | null,
  client: string,
  operationKey: string,
) {
  const { data: result, error } = await dynamicRpc(
    context.supabase,
    "convert_estimate_to_sov_atomic",
    {
      p_estimate_id: estimateId,
      p_project_id: projectId,
      p_client: client,
      p_operation_key: operationKey,
    },
  );
  if (error) {
    throw new Error(
      `Estimate was not pushed and the prior project budget was preserved: ${error.message}. Apply the budget/SOV authority migration if the atomic command is unavailable.`,
    );
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Estimate push did not return a committed operation result.");
  }
  const returnedProjectId = str((result as Record<string, unknown>).project_id);
  if (!returnedProjectId) {
    throw new Error("Estimate push committed without returning the destination project.");
  }
  return {
    ...(result as Record<string, Json>),
    project_id: returnedProjectId,
  };
}

export const convertEstimateToSOV = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { estimate_id: string; project_id: string; operation_key: string }) =>
    z
      .object({
        estimate_id: z.string().uuid(),
        project_id: z.string().uuid(),
        operation_key: z.string().trim().min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    convertEstimateToSovInternal(
      context,
      data.estimate_id,
      data.project_id,
      "",
      data.operation_key,
    ),
  );

export const convertEstimateToProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { estimate_id: string; operation_key: string }) =>
    z
      .object({
        estimate_id: z.string().uuid(),
        operation_key: z.string().trim().min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const estimate = await loadEstimate(context, data.estimate_id);
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
    return convertEstimateToSovInternal(
      context,
      data.estimate_id,
      null,
      client,
      data.operation_key,
    );
  });
