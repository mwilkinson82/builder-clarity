import { describe, expect, it } from "vitest";
import {
  isPlaceholderPlanSheet,
  parsePlanSheetIdentityResponse,
} from "../src/lib/plan-sheet-identity";

const sheetId = "00000000-0000-4000-8000-000000000001";

describe("plan sheet identity", () => {
  it("recognizes untouched upload placeholders without classifying estimator names", () => {
    expect(
      isPlaceholderPlanSheet(
        { page_number: 23, sheet_number: "PG-023", sheet_name: "Page 23" },
        { name: "Permit Set", source_file_name: "Permit Set.pdf" },
      ),
    ).toBe(true);
    expect(
      isPlaceholderPlanSheet(
        { page_number: 1, sheet_number: "PG-001", sheet_name: "Permit Set" },
        { name: "Permit Set", source_file_name: "Permit Set.pdf" },
      ),
    ).toBe(true);
    expect(
      isPlaceholderPlanSheet(
        { page_number: 23, sheet_number: "A-201", sheet_name: "Floor Plan" },
        { name: "Permit Set" },
      ),
    ).toBe(false);
  });

  it("accepts only requested, unique, sufficiently confident AI identities", () => {
    const identities = parsePlanSheetIdentityResponse({
      requestedSheetIds: [sheetId],
      raw: JSON.stringify({
        identities: [
          {
            plan_sheet_id: sheetId,
            sheet_number: "A-201",
            sheet_name: "FIRST FLOOR PLAN",
            confidence: 0.92,
            evidence: "A-201 FIRST FLOOR PLAN",
          },
          {
            plan_sheet_id: sheetId,
            sheet_number: "A-999",
            sheet_name: "DUPLICATE",
            confidence: 0.99,
            evidence: "duplicate",
          },
        ],
      }),
    });
    expect(identities).toEqual([
      expect.objectContaining({ sheet_number: "A-201", sheet_name: "FIRST FLOOR PLAN" }),
    ]);
  });

  it("rejects low-confidence guesses", () => {
    expect(
      parsePlanSheetIdentityResponse({
        requestedSheetIds: [sheetId],
        raw: JSON.stringify({
          identities: [
            {
              plan_sheet_id: sheetId,
              sheet_number: "A-201",
              sheet_name: "MAYBE",
              confidence: 0.4,
              evidence: "blurred",
            },
          ],
        }),
      }),
    ).toEqual([]);
  });
});
