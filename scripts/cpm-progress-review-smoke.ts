import assert from "node:assert/strict";

import {
  buildCpmProgressRecommendations,
  resolveCpmProgressDecision,
} from "../src/lib/cpm-progress.ts";

const activities = [
  {
    id: "activity-percent",
    activityId: "09-210",
    name: "Drywall hang",
    division: "Finishes",
    currentPercent: 25,
  },
  {
    id: "activity-quantity",
    activityId: "03-100",
    name: "Place slab",
    division: "Concrete",
    currentPercent: 10,
  },
];

const recommendations = buildCpmProgressRecommendations({
  activities,
  entries: [
    {
      id: "percent-old",
      scheduleActivityId: "activity-percent",
      entryDate: "2026-07-13",
      updatedAt: "2026-07-13T20:00:00Z",
      activity: "Hang drywall",
      quantity: 900,
      unit: "SF",
      percentBasis: "cpm",
      reviewedPercent: 30,
      reviewedAt: "2026-07-13T21:00:00Z",
    },
    {
      id: "percent-new",
      scheduleActivityId: "activity-percent",
      entryDate: "2026-07-14",
      updatedAt: "2026-07-14T20:00:00Z",
      activity: "Continue drywall",
      quantity: 1_100,
      unit: "SF",
      percentBasis: "cpm",
      reviewedPercent: 42,
      reviewedAt: "2026-07-14T21:00:00Z",
    },
    {
      id: "quantity-reviewed",
      scheduleActivityId: "activity-quantity",
      entryDate: "2026-07-14",
      updatedAt: "2026-07-14T20:00:00Z",
      activity: "Place slab",
      quantity: 2_500,
      unit: "Square Feet",
      percentBasis: "sov",
      reviewedPercent: 20,
      reviewedAt: "2026-07-14T21:00:00Z",
    },
    {
      id: "quantity-unreviewed",
      scheduleActivityId: "activity-quantity",
      entryDate: "2026-07-15",
      updatedAt: "2026-07-15T20:00:00Z",
      activity: "Place more slab",
      quantity: 5_000,
      unit: "SF",
      percentBasis: "sov",
      reviewedPercent: 40,
      reviewedAt: null,
    },
  ],
  controls: [
    {
      scheduleActivityId: "activity-quantity",
      basis: "installed_quantity",
      plannedQuantity: 10_000,
      unit: "SF",
    },
  ],
  reviews: [],
});

const percentRecommendation = recommendations.find((row) => row.id === "activity-percent");
assert.ok(percentRecommendation);
assert.equal(percentRecommendation.recommendedPercent, 42);
assert.equal(percentRecommendation.sourceEntryId, "percent-new");
assert.equal(percentRecommendation.variancePercent, 17);

const quantityRecommendation = recommendations.find((row) => row.id === "activity-quantity");
assert.ok(quantityRecommendation);
assert.equal(quantityRecommendation.installedQuantity, 2_500);
assert.equal(quantityRecommendation.recommendedPercent, 25);
assert.deepEqual(quantityRecommendation.sourceEntryIds, ["quantity-reviewed"]);
assert.equal(quantityRecommendation.variancePercent, 15);

const kept = resolveCpmProgressDecision({
  decision: "kept",
  currentPercent: 25,
  recommendedPercent: 42,
  requestedPercent: 42,
  note: "This must be ignored",
});
assert.deepEqual(kept, {
  acceptedPercent: 25,
  reviewNote: "",
  updatesCpm: false,
});

const accepted = resolveCpmProgressDecision({
  decision: "accepted",
  currentPercent: 25,
  recommendedPercent: 42,
  requestedPercent: 30,
  note: "Reviewed",
});
assert.deepEqual(accepted, {
  acceptedPercent: 42,
  reviewNote: "Reviewed",
  updatesCpm: true,
});

assert.throws(
  () =>
    resolveCpmProgressDecision({
      decision: "overridden",
      currentPercent: 25,
      recommendedPercent: 42,
      requestedPercent: 35,
      note: "",
    }),
  /Explain why/,
);

console.log("CPM progress review smoke passed");
