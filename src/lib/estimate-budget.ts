// Estimate → Budget carry (BUDGETENGINE Phase 3). The estimator + PM turn the
// estimate into the budget once; the budget is the raw line COST (material +
// labor) by cost code — the estimate's markups (overhead / profit / contingency)
// are the margin, not the budget. This aggregates estimate line items into a
// per-cost-code budget the project cost buckets carry.
//
// Cents-safe: sum extended costs in integer cents, convert once. Relative .ts
// import so node smokes can load this module directly.
import { centsToDollars } from "./payments-domain.ts";

export interface EstimateLineLike {
  cost_code: string;
  csi_division: string;
  scope_group: string;
  description: string;
  total_extended_cents: number;
}

export interface BudgetLineFromEstimate {
  costCode: string;
  description: string;
  budget: number; // dollars
}

// A readable bucket name for a cost code: prefer the scope group, then the first
// line's description, then the CSI division — never blank.
function bucketNameForCode(line: EstimateLineLike): string {
  return (
    line.scope_group.trim() ||
    line.description.trim() ||
    (line.csi_division.trim() ? `Division ${line.csi_division.trim()}` : "Estimated scope")
  );
}

// Aggregate estimate line items into a per-cost-code budget. Lines are grouped
// by cost_code; a blank cost code rolls into an "uncoded" group so nothing is
// dropped. Returned in stable cost-code order.
export function aggregateEstimateToBudget(
  lines: readonly EstimateLineLike[],
): BudgetLineFromEstimate[] {
  const groups = new Map<string, { costCode: string; description: string; cents: number }>();
  for (const line of lines) {
    const key = line.cost_code.trim() || "__uncoded__";
    const existing = groups.get(key);
    if (existing) {
      existing.cents += line.total_extended_cents;
    } else {
      groups.set(key, {
        costCode: line.cost_code.trim(),
        description: bucketNameForCode(line),
        cents: line.total_extended_cents,
      });
    }
  }
  return Array.from(groups.values())
    .map((group) => ({
      costCode: group.costCode,
      description: group.description,
      budget: centsToDollars(group.cents),
    }))
    .sort((a, b) => a.costCode.localeCompare(b.costCode));
}
