// Exposure → cost-code allocation math (BUDGETENGINE Phase 1: "At Risk goes
// live"). An IOR exposure — an E-Hold (emergent at-risk) or a C-Hold
// (contingency) — is split across one or more SOV cost codes; whatever is left
// unallocated is general job risk. Summed by cost code and hold class, this is
// the LIVE At Risk (E) and Contingency (C) columns of the budget-vs-cost ledger.
//
// Cents-safe throughout: sum in integer cents, convert once. Relative .ts import
// so node smokes can load this module directly.
import { centsToDollars, dollarsToCents } from "./payments-domain.ts";

// Matches the IOR hold_class. "Both" (an exposure that is both an E-Hold and a
// C-Hold) rolls into At Risk — a single dollar can't sit in two columns, and the
// exposure/risk column is the safer default. "None" carries no hold and is
// skipped entirely.
export type HoldClass = "E-Hold" | "C-Hold" | "Both" | "None";

export interface ExposureAllocationLike {
  exposure_id: string;
  cost_bucket_id: string | null;
  cost_code: string;
  amount: number;
}

export interface ExposureLike {
  id: string;
  dollar_exposure: number;
  hold_class: HoldClass;
}

// Total dollars allocated per exposure (summed in cents, converted once).
export function allocatedByExposure(
  allocations: readonly ExposureAllocationLike[],
): Map<string, number> {
  const cents = new Map<string, number>();
  for (const allocation of allocations) {
    cents.set(
      allocation.exposure_id,
      (cents.get(allocation.exposure_id) ?? 0) + dollarsToCents(allocation.amount),
    );
  }
  const out = new Map<string, number>();
  for (const [id, value] of cents) out.set(id, centsToDollars(value));
  return out;
}

// Exposure dollars not yet tied to a cost code — general job risk (never below
// zero: over-allocation clamps to nothing remaining).
export function unallocatedExposure(exposureAmount: number, allocated: number): number {
  return centsToDollars(Math.max(0, dollarsToCents(exposureAmount) - dollarsToCents(allocated)));
}

export interface ExposureSummary {
  exposureId: string;
  exposure: number;
  allocated: number;
  remaining: number;
  fullyAllocated: boolean;
}

// Per-exposure allocation summary for the allocation UI.
export function summarizeExposure(
  exposureId: string,
  exposureAmount: number,
  allocations: readonly ExposureAllocationLike[],
): ExposureSummary {
  const allocated = allocatedByExposure(allocations).get(exposureId) ?? 0;
  const remaining = unallocatedExposure(exposureAmount, allocated);
  return {
    exposureId,
    exposure: exposureAmount,
    allocated,
    remaining,
    // Fully allocated once the remaining amount is under a cent — no dangling
    // "allocate the rest" nudge from rounding.
    fullyAllocated: dollarsToCents(remaining) <= 0,
  };
}

export interface CostCodeRisk {
  // null bucket = general job risk (allocated to no specific cost code).
  costBucketId: string | null;
  costCode: string;
  atRisk: number; // E-Hold dollars on this code
  contingency: number; // C-Hold dollars on this code
}

// The rollup that feeds the ledger: At Risk (E-Hold) and Contingency (C-Hold)
// dollars per cost code. Keyed by cost_bucket_id (null = general risk). Each
// allocation inherits its exposure's hold_class; unknown exposures are skipped.
export function riskByCostCode(
  exposures: readonly ExposureLike[],
  allocations: readonly ExposureAllocationLike[],
): CostCodeRisk[] {
  const holdById = new Map<string, HoldClass>();
  for (const exposure of exposures) holdById.set(exposure.id, exposure.hold_class);

  // Accumulate in cents per bucket key.
  const rows = new Map<
    string,
    { costBucketId: string | null; costCode: string; atRiskCents: number; contingencyCents: number }
  >();
  for (const allocation of allocations) {
    const hold = holdById.get(allocation.exposure_id);
    if (!hold || hold === "None") continue; // no hold class → carries no risk
    const key = allocation.cost_bucket_id ?? `__general__:${allocation.cost_code}`;
    const row = rows.get(key) ?? {
      costBucketId: allocation.cost_bucket_id,
      costCode: allocation.cost_code,
      atRiskCents: 0,
      contingencyCents: 0,
    };
    const cents = dollarsToCents(allocation.amount);
    // C-Hold → Contingency; E-Hold and Both → At Risk.
    if (hold === "C-Hold") row.contingencyCents += cents;
    else row.atRiskCents += cents;
    rows.set(key, row);
  }

  return Array.from(rows.values()).map((row) => ({
    costBucketId: row.costBucketId,
    costCode: row.costCode,
    atRisk: centsToDollars(row.atRiskCents),
    contingency: centsToDollars(row.contingencyCents),
  }));
}
