// Budget-vs-cost ledger (BUDGETENGINE Phase 2). The per-cost-code accounting
// view from the founder mockup — and it's almost entirely a rollup over data
// that already exists: Budget / Actuals / Open come straight off the cost
// buckets, and At Risk / Contingency come from the live exposure allocations
// (E-Hold → At Risk, C-Hold → Contingency) we shipped in Phase 1.
//
//   EAC        = Actuals + Open          (paid + committed-but-unpaid)
//   (Over)/Under = Budget − EAC
//
// Cents-safe throughout: sum in integer cents, convert once. Relative .ts
// imports so node smokes can load this module directly.
import { centsToDollars, dollarsToCents } from "./payments-domain.ts";
import {
  riskByCostCode,
  type ExposureAllocationLike,
  type ExposureLike,
} from "./exposure-allocation.ts";

export interface BudgetBucketLike {
  id: string;
  cost_code: string;
  bucket: string;
  original_budget: number;
  actual_to_date: number;
  ftc: number;
}

// BUDGETLOCK1: the budget is a locked baseline — the ONLY thing that moves it
// is an approved change order's budgeted cost. These Like shapes carry that
// layer into the ledger.
export interface BudgetChangeOrderLike {
  id: string;
  status: string; // only "Approved" moves the budget
  cost_amount: number; // the CO's own budgeted cost
}

export interface BudgetChangeOrderAllocationLike {
  change_order_id: string;
  cost_bucket_id: string | null;
  cost_amount: number; // portion of the CO's budgeted cost on this code
}

export interface BudgetLedgerRow {
  // null bucket = a synthetic line (general job risk / unallocated CO budget).
  costBucketId: string | null;
  costCode: string;
  description: string;
  // The current budget: frozen original + approved change-order cost. This is
  // the number every downstream column compares against.
  budget: number;
  // The frozen baseline (never changes after lock) and the CO layer on top,
  // kept separate so the UI can show where the budget came from.
  originalBudget: number;
  changeOrderBudget: number;
  actuals: number;
  open: number;
  atRisk: number;
  contingency: number;
  eac: number; // Actuals + Open
  overUnder: number; // Budget − EAC (positive = under budget)
}

export interface BudgetLedger {
  rows: BudgetLedgerRow[];
  totals: BudgetLedgerRow;
}

function eacDollars(actuals: number, open: number): number {
  return centsToDollars(dollarsToCents(actuals) + dollarsToCents(open));
}

function overUnderDollars(budget: number, eac: number): number {
  return centsToDollars(dollarsToCents(budget) - dollarsToCents(eac));
}

