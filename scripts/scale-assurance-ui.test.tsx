import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { ScaleAssurancePanel } from "@/components/estimates/plan-room/ScaleAssurancePanel";
import type { PlanSheetRow } from "@/lib/plan-room.functions";
import type {
  ScaleAssessmentRow,
  ScaleAssuranceCheckPreview,
} from "@/lib/plan-room-scale-assurance";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const sheet: PlanSheetRow = {
  id: "20000000-0000-4000-8000-000000000002",
  plan_set_id: "30000000-0000-4000-8000-000000000003",
  estimate_id: "10000000-0000-4000-8000-000000000001",
  sheet_number: "A1.1",
  sheet_name: "Foundation Plan",
  discipline: "A",
  page_number: 1,
  sort_order: 1,
  scale_label: "Sample scale",
  scale_feet_per_pixel: 0.01,
  scale_source: "calibrated",
  scale_verified_at: null,
  thumbnail_path: "",
  width_px: 1000,
  height_px: 700,
  scale_revision: 4,
  scale_changed_at: null,
  created_at: "2026-07-15T00:00:00.000Z",
  updated_at: "2026-07-15T00:00:00.000Z",
};

const firstCheck: ScaleAssuranceCheckPreview = {
  check_number: 1,
  points: [
    { x: 0.1, y: 0.2 },
    { x: 0.6, y: 0.2 },
  ],
  labeled_distance_feet: 5,
  pixel_distance: 500,
  measured_distance_feet: 5,
  variance_pct: 0,
  implied_scale_feet_per_pixel: 0.01,
};

const assessment: ScaleAssessmentRow = {
  id: "40000000-0000-4000-8000-000000000004",
  estimate_id: sheet.estimate_id,
  plan_sheet_id: sheet.id,
  scale_revision: sheet.scale_revision,
  outcome: "verified",
  tolerance_pct: 1.5,
  max_variance_pct: 0.4,
  scale_spread_pct: 0.3,
  evidence: [firstCheck, { ...firstCheck, check_number: 2 }],
  notes: "",
  created_by: "50000000-0000-4000-8000-000000000005",
  created_at: "2026-07-15T00:00:00.000Z",
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(overrides: Partial<Parameters<typeof ScaleAssurancePanel>[0]> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const props: Parameters<typeof ScaleAssurancePanel>[0] = {
    sheet,
    latestAssessment: null,
    drafts: [],
    tool: "select",
    selectedPointCount: 0,
    verifyFeet: "",
    backendReady: true,
    scaleAssuranceReady: true,
    pending: false,
    onVerifyFeetChange: () => {},
    onStartCheck: () => {},
    onRecordCheck: () => {},
    onResetChecks: () => {},
    ...overrides,
  };
  act(() => root!.render(<ScaleAssurancePanel {...props} />));
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.restoreAllMocks();
});

test("records the second check only when endpoints and a labeled distance are ready", () => {
  const record = vi.fn();
  mount({
    drafts: [firstCheck],
    tool: "verify",
    selectedPointCount: 2,
    verifyFeet: "5",
    onRecordCheck: record,
  });

  expect(container!.querySelector('[data-testid="scale-assurance-status"]')?.textContent).toContain(
    "1/2 checks",
  );
  const button = container!.querySelector<HTMLButtonElement>('[data-testid="verify-scale-check"]');
  expect(button?.disabled).toBe(false);
  expect(button?.textContent).toContain("Record Check 2 & Verify");
  act(() => button!.click());
  expect(record).toHaveBeenCalledOnce();
});

test("shows persisted two-check proof only for the current scale revision", () => {
  mount({
    sheet: { ...sheet, scale_verified_at: "2026-07-15T00:00:00.000Z" },
    latestAssessment: assessment,
  });
  expect(container!.querySelector('[data-testid="scale-assurance-status"]')?.textContent).toContain(
    "Verified · 2 checks",
  );
  expect(container!.querySelector('[data-testid="scale-assurance-latest"]')?.textContent).toContain(
    "max variance 0.40%",
  );

  act(() =>
    root!.render(
      <ScaleAssurancePanel
        sheet={{ ...sheet, scale_revision: 5, scale_verified_at: null }}
        latestAssessment={assessment}
        drafts={[]}
        tool="select"
        selectedPointCount={0}
        verifyFeet=""
        backendReady
        scaleAssuranceReady
        pending={false}
        onVerifyFeetChange={() => {}}
        onStartCheck={() => {}}
        onRecordCheck={() => {}}
        onResetChecks={() => {}}
      />,
    ),
  );
  expect(container!.querySelector('[data-testid="scale-assurance-latest"]')?.textContent).toContain(
    "stale after a scale change",
  );
});

test("blocks assurance actions while the Lovable migration is pending", () => {
  mount({ scaleAssuranceReady: false });
  expect(
    container!.querySelector('[data-testid="scale-assurance-migration-pending"]'),
  ).not.toBeNull();
  expect(
    container!.querySelector<HTMLButtonElement>('[data-testid="scale-assurance-start"]')?.disabled,
  ).toBe(true);
});
