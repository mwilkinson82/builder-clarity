import { describe, expect, it } from "vitest";
import { calculateSelectionDates, selectionDateHealth } from "../src/lib/selections-domain";

describe("selection procurement dates", () => {
  it("works backward from need-on-site through lead, delivery, and owner review", () => {
    expect(
      calculateSelectionDates({
        needOnSiteDate: "2026-10-12",
        procurementLeadDays: 42,
        deliveryBufferDays: 7,
        clientReviewDays: 7,
      }),
    ).toEqual({
      needOnSiteDate: "2026-10-12",
      orderByDate: "2026-08-24",
      clientDecisionDueDate: "2026-08-17",
    });
  });

  it("keeps unscheduled selections explicitly unscheduled", () => {
    expect(
      calculateSelectionDates({
        needOnSiteDate: null,
        procurementLeadDays: 42,
        deliveryBufferDays: 7,
        clientReviewDays: 7,
      }),
    ).toEqual({
      needOnSiteDate: null,
      orderByDate: null,
      clientDecisionDueDate: null,
    });
  });

  it("marks past owner decisions overdue", () => {
    expect(selectionDateHealth("2026-07-01", new Date("2026-07-13T12:00:00Z"))).toBe("overdue");
  });
});
