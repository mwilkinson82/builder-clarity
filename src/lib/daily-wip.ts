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

// Work-in-place for one activity row: labor + materials + equipment.
export function rowWorkInPlace(row: DailyWipRowLike): number {
  return centsToDollars(
    dollarsToCents(laborCost(row)) +
      dollarsToCents(numeric(row.material_cost)) +
      dollarsToCents(numeric(row.equipment_cost)),
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
