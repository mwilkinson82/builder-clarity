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
    expect(html).toContain("Original build cost");
    expect(html).toContain("$2,720,000");
    expect(html).toContain("Original planned GP");
    expect(html).toContain("$480,000");
    expect(html).toContain("$3,200,000 original contract");
    expect(html).toContain("$2,720,000 original build cost");
    // "CO" now carries a plain-English hover-help glossary tooltip, so the
    // approved-CO label is split by a <span>; assert the parts around the term.
    expect(html).toContain("+ Approved ");
    expect(html).toContain(">CO</span> margin");
    expect(html).toContain("+$7,000");
    expect(html).toContain("Current signed GP target");
    expect(html).toContain("$487,000");
    expect(html).toContain("Base cost forecast growth");
    expect(html).toContain("−$315,000");
    expect(html).toContain("Pending CO margin · weighted");
    expect(html).toContain("+$32,250");
    expect(html).toContain("GP before holds");
    expect(html).toContain("$204,250");
    // "Indicated GP" is wrapped in a glossary tooltip span.
    expect(html).toContain(">Indicated GP</span> · 0.9%");
    expect(html).toContain("Gap to signed GP target");
    expect(html).toContain("$455,750 below current signed");
    expect(html).toContain("$173,000 total holds");
    // The "GP" in the bridge heading now carries a glossary span, so match the
    // contiguous "recovery bridge" remainder for the ordering assertions.
    expect(html.indexOf("recovery bridge")).toBeLessThan(html.indexOf("01 · Revenue forecast"));
    expect(html.indexOf("recovery bridge")).toBeLessThan(html.indexOf("02 · Cost forecast"));
  });
});
