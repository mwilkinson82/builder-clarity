// Change-order → cost-code allocation math.
//
// Approved change orders become billable only once their value is allocated
// to SOV cost codes; buildBillingLinesFromBuckets then rolls each allocated
// slice into that line's change_order_value_cents (G702 line 2). This module
// is the shared, cents-safe accounting of how much of a CO is allocated and
// how much remains — used by the allocation UI and the tests.
// Relative .ts import so node smokes can load this module.
import { centsToDollars, dollarsToCents } from "./payments-domain.ts";

export interface AllocationLike {
  change_order_id: string;
  cost_bucket_id: string | null;
  contract_amount: number;
  cost_amount?: number;
}

// Total contract dollars allocated per change order (summed in integer
// cents, converted once).
export function allocatedContractByChangeOrder(
  allocations: readonly AllocationLike[],
): Map<string, number> {
  const cents = new Map<string, number>();
  for (const allocation of allocations) {
    cents.set(
      allocation.change_order_id,
      (cents.get(allocation.change_order_id) ?? 0) + dollarsToCents(allocation.contract_amount),
    );
  }
  const out = new Map<string, number>();
  for (const [id, value] of cents) out.set(id, centsToDollars(value));
  return out;
}

// Contract dollars of a change order not yet allocated to any cost code.
// Additions remain positive; credits remain negative. Over-allocation clamps
// toward zero without flipping the adjustment's direction.
export function unallocatedContract(coContract: number, allocatedContract: number): number {
  const contractCents = dollarsToCents(coContract);
  const remainingCents = contractCents - dollarsToCents(allocatedContract);
  return centsToDollars(
    contractCents < 0 ? Math.min(0, remainingCents) : Math.max(0, remainingCents),
  );
}

export interface ApprovedCoSummary {
  changeOrderId: string;
  contract: number;
  allocated: number;
  remaining: number;
  cost: number;
  allocatedCost: number;
  remainingCost: number;
  fullyAllocated: boolean;
}

// Per-approved-CO allocation summary for the allocation UI.
export function summarizeApprovedCo(
  changeOrderId: string,
  contract: number,
  allocations: readonly AllocationLike[],
  cost = 0,
): ApprovedCoSummary {
  const matching = allocations.filter((allocation) => allocation.change_order_id === changeOrderId);
  const allocated = allocatedContractByChangeOrder(matching).get(changeOrderId) ?? 0;
  const allocatedCost = centsToDollars(
    matching.reduce((sum, allocation) => sum + dollarsToCents(allocation.cost_amount ?? 0), 0),
  );
  const remaining = unallocatedContract(contract, allocated);
  const remainingCost = unallocatedContract(cost, allocatedCost);
  return {
    changeOrderId,
    contract,
    allocated,
    remaining,
    cost,
    allocatedCost,
    remainingCost,
    // A CO counts as fully allocated once the remaining unallocated amount is
    // under a cent — no dangling "allocate the rest" nudge from rounding.
    fullyAllocated:
      Math.abs(dollarsToCents(remaining)) === 0 && Math.abs(dollarsToCents(remainingCost)) === 0,
  };
}
