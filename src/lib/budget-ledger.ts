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
  // BUDGETVSCONTRACT1: every line carries BOTH numbers. contract_value is the
  // billable value (what the owner pays); original_budget is the internal cost
  // budget (what we drive the job on). The delta is the line's margin. 0 =
  // unpriced — surfaced explicitly, never treated as zero margin.
  contract_value: number;
  original_budget: number;
  actual_to_date: number;
  ftc: number;
}

// BUDGETLOCK1: the budget is a locked baseline — the ONLY thing that moves it
// is an approved change order. These Like shapes carry BOTH sides of the CO
// layer into the ledger: contract_amount moves the contract value, cost_amount
// moves the budget — so an approved CO's own margin flows into the delta.
export interface BudgetChangeOrderLike {
  id: string;
  status: string; // only "Approved" moves the ledger
  contract_amount: number; // what the owner pays for the CO
  cost_amount: number; // the CO's own budgeted cost
}

export interface BudgetChangeOrderAllocationLike {
  change_order_id: string;
  cost_bucket_id: string | null;
  contract_amount: number; // portion of the CO's contract value on this code
  cost_amount: number; // portion of the CO's budgeted cost on this code
}

export interface BudgetLedgerRow {
  // null bucket = a synthetic line (general job risk / unallocated COs).
  costBucketId: string | null;
  costCode: string;
  description: string;
  // Contract side: what the owner pays for this line — base contract_value
  // plus approved CO contract allocations. NEVER falls back to budget; an
  // unpriced line reports priced=false and a null margin instead of lying.
  contractValue: number;
  changeOrderContract: number;
  priced: boolean;
  // Line margin = contractValue − budget ($ and % of contract). null when the
  // line is unpriced — an unpriced line must never masquerade as zero-margin.
  margin: number | null;
  marginPct: number | null;
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
  // Lines with no contract value yet — the UI footnotes these so the totals'
  // margin is read as "margin on priced lines", not the whole job.
  unpricedCount: number;
}

