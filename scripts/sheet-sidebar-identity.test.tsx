import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { SheetSidebar } from "@/components/estimates/plan-room/SheetSidebar";
import type { PlanSetRow, PlanSheetRow } from "@/lib/plan-room.functions";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const set: PlanSetRow = {
  id: "10000000-0000-4000-8000-000000000001",
  organization_id: "20000000-0000-4000-8000-000000000002",
  estimate_id: "30000000-0000-4000-8000-000000000003",
  created_by: null,
  name: "Permit Set",
  description: "",
  source_file_name: "Permit Set.pdf",
  file_path: "plans/permit-set.pdf",
  file_mime_type: "application/pdf",
  file_size_bytes: 100,
  page_count: 1,
  sample_key: "",
  status: "current",
  created_at: "2026-07-19T00:00:00.000Z",
  updated_at: "2026-07-19T00:00:00.000Z",
};

const sheet: PlanSheetRow = {
  id: "40000000-0000-4000-8000-000000000004",
  plan_set_id: set.id,
  estimate_id: set.estimate_id,
  sheet_number: "PG-001",
  sheet_name: "Permit Set",
  discipline: "General",
  page_number: 1,
  sort_order: 1,
  scale_label: "",
  scale_feet_per_pixel: 0,
  scale_source: "unset",
  scale_verified_at: null,
  thumbnail_path: "",
  width_px: 0,
  height_px: 0,
  scale_revision: 1,
  scale_changed_at: null,
  created_at: "2026-07-19T00:00:00.000Z",
  updated_at: "2026-07-19T00:00:00.000Z",
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

test("unresolved sheet names are visible and expose one clear recovery action", () => {
  const readNames = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <SheetSidebar
        sheets={[sheet]}
        planSets={[set]}
        sheetSearch=""
        setSheetSearch={() => {}}
        sheetFilter="all"
        setSheetFilter={() => {}}
        measurementCountBySheet={new Map()}
        filteredSheetCount={1}
        filteredSheetsByPlanSet={new Map([[set.id, [sheet]]])}
        currentSheet={sheet}
        openSheet={() => {}}
        onDetectSheetNames={readNames}
        unresolvedNameCount={1}
        sheetIdentityStatus={{
          text: "1 sheet still uses a placeholder name.",
          tone: "warning",
        }}
      />,
    ),
  );

  expect(container.querySelector('[data-testid="sheet-identity-status"]')?.textContent).toContain(
    "placeholder",
  );
  const button = container.querySelector<HTMLButtonElement>('[data-testid="detect-sheet-names"]');
  expect(button?.textContent).toContain("Read 1 name");
  act(() => button?.click());
  expect(readNames).toHaveBeenCalledOnce();
});
