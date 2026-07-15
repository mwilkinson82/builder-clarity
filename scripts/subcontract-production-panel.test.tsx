import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SubcontractProductionBenchmarks } from "../src/components/outcome/SubcontractProductionBenchmarks";
import { subCommitmentKey } from "../src/lib/daily-wip";

const buckets = [
  {
    id: "drywall",
    cost_code: "09-2900",
    bucket: "Drywall install",
    contract_quantity: 24_000,
    unit: "SF",
  },
  {
    id: "flooring",
    cost_code: "09-6500",
    bucket: "LVT flooring install",
    contract_quantity: 10_000,
    unit: "SF",
  },
];

const base = {
  labor_rate: 0,
  material_cost: 0,
  equipment_cost: 0,
};

const entries = [
  {
    ...base,
    id: "d1",
    subcontractor_id: "atlas",
    cost_bucket_id: "drywall",
    entry_date: "2026-07-12",
    updated_at: "2026-07-12T17:00:00Z",
    crew_count: 1,
    people_per_crew: 4,
    hours: 8,
    quantity: 1_000,
    unit: "SF",
    percent_complete: 4,
    target_production_rate: 30,
  },
  {
    ...base,
    id: "d2",
    subcontractor_id: "atlas",
    cost_bucket_id: "drywall",
    entry_date: "2026-07-13",
    updated_at: "2026-07-13T17:00:00Z",
    crew_count: 2,
    people_per_crew: 4,
    hours: 8,
    quantity: 2_100,
    unit: "SF",
    percent_complete: 13,
    target_production_rate: 30,
  },
  {
    ...base,
    id: "d3",
    subcontractor_id: "atlas",
    cost_bucket_id: "drywall",
    entry_date: "2026-07-14",
    updated_at: "2026-07-14T17:00:00Z",
    crew_count: 2,
    people_per_crew: 4,
    hours: 8,
    quantity: 2_100,
    unit: "SF",
    percent_complete: 22,
    target_production_rate: 30,
  },
  {
    ...base,
    id: "f1",
    subcontractor_id: "summit",
    cost_bucket_id: "flooring",
    entry_date: "2026-07-12",
    updated_at: "2026-07-12T17:00:00Z",
    crew_count: 1,
    people_per_crew: 3,
    hours: 8,
    quantity: 420,
    unit: "SF",
    percent_complete: 4,
    target_production_rate: 18,
  },
  {
    ...base,
    id: "f2",
    subcontractor_id: "summit",
    cost_bucket_id: "flooring",
    entry_date: "2026-07-13",
    updated_at: "2026-07-13T17:00:00Z",
    crew_count: 1,
    people_per_crew: 3,
    hours: 8,
    quantity: 500,
    unit: "SF",
    percent_complete: 9,
    target_production_rate: 18,
  },
  {
    ...base,
    id: "f3",
    subcontractor_id: "summit",
    cost_bucket_id: "flooring",
    entry_date: "2026-07-14",
    updated_at: "2026-07-14T17:00:00Z",
    crew_count: 1,
    people_per_crew: 3,
    hours: 8,
    quantity: 250,
    unit: "SF",
    percent_complete: 13,
    target_production_rate: 18,
  },
];

describe("SubcontractProductionBenchmarks", () => {
  it("renders reusable subcontract buyout and field comparisons", () => {
    const html = renderToStaticMarkup(
      <SubcontractProductionBenchmarks
        entries={entries}
        buckets={buckets}
        commitments={
          new Map([
            [subCommitmentKey("atlas", "drywall")!, 120_000],
            [subCommitmentKey("summit", "flooring")!, 90_000],
          ])
        }
        subcontractorNames={
          new Map([
            ["atlas", "Atlas Drywall"],
            ["summit", "Summit Flooring"],
          ])
        }
        settings={
          new Map([
            [
              subCommitmentKey("atlas", "drywall")!,
              { plannedQuantity: 24_000, unit: "SF", benchmarkLaborRate: 110 },
            ],
            [
              subCommitmentKey("summit", "flooring")!,
              { plannedQuantity: 10_000, unit: "SF", benchmarkLaborRate: 162 },
            ],
          ])
        }
      />,
    );

    expect(html).toContain("Purchased cost and field production, in one benchmark");
    expect(html).toContain("Atlas Drywall");
    expect(html).toContain("$5.00/SF");
    expect(html).toContain("32.50 SF/labor hr");
    expect(html).toContain("1,090.9 labor hrs");
    expect(html).toContain("requires 22.00 SF/labor hr");
    expect(html).toContain("$3.38/SF at the GC benchmark rate");
    expect(html).toContain("47.7% ahead of target");
    expect(html).toContain("derived target 22.00");
    expect(html).toContain("Quantity and certified progress align");
    expect(html).toContain("Summit Flooring");
    expect(html).toContain("$9.00/SF");
    expect(html).toContain("$10.00/SF field $/logged unit");
    expect(html).toContain("9.7% behind target");
    expect(html).toContain("10% less quantity than certified progress");
  });
});
