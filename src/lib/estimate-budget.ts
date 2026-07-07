// Estimate → Budget carry (BUDGETENGINE Phase 3). The estimator + PM turn the
// estimate into the budget once; the budget is the raw line COST (material +
// labor) by cost code — the estimate's markups (overhead / profit / contingency)
// are the margin, not the budget. This aggregates estimate line items into a
// per-cost-code budget the project cost buckets carry.
//
// Cents-safe: sum extended costs in integer cents, convert once. Relative .ts
// import so node smokes can load this module directly.
import { centsToDollars, dollarsToCents } from "./payments-domain.ts";

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
  budget: number; // dollars (line cost)
  // BUDGETVSCONTRACT2: the proposed contract value for this line (what the
  // owner pays), when the user chose to auto-price. undefined = leave the line
  // unpriced (the estimate carries no markup, or the user chose manual). It is
  // a starting point — the user can override every line.
  contractValue?: number;
}

export interface AggregateEstimateOptions {
  // The estimate's contract/sell total (cost + all markups), in cents. When
  // provided AND greater than the total line cost, the markup is distributed
  // across lines pro-rata by cost, and the per-line contract values sum back to
  // this exact total. When absent, ≤ cost, or non-positive, lines stay unpriced
  // (we never fabricate a contract equal to cost — that IS the zero-margin bug).
  contractTotalCents?: number;
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
// dropped. Returned in stable cost-code order. When options.contractTotalCents
// is a real markup over cost, each line also gets a proposed contract value
// (pro-rata by cost) that sums back to that total exactly.
export function aggregateEstimateToBudget(
  lines: readonly EstimateLineLike[],
  options: AggregateEstimateOptions = {},
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
  const ordered = Array.from(groups.values()).sort((a, b) => a.costCode.localeCompare(b.costCode));
  const subtotalCents = ordered.reduce((sum, group) => sum + group.cents, 0);

  // Distribute the markup only when there is a positive markup to distribute.
  // Pro-rata by cost, cents-safe, with the last positive-cost line absorbing
  // the rounding remainder so the contract values reconcile to the estimate's
  // total to the cent.
  const contractTotalCents = options.contractTotalCents ?? 0;
  const shouldPrice = contractTotalCents > subtotalCents && subtotalCents > 0;
  const contractCentsByIndex = new Map<number, number>();
  if (shouldPrice) {
    let assignedCents = 0;
    let lastPricedIndex = -1;
    ordered.forEach((group, index) => {
      if (group.cents <= 0) return; // a $0-cost line gets no proposed contract
      const share = Math.round((group.cents * contractTotalCents) / subtotalCents);
      contractCentsByIndex.set(index, share);
      assignedCents += share;
      lastPricedIndex = index;
    });
    if (lastPricedIndex >= 0) {
      const remainder = contractTotalCents - assignedCents;
      contractCentsByIndex.set(
        lastPricedIndex,
        (contractCentsByIndex.get(lastPricedIndex) ?? 0) + remainder,
      );
    }
  }

  return ordered.map((group, index) => {
    const contractCents = contractCentsByIndex.get(index);
    return {
      costCode: group.costCode,
      description: group.description,
      budget: centsToDollars(group.cents),
      ...(contractCents !== undefined ? { contractValue: centsToDollars(contractCents) } : {}),
    };
  });
}

// True when the estimate's total carries a positive markup to distribute — the
// only case where auto-pricing produces a real (non-zero) margin.
export function estimateHasDistributableMarkup(
  lines: readonly EstimateLineLike[],
  contractTotalCents: number,
): boolean {
  const subtotalCents = lines.reduce((sum, line) => sum + line.total_extended_cents, 0);
  return dollarsToCents(centsToDollars(contractTotalCents)) > subtotalCents && subtotalCents > 0;
}
