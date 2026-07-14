import { describe, expect, it } from "vitest";
import {
  approvalGateDecisionStatus,
  procurementReleaseAllowed,
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
});
