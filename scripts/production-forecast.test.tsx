import { describe, expect, it } from "vitest";

import type { ProductionAnalyticsRow } from "../src/lib/production-analytics";
import {
  buildProductionForecast,
  buildSovCompletionRecommendations,
  workingDaysInclusive,
} from "../src/lib/production-forecast";

const row = (patch: Partial<ProductionAnalyticsRow> = {}): ProductionAnalyticsRow => ({
  id: "entry-1",
  date: "2026-07-13",
  performerKey: "sub:atlas",
  performerName: "Atlas Drywall",
  performerType: "subcontractor",
  costBucketId: "bucket-1",
  costCode: "09-2900",
  scopeName: "Drywall",
  activity: "Hang drywall",
  quantity: 100,
  unit: "SF",
  laborHours: 10,
  targetRate: 10,
  fieldValue: 1000,
  ...patch,
});

describe("production pace to forecast", () => {
  it("counts weekdays without inventing weekend production days", () => {
    expect(workingDaysInclusive("2026-07-13", "2026-07-19")).toBe(5);
  });

  it("separates a missing plan from a behind plan", () => {
    const missing = buildProductionForecast({
      rows: [row()],
      plans: [],
      periodFrom: "2026-07-13",
      periodTo: "2026-07-17",
      targetDate: "2026-07-24",
    });
    expect(missing[0].status).toBe("missing-plan");

    const behind = buildProductionForecast({
      rows: [row()],
      plans: [
        {
          performerKey: "sub:atlas",
          costBucketId: "bucket-1",
          plannedQuantity: 1000,
          unit: "SF",
        },
      ],
      periodFrom: "2026-07-13",
      periodTo: "2026-07-17",
      targetDate: "2026-07-24",
    });
    expect(behind[0].recentDailyPace).toBe(20);
    expect(behind[0].requiredDailyPace).toBe(180);
    expect(behind[0].status).toBe("behind");
  });

  it("does not call a scope behind when the billing target date is missing", () => {
    const forecast = buildProductionForecast({
      rows: [row()],
      plans: [
        {
          performerKey: "sub:atlas",
          costBucketId: "bucket-1",
          plannedQuantity: 1000,
          unit: "SF",
        },
      ],
      periodFrom: "2026-07-13",
      periodTo: "2026-07-17",
      targetDate: null,
    });
    expect(forecast[0].status).toBe("missing-date");
  });

  it("calls unfinished work behind when the target date has passed", () => {
    const forecast = buildProductionForecast({
      rows: [row()],
      plans: [
        {
          performerKey: "sub:atlas",
          costBucketId: "bucket-1",
          plannedQuantity: 1000,
          unit: "SF",
        },
      ],
      periodFrom: "2026-07-13",
      periodTo: "2026-07-17",
      targetDate: "2026-07-16",
    });

    expect(forecast[0].workingDaysRemaining).toBe(0);
    expect(forecast[0].requiredDailyPace).toBeNull();
    expect(forecast[0].status).toBe("behind");
  });
});

describe("SOV completion recommendation", () => {
  it("uses the latest PM-reviewed SOV evidence and excludes field-only evidence", () => {
    const recommendations = buildSovCompletionRecommendations(
      [
        {
          id: "field-only",
          cost_bucket_id: "bucket-1",
          entry_date: "2026-07-15",
          updated_at: "2026-07-15T12:00:00Z",
          percent_basis: "sov",
          percent_complete: 70,
          wip_reviewed_at: null,
          review_version: 0,
        },
        {
          id: "reviewed",
          cost_bucket_id: "bucket-1",
          entry_date: "2026-07-14",
          updated_at: "2026-07-14T12:00:00Z",
          percent_basis: "sov",
          percent_complete: 55,
          wip_reviewed_at: "2026-07-14T13:00:00Z",
          review_version: 3,
        },
      ],
      [
        {
          id: "bucket-1",
          cost_code: "09-2900",
          bucket: "Drywall",
          earned_percent_complete: 40,
        },
      ],
      "2026-07-15",
    );

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toMatchObject({
      sourceEntryId: "reviewed",
      currentSovPercent: 40,
      recommendedPercent: 55,
      sourceReviewVersion: 3,
    });
  });
});
