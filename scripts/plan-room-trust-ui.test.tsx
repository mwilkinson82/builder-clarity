import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import { TakeoffFinishPopover } from "@/components/estimates/plan-room/TakeoffClassify";
import { TakeoffGroupCard } from "@/components/estimates/plan-room/TakeoffGroupCard";
import {
  SyncConflictDialog,
  TakeoffWorksheet,
} from "@/components/estimates/plan-room/TakeoffWorksheet";
import { groupTakeoffWorksheet } from "@/lib/plan-room-math";
import type { EstimateLineItemRow } from "@/lib/estimates.functions";
import type { PlanSheetRow, TakeoffMeasurementRow } from "@/lib/plan-room.functions";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const ESTIMATE_ID = "10000000-0000-4000-8000-000000000001";
const SHEET_ID = "20000000-0000-4000-8000-000000000002";
const LINE_ID = "30000000-0000-4000-8000-000000000003";

const sheet: PlanSheetRow = {
  id: SHEET_ID,
  plan_set_id: "40000000-0000-4000-8000-000000000004",
  estimate_id: ESTIMATE_ID,
  sheet_number: "A1.1",
  sheet_name: "Floor Plan",
  discipline: "A",
  page_number: 1,
  sort_order: 1,
  scale_label: '1/4" = 1\'-0"',
  scale_feet_per_pixel: 0.1,
  scale_source: "stated",
  scale_verified_at: null,
  thumbnail_path: "",
  width_px: 1000,
  height_px: 700,
  scale_revision: 1,
  scale_changed_at: null,
  created_at: "2026-07-15T00:00:00.000Z",
  updated_at: "2026-07-15T00:00:00.000Z",
};

const line: EstimateLineItemRow = {
  id: LINE_ID,
  estimate_id: ESTIMATE_ID,
  csi_division: "01",
  cost_code: "01-500",
  description: "Temporary protection",
  unit: "LF",
  quantity: 0,
  quantity_source: "manual",
  takeoff_quantity: null,
  takeoff_synced_at: null,
  material_unit_cost_cents: 0,
  labor_unit_cost_cents: 0,
  material_extended_cents: 0,
  labor_extended_cents: 0,
  total_extended_cents: 0,
  library_item_id: null,
  scope_group: "General Conditions",
  sort_order: 1,
  notes: "",
  created_at: "2026-07-15T00:00:00.000Z",
  updated_at: "2026-07-15T00:00:00.000Z",
};

function measurement(
  id: string,
  status: TakeoffMeasurementRow["calculation_status"],
): TakeoffMeasurementRow {
  return {
    id,
    estimate_id: ESTIMATE_ID,
    plan_sheet_id: SHEET_ID,
    estimate_line_item_id: LINE_ID,
    library_item_id: null,
    created_by: "50000000-0000-4000-8000-000000000005",
    tool_type: "linear",
    label: "Temporary protection",
    unit: "LF",
    quantity: 50,
    waste_pct: 0,
    color: "#1b7a6e",
    geometry: { points: [] },
    notes: "",
    created_by_ai: false,
    calculation_method: "geometry",
    calculation_status: status,
    calculated_quantity: 50,
    calculation_scale_revision: 1,
    calculated_at: "2026-07-15T00:00:00.000Z",
    calculation_context: {},
    override_reason: "",
    ai_operation_id: null,
    ai_proposal_source: null,
    ai_confidence: null,
    ai_original_geometry: null,
    ai_review_action: null,
    ai_reviewed_by: null,
    ai_reviewed_at: null,
    scope_brief_review_id: null,
    created_at: "2026-07-15T00:00:00.000Z",
    updated_at: "2026-07-15T00:00:00.000Z",
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(element: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  act(() =>
    root!.render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>),
  );
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.restoreAllMocks();
});

