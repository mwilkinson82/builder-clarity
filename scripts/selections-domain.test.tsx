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
      followOnApprovalDueDate: null,
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
      followOnApprovalDueDate: null,
    });
  });

  it("works backward through an RFI and a follow-on approval gate", () => {
    expect(
      calculateSelectionDates({
        needOnSiteDate: "2026-10-12",
        procurementLeadDays: 42,
        deliveryBufferDays: 7,
        clientReviewDays: 14,
        upstreamReviewDays: 10,
      }),
    ).toEqual({
      needOnSiteDate: "2026-10-12",
      orderByDate: "2026-08-24",
      followOnApprovalDueDate: "2026-08-10",
      clientDecisionDueDate: "2026-07-31",
    });
  });

  it("marks past owner decisions overdue", () => {
    expect(selectionDateHealth("2026-07-01", new Date("2026-07-13T12:00:00Z"))).toBe("overdue");
  });
});
