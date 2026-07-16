import { describe, expect, it } from "vitest";
import {
  buildEstimateQuantitySourceReview,
  quantitySourceIssueDetail,
  quantitySourceIssueLabel,
} from "../src/lib/estimate-quantity-source-review";

describe("estimate quantity source review", () => {
  it("surfaces linked issues first and preserves unlinked Plan Room review", () => {
    const review = buildEstimateQuantitySourceReview({
      lines: [{ id: "line-1", description: "Interior wall board" }],
      sheets: [{ id: "sheet-1", sheet_number: "A1.1", sheet_name: "Foundation Plan" }],
      takeoffs: [
        {
          id: "takeoff-current",
          estimate_line_item_id: null,
          plan_sheet_id: "sheet-1",
          label: "Reviewed count",
          unit: "EA",
          quantity: 4,
          calculation_status: "current",
          updated_at: "2026-07-16T10:00:00Z",
        },
        {
          id: "takeoff-linked",
          estimate_line_item_id: "line-1",
          plan_sheet_id: "sheet-1",
          label: "Wall run",
          unit: "LF",
          quantity: 120,
          calculation_status: "stale",
          updated_at: "2026-07-16T11:00:00Z",
        },
        {
          id: "takeoff-unlinked",
          estimate_line_item_id: null,
          plan_sheet_id: "sheet-1",
          label: "Slab area",
          unit: "SF",
          quantity: 450,
          calculation_status: "unverified_scale",
          updated_at: "2026-07-16T12:00:00Z",
        },
      ],
      assemblies: [],
    });

    expect(review).toMatchObject({
      total_source_count: 3,
      current_count: 1,
      review_count: 2,
      linked_review_count: 1,
      unlinked_review_count: 1,
    });
    expect(review.items.map((item) => item.measurement_id)).toEqual([
      "takeoff-linked",
      "takeoff-unlinked",
    ]);
    expect(review.items[0]).toMatchObject({
      line_description: "Interior wall board",
      sheet_number: "A1.1",
      status: "stale",
    });
  });

  it("keeps a stale assembly source visible beside its trusted takeoff", () => {
    const review = buildEstimateQuantitySourceReview({
      lines: [{ id: "line-1", description: "Wall face area" }],
      sheets: [{ id: "sheet-1", sheet_number: "A2.1", sheet_name: "Floor Plan" }],
      takeoffs: [
        {
          id: "takeoff-1",
          estimate_line_item_id: null,
          plan_sheet_id: "sheet-1",
          label: "Partition run",
          unit: "LF",
          quantity: 335,
          calculation_status: "current",
          updated_at: "2026-07-16T10:00:00Z",
        },
      ],
      assemblies: [
        {
          link_id: "link-1",
          measurement_id: "takeoff-1",
          estimate_line_item_id: "line-1",
          output_label: "Wall face area",
          output_unit: "SF",
          output_quantity: 5360,
          formula_version: "assembly-engine-v1",
          status: "stale",
          last_synced_at: "2026-07-16T10:00:00Z",
          stale_at: "2026-07-16T12:00:00Z",
        },
      ],
    });

    expect(review.current_count).toBe(1);
    expect(review.items).toHaveLength(1);
    expect(review.items[0]).toMatchObject({
      source_type: "assembly",
      measurement_id: "takeoff-1",
      line_description: "Wall face area",
      sheet_name: "Floor Plan",
      formula_version: "assembly-engine-v1",
      status: "assembly_stale",
    });
    expect(quantitySourceIssueLabel("assembly_stale")).toBe("Assembly changed");
    expect(quantitySourceIssueDetail("assembly_stale")).toContain("did not resync");
  });
});