// Single source for line-margin math (BUDGETVSCONTRACT1): margin only exists
// on a priced line. $ = contract − budget; % is of contract.
export function ledgerLineMargin(
  contractValueDollars: number,
  budgetDollars: number,
): { margin: number; marginPct: number } | null {
  const contractCents = dollarsToCents(contractValueDollars);
  if (contractCents <= 0) return null;
  const marginCents = contractCents - dollarsToCents(budgetDollars);
  return {
    margin: centsToDollars(marginCents),
    marginPct: (marginCents / contractCents) * 100,
  };
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
  // SUBCONTRACTORS: the subcontractor cost layer, per bucket. A buyout is not
  // extra cost heaped on top of the budget — it BUYS OUT scope the budget
  // already carries. So the fold DISPLACES, it doesn't stack: `paid` (gross sub
  // payments) moves into actuals, and the remaining sub commitment REPLACES the
  // code's own forecast for the bought-out portion — `committed` is netted out
  // of bucket.ftc (floored at 0) and `open` (= committed − paid) added back.
  // Built by summarizeSubCostByBucket (subcontract-budget.ts). No subs → no-op;
  // a caller that omits `committed` gets the old purely-additive behaviour.
  subCostByBucket: ReadonlyMap<
    string,
    { paid: number; open: number; committed?: number }
  > = new Map(),
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

  // Only APPROVED change orders move the ledger, on BOTH sides:
  // contract_amount onto the contract value, cost_amount onto the budget — so
  // an approved CO's own margin flows into the delta. Deductive COs carry
  // negative amounts and reduce their side — no clamping.
  const approvedCoIds = new Set(
    changeOrders.filter((co) => co.status === "Approved").map((co) => co.id),
  );
  const approvedCos = changeOrders.filter((co) => co.status === "Approved");
  const approvedCoCostCents = approvedCos.reduce(
    (sum, co) => sum + dollarsToCents(co.cost_amount),
    0,
  );
  const approvedCoContractCents = approvedCos.reduce(
    (sum, co) => sum + dollarsToCents(co.contract_amount),
    0,
  );
  const coBudgetCentsByBucket = new Map<string, number>();
  const coContractCentsByBucket = new Map<string, number>();
  let bucketAllocatedCoCostCents = 0;
  let bucketAllocatedCoContractCents = 0;
  for (const allocation of coAllocations) {
    if (!approvedCoIds.has(allocation.change_order_id)) continue;
    if (!allocation.cost_bucket_id) continue;
    const costCents = dollarsToCents(allocation.cost_amount);
    const contractCents = dollarsToCents(allocation.contract_amount);
    bucketAllocatedCoCostCents += costCents;
    bucketAllocatedCoContractCents += contractCents;
    coBudgetCentsByBucket.set(
      allocation.cost_bucket_id,
      (coBudgetCentsByBucket.get(allocation.cost_bucket_id) ?? 0) + costCents,
    );
    coContractCentsByBucket.set(
      allocation.cost_bucket_id,
      (coContractCentsByBucket.get(allocation.cost_bucket_id) ?? 0) + contractCents,
    );
  }
  // Approved CO money not landed on a cost code (never allocated, or allocated
  // without a bucket) — real contract/budget that must not vanish from totals.
  const unallocatedCoCostCents = approvedCoCostCents - bucketAllocatedCoCostCents;
  const unallocatedCoContractCents = approvedCoContractCents - bucketAllocatedCoContractCents;

  const rows: BudgetLedgerRow[] = buckets.map((bucket) => {
    const bucketRisk = riskByBucket.get(bucket.id) ?? { atRisk: 0, contingency: 0 };
    // Subcontractor layer. A sub payment is actual cost incurred, so it adds to
    // actual-to-date. A buyout, though, REPLACES the self-perform forecast for
    // the scope it covers — it does not stack on top of it. So net the committed
    // buyout out of the code's own forecast-to-complete (never below 0), then add
    // back the remaining sub commitment. A fully bought-out code thus forecasts
    // to its budget, not budget + buyout, and each payment burns the forecast
    // down. Cents-safe; a missing `committed` makes the netting a no-op.
    const subCost = subCostByBucket.get(bucket.id) ?? { paid: 0, open: 0, committed: 0 };
    const actuals = centsToDollars(
      dollarsToCents(bucket.actual_to_date) + dollarsToCents(subCost.paid),
    );
    const selfPerformFtcCents = Math.max(
      0,
      dollarsToCents(bucket.ftc) - dollarsToCents(subCost.committed ?? 0),
    );
    const open = centsToDollars(selfPerformFtcCents + dollarsToCents(subCost.open));
    const eac = eacDollars(actuals, open);
    const changeOrderBudget = centsToDollars(coBudgetCentsByBucket.get(bucket.id) ?? 0);
    const budget = centsToDollars(
      dollarsToCents(bucket.original_budget) + dollarsToCents(changeOrderBudget),
    );
    // Contract side. NEVER falls back to budget — an unpriced line (base
    // contract_value = 0) reports priced=false and a null margin; reusing the
    // budget here is exactly the bug this module exists to prevent.
    const priced = dollarsToCents(bucket.contract_value) > 0;
    const changeOrderContract = centsToDollars(coContractCentsByBucket.get(bucket.id) ?? 0);
    const contractValue = centsToDollars(
      dollarsToCents(bucket.contract_value) + dollarsToCents(changeOrderContract),
    );
    const marginParts = priced ? ledgerLineMargin(contractValue, budget) : null;
    return {
      costBucketId: bucket.id,
      costCode: bucket.cost_code,
      description: bucket.bucket,
      contractValue,
      changeOrderContract,
      priced,
      margin: marginParts?.margin ?? null,
      marginPct: marginParts?.marginPct ?? null,
      budget,
      originalBudget: bucket.original_budget,
      changeOrderBudget,
      actuals,
      open,
      atRisk: bucketRisk.atRisk,
      contingency: bucketRisk.contingency,
      eac,
      overUnder: overUnderDollars(budget, eac),
    };
  });

  // Approved change-order money not yet allocated to a cost code — its own
  // line, so both totals stay honest before the allocation pass happens. No
  // margin is claimed for it (allocation decides where it truly lands).
  if (Math.abs(unallocatedCoCostCents) > 1 || Math.abs(unallocatedCoContractCents) > 1) {
    const unallocatedCost = centsToDollars(unallocatedCoCostCents);
    const unallocatedContract = centsToDollars(unallocatedCoContractCents);
    rows.push({
      costBucketId: null,
      costCode: "",
      description: "Change orders (unallocated)",
      contractValue: unallocatedContract,
      changeOrderContract: unallocatedContract,
      priced: false,
      margin: null,
      marginPct: null,
      budget: unallocatedCost,
      originalBudget: 0,
      changeOrderBudget: unallocatedCost,
      actuals: 0,
      open: 0,
      atRisk: 0,
      contingency: 0,
      eac: 0,
      overUnder: unallocatedCost,
    });
  }

  // Risk allocated to no specific cost code is real job risk — surface it as its
  // own line so the At Risk / Contingency totals never quietly drop it.
  if (generalAtRiskCents > 0 || generalContingencyCents > 0) {
    rows.push({
      costBucketId: null,
      costCode: "",
      description: "General job risk (unallocated)",
      contractValue: 0,
      changeOrderContract: 0,
      priced: false,
      margin: null,
      marginPct: null,
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

  // Totals: accumulate every column in cents, convert once. The margin total
  // is the sum of PRICED line margins only, and its % is of priced contract —
  // unpriced lines are counted, footnoted by the UI, and never guessed at.
  const totalCents = rows.reduce(
    (acc, row) => {
      acc.contractValue += dollarsToCents(row.contractValue);
      acc.changeOrderContract += dollarsToCents(row.changeOrderContract);
      acc.budget += dollarsToCents(row.budget);
      acc.originalBudget += dollarsToCents(row.originalBudget);
      acc.changeOrderBudget += dollarsToCents(row.changeOrderBudget);
      acc.actuals += dollarsToCents(row.actuals);
      acc.open += dollarsToCents(row.open);
      acc.atRisk += dollarsToCents(row.atRisk);
      acc.contingency += dollarsToCents(row.contingency);
      if (row.margin !== null) {
        acc.margin += dollarsToCents(row.margin);
        acc.pricedContract += dollarsToCents(row.contractValue);
      }
      return acc;
    },
    {
      contractValue: 0,
      changeOrderContract: 0,
      budget: 0,
      originalBudget: 0,
      changeOrderBudget: 0,
      actuals: 0,
      open: 0,
      atRisk: 0,
      contingency: 0,
      margin: 0,
      pricedContract: 0,
    },
  );
  const totalBudget = centsToDollars(totalCents.budget);
  const totalEac = centsToDollars(totalCents.actuals + totalCents.open);
  const anyPriced = totalCents.pricedContract > 0;
  const unpricedCount = rows.filter((row) => row.costBucketId !== null && !row.priced).length;

  return {
    rows,
    unpricedCount,
    totals: {
      costBucketId: null,
      costCode: "",
      description: "Total",
      contractValue: centsToDollars(totalCents.contractValue),
      changeOrderContract: centsToDollars(totalCents.changeOrderContract),
      priced: anyPriced,
      margin: anyPriced ? centsToDollars(totalCents.margin) : null,
      marginPct: anyPriced ? (totalCents.margin / totalCents.pricedContract) * 100 : null,
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