test("finish popover formats a geometric linear quantity as feet, inches, and fractions", () => {
  const finished = { ...measurement("m-finish", "current"), quantity: 21.03 };
  mount(
    <TakeoffFinishPopover
      measurement={finished}
      lineItems={[line]}
      linkedLine={line}
      onSaveDetails={() => {}}
      onPickRow={() => {}}
      onPickLibraryItem={() => {}}
      onCreateFromLabel={() => {}}
      onDismiss={() => {}}
    />,
  );

  const finish = container!.querySelector<HTMLElement>('[data-testid="takeoff-finish-popover"]');
  expect(finish?.textContent).toContain(`21'-0 3/8" measured`);
  expect(finish?.textContent).not.toContain("21.03 LF");
});

test("expanded group cards format geometric linear totals and each member", () => {
  const members = [
    { ...measurement("m-group-1", "current"), quantity: 21.03 },
    { ...measurement("m-group-2", "current"), quantity: 21.03 },
  ];
  const group = groupTakeoffWorksheet(members)[0];
  mount(
    <TakeoffGroupCard
      group={group}
      lineItems={[line]}
      sheets={[sheet]}
      selectedMeasurementId=""
      expanded
      onToggleExpanded={() => {}}
      selectMeasurement={() => {}}
      deleteMeasurement={() => {}}
      detachMeasurement={() => {}}
      linkMeasurements={() => {}}
      classifyMeasurements={() => {}}
      syncLine={() => {}}
    />,
  );

  const card = container!.querySelector<HTMLElement>('[data-testid="takeoff-group-card"]');
  expect(card?.textContent).toContain(`42'-0 3/4" total`);
  const memberText = Array.from(
    container!.querySelectorAll<HTMLElement>('[data-testid="takeoff-group-member"]'),
  ).map((member) => member.textContent);
  expect(memberText).toEqual([
    expect.stringContaining(`21'-0 3/8"`),
    expect.stringContaining(`21'-0 3/8"`),
  ]);
});

test("worksheet and sync source show geometric LF while conflict totals stay decimal", () => {
  const item = { ...measurement("m-worksheet", "current"), quantity: 21.03 };
  mount(
    <TakeoffWorksheet
      measurements={[item]}
      totalMeasured={21.03}
      copyTakeoffSummary={() => {}}
      downloadTakeoffCsv={() => {}}
      takeoffSummaryFallback=""
      takeoffSearch=""
      setTakeoffSearch={() => {}}
      takeoffFilter="all"
      setTakeoffFilter={() => {}}
      sheetMeasurements={[item]}
      linkedCount={1}
      visibleMeasurements={[item]}
      lineItems={[line]}
      sheets={[sheet]}
      selectedMeasurementId=""
      selectMeasurement={() => {}}
      deleteMeasurementMutation={{ mutate: () => {} }}
      updateMeasurementMutation={{ mutate: () => {} }}
      syncLineMutation={{ mutate: () => {} }}
      lineTotals={new Map([[LINE_ID, { quantity: 21.03, count: 1, untrustedCount: 0 }]])}
      linkMeasurement={() => {}}
      classifyMeasurement={() => {}}
      linkMeasurements={() => {}}
      classifyMeasurements={() => {}}
      detachMeasurement={() => {}}
    />,
  );

  const worksheetRow = container!.querySelector<HTMLElement>(
    '[data-testid="takeoff-navigator-row"]',
  );
  expect(worksheetRow?.textContent).toContain(`Linear · 21'-0 3/8"`);
  expect(worksheetRow?.textContent).not.toContain("21.03 LF");

  act(() => root?.unmount());
  root = createRoot(container!);
  const queryClient = new QueryClient();
  act(() =>
    root!.render(
      <QueryClientProvider client={queryClient}>
        <SyncConflictDialog
          conflict={{
            kind: "quantity",
            lineId: LINE_ID,
            lineDescription: line.description,
            lineUnit: "LF",
            takeoffUnit: "LF",
            currentQuantity: 12,
            incomingQuantity: 21.03,
            measurementCount: 1,
            forceUnitGranted: false,
            sources: [
              {
                label: item.label,
                sheetNumber: sheet.sheet_number,
                sheetName: sheet.sheet_name,
                wastePct: 0,
                quantity: item.quantity,
                unit: item.unit,
                toolType: item.tool_type,
              },
            ],
          }}
          pending={false}
          onCancel={() => {}}
          onConfirm={() => {}}
        />
      </QueryClientProvider>,
    ),
  );

  const conflictDetails = document.querySelector<HTMLElement>(
    '[data-testid="sync-conflict-details"]',
  );
  expect(conflictDetails?.textContent).toContain("21.03 LF");
  expect(conflictDetails?.textContent).toContain(`21'-0 3/8"`);
});