export function computeBudgetLedger(
  buckets: readonly BudgetBucketLike[],
  exposures: readonly ExposureLike[],
  allocations: readonly ExposureAllocationLike[],
  // BUDGETLOCK1: the change-order layer. Optional so existing callers and the
  // node smokes keep working; without COs the ledger is the frozen baseline.
  changeOrders: readonly BudgetChangeOrderLike[] = [],
  coAllocations: readonly BudgetChangeOrderAllocationLike[] = [],
): BudgetLedger {
  const risk = riskByCostCode(exposures, allocations);
  const riskByBucket = new Map<string, { atRisk: number; contingency: number }>();
  let generalAtRiskCents = 0;
  let generalContingencyCents = 0;
  for (const entry of risk) {
    if (entry.costBucketId) {
      riskByBucket.set(entry.costBucketId, {
        atRisk: entry.atRisk,
        contingency: entry.contingency,
      });
    } else {
      generalAtRiskCents += dollarsToCents(entry.atRisk);
      generalContingencyCents += dollarsToCents(entry.contingency);
    }
  }

  // Only APPROVED change orders move the budget (matching the WIP/billing
  // engine's contract-side rule). A deductive CO carries negative cost and
  // reduces the budget — no clamping.
  const approvedCoIds = new Set(
    changeOrders.filter((co) => co.status === "Approved").map((co) => co.id),
  );
  const approvedCoCostCents = changeOrders
    .filter((co) => co.status === "Approved")
    .reduce((sum, co) => sum + dollarsToCents(co.cost_amount), 0);
  const coBudgetCentsByBucket = new Map<string, number>();
  let bucketAllocatedCoCostCents = 0;
  for (const allocation of coAllocations) {
    if (!approvedCoIds.has(allocation.change_order_id)) continue;
    if (!allocation.cost_bucket_id) continue;
    const cents = dollarsToCents(allocation.cost_amount);
    bucketAllocatedCoCostCents += cents;
    coBudgetCentsByBucket.set(
      allocation.cost_bucket_id,
      (coBudgetCentsByBucket.get(allocation.cost_bucket_id) ?? 0) + cents,
    );
  }
  // Approved CO cost not landed on a cost code (never allocated, or allocated
  // without a bucket) — real budget that must not vanish from the totals.
  const unallocatedCoCostCents = approvedCoCostCents - bucketAllocatedCoCostCents;

  const rows: BudgetLedgerRow[] = buckets.map((bucket) => {
    const bucketRisk = riskByBucket.get(bucket.id) ?? { atRisk: 0, contingency: 0 };
    const eac = eacDollars(bucket.actual_to_date, bucket.ftc);
    const changeOrderBudget = centsToDollars(coBudgetCentsByBucket.get(bucket.id) ?? 0);
    const budget = centsToDollars(
      dollarsToCents(bucket.original_budget) + dollarsToCents(changeOrderBudget),
    );
    return {
      costBucketId: bucket.id,
      costCode: bucket.cost_code,
      description: bucket.bucket,
      budget,
      originalBudget: bucket.original_budget,
      changeOrderBudget,
      actuals: bucket.actual_to_date,
      open: bucket.ftc,
      atRisk: bucketRisk.atRisk,
      contingency: bucketRisk.contingency,
      eac,
      overUnder: overUnderDollars(budget, eac),
    };
  });

  // Approved change-order budget not yet allocated to a cost code — its own
  // line, so the budget total is honest before the allocation pass happens.
  if (Math.abs(unallocatedCoCostCents) > 1) {
    const unallocated = centsToDollars(unallocatedCoCostCents);
    rows.push({
      costBucketId: null,
      costCode: "",
      description: "Change-order budget (unallocated)",
      budget: unallocated,
      originalBudget: 0,
      changeOrderBudget: unallocated,
      actuals: 0,
      open: 0,
      atRisk: 0,
      contingency: 0,
      eac: 0,
      overUnder: unallocated,
    });
  }

  // Risk allocated to no specific cost code is real job risk — surface it as its
  // own line so the At Risk / Contingency totals never quietly drop it.
  if (generalAtRiskCents > 0 || generalContingencyCents > 0) {
    rows.push({
      costBucketId: null,
      costCode: "",
      description: "General job risk (unallocated)",
      budget: 0,
      originalBudget: 0,
      changeOrderBudget: 0,
      actuals: 0,
      open: 0,
      atRisk: centsToDollars(generalAtRiskCents),
      contingency: centsToDollars(generalContingencyCents),
      eac: 0,
      overUnder: 0,
    });
  }

  // Totals: accumulate every column in cents, convert once.
  const totalCents = rows.reduce(
    (acc, row) => {
      acc.budget += dollarsToCents(row.budget);
      acc.originalBudget += dollarsToCents(row.originalBudget);
      acc.changeOrderBudget += dollarsToCents(row.changeOrderBudget);
      acc.actuals += dollarsToCents(row.actuals);
      acc.open += dollarsToCents(row.open);
      acc.atRisk += dollarsToCents(row.atRisk);
      acc.contingency += dollarsToCents(row.contingency);
      return acc;
    },
    {
      budget: 0,
      originalBudget: 0,
      changeOrderBudget: 0,
      actuals: 0,
      open: 0,
      atRisk: 0,
      contingency: 0,
    },
  );
  const totalBudget = centsToDollars(totalCents.budget);
  const totalEac = centsToDollars(totalCents.actuals + totalCents.open);

  return {
    rows,
    totals: {
      costBucketId: null,
      costCode: "",
      description: "Total",
      budget: totalBudget,
      originalBudget: centsToDollars(totalCents.originalBudget),
      changeOrderBudget: centsToDollars(totalCents.changeOrderBudget),
      actuals: centsToDollars(totalCents.actuals),
      open: centsToDollars(totalCents.open),
      atRisk: centsToDollars(totalCents.atRisk),
      contingency: centsToDollars(totalCents.contingency),
      eac: totalEac,
      overUnder: overUnderDollars(totalBudget, totalEac),
    },
  };
}
