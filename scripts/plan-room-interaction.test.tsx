// AITAKEOFF4 Task 0 regression: arming an AI exemplar from a PERSISTED count
// marker must work on a fresh page load. The production bug: in select mode
// (every fresh load) the pan handler took pointer capture at press time, which
// makes the browser retarget the eventual click to the svg — the marker's own
// click handler never fired, so "Pick a count marker" silently did nothing
// for markers that were already on the sheet. Session-created markers only
// worked because drawing leaves a draw tool active, where no capture happens.
//
// The dispatcher below reproduces the BROWSER's pointer-capture contract
// (click retargets to the capturing element), which neither happy-dom nor
// React simulate — without it this regression cannot be caught headlessly.
// Measurements are provided exclusively as props, exactly like query data on
// a reload: zero session-created state.

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { toast } from "sonner";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { AiAssistPanel } from "@/components/estimates/plan-room/AiAssistPanel";
import { PlanCanvas } from "@/components/estimates/plan-room/PdfSheetViewer";
import { useAiAssist } from "@/components/estimates/plan-room/useAiAssist";
import type { ViewSize } from "@/components/estimates/plan-room/planRoomShared";
import type { PlanSetRow, PlanSheetRow, TakeoffMeasurementRow } from "@/lib/plan-room.functions";

// React 19 requires an explicit opt-in before act() is usable.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// --- Browser pointer-capture contract ---------------------------------------

const capturedPointers = new Map<number, Element>();

beforeAll(() => {
  Object.assign(Element.prototype, {
    setPointerCapture(this: Element, pointerId: number) {
      capturedPointers.set(pointerId, this);
    },
    releasePointerCapture(this: Element, pointerId: number) {
      if (capturedPointers.get(pointerId) === this) capturedPointers.delete(pointerId);
    },
    hasPointerCapture(this: Element, pointerId: number) {
      return capturedPointers.get(pointerId) === this;
    },
  });
});

const pointerInit = (pointerId: number, x: number, y: number): PointerEventInit => ({
  bubbles: true,
  cancelable: true,
  composed: true,
  button: 0,
  pointerId,
  clientX: x,
  clientY: y,
  isPrimary: true,
});

/**
 * Dispatch a click the way a real browser does: pointerdown at the target;
 * if any element holds pointer capture when the pointer is released, the
 * pointerup AND the compatibility click fire at the capturing element, not
 * at the press target. `movePath` optionally drags between press and release
 * (moves dispatch at the capture element once one exists, like a browser).
 */
function browserClick(target: Element, movePath: Array<{ x: number; y: number }> = []) {
  const pointerId = 7;
  const start = { x: 40, y: 40 };
  act(() => {
    target.dispatchEvent(new PointerEvent("pointerdown", pointerInit(pointerId, start.x, start.y)));
  });
  for (const move of movePath) {
    const moveTarget = capturedPointers.get(pointerId) ?? target;
    act(() => {
      moveTarget.dispatchEvent(
        new PointerEvent("pointermove", pointerInit(pointerId, move.x, move.y)),
      );
    });
  }
  const end = movePath.at(-1) ?? start;
  // Snapshot capture BEFORE pointerup: the browser retargets the click based
  // on the capture state at release time, even though handlers (and the
  // implicit release) drop the capture while pointerup dispatches.
  const captureAtRelease = capturedPointers.get(pointerId);
  const releaseTarget = captureAtRelease ?? target;
  act(() => {
    releaseTarget.dispatchEvent(
      new PointerEvent("pointerup", pointerInit(pointerId, end.x, end.y)),
    );
  });
  const clickTarget = captureAtRelease ?? target;
  capturedPointers.delete(pointerId); // implicit release after pointerup
  act(() => {
    clickTarget.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
        detail: 1,
      }),
    );
  });
}

// --- Persisted rows, as the plan-room route query returns them --------------

const ESTIMATE_ID = "0e0e0e0e-0000-4000-8000-000000000001";
const SHEET_ID = "1884a9cf-0000-4000-8000-000000000002";
const PLAN_SET_ID = "2b2b2b2b-0000-4000-8000-000000000003";

const persistedSheet: PlanSheetRow = {
  id: SHEET_ID,
  plan_set_id: PLAN_SET_ID,
  estimate_id: ESTIMATE_ID,
  sheet_number: "A-100",
  sheet_name: "Equipment Plan",
  discipline: "A",
  page_number: 1,
  sort_order: 1,
  scale_label: "",
  scale_feet_per_pixel: 0,
  scale_source: "unset",
  scale_verified_at: null,
  thumbnail_path: "",
  width_px: 0,
  height_px: 0,
  created_at: "2026-07-03T00:00:00Z",
};

// No file_path on purpose: the viewer renders its sample background and never
// touches storage — the svg overlay and markers mount exactly as in prod.
const persistedPlanSet = {
  id: PLAN_SET_ID,
  estimate_id: ESTIMATE_ID,
  name: "Crystal Carwash",
  file_path: "",
  file_mime_type: "application/pdf",
  sample_key: null,
  status: "current",
} as unknown as PlanSetRow;

const persistedMeasurement = (
  overrides: Partial<TakeoffMeasurementRow>,
): TakeoffMeasurementRow => ({
  id: "ed239795-0000-4000-8000-000000000004",
  estimate_id: ESTIMATE_ID,
  plan_sheet_id: SHEET_ID,
  estimate_line_item_id: null,
  library_item_id: null,
  created_by: "someone-else",
  tool_type: "count",
  label: "Mechanical Brush",
  unit: "EA",
  quantity: 2,
  waste_pct: 0,
  color: "#d97706",
  geometry: {
    points: [
      { x: 0.42, y: 0.37 },
      { x: 0.61, y: 0.52 },
    ],
    view_size: { width: 1000, height: 700 },
  },
  notes: "",
  created_by_ai: false,
  created_at: "2026-07-04T12:00:00Z",
  updated_at: "2026-07-04T12:00:00Z",
  ...overrides,
});

