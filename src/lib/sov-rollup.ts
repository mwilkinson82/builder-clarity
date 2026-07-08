// SOV rollup math + optimistic patch helpers (BILLINGBATCH2 Task 3).
//
// Pure functions so the table, the optimistic cache update, and the unit
// tests all share one definition of "what the sums say". Money sums run in
// integer cents (round each line, sum, convert once) per the cents-exact
// derivation rule from BILLINGBATCH1.
// Relative .ts import so node-based smoke tests can load this module.
import { centsToDollars, dollarsToCents } from "./payments-domain.ts";

export interface SovBucketMoney {
  original_budget: number;
  actual_to_date: number;
  ftc: number;
}

export interface SovTotals {
  budget: number;
  actual: number;
  ftc: number;
  // Forecast at completion = actual to date + forecast to complete.
  fac: number;
  // Variance vs budget = budget - forecast at completion.
  variance: number;
}

export function sovTotals(buckets: readonly SovBucketMoney[]): SovTotals {
  const cents = buckets.reduce(
    (sum, bucket) => {
      sum.budget += dollarsToCents(bucket.original_budget);
      sum.actual += dollarsToCents(bucket.actual_to_date);
      sum.ftc += dollarsToCents(bucket.ftc);
      return sum;
    },
    { budget: 0, actual: 0, ftc: 0 },
  );
  const facCents = cents.actual + cents.ftc;
  return {
    budget: centsToDollars(cents.budget),
    actual: centsToDollars(cents.actual),
    ftc: centsToDollars(cents.ftc),
    fac: centsToDollars(facCents),
    variance: centsToDollars(cents.budget - facCents),
  };
}

// Forecast/variance for a single SOV line, cents-exact.
export function sovLineForecast(bucket: SovBucketMoney): { fac: number; variance: number } {
  const facCents = dollarsToCents(bucket.actual_to_date) + dollarsToCents(bucket.ftc);
  return {
    fac: centsToDollars(facCents),
    variance: centsToDollars(dollarsToCents(bucket.original_budget) - facCents),
  };
}

// The subcontractor cost layer for one bucket (dollars), same shape the budget
// ledger and dashboard rollup consume.
export interface SubBucketCostLite {
  paid: number;
  open: number;
  committed?: number;
  // Earned value (commitment × % complete) — display-only, shown alongside paid.
  // Optional so callers that don't track it are unaffected.
  earned?: number;
}

const ZERO_SUB: SubBucketCostLite = { paid: 0, open: 0, committed: 0 };

// A single line's projected cost + variance, folding the subcontractor layer in
// with the SAME displace-not-stack model the budget ledger uses (budget-ledger.ts):
// sub payments add to actuals, and the sub commitment displaces the code's own
// forecast (netted out of ftc, floored at 0) with the remaining commitment added
// back. So a bought-out line's projected cost tracks its commitment instead of
// ignoring it — this is what corrects the grid's bogus "under budget". Passing no
// sub cost reproduces sovLineForecast exactly.
export function sovLineForecastWithSubs(
  bucket: SovBucketMoney,
  subCost: SubBucketCostLite | undefined,
): { fac: number; variance: number } {
  const sub = subCost ?? ZERO_SUB;
  const actualsCents = dollarsToCents(bucket.actual_to_date) + dollarsToCents(sub.paid);
  const selfPerformFtcCents = Math.max(
    0,
    dollarsToCents(bucket.ftc) - dollarsToCents(sub.committed ?? 0),
  );
  const facCents = actualsCents + selfPerformFtcCents + dollarsToCents(sub.open);
  return {
    fac: centsToDollars(facCents),
    variance: centsToDollars(dollarsToCents(bucket.original_budget) - facCents),
  };
}

// The subcontractor cost added ON TOP of a line's raw actual+ftc — what the row's
// projected cost jumped by. Used to annotate the cell so projected ≠ actual+ftc
// reads as "includes the buyout", not a math error. 0 when the line has no sub cost.
export function subCostOnLine(
  bucket: SovBucketMoney,
  subCost: SubBucketCostLite | undefined,
): number {
  const plainCents = dollarsToCents(bucket.actual_to_date) + dollarsToCents(bucket.ftc);
  const withCents = dollarsToCents(sovLineForecastWithSubs(bucket, subCost).fac);
  return centsToDollars(withCents - plainCents);
}

// Totals with the subcontractor layer folded into fac/variance (budget, actual,
// and ftc stay RAW so the editable Actual/FTC columns and their subtotals sum
// cleanly). `includeUnallocated` adds sub cost tied to a code that isn't one of
// `buckets` (raw paid+open, no ftc to displace) so the footer reconciles with the
// budget ledger's "unallocated" catch-all; group subtotals pass it false.
export function sovTotalsWithSubs(
  buckets: readonly (SovBucketMoney & { id?: string | null })[],
  subCostByBucket: ReadonlyMap<string, SubBucketCostLite>,
  includeUnallocated = false,
): SovTotals {
  const listed = new Set<string>();
  const cents = buckets.reduce(
    (sum, bucket) => {
      if (bucket.id) listed.add(bucket.id);
      const sub = (bucket.id && subCostByBucket.get(bucket.id)) || ZERO_SUB;
      const actualsCents = dollarsToCents(bucket.actual_to_date) + dollarsToCents(sub.paid);
      const openCents =
        Math.max(0, dollarsToCents(bucket.ftc) - dollarsToCents(sub.committed ?? 0)) +
        dollarsToCents(sub.open);
      sum.budget += dollarsToCents(bucket.original_budget);
      // Actual and ftc are SUB-INCLUSIVE so the subtotal/footer match the rows,
      // which now show each bought-out line's sub-inclusive actual + forecast.
      sum.actual += actualsCents;
      sum.ftc += openCents;
      sum.fac += actualsCents + openCents;
      return sum;
    },
    { budget: 0, actual: 0, ftc: 0, fac: 0 },
  );
  if (includeUnallocated) {
    for (const [id, sub] of subCostByBucket) {
      if (listed.has(id)) continue;
      cents.actual += dollarsToCents(sub.paid);
      cents.ftc += dollarsToCents(sub.open);
      cents.fac += dollarsToCents(sub.paid) + dollarsToCents(sub.open);
    }
  }
  return {
    budget: centsToDollars(cents.budget),
    actual: centsToDollars(cents.actual),
    ftc: centsToDollars(cents.ftc),
    fac: centsToDollars(cents.fac),
    variance: centsToDollars(cents.budget - cents.fac),
  };
}

// Optimistic cache update for a committed SOV cell: the patched bucket list
// is what every rollup on the page (group headers, summary cards, footer)
// recomputes from, so the numbers move the moment the save is committed
// instead of lying until a reload.
export function applySovBucketPatch<T extends { id: string }>(
  buckets: readonly T[],
  id: string,
  patch: Partial<T>,
): T[] {
  return buckets.map((bucket) => (bucket.id === id ? { ...bucket, ...patch } : bucket));
}
