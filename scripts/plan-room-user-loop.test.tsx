import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EstimatorActivationChecklist } from "@/components/estimates/plan-room/EstimatorActivationChecklist";
import { MeasurementAttentionDock } from "@/components/estimates/plan-room/MeasurementAttentionDock";
import { MeasurementGuideReviewBar } from "@/components/estimates/plan-room/MeasurementGuideReviewBar";
import { TakeoffRunPreview } from "@/components/estimates/plan-room/TakeoffRunPreview";
import { DraftShape, MeasurementShape } from "@/components/estimates/plan-room/TakeoffTools";
import type { MeasurementAssistantSuggestion } from "@/lib/plan-room-measurement-assistant";
import type { TakeoffMeasurementRow } from "@/lib/plan-room.functions";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const linearMeasurement = {
  id: "measurement-1",
  estimate_id: "estimate-1",
  plan_sheet_id: "sheet-1",
  estimate_line_item_id: null,
  library_item_id: null,
  created_by: "estimator-1",
  tool_type: "linear",
  label: "Foundation wall",
  unit: "LF",
  quantity: 21.03,
  waste_pct: 0,
  color: "#0f766e",
  geometry: {
    points: [
      { x: 0.1, y: 0.25 },
      { x: 0.3103, y: 0.25 },
    ],
    view_size: { width: 1000, height: 700 },
  },
  notes: "",
  created_by_ai: false,
  scope_brief_review_id: null,
  calculation_status: "current",
  calculation_method: "geometry",
  created_at: "2026-07-20T00:00:00Z",
  updated_at: "2026-07-20T00:00:00Z",
} as unknown as TakeoffMeasurementRow;

const guideSuggestion = {
  id: "guide-1",
  tool: "linear",
  label: "Retaining wall",
  unit: "LF",
  source_line: "L059",
  source_excerpt: "RETAINING WALL",
  evidence_strength: "direct",
  guide: {
    kind: "route",
    points: [
      { x: 0.1, y: 0.2 },
      { x: 0.8, y: 0.2 },
    ],
    source: "ai_visual_hint",
  },
} as MeasurementAssistantSuggestion;

describe("reported estimator workflow regressions", () => {
  it("uses feet-inches-fractions for persisted, draft, and live LF geometry", () => {
    const persisted = renderToStaticMarkup(
      <svg>
        <MeasurementShape
          measurement={linearMeasurement}
          viewSize={{ width: 1000, height: 700 }}
          selected={false}
          editable={false}
          pointsOverride={null}
          onSelect={() => {}}
          onPointDragStart={() => {}}
        />
      </svg>,
    );
    const draft = renderToStaticMarkup(
      <svg>
        <DraftShape
          points={[
            { x: 0.1, y: 0.25 },
            { x: 0.3103, y: 0.25 },
          ]}
          viewSize={{ width: 1000, height: 700 }}
          color="#0f766e"
          scaleFeetPerPixel={0.1}
          unit="LF"
          tool="linear"
          command={null}
        />
      </svg>,
    );
    const live = renderToStaticMarkup(
      <svg>
        <TakeoffRunPreview
          pendingPoints={[{ x: 0.1, y: 0.25 }]}
          cursor={{
            point: { x: 0.3103, y: 0.25 },
            angleDeg: 0,
            orthoSnapped: true,
            geometrySnapped: false,
          }}
          tool="linear"
          viewSize={{ width: 1000, height: 700 }}
          zoom={1}
          scaleFeetPerPixel={0.1}
          unit="LF"
        />
      </svg>,
    );

    for (const markup of [persisted, draft, live]) {
      expect(markup).toContain(`21&#x27;-0 3/8&quot;`);
      expect(markup).not.toContain("21.03 LF");
    }
    expect(linearMeasurement.quantity).toBe(21.03);
  });

  it("makes the two-check scale requirement and the next action explicit", () => {
    const markup = renderToStaticMarkup(
      <EstimatorActivationChecklist
        hasDrawings
        hasScale
        scaleVerified={false}
        scaleCheckCount={1}
        hasTakeoff={false}
        hasLinkedTakeoff={false}
        onOpenDrawings={vi.fn()}
        onVerifyScale={vi.fn()}
        onOpenAiMarkups={vi.fn()}
        onOpenWorksheet={vi.fn()}
        onHide={vi.fn()}
      />,
    );

    expect(markup).toContain("Confirm this sheet&#x27;s scale");
    expect(markup).toContain("1 of 2 dimension checks recorded");
    expect(markup).toContain("Record check 2");
    expect(markup).toContain('data-testid="estimator-activation-scale"');
  });

  it("wires the scale action and reflects completion after the second saved check", () => {
    const openScale = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const renderChecklist = (scaleVerified: boolean, scaleCheckCount: number) => (
      <EstimatorActivationChecklist
        hasDrawings
        hasScale
        scaleVerified={scaleVerified}
        scaleCheckCount={scaleCheckCount}
        hasTakeoff={false}
        hasLinkedTakeoff={false}
        onOpenDrawings={() => {}}
        onVerifyScale={openScale}
        onOpenAiMarkups={() => {}}
        onOpenWorksheet={() => {}}
        onHide={() => {}}
      />
    );

    act(() => root.render(renderChecklist(false, 1)));
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="estimator-activation-scale"]')!
        .click(),
    );
    expect(openScale).toHaveBeenCalledOnce();

    act(() => root.render(renderChecklist(true, 2)));
    expect(container.textContent).toContain("Two independent dimensions agree on this sheet.");
    expect(container.textContent).toContain("Review scale");

    act(() => root.unmount());
    container.remove();
  });

  it("keeps accept, reject, and exit visible for a structural callout", () => {
    const markup = renderToStaticMarkup(
      <MeasurementGuideReviewBar
        suggestion={guideSuggestion}
        label="Retaining wall"
        queueStatus={null}
        scaleVerified={false}
        structuralSheet
        pending={false}
        onLabelChange={() => {}}
        onShowEvidence={() => {}}
        onAccept={() => {}}
        onReject={() => {}}
        onStartTrace={() => {}}
        onClose={() => {}}
      />,
    );

    expect(markup).toContain("AI visual hypothesis");
    expect(markup).toContain("Structural sheets contain dense grids");
    expect(markup).toContain("Accept &amp; next");
    expect(markup).toContain("Reject &amp; next");
    expect(markup).toContain("Exit review");
  });

  it("provides an explicit way to finish the attention layer", () => {
    const markup = renderToStaticMarkup(
      <MeasurementAttentionDock
        count={3}
        activeIndex={0}
        mode="all"
        opacity={85}
        onPrevious={() => {}}
        onNext={() => {}}
        onModeChange={() => {}}
        onOpacityChange={() => {}}
        onReplay={() => {}}
        onExit={() => {}}
      />,
    );

    expect(markup).toContain('data-testid="measurement-attention-exit"');
    expect(markup).toContain("Done");
  });
});