const persistedCount = persistedMeasurement({});
const persistedLinear = persistedMeasurement({
  id: "ed239795-0000-4000-8000-000000000005",
  tool_type: "linear",
  label: "Trench Drain",
  unit: "LF",
  geometry: {
    points: [
      { x: 0.2, y: 0.8 },
      { x: 0.7, y: 0.8 },
    ],
    view_size: { width: 1000, height: 700 },
  },
});

// --- Host: the workspace's real wiring around the real viewer + hook --------
// Mirrors PlanRoomWorkspace.tsx (onMeasurementSelect at ~3098) verbatim:
// AI-assist arming intercepts the click before plain selection.

function Host({ measurements }: { measurements: TakeoffMeasurementRow[] }) {
  const [viewSize, setViewSize] = useState<ViewSize>({ width: 1000, height: 700 });
  const [selectedMeasurementId, setSelectedMeasurementId] = useState("");
  const ai = useAiAssist({
    estimateId: ESTIMATE_ID,
    sheets: [persistedSheet],
    planSets: [persistedPlanSet],
    measurements,
    currentSheetId: SHEET_ID,
    viewSize,
    openSheet: () => {},
    onTakeoffsChanged: () => {},
  });
  return (
    <div>
      <button type="button" data-testid="open-ai-panel" onClick={ai.openPanel}>
        AI assist
      </button>
      <PlanCanvas
        planSet={persistedPlanSet}
        sheet={persistedSheet}
        overlayPlanSet={null}
        overlaySheet={null}
        overlayOpacity={0.5}
        overlayMode="overlay"
        measurements={measurements}
        pendingPoints={[]}
        calibrationPoints={[]}
        draftCommand={null}
        draftUnit="EA"
        draftActionDisabled={false}
        onFinishDraft={() => {}}
        tool="select"
        viewSize={viewSize}
        onViewSizeChange={setViewSize}
        onPoint={() => {}}
        isCockpitMode={false}
        selectedMeasurementId={selectedMeasurementId}
        onMeasurementSelect={(measurementId) => {
          const measurement = measurements.find((item) => item.id === measurementId);
          if (!measurement) return;
          if (ai.handleMeasurementSelected(measurement)) return;
          setSelectedMeasurementId(measurement.id);
        }}
        onMeasurementGeometryChange={async () => {}}
        isGeometrySaving={false}
        aiPanel={<AiAssistPanel ai={ai} />}
      />
    </div>
  );
}

// --- Mount plumbing ----------------------------------------------------------

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function mountHost(measurements: TakeoffMeasurementRow[]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <Host measurements={measurements} />
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  root = createRoot(container);
  await act(async () => {
    root!.render(<RouterProvider router={router} />);
  });
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
  capturedPointers.clear();
  vi.restoreAllMocks();
});

function armExemplarPicker() {
  const openButton = document.querySelector<HTMLButtonElement>('[data-testid="open-ai-panel"]');
  expect(openButton, "host open button").toBeTruthy();
  act(() => {
    openButton!.click();
  });
  const pickButton = document.querySelector<HTMLButtonElement>('[data-testid="ai-pick-exemplar"]');
  expect(pickButton, "the AI panel's pick button").toBeTruthy();
  act(() => {
    pickButton!.click();
  });
}

function markerByTool(tool: string): Element {
  const marker = Array.from(
    document.querySelectorAll('[data-testid="takeoff-measurement-shape"]'),
  ).find((shape) => shape.getAttribute("data-takeoff-tool") === tool);
  expect(marker, `a persisted ${tool} marker on the canvas`).toBeTruthy();
  return marker!;
}

// --- The regression ----------------------------------------------------------

test("fresh load: clicking a persisted count marker arms the exemplar", async () => {
  const successToast = vi.spyOn(toast, "success");
  await mountHost([persistedCount, persistedLinear]);
  armExemplarPicker();

  browserClick(markerByTool("count"));

  const label = document.querySelector('[data-testid="ai-exemplar-label"]');
  expect(label?.textContent, "exemplar label rendered in the AI panel").toBe("Mechanical Brush");
  expect(successToast).toHaveBeenCalledWith("Exemplar set: Mechanical Brush");
});

test("fresh load: a persisted linear marker still hits the count-only guard", async () => {
  const errorToast = vi.spyOn(toast, "error");
  await mountHost([persistedCount, persistedLinear]);
  armExemplarPicker();

  browserClick(markerByTool("linear"));

  expect(errorToast).toHaveBeenCalledWith(
    "Pick a count marker — linear and area takeoffs can't seed a count scan.",
  );
  expect(document.querySelector('[data-testid="ai-exemplar-label"]')).toBeNull();
});

test("select-mode pan still owns real drags: a drag over a marker never picks", async () => {
  await mountHost([persistedCount, persistedLinear]);
  armExemplarPicker();

  // 30px of travel: the pan takes capture mid-gesture, the click retargets
  // to the svg and gets discarded as a drag — no exemplar, no selection.
  browserClick(markerByTool("count"), [
    { x: 55, y: 40 },
    { x: 70, y: 40 },
  ]);

  expect(document.querySelector('[data-testid="ai-exemplar-label"]')).toBeNull();
});
