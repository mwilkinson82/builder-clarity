import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CertificationHistoryPanel } from "../src/components/outcome/CertificationHistoryPanel";
import type { ProductionSovCertificationRow } from "../src/lib/production-forecast.functions";

const certification: ProductionSovCertificationRow = {
  id: "certification-1",
  project_id: "project-1",
  cost_bucket_id: "bucket-1",
  source_wip_entry_id: "wip-1",
  source_wip_review_version: 3,
  source_wip_updated_at: "2026-07-15T14:00:00.000Z",
  source_wip_reviewed_at: "2026-07-15T14:15:00.000Z",
  source_period_start: "2026-07-13",
  source_period_end: "2026-07-15",
  current_sov_percent: 60,
  recommended_percent: 15,
  certified_percent: 60,
  target_date: "2026-07-31",
  planned_quantity: 1000,
  installed_quantity: 150,
  unit: "SF",
  recent_daily_pace: 50,
  required_daily_pace: 85,
  calculation_version: "production-pace-v1",
  certification_note: "Retained the current billing position after reviewing field evidence.",
  certified_by: "user-1",
  certified_by_name: "Marshall Wilkinson",
  certified_at: "2026-07-15T14:30:00.000Z",
  invalidated_at: null,
  invalidation_reason_code: null,
  invalidation_reason_detail: null,
};

describe("CertificationHistoryPanel", () => {
  it("renders the complete PM certification decision", () => {
    const markup = renderToStaticMarkup(
      <CertificationHistoryPanel
        certifications={[certification]}
        buckets={[{ id: "bucket-1", cost_code: "1500", bucket: "MEP" }]}
      />,
    );

    expect(markup).toContain("Certification history");
    expect(markup).toContain("1500 · MEP");
    expect(markup).toContain("Marshall Wilkinson");
    expect(markup).toContain("Billing SOV at review");
    expect(markup).toContain("Reviewed WIP recommends");
    expect(markup).toContain("PM certified");
    expect(markup).toContain("60.0%");
    expect(markup).toContain("15.0%");
    expect(markup).toContain(
      "Retained the current billing position after reviewing field evidence.",
    );
    expect(markup).toContain("50 SF/workday");
    expect(markup).toContain("85 SF/workday");
  });

  it("explains the empty state before the first certification", () => {
    const markup = renderToStaticMarkup(
      <CertificationHistoryPanel certifications={[]} buckets={[]} />,
    );

    expect(markup).toContain("No SOV positions certified yet");
    expect(markup).toContain("complete decision record will appear here newest first");
  });

  it("labels preserved invalid certifications as ineligible for Billing", () => {
    const markup = renderToStaticMarkup(
      <CertificationHistoryPanel
        certifications={[
          {
            ...certification,
            invalidated_at: "2026-07-16T10:00:00.000Z",
            invalidation_reason_code: "source_not_latest_at_certification",
            invalidation_reason_detail:
              "A newer reviewed SOV Daily WIP row already existed when this certification was created.",
          },
        ]}
        buckets={[{ id: "bucket-1", cost_code: "1500", bucket: "MEP" }]}
      />,
    );

    expect(markup).toContain("Invalidated");
    expect(markup).toContain("Not eligible for Billing");
    expect(markup).toContain("newer reviewed SOV Daily WIP row");
    expect(markup).not.toContain("Latest");
  });
});
