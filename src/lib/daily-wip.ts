// Daily WIP math (Workspace B, BILLINGDESIGN P2). A day's work-in-place is the
// sum, over each activity logged that day, of self-perform labor
// (crew × hours × blended rate), materials, and equipment. Labor cost is always
// derived from its inputs so it can never drift from crew/hours/rate.
//
// Cents-safe: every dollar amount is converted to integer cents before adding,
// then back once. Relative .ts import so node smokes can load this directly.
import { centsToDollars, dollarsToCents } from "./payments-domain.ts";

export interface DailyWipRowLike {
  crew_count: number;
  hours: number;
  labor_rate: number;
  material_cost: number;
  equipment_cost: number;
  quantity: number;
  // A line performed by a bought-out subcontractor is valued by earned value
  // (commitment × percent complete), not crew × hours. Both optional so
  // self-perform callers/fixtures are unchanged.
  subcontractor_id?: string | null;
  cost_bucket_id?: string | null;
  percent_complete?: number;
}

// One itemized cost line: what it was, and how much it cost (dollars).
export interface CostLineItem {
  description: string;
  amount: number;
}

// Cents-safe sum of a list of line-item amounts. This is the source of truth for
// material_cost / equipment_cost when items are present, so the lump can never
// drift from the lines that make it up.
export function sumLineItems(items: readonly CostLineItem[] | null | undefined): number {
  if (!Array.isArray(items) || items.length === 0) return 0;
  return centsToDollars(
    items.reduce((cents, item) => cents + dollarsToCents(numeric(item?.amount)), 0),
  );
}

// Items to load into the editor when opening a line. A line can carry a lump
// material/equipment cost with NO itemized breakdown (rows created before
// itemization, or otherwise). Because save recomputes the cost from the items,
// editing such a line with empty items would silently zero the lump — so we
// surface the lump as a single editable line, keeping it visible AND preserved.
export function costItemsForEdit(
  items: readonly CostLineItem[] | null | undefined,
  lump: number,
): CostLineItem[] {
  const existing = Array.isArray(items) ? items : [];
  if (existing.length > 0) return existing.map((item) => ({ ...item }));
  return numeric(lump) > 0 ? [{ description: "", amount: numeric(lump) }] : [];
}

// crew × hours × blended $/hr, rounded to cents. Headcount × hours is total
// labor-hours; times the blended rate is the day's labor cost for the activity.
export function laborCost(
  row: Pick<DailyWipRowLike, "crew_count" | "hours" | "labor_rate">,
): number {
  const raw = numeric(row.crew_count) * numeric(row.hours) * numeric(row.labor_rate);
  return centsToDollars(dollarsToCents(raw));
}

// Total labor-hours logged for the activity (crew × hours) — the denominator of
// the production rate.
export function laborHours(row: Pick<DailyWipRowLike, "crew_count" | "hours">): number {
  return numeric(row.crew_count) * numeric(row.hours);
}

// Earned value of a bought-out subcontractor line: its commitment on this cost
// code × the percent complete logged against it. This is the sub's work put in
// place — the physical-progress analogue of self-perform's crew × hours × rate.
// One % complete, applied to the sub commitment, is the COST recognized; the
// same % applied to the SOV line is the billable side (that lives in billing).
// Cents-safe; % is clamped to 0..100.
export function subEarnedValue(commitment: number, percentComplete: number): number {
  const pct = Math.max(0, Math.min(100, numeric(percentComplete)));
  return centsToDollars(Math.round((dollarsToCents(numeric(commitment)) * pct) / 100));
}

// Work-in-place for one activity row. A self-perform line is labor + materials +
// equipment. A bought-out subcontractor line (subcontractor_id set) with a known
// commitment on its cost code is instead valued by earned value —
// commitment × percent complete — because the sub owns its own labor, materials,
// and equipment; the GC's crew/hours/rate don't apply to it.
export function rowWorkInPlace(row: DailyWipRowLike, subCommitment?: number | null): number {
  if (row.subcontractor_id && subCommitment != null && subCommitment > 0) {
    return subEarnedValue(subCommitment, numeric(row.percent_complete));
  }
  return centsToDollars(
    dollarsToCents(laborCost(row)) +
      dollarsToCents(numeric(row.material_cost)) +
      dollarsToCents(numeric(row.equipment_cost)),
  );
}

