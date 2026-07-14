import { describe, expect, it } from "vitest";
import type { CostActualRow } from "../src/lib/billing.functions";
import {
  groupCostActualsByDocument,
  recognizedRiskActuals,
  summarizeRiskLinkedCosts,
} from "../src/lib/cost-documents";
import type {
  SubcontractChangeOrderRow,
  SubcontractPaymentRow,
} from "../src/lib/subcontracts.functions";

const cost = (patch: Partial<CostActualRow>): CostActualRow =>
  ({
    id: "00000000-0000-4000-8000-000000000001",
    project_id: "00000000-0000-4000-8000-000000000010",
    cost_bucket_id: null,
    import_batch_id: null,
    cost_document_id: "00000000-0000-4000-8000-000000000100",
    exposure_id: null,
    budget_open_relief: 0,
    cost_code: "03-8005",
    description: "Invoice line",
    category: "subcontract",
    amount: 100,
    vendor: "Vendor",
    reference_number: "INV-1",
    source_row_hash: "",
    source_external_id: "",
    cost_date: "2026-07-14",
    status: "approved",
    notes: "",
    approved_at: null,
    paid_at: null,
    payment_method: "",
    payment_reference: "",
    paid_date: null,
    invoice_attachment_path: "",
    invoice_attachment_name: "",
    invoice_attachment_type: "",
    invoice_attachment_size: 0,
    daily_wip_offset: 0,
    credit_applies_to_id: null,
    voided_at: null,
    created_at: "2026-07-14T00:00:00Z",
    updated_at: "2026-07-14T00:00:00Z",
    ...patch,
  }) as CostActualRow;

describe("cost documents", () => {
  it("shows one invoice with multiple cost-code allocation lines", () => {
    const first = cost({ id: "line-1", amount: 500 });
    const second = cost({ id: "line-2", cost_code: "03-8010", amount: 250 });

    const documents = groupCostActualsByDocument([first, second]);

    expect(documents).toHaveLength(1);
    expect(documents[0]?.lines.map((line) => line.id)).toEqual(["line-1", "line-2"]);
  });

  it("keeps historical rows without a document id separate", () => {
    const first = cost({ id: "legacy-1", cost_document_id: "" });
    const second = cost({ id: "legacy-2", cost_document_id: "" });

    expect(groupCostActualsByDocument([first, second])).toHaveLength(2);
  });

  it("counts only incurred, non-void risk-linked cost", () => {
    const exposureId = "00000000-0000-4000-8000-000000000200";
    const actuals = [
      cost({ id: "draft", exposure_id: exposureId, status: "draft" }),
      cost({ id: "approved", exposure_id: exposureId, status: "approved" }),
      cost({ id: "void", exposure_id: exposureId, status: "void" }),
      cost({ id: "unlinked", exposure_id: null, status: "paid" }),
    ];

    expect(recognizedRiskActuals(actuals).map((actual) => actual.id)).toEqual(["approved"]);
  });

  it("separates paid subcontract actuals from subcontract CO commitments", () => {
    const exposureId = "00000000-0000-4000-8000-000000000200";
    const payment = (status: "draft" | "approved" | "paid", amount: number) =>
      ({ exposure_id: exposureId, status, amount }) as SubcontractPaymentRow;
    const changeOrder = (amount: number) =>
      ({ exposure_id: exposureId, amount }) as SubcontractChangeOrderRow;

    const totals = summarizeRiskLinkedCosts(
      [cost({ exposure_id: exposureId, amount: 125 })],
      [payment("draft", 900), payment("approved", 800), payment("paid", 300)],
      [changeOrder(1_000), changeOrder(-100)],
    );

    expect(totals.actualByExposure.get(exposureId)).toBe(425);
    expect(totals.committedByExposure.get(exposureId)).toBe(900);
  });
});
