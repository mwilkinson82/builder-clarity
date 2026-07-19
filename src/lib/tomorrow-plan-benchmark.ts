export interface TomorrowPlanBenchmarkAllocation {
  id: string;
  subcontract_id: string;
  cost_bucket_id: string | null;
  cost_code: string;
  amount: number;
  planned_quantity: number;
  unit: string;
  benchmark_labor_rate: number;
}

export interface TomorrowPlanBenchmarkSubcontract {
  id: string;
  subcontractor_id: string;
  title: string;
}

export interface ResolvedTomorrowPlanBenchmark {
  allocationId: string;
  targetRate: number;
  unit: string;
  sourceLabel: string;
}

const finitePositive = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/**
 * Converts the GC's buyout benchmark into the production pace required to
 * carry that scope at the configured loaded labor rate.
 *
 * labor-equivalent hours = buyout amount / GC loaded labor rate
 * required production pace = planned scope quantity / labor-equivalent hours
 */
export function deriveBuyoutTargetRate(
  allocation: Pick<
    TomorrowPlanBenchmarkAllocation,
    "amount" | "planned_quantity" | "benchmark_labor_rate"
  >,
): number | null {
  const amount = finitePositive(allocation.amount);
  const plannedQuantity = finitePositive(allocation.planned_quantity);
  const benchmarkLaborRate = finitePositive(allocation.benchmark_labor_rate);
  if (amount == null || plannedQuantity == null || benchmarkLaborRate == null) return null;

  const laborEquivalentHours = amount / benchmarkLaborRate;
  return laborEquivalentHours > 0
    ? Math.round((plannedQuantity / laborEquivalentHours) * 1_000_000) / 1_000_000
    : null;
}

export function resolveTomorrowPlanBenchmark({
  subcontractorId,
  costBucketId,
  subcontracts,
  allocations,
}: {
  subcontractorId: string | null;
  costBucketId: string | null;
  subcontracts: readonly TomorrowPlanBenchmarkSubcontract[];
  allocations: readonly TomorrowPlanBenchmarkAllocation[];
}): ResolvedTomorrowPlanBenchmark | null {
  if (!subcontractorId || !costBucketId) return null;

  const matchingSubcontracts = new Map(
    subcontracts
      .filter((subcontract) => subcontract.subcontractor_id === subcontractorId)
      .map((subcontract) => [subcontract.id, subcontract] as const),
  );
  const allocation = allocations.find(
    (candidate) =>
      candidate.cost_bucket_id === costBucketId &&
      matchingSubcontracts.has(candidate.subcontract_id),
  );
  if (!allocation || !allocation.unit.trim()) return null;

  const targetRate = deriveBuyoutTargetRate(allocation);
  if (targetRate == null) return null;
  const subcontract = matchingSubcontracts.get(allocation.subcontract_id);

  return {
    allocationId: allocation.id,
    targetRate,
    unit: allocation.unit.trim(),
    sourceLabel: `${subcontract?.title ?? "Subcontract buyout"} · ${allocation.cost_code}`,
  };
}

export const plannedLaborHours = ({
  crewCount,
  peoplePerCrew,
  hoursPerPerson,
}: {
  crewCount: number;
  peoplePerCrew: number;
  hoursPerPerson: number;
}) => Math.max(0, crewCount) * Math.max(0, peoplePerCrew) * Math.max(0, hoursPerPerson);

export const expectedProductionQuantity = (targetRate: number, laborHours: number) =>
  Math.round(Math.max(0, targetRate) * Math.max(0, laborHours) * 100) / 100;

export const productionRateIsOverridden = (
  targetRate: number | null,
  benchmarkRate: number | null,
) =>
  targetRate != null &&
  benchmarkRate != null &&
  Math.abs(targetRate - benchmarkRate) > Math.max(0.0001, benchmarkRate * 0.0001);