test("group cards use explicit controls and block row sync when any linked takeoff is untrusted", () => {
  const members = [measurement("m-1", "current"), measurement("m-2", "current")];
  const group = groupTakeoffWorksheet(members)[0];
  const selectMeasurement = vi.fn();
  const toggleExpanded = vi.fn();
  mount(
    <TakeoffGroupCard
      group={group}
      lineItems={[line]}
      sheets={[sheet]}
      selectedMeasurementId=""
      expanded={false}
      onToggleExpanded={toggleExpanded}
      selectMeasurement={selectMeasurement}
      deleteMeasurement={() => {}}
      detachMeasurement={() => {}}
      linkMeasurements={() => {}}
      classifyMeasurements={() => {}}
      syncLine={() => {}}
      linkedLineUntrustedCount={1}
    />,
  );

  const card = container!.querySelector<HTMLElement>('[data-testid="takeoff-group-card"]');
  const open = container!.querySelector<HTMLButtonElement>('[data-testid="takeoff-group-open"]');
  const expand = container!.querySelector<HTMLButtonElement>(
    '[data-testid="takeoff-group-expand"]',
  );
  const sync = container!.querySelector<HTMLButtonElement>('[data-testid="takeoff-group-sync"]');
  const warning = container!.querySelector<HTMLElement>(
    '[data-testid="takeoff-group-linked-trust-warning"]',
  );
  expect(card?.getAttribute("role")).toBeNull();
  expect(card?.getAttribute("tabindex")).toBeNull();
  expect(sync?.disabled).toBe(true);
  expect(warning?.textContent).toContain("Another takeoff");
  act(() => open!.click());
  expect(selectMeasurement).toHaveBeenCalledOnce();
  act(() => expand!.click());
  expect(toggleExpanded).toHaveBeenCalledOnce();
  expect(selectMeasurement).toHaveBeenCalledOnce();
});

test("singleton cards expose scale trust and disable every row-level sync control", () => {
  const untrusted = measurement("m-3", "unverified_scale");
  const lineTotals = new Map([[LINE_ID, { quantity: 50, count: 1, untrustedCount: 1 }]]);
  mount(
    <TakeoffWorksheet
      measurements={[untrusted]}
      totalMeasured={50}
      copyTakeoffSummary={() => {}}
      downloadTakeoffCsv={() => {}}
      takeoffSummaryFallback=""
      takeoffSearch=""
      setTakeoffSearch={() => {}}
      takeoffFilter="all"
      setTakeoffFilter={() => {}}
      sheetMeasurements={[untrusted]}
      linkedCount={1}
      visibleMeasurements={[untrusted]}
      lineItems={[line]}
      sheets={[sheet]}
      selectedMeasurementId=""
      selectMeasurement={() => {}}
      deleteMeasurementMutation={{ mutate: () => {} }}
      updateMeasurementMutation={{ mutate: () => {} }}
      syncLineMutation={{ mutate: () => {} }}
      lineTotals={lineTotals}
      linkMeasurement={() => {}}
      classifyMeasurement={() => {}}
      linkMeasurements={() => {}}
      classifyMeasurements={() => {}}
      detachMeasurement={() => {}}
    />,
  );

  const card = container!.querySelector<HTMLElement>('[data-testid="takeoff-navigator-row"]');
  const chip = container!.querySelector<HTMLElement>('[data-testid="takeoff-trust-chip"]');
  const cardSync = container!.querySelector<HTMLButtonElement>('[data-testid="takeoff-row-sync"]');
  const lineSync = container!.querySelector<HTMLButtonElement>('[data-testid="takeoff-line-sync"]');
  expect(card?.getAttribute("role")).toBeNull();
  expect(chip?.textContent).toContain("Verify scale");
  expect(cardSync?.disabled).toBe(true);
  expect(lineSync?.disabled).toBe(true);
});
