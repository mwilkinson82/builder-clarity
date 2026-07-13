import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectDashboard } from "../src/components/outcome/ProjectDashboard";
import { computeRollup } from "../src/lib/ior";
import type { ProjectRow } from "../src/lib/projects.functions";

describe("Money dashboard forecast bridge", () => {
  it("separates current signed money from weighted pending change orders", () => {
    const project = {
      original_contract: 3_200_000,
      original_cost_budget: 2_720_000,
      phase: "Middle",
      percent_complete: 60,
      schedule_variance_weeks: 0,
      baseline_completion_date: "2026-05-16",
      forecast_completion_date: "2026-09-04",
      organization_name: "ALP Company",
      organization_logo_url: null,
    } as unknown as ProjectRow;

    const rollup = computeRollup(
      project,
      [
        {
          bucket: "Project total",
          original_budget: 2_720_000,
          actual_to_date: 0,
          ftc: 3_035_000,
        },
      ],
      [
        { contract_amount: 65_000, cost_amount: 58_000, status: "Approved", probability: 100 },
        { contract_amount: 145_000, cost_amount: 122_000, status: "Pending", probability: 50 },
        { contract_amount: 85_000, cost_amount: 72_000, status: "Pending", probability: 75 },
        { contract_amount: 120_000, cost_amount: 98_000, status: "Pending", probability: 50 },
      ],
      [
        {
          category: "other",
          dollar_exposure: 173_000,
          probability: 100,
          hold_class: "E-Hold",
          status: "active",
          response_path: "accept",
          released_amount: 0,
        },
      ],
    );

    const html = renderToStaticMarkup(
      <ProjectDashboard
        project={project}
        exposures={[]}
        rollup={rollup}
        warnings={[]}
        scheduleRiskCount={0}
      />,
    );

    expect(html).toContain("Current signed contract");
    expect(html).toContain("$3,265,000");
    expect(html).toContain("Pending COs · weighted");
    expect(html).toContain("$196,250");
    expect(html).toContain("Current signed GP $487,000");
    expect(html).toContain("$455,750 below current signed");
    expect(html).toContain("$173,000 total holds");
  });
});