// A subcontract and its cost-code allocations, trimmed to what the WIP earned-
// value lookup needs (matches the shapes listProjectSubcontracts returns).
export interface WipSubcontractLike {
  id: string;
  subcontractor_id: string;
  status: string;
}
export interface WipSubAllocationLike {
  subcontract_id: string;
  cost_bucket_id: string | null;
  amount: number;
}

// The lookup key a WIP line resolves its commitment by: the directory company
// that performed the work + the cost code it landed on. Null when the line isn't
// both sub-tagged and coded (nothing to value by commitment).
export function subCommitmentKey(
  subcontractorId: string | null | undefined,
  costBucketId: string | null | undefined,
): string | null {
  if (!subcontractorId || !costBucketId) return null;
  return `${subcontractorId}:${costBucketId}`;
}

// Committed dollars per (subcontractor company, cost code), from EXECUTED
// subcontracts only (a draft buyout hasn't committed cost). The WIP line stores
// the directory company (subcontractor_id), not a specific buyout, so allocations
// are keyed back through their subcontract to the company. Cents-safe.
export function commitmentBySubBucket(
  subcontracts: readonly WipSubcontractLike[],
  allocations: readonly WipSubAllocationLike[],
): Map<string, number> {
  const companyBySubcontract = new Map<string, string>();
  for (const sub of subcontracts) {
    if (sub.status === "executed") companyBySubcontract.set(sub.id, sub.subcontractor_id);
  }
  const cents = new Map<string, number>();
  for (const alloc of allocations) {
    const company = companyBySubcontract.get(alloc.subcontract_id);
    const key = subCommitmentKey(company, alloc.cost_bucket_id);
    if (!key) continue;
    cents.set(key, (cents.get(key) ?? 0) + dollarsToCents(numeric(alloc.amount)));
  }
  const out = new Map<string, number>();
  for (const [key, c] of cents) out.set(key, centsToDollars(c));
  return out;
}

// Total work-in-place across rows, resolving each sub line's commitment via the
// lookup; self-perform rows fall back to labor + materials + equipment. Cents-safe.
export function dailyWipWorkInPlaceTotal(
  rows: readonly DailyWipRowLike[],
  commitmentFor: (row: DailyWipRowLike) => number | null | undefined,
): number {
  return centsToDollars(
    rows.reduce((cents, row) => cents + dollarsToCents(rowWorkInPlace(row, commitmentFor(row))), 0),
  );
}

export interface DailyWipTotals {
  labor: number;
  material: number;
  equipment: number;
  total: number;
  laborHours: number;
  rowCount: number;
}

// Roll a day's (or any set's) rows into labor / material / equipment / total,
// cents-safe.
export function dailyWipTotals(rows: readonly DailyWipRowLike[]): DailyWipTotals {
  const cents = rows.reduce(
    (acc, row) => {
      acc.labor += dollarsToCents(laborCost(row));
      acc.material += dollarsToCents(numeric(row.material_cost));
      acc.equipment += dollarsToCents(numeric(row.equipment_cost));
      acc.laborHours += laborHours(row);
      return acc;
    },
    { labor: 0, material: 0, equipment: 0, laborHours: 0 },
  );
  const labor = centsToDollars(cents.labor);
  const material = centsToDollars(cents.material);
  const equipment = centsToDollars(cents.equipment);
  return {
    labor,
    material,
    equipment,
    total: centsToDollars(cents.labor + cents.material + cents.equipment),
    laborHours: cents.laborHours,
    rowCount: rows.length,
  };
}

// Production rate = quantity placed ÷ labor-hours (e.g. SF per labor-hour). Null
// when there are no hours or no quantity — a rate needs both.
export function productionRate(row: DailyWipRowLike): number | null {
  const hours = laborHours(row);
  const qty = numeric(row.quantity);
  if (hours <= 0 || qty <= 0) return null;
  return qty / hours;
}

function numeric(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}
