import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeasurementAssistantPanel } from "@/components/estimates/plan-room/MeasurementAssistantPanel";
import {
  groupPdfMeasurementText,
  measurementAssistantTakeoffNote,
  parseMeasurementAssistantPlan,
  sourceExcerptIsSupported,
  type MeasurementAssistantPlanResult,
} from "@/lib/plan-room-measurement-assistant";
import {
  resolveScaleAssessmentForSheet,
  type ScaleAssessmentRow,
} from "@/lib/plan-room-scale-assurance";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe("guided measurement planning", () => {
  it("turns positioned PDF runs into stable top-to-bottom cited lines", () => {
    const lines = groupPdfMeasurementText([
      { text: "WALLS", x: 40, y: 680, height: 12 },
      { text: "TYPE A", x: 100, y: 680.5, height: 12 },
      { text: "PAINT GWB PARTITIONS", x: 40, y: 620, height: 10 },
    ]);

    expect(lines).toEqual([
      { line_number: "L001", text: "WALLS TYPE A" },
      { line_number: "L002", text: "PAINT GWB PARTITIONS" },
    ]);
  });

  it("drops suggestions that cannot prove their source excerpt", () => {
    const sourceLines = [
      { line_number: "L001", text: "PROVIDE CONTINUOUS 5/8 IN GWB AT CORRIDOR WALLS" },
      { line_number: "L002", text: "EPOXY FLOOR FINISH IN MECHANICAL ROOM" },
    ];
    const plan = parseMeasurementAssistantPlan(
      JSON.stringify({
        summary: "Interior finish scope is called out.",
        suggestions: [
          {
            label: "Corridor GWB walls",
            tool: "linear",
            unit: "LF",
            source_line: "L001",
            source_excerpt: "CONTINUOUS 5/8 IN GWB AT CORRIDOR WALLS",
            rationale: "Trace the corridor wall run for board scope.",
            evidence_strength: "direct",
          },
          {
            label: "Concrete footing",
            tool: "linear",
            unit: "LF",
            source_line: "L002",
            source_excerpt: "CONTINUOUS CONCRETE FOOTING",
            rationale: "Trace the footing.",
            evidence_strength: "direct",
          },
        ],
        warnings: [],
      }),
      sourceLines,
    );

    expect(plan.suggestions).toHaveLength(1);
    expect(plan.suggestions[0]).toMatchObject({
      label: "Corridor GWB walls",
      unit: "LF",
      source_line: "L001",
    });
    expect(sourceExcerptIsSupported(sourceLines[0].text, "GWB AT CORRIDOR WALLS")).toBe(true);
    expect(measurementAssistantTakeoffNote(plan.suggestions[0])).toContain(
      "Geometry and final quantity placed by the estimator.",
    );
  });

  it("prefers the just-saved assessment until refreshed server data catches up", () => {
    const persisted: ScaleAssessmentRow = {
      id: "persisted",
      estimate_id: "estimate",
      plan_sheet_id: "sheet",
      scale_revision: 2,
      outcome: "conflict",
      tolerance_pct: 1.5,
      max_variance_pct: 10,
      scale_spread_pct: 2,
      evidence: [],
      notes: "",
      created_by: null,
      created_at: "2026-07-15T15:00:00.000Z",
    };
    const justSaved: ScaleAssessmentRow = {
      ...persisted,
      id: "just-saved",
      outcome: "verified",
      max_variance_pct: 0.2,
      scale_spread_pct: 0.1,
      created_at: "2026-07-15T16:00:00.000Z",
    };

    expect(
      resolveScaleAssessmentForSheet({
        assessments: [persisted],
        pendingAssessment: justSaved,
        sheetId: "sheet",
        scaleRevision: 2,
      }),
    ).toBe(justSaved);
  });
});

const result: MeasurementAssistantPlanResult = {
  operation_id: "operation",
  credits_charged: 1,
  model: "gpt-4o",
  provider: "openai",
  source_line_count: 42,
  summary: "The notes call for a corridor wall finish takeoff.",
  warnings: [],
  suggestions: [
    {
      id: "measurement-suggestion-1",
      label: "Corridor GWB walls",
      tool: "linear",
      unit: "LF",
      source_line: "L014",
      source_excerpt: "CONTINUOUS GWB AT CORRIDOR WALLS",
      rationale: "Trace the corridor wall run.",
      evidence_strength: "direct",
    },
  ],
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.restoreAllMocks();
});

it("shows source evidence and hands the chosen scope back to the estimator", () => {
  const prepare = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <MeasurementAssistantPanel
        plan={result}
        pending={false}
        canAnalyze
        scaleVerified
        preparedSuggestionId=""
        completedSuggestionIds={[]}
        onAnalyze={() => {}}
        onPrepare={prepare}
        onClear={() => {}}
      />,
    ),
  );

  expect(container.textContent).toContain("AI reads selectable drawing notes");
  expect(container.textContent).toContain("L014 · “CONTINUOUS GWB AT CORRIDOR WALLS”");
  const start = container.querySelector<HTMLButtonElement>(
    '[data-testid="measurement-suggestion-start-measurement-suggestion-1"]',
  );
  act(() => start!.click());
  expect(prepare).toHaveBeenCalledWith(result.suggestions[0]);
});
