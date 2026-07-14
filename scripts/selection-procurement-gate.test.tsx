import { describe, expect, it } from "vitest";
import {
  approvalGateDecisionStatus,
  procurementReleaseAllowed,
  rfiProcurementDecisionStatus,
} from "../src/lib/selections-domain";

describe("selection procurement release gate", () => {
  it("blocks ordering while approval is pending", () => {
    expect(procurementReleaseAllowed("draft", "ordered")).toBe(false);
    expect(procurementReleaseAllowed("sent", "ordered")).toBe(false);
    expect(procurementReleaseAllowed("revision_requested", "ordered")).toBe(false);
  });

  it("permits procurement after approval", () => {
    expect(procurementReleaseAllowed("approved", "ordered")).toBe(true);
    expect(procurementReleaseAllowed("approved", "shipped")).toBe(true);
  });

  it("always permits returning a package to not released", () => {
    expect(procurementReleaseAllowed("draft", "not_released")).toBe(true);
  });

  it("maps commercial review responses to the procurement gate", () => {
    expect(approvalGateDecisionStatus("a")).toBe("approved");
    expect(approvalGateDecisionStatus("aan")).toBe("approved");
    expect(approvalGateDecisionStatus("rar")).toBe("revision_requested");
    expect(approvalGateDecisionStatus("ur")).toBe("sent");
  });

  it("branches an answered RFI into the required follow-on gate", () => {
    expect(rfiProcurementDecisionStatus({ rfiStatus: "a", outcome: "direct_release" })).toBe(
      "approved",
    );
    expect(
      rfiProcurementDecisionStatus({
        rfiStatus: "a",
        outcome: "requires_submittal",
        followOnSubmittalStatus: "ur",
      }),
    ).toBe("sent");
    expect(
      rfiProcurementDecisionStatus({
        rfiStatus: "a",
        outcome: "requires_submittal",
        followOnSubmittalStatus: "aan",
      }),
    ).toBe("approved");
    expect(
      rfiProcurementDecisionStatus({
        rfiStatus: "a",
        outcome: "requires_client_selection",
      }),
    ).toBe("draft");
  });

  it("does not advance to a follow-on gate before the RFI is answered", () => {
    expect(
      rfiProcurementDecisionStatus({
        rfiStatus: "ur",
        outcome: "requires_submittal",
        followOnSubmittalStatus: "a",
      }),
    ).toBe("sent");
  });
});
