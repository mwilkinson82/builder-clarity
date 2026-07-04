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
