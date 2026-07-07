// Pay-application line generation: buckets + approved-CO allocations -> the
// billing_line_items an application is built from (GETTINGPAID3 Task 2).
//
// Extracted pure so the CO-reaches-line-2 flow is exercised by the same code
// production runs: an approved change order allocated to an SOV cost code
// lands in that line's change_order_value_cents (G702 line 2), never in
// scheduled_value_cents (line 1). Money is integer cents throughout.
// Relative .ts import so node smokes can load this module.
import { dollarsToCents } from "./payments-domain.ts";

export interface LineGenBucket {
  id: string;
  cost_code: string;
  bucket: string;
  // BUDGETVSCONTRACT1: the billable value of the line (what the owner pays).
  // 0 = unpriced. Optional for legacy fixtures; absent reads as unpriced.
  contract_value?: number;
  original_budget: number;
  retainage_pct: number;
  billing_method: string;
  sort_order: number;
}

// BUDGETVSCONTRACT1: a PRICED line bills its contract value; an unpriced
// legacy line falls back to the cost budget (the pre-contract_value behavior,
// kept so existing jobs keep billing) — with the entry UI cueing the user to
// price the line. Billing the owner at cost was the user-reported bug.
function lineScheduledBasis(bucket: LineGenBucket): number {
  return (bucket.contract_value ?? 0) > 0
    ? (bucket.contract_value as number)
    : bucket.original_budget;
}

export interface LineGenChangeOrder {
  id: string;
  status: string;
}

export interface LineGenAllocation {
  change_order_id: string;
  cost_bucket_id: string | null;
  contract_amount: number;
}

export interface LineGenPreviousLine {
  cost_bucket_id: string | null;
  work_completed_to_date_cents: number;
  materials_stored_to_date_cents: number;
}

export interface LineGenInput {
  buckets: readonly LineGenBucket[];
  changeOrders: readonly LineGenChangeOrder[];
  allocations: readonly LineGenAllocation[];
  previousLines: readonly LineGenPreviousLine[];
  amountBilled: number;
  defaultRetainagePct: number;
}

export interface GeneratedBillingLine {
  cost_bucket_id: string;
  cost_code: string;
  description: string;
  billing_method: string;
  scheduled_value_cents: number;
  change_order_value_cents: number;
  work_completed_previous_cents: number;
  materials_stored_previous_cents: number;
  work_completed_this_period_cents: number;
  materials_stored_this_period_cents: number;
  retainage_pct: number;
  retainage_released_cents: number;
  sort_order: number;
}

// Sum of approved-CO allocation dollars per cost bucket. A change order only
// counts once it is Approved AND allocated to a cost code — pending or
// unallocated COs contribute nothing (they surface as the allocate nudge).
export function approvedCoDollarsByBucket(
  changeOrders: readonly LineGenChangeOrder[],
  allocations: readonly LineGenAllocation[],
): Map<string, number> {
  const approvedIds = new Set(
    changeOrders.filter((co) => co.status === "Approved").map((co) => co.id),
  );
  const byBucket = new Map<string, number>();
  for (const allocation of allocations) {
    if (!allocation.cost_bucket_id || !approvedIds.has(allocation.change_order_id)) continue;
    byBucket.set(
      allocation.cost_bucket_id,
      (byBucket.get(allocation.cost_bucket_id) ?? 0) + allocation.contract_amount,
    );
  }
  return byBucket;
}

export function buildBillingLinesFromBuckets(input: LineGenInput): GeneratedBillingLine[] {
  const coByBucket = approvedCoDollarsByBucket(input.changeOrders, input.allocations);
  const previousByBucket = new Map(
    input.previousLines
      .filter((line) => line.cost_bucket_id)
      .map((line) => [line.cost_bucket_id as string, line]),
  );

  const targetThisPeriod = dollarsToCents(input.amountBilled);
  const contractTotal = input.buckets.reduce(
    (sum, bucket) => sum + lineScheduledBasis(bucket) + (coByBucket.get(bucket.id) ?? 0),
    0,
  );
  let remainingThisPeriod = targetThisPeriod;

  return input.buckets.map((bucket, index) => {
    const lineContract = lineScheduledBasis(bucket) + (coByBucket.get(bucket.id) ?? 0);
    // Spread the period target across lines by contract weight; the last
    // line absorbs the rounding remainder so the lines sum exactly.
    const thisPeriod =
      index === input.buckets.length - 1
        ? remainingThisPeriod
        : contractTotal > 0
          ? Math.round(targetThisPeriod * (lineContract / contractTotal))
          : 0;
    remainingThisPeriod -= thisPeriod;
    const previous = previousByBucket.get(bucket.id);
    return {
      cost_bucket_id: bucket.id,
      cost_code: bucket.cost_code,
      description: bucket.bucket,
      billing_method: bucket.billing_method,
      // Base SOV only — the change order rides the dedicated column so it
      // reaches G702 line 2 instead of inflating line 1. Priced lines bill
      // their CONTRACT value; unpriced legacy lines fall back to budget.
      scheduled_value_cents: dollarsToCents(lineScheduledBasis(bucket)),
      change_order_value_cents: dollarsToCents(coByBucket.get(bucket.id) ?? 0),
      work_completed_previous_cents: previous?.work_completed_to_date_cents ?? 0,
      materials_stored_previous_cents: previous?.materials_stored_to_date_cents ?? 0,
      work_completed_this_period_cents: Math.max(0, thisPeriod),
      materials_stored_this_period_cents: 0,
      retainage_pct: bucket.retainage_pct || input.defaultRetainagePct,
      retainage_released_cents: 0,
      sort_order: bucket.sort_order || index + 1,
    };
  });
}
