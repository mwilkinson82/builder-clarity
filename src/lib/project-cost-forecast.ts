import {
  computeBudgetLedger,
  type BudgetBucketLike,
  type BudgetChangeOrderAllocationLike,
  type BudgetChangeOrderLike,
} from "./budget-ledger.ts";

export type ProjectSubCostByBucket = ReadonlyMap<
  string,
  { paid: number; open: number; committed?: number; earned?: number }
>;

export interface ProjectCostForecastSummary {
  workingBudget: number;
  actuals: number;
  forecastToComplete: number;
  projectedCost: number;
  forecastVariance: number;
  contractValue: number;
  projectedMargin: number;
}

/**
 * One forecast calculation for every project-cost surface.
 *
 * The Budget ledger already reconciles base budget, approved change-order cost,
 * paid subcontract cost, and open subcontract commitments. The Costs workspace
 * must consume the same result instead of rebuilding a raw bucket-only forecast.
 */
export function summarizeProjectCostForecast({
  buckets,
  changeOrders = [],
  changeOrderAllocations = [],
  subCostByBucket = new Map(),
}: {
  buckets: readonly BudgetBucketLike[];
  changeOrders?: readonly BudgetChangeOrderLike[];
  changeOrderAllocations?: readonly BudgetChangeOrderAllocationLike[];
  subCostByBucket?: ProjectSubCostByBucket;
}): ProjectCostForecastSummary {
  const totals = computeBudgetLedger(
    buckets,
    [],
    [],
    changeOrders,
    changeOrderAllocations,
    subCostByBucket,
  ).totals;

  return {
    workingBudget: totals.budget,
    actuals: totals.actuals,
    forecastToComplete: totals.open,
    projectedCost: totals.eac,
    forecastVariance: totals.overUnder,
    contractValue: totals.contractValue,
    projectedMargin: totals.contractValue - totals.eac,
  };
}
