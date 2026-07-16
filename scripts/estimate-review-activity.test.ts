import { describe, expect, it } from "vitest";
import {
  emptyEstimateReviewActivityState,
  estimateReleaseNeedsOverride,
  estimateReviewActivityLabel,
  estimateReviewStatusLabel,
} from "../src/lib/estimate-review-activity";

describe("estimate review activity", () => {
  it("allows release without an override only for a ready current sign-off", () => {
    const current = {
      ...emptyEstimateReviewActivityState(),
      ready: true,
      status: "current" as const,
    };

    expect(estimateReleaseNeedsOverride(current)).toBe(false);
    expect(estimateReleaseNeedsOverride({ ...current, status: "stale" })).toBe(true);
    expect(estimateReleaseNeedsOverride({ ...current, status: "unsigned" })).toBe(true);
    expect(estimateReleaseNeedsOverride(emptyEstimateReviewActivityState())).toBe(true);
    expect(estimateReleaseNeedsOverride(undefined)).toBe(true);
  });

  it("keeps override events distinct from estimator sign-off", () => {
    expect(estimateReviewActivityLabel("signoff")).toBe("Estimator sign-off");
    expect(estimateReviewActivityLabel("override_export_csv")).toBe("CSV export override");
    expect(estimateReviewActivityLabel("override_export_pdf")).toBe("PDF export override");
    expect(estimateReviewActivityLabel("override_push_project")).toBe("Project push override");
  });

  it("uses explicit contractor-facing sign-off state labels", () => {
    expect(estimateReviewStatusLabel("current")).toBe("Current sign-off");
    expect(estimateReviewStatusLabel("stale")).toBe("Sign-off is stale");
    expect(estimateReviewStatusLabel("unsigned")).toBe("Not signed off");
    expect(estimateReviewStatusLabel("unavailable")).toBe("Sign-off unavailable");
  });
});
