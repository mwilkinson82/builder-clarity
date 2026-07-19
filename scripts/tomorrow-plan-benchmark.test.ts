import { describe, expect, it } from "vitest";
import {
  deriveBuyoutTargetRate,
  expectedProductionQuantity,
  plannedLaborHours,
  productionRateIsOverridden,
  resolveTomorrowPlanBenchmark,
} from "../src/lib/tomorrow-plan-benchmark";

const allocation = {
  id: "allocation-1",
  subcontract_id: "subcontract-1",
  cost_bucket_id: "bucket-1500",
  cost_code: "1500",
  amount: 125_000,
  planned_quantity: 25_000,
  unit: "LF",
  benchmark_labor_rate: 110,
};

describe("Tomorrow Plan production benchmark", () => {
  it("derives the required pace from buyout quantity and GC loaded labor benchmark", () => {
    expect(deriveBuyoutTargetRate(allocation)).toBe(22);
  });

  it("resolves the exact performer and scope instead of a subcontractor-wide average", () => {
    const result = resolveTomorrowPlanBenchmark({
      subcontractorId: "directory-electric",
      costBucketId: "bucket-1500",
      subcontracts: [
        {
          id: "subcontract-1",
          subcontractor_id: "directory-electric",
          title: "ALP Electric — Electrical Scope",
        },
      ],
      allocations: [
        allocation,
        { ...allocation, id: "allocation-2", cost_bucket_id: "bucket-2600", unit: "EA" },
      ],
    });

    expect(result).toMatchObject({
      allocationId: "allocation-1",
      targetRate: 22,
      unit: "LF",
    });
  });

  it("turns the locked rate and planned labor into the promised output", () => {
    const hours = plannedLaborHours({ crewCount: 2, peoplePerCrew: 3, hoursPerPerson: 8 });
    expect(hours).toBe(48);
    expect(expectedProductionQuantity(22, hours)).toBe(1056);
  });

  it("flags a course correction without rewriting the benchmark", () => {
    expect(productionRateIsOverridden(18, 22)).toBe(true);
    expect(productionRateIsOverridden(22, 22)).toBe(false);
  });
});
