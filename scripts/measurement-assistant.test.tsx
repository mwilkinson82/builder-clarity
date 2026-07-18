import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeasurementAssistantPanel } from "@/components/estimates/plan-room/MeasurementAssistantPanel";
import { MeasurementAttentionDock } from "@/components/estimates/plan-room/MeasurementAttentionDock";
import { MeasurementGuideLayer } from "@/components/estimates/plan-room/MeasurementGuideLayer";
import { MeasurementGuideReviewBar } from "@/components/estimates/plan-room/MeasurementGuideReviewBar";
import {
  groupPdfMeasurementText,
  groupPdfMeasurementEvidence,
  measurementAssistantTakeoffNote,
  parseMeasurementAssistantPlan,
  parseMeasurementVisualGuide,
  sourceExcerptIsSupported,
  withMeasurementEvidenceTimeout,
  type MeasurementAssistantPlanResult,
} from "@/lib/plan-room-measurement-assistant";
import {
  duplicateScopeCounts,
  measurementScopeKey,
  measurementSuggestionKey,
  scopeItemAsSuggestion,
  type MeasurementScopeQueueItem,
} from "@/lib/plan-room-measurement-scope";
import {
  latestPlanScopeCoverageRecords,
  partitionPlanScopeCoverageDecisions,
  planScopeCoverageDiscipline,
} from "@/lib/plan-scope-coverage";
import { parsePlanScopeBrief, selectPlanScopeBriefSourceLines } from "@/lib/plan-scope-brief";
import {
  defaultScopeBriefNextAction,
  latestPlanScopeBriefReviews,
  planScopeBriefReviewIsActionable,
  planScopeBriefReviewDraftError,
  planScopeBriefStartActionLabel,
  type PlanScopeBriefReview,
} from "@/lib/plan-scope-brief-review";
import {
  resolveScaleAssessmentForSheet,
  type ScaleAssessmentRow,
} from "@/lib/plan-room-scale-assurance";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe("guided measurement planning", () => {
  it("returns control when selectable PDF note extraction stalls", async () => {
    await expect(
      withMeasurementEvidenceTimeout(
        new Promise<never>(() => undefined),
        "Reading selectable drawing notes",
        5,
      ),
    ).rejects.toThrow(
      "Reading selectable drawing notes took too long. Try the review again or open the source PDF for manual takeoff.",
    );
  });

  it("uses stable per-sheet suggestion keys and excludes rejected scope from duplicate warnings", () => {
    const suggestion = {
      tool: "linear" as const,
      label: " Corridor GWB Walls ",
      source_line: "L014",
      source_excerpt: "CONTINUOUS GWB AT CORRIDOR WALLS",
    };
    const secondSheet = {
      ...queuedScope,
      id: "66666666-6666-4666-8666-666666666666",
      plan_sheet_id: "77777777-7777-4777-8777-777777777777",
    };

    expect(measurementScopeKey(suggestion)).toBe("linear:corridor gwb walls");
    expect(measurementSuggestionKey(queuedScope.plan_sheet_id, suggestion)).toBe(
      measurementSuggestionKey(queuedScope.plan_sheet_id, suggestion),
    );
    expect(measurementSuggestionKey(queuedScope.plan_sheet_id, suggestion)).not.toBe(
      measurementSuggestionKey(secondSheet.plan_sheet_id, suggestion),
    );
    expect(duplicateScopeCounts([queuedScope, secondSheet]).get(queuedScope.scope_key)).toBe(2);
    expect(
      duplicateScopeCounts([queuedScope, { ...secondSheet, status: "rejected" }]).get(
        queuedScope.scope_key,
      ),
    ).toBe(1);
  });

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

  it("keeps a normalized drawing anchor with every cited PDF line", () => {
    const evidence = groupPdfMeasurementEvidence(
      [{ text: "CONTINUOUS GWB WALL", x: 100, y: 800, width: 120, height: 10 }],
      1000,
      1000,
    );

    expect(evidence[0]).toMatchObject({
      line_number: "L001",
      text: "CONTINUOUS GWB WALL",
    });
    expect(evidence[0].anchor.x).toBeGreaterThan(0.09);
    expect(evidence[0].anchor.y).toBeGreaterThan(0.18);
    expect(evidence[0].anchor.width).toBeGreaterThan(0.12);
    expect(evidence[0].anchor.height).toBeGreaterThan(0.01);
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

  it("keeps bounded visual guides as non-quantity routing hints", () => {
    const sourceLines = [
      { line_number: "L001", text: "PROVIDE CONTINUOUS GWB AT CORRIDOR WALLS" },
      { line_number: "L002", text: "EPOXY FLOOR FINISH IN MECHANICAL ROOM" },
    ];
    const plan = parseMeasurementAssistantPlan(
      JSON.stringify({
        suggestions: [
          {
            label: "continuous GWB corridor walls",
            tool: "linear",
            source_line: "L001",
            source_excerpt: "CONTINUOUS GWB AT CORRIDOR WALLS",
            guide_points: [
              { x: 0.12, y: 0.25 },
              { x: 0.42, y: 0.25 },
              { x: 0.42, y: 0.58 },
            ],
          },
          {
            label: "epoxy floor finish",
            tool: "area",
            source_line: "L002",
            source_excerpt: "EPOXY FLOOR FINISH IN MECHANICAL ROOM",
            guide_points: [
              { x: 0.58, y: 0.3 },
              { x: 0.78, y: 0.3 },
              { x: 0.78, y: 0.55 },
              { x: 0.58, y: 0.55 },
            ],
          },
        ],
      }),
      sourceLines,
    );

    expect(plan.suggestions.map((suggestion) => suggestion.guide?.kind)).toEqual([
      "linear_route",
      "area_region",
    ]);
    expect(plan.suggestions[0].guide?.source).toBe("ai_visual_hint");
    expect(plan.warnings).toEqual([]);
  });

  it("keeps cited scope but discards unsafe or degenerate visual geometry", () => {
    expect(
      parseMeasurementVisualGuide(
        [
          { x: 0.1, y: 0.1 },
          { x: 1.2, y: 0.1 },
        ],
        "linear",
      ),
    ).toBeNull();
    expect(
      parseMeasurementVisualGuide(
        [
          { x: 0.2, y: 0.2 },
          { x: 0.6, y: 0.6 },
          { x: 0.2, y: 0.6 },
          { x: 0.6, y: 0.2 },
        ],
        "area",
      ),
    ).toBeNull();

    const plan = parseMeasurementAssistantPlan(
      JSON.stringify({
        suggestions: [
          {
            label: "continuous GWB corridor walls",
            tool: "linear",
            source_line: "L001",
            source_excerpt: "CONTINUOUS GWB AT CORRIDOR WALLS",
            guide_points: [
              { x: 0.2, y: 0.2 },
              { x: 0.205, y: 0.205 },
            ],
          },
        ],
      }),
      [{ line_number: "L001", text: "CONTINUOUS GWB AT CORRIDOR WALLS" }],
    );

    expect(plan.suggestions).toHaveLength(1);
    expect(plan.suggestions[0].guide).toBeUndefined();
    expect(plan.warnings).toContain(
      "1 drawing location hint was omitted because the proposed geometry was not usable.",
    );
  });

  it("rejects the semantically unsupported suggestions observed in live A-100 QA", () => {
    const sourceLines = [
      { line_number: "L036", text: "RESTROOM" },
      { line_number: "L056", text: `ACCESS PANEL IN CEILING, 1'-8"` },
      { line_number: "L064", text: `CEILING TILE 2' x 4' CEILING GRID` },
      { line_number: "L095", text: "MASONRY OVERALL" },
      { line_number: "L131", text: "INTERIOR WALL PARTITION" },
    ];
    const plan = parseMeasurementAssistantPlan(
      JSON.stringify({
        summary: "plain-language understanding of this sheet's measurable scope",
        suggestions: [
          {
            label: "Access Panel Ceiling Locations",
            tool: "area",
            source_line: "L056",
            source_excerpt: `ACCESS PANEL IN CEILING, 1'-8"`,
            rationale: "Infer ceiling-grid labor and material.",
          },
          {
            label: "Interior Wall Partition Types",
            tool: "linear",
            source_line: "L131",
            source_excerpt: "INTERIOR WALL PARTITION",
            rationale: "Infer framing and finishes.",
          },
          {
            label: "Ceiling Grid",
            tool: "area",
            source_line: "L064",
            source_excerpt: `CEILING TILE 2' x 4' CEILING GRID`,
            rationale: "Infer tile supports.",
          },
          {
            label: "Masonry Overall",
            tool: "linear",
            source_line: "L095",
            source_excerpt: "MASONRY OVERALL",
            rationale: "Infer perimeter scope.",
          },
          {
            label: "Restroom Ceiling",
            tool: "area",
            source_line: "L036",
            source_excerpt: "RESTROOM",
            rationale: "Infer drywall or tile finishes.",
          },
        ],
        warnings: ["Uncited model warning"],
      }),
      sourceLines,
    );

    expect(plan.suggestions.map((suggestion) => suggestion.label)).toEqual([
      "Interior Wall Partition Types",
      "Ceiling Grid",
      "Masonry Overall",
    ]);
    expect(plan.summary).toBe(
      "Cited measurement scope found for Interior Wall Partition Types, Ceiling Grid and Masonry Overall.",
    );
    expect(plan.summary).not.toContain("plain-language understanding");
    expect(plan.warnings).toEqual([
      "2 AI suggestions were omitted because the cited note did not support the proposed scope or measurement tool.",
    ]);
    expect(plan.suggestions[0].rationale).not.toContain("framing");
    expect(plan.suggestions[0].rationale).toContain("only the supported scope");
  });

  it("requires the displayed excerpt itself to support the proposed label and tool", () => {
    const sourceLines = [
      {
        line_number: "L081",
        text: '1/2" GYPSUM BOARD DRAFT STOPPING (AREA OF ATTIC SPACE NOT TO EXCEED 3,000 SF)',
      },
    ];
    const plan = parseMeasurementAssistantPlan(
      JSON.stringify({
        suggestions: [
          {
            label: "draft board area",
            tool: "area",
            source_line: "L081",
            source_excerpt: "STOPPING (AREA OF ATTIC SPACE NOT TO EXCEED 3,000 SF)",
          },
        ],
      }),
      sourceLines,
    );

    expect(sourceExcerptIsSupported(sourceLines[0].text, "STOPPING (AREA OF ATTIC SPACE")).toBe(
      true,
    );
    expect(plan.suggestions).toEqual([]);
    expect(plan.summary).toBe(
      "No reliable linear or area measurement scope was found in the extracted notes.",
    );
    expect(plan.warnings).toEqual([
      "1 AI suggestion was omitted because the cited note did not support the proposed scope or measurement tool.",
    ]);
  });

  it("rejects the dimension fragments and detail captions observed in live Crystal QA", () => {
    const sourceLines = [
      { line_number: "L077", text: `RESTROOM WALL ℄ 9 7 60" 8` },
      {
        line_number: "L098",
        text: "WALL LOCATIONS FOR ALL GRAB BAR F.R.T. BLOCKING",
      },
      { line_number: "L103", text: "DOOR JAMB AT GWB PARTITION" },
      {
        line_number: "L104",
        text: "PROVIDE CONTINUOUS GWB PARTITION ALONG RESTROOM WALL",
      },
    ];
    const plan = parseMeasurementAssistantPlan(
      JSON.stringify({
        suggestions: [
          {
            label: "restroom wall",
            tool: "linear",
            source_line: "L077",
            source_excerpt: `RESTROOM WALL ℄ 9 7 60" 8`,
          },
          {
            label: "wall locations for all grab bar",
            tool: "linear",
            source_line: "L098",
            source_excerpt: "WALL LOCATIONS FOR ALL GRAB BAR F.R.T. BLOCKING",
          },
          {
            label: "door jamb at GWB partition",
            tool: "linear",
            source_line: "L103",
            source_excerpt: "DOOR JAMB AT GWB PARTITION",
          },
          {
            label: "continuous GWB partition",
            tool: "linear",
            source_line: "L104",
            source_excerpt: "PROVIDE CONTINUOUS GWB PARTITION ALONG RESTROOM WALL",
          },
        ],
      }),
      sourceLines,
    );

    expect(plan.suggestions.map((suggestion) => suggestion.label)).toEqual([
      "continuous GWB partition",
    ]);
    expect(plan.warnings).toEqual([
      "3 AI suggestions were omitted because the cited note did not support the proposed scope or measurement tool.",
    ]);
  });

  it("rejects code-limit and direction-only material fragments from live A-600 QA", () => {
    const sourceLines = [
      { line_number: "L025", text: "ROOFING MEMBRANE UP AND OVER" },
      { line_number: "L069", text: "FLOOR AREA PERMITTED IN CLEAR" },
      { line_number: "L070", text: "EPOXY FLOOR FINISH IN MECHANICAL ROOM" },
    ];
    const plan = parseMeasurementAssistantPlan(
      JSON.stringify({
        suggestions: [
          {
            label: "roofing membrane",
            tool: "area",
            source_line: "L025",
            source_excerpt: "ROOFING MEMBRANE UP AND OVER",
          },
          {
            label: "floor area",
            tool: "area",
            source_line: "L069",
            source_excerpt: "FLOOR AREA PERMITTED IN CLEAR",
          },
          {
            label: "epoxy floor finish",
            tool: "area",
            source_line: "L070",
            source_excerpt: "EPOXY FLOOR FINISH IN MECHANICAL ROOM",
          },
        ],
      }),
      sourceLines,
    );

    expect(plan.suggestions.map((suggestion) => suggestion.label)).toEqual(["epoxy floor finish"]);
    expect(plan.warnings).toEqual([
      "2 AI suggestions were omitted because the cited note did not support the proposed scope or measurement tool.",
    ]);
  });

  it("builds one deterministic latest cited review per sheet for the coverage matrix", () => {
    const rows = [
      {
        id: "new-operation",
        sheet_ids: ["sheet-a"],
        updated_at: "2026-07-15T20:00:00.000Z",
        model_used: "gpt-5-mini",
        credits_charged: 1,
        request_context: { source_line_count: 113 },
        result: {
          summary: "Ignore this model-authored summary.",
          suggestions: [
            {
              id: "candidate-1",
              label: "epoxy floor finish",
              tool: "area",
              source_line: "L070",
              source_excerpt: "EPOXY FLOOR FINISH IN MECHANICAL ROOM",
            },
          ],
          warnings: ["1 unsupported candidate was omitted."],
        },
      },
      {
        id: "old-operation",
        sheet_ids: ["sheet-a"],
        updated_at: "2026-07-15T19:00:00.000Z",
        result: { suggestions: [] },
      },
      {
        id: "sheet-b-operation",
        sheet_ids: ["sheet-b"],
        updated_at: "2026-07-15T18:00:00.000Z",
        request_context: { source_line_count: 20 },
        result: { suggestions: [] },
      },
    ];

    const records = latestPlanScopeCoverageRecords(rows);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      operation_id: "new-operation",
      sheet_id: "sheet-a",
      source_line_count: 113,
    });
    expect(records[0].plan.summary).toBe("Cited measurement scope found for epoxy floor finish.");
    expect(records.some((record) => record.operation_id === "old-operation")).toBe(false);
    expect(planScopeCoverageDiscipline({ sheet_number: "S-205", discipline: "Other" })).toBe(
      "Structural",
    );
  });

  it("revalidates historical matrix candidates against the current evidence gate", () => {
    const [record] = latestPlanScopeCoverageRecords([
      {
        id: "historical-operation",
        sheet_ids: ["sheet-a-600"],
        updated_at: "2026-07-15T20:00:00.000Z",
        request_context: {
          source_line_count: 2,
          source_lines: [
            { line_number: "L025", text: "ROOFING MEMBRANE UP AND OVER" },
            { line_number: "L069", text: "FLOOR AREA PERMITTED IN CLEAR" },
          ],
        },
        result: {
          suggestions: [
            {
              id: "candidate-1",
              label: "roofing membrane",
              tool: "area",
              source_line: "L025",
              source_excerpt: "ROOFING MEMBRANE UP AND OVER",
            },
            {
              id: "candidate-2",
              label: "floor area",
              tool: "area",
              source_line: "L069",
              source_excerpt: "FLOOR AREA PERMITTED IN CLEAR",
            },
          ],
        },
      },
    ]);

    expect(record.plan.suggestions).toEqual([]);
    expect(record.plan.warnings).toEqual([
      "2 AI suggestions were omitted because the cited note did not support the proposed scope or measurement tool.",
    ]);
  });

  it("retains estimator decisions as audit history without reviving filtered candidates", () => {
    const sheetId = queuedScope.plan_sheet_id;
    const currentSuggestion = {
      id: "current-candidate",
      label: "Corridor GWB walls",
      tool: "linear" as const,
      unit: "LF" as const,
      source_line: "L014",
      source_excerpt: "CONTINUOUS GWB AT CORRIDOR WALLS",
      rationale: "Review the cited note, then trace the supported wall run.",
      evidence_strength: "review" as const,
    };
    const record = {
      operation_id: "current-operation",
      sheet_id: sheetId,
      reviewed_at: "2026-07-15T20:00:00.000Z",
      model: "gpt-5-mini",
      credits_charged: 0,
      source_line_count: 42,
      plan: { summary: "Current cited scope.", suggestions: [currentSuggestion], warnings: [] },
    };
    const currentDecision = {
      ...queuedScope,
      suggestion_key: measurementSuggestionKey(sheetId, currentSuggestion),
    };
    const historicalDecision = {
      ...queuedScope,
      id: "historical-decision",
      suggestion_key: "measurement-no-longer-retained",
      label: "Door jamb at GWB partition",
      source_line: "L103",
      source_excerpt: "DOOR JAMB AT GWB PARTITION",
    };

    const partitioned = partitionPlanScopeCoverageDecisions({
      sheetId,
      record,
      queueItems: [currentDecision, historicalDecision],
    });

    expect(partitioned.current).toEqual([currentDecision]);
    expect(partitioned.historical).toEqual([historicalDecision]);
    expect(record.plan.suggestions).toEqual([currentSuggestion]);
  });

  it("selects scope-bearing plan notes without treating title blocks or dimensions as scope", () => {
    const selected = selectPlanScopeBriefSourceLines([
      { line_number: "L001", text: "PROJECT CRYSTAL CARWASH" },
      { line_number: "L002", text: "10'-0\"" },
      { line_number: "L003", text: "MASONRY CONTROL JOINT REINFORCEMENT" },
      { line_number: "L004", text: "DOOR JAMB AT GWB PARTITION" },
      { line_number: "L005", text: "SHEET S-100 FOUNDATION PLAN" },
    ]);

    expect(selected).toEqual([
      { line_number: "L003", text: "MASONRY CONTROL JOINT REINFORCEMENT" },
      { line_number: "L004", text: "DOOR JAMB AT GWB PARTITION" },
    ]);
  });

  it("builds a cited scope brief and drops unsupported labels or workflows", () => {
    const sheetId = "33333333-3333-4333-8333-333333333333";
    const brief = parsePlanScopeBrief({
      raw: JSON.stringify({
        items: [
          {
            trade: "Electrical",
            review_kind: "linear",
            scope_label: "masonry control joint reinforcement",
            plan_sheet_id: sheetId,
            source_line: "L015",
            source_excerpt: "MASONRY CONTROL JOINT REINFORCEMENT",
          },
          {
            trade: "Concrete / Masonry",
            review_kind: "count",
            scope_label: "masonry control joint reinforcement",
            plan_sheet_id: sheetId,
            source_line: "L015",
            source_excerpt: "MASONRY CONTROL JOINT REINFORCEMENT",
          },
          {
            trade: "Concrete / Masonry",
            review_kind: "linear",
            scope_label: "concrete foundation wall",
            plan_sheet_id: sheetId,
            source_line: "L015",
            source_excerpt: "MASONRY CONTROL JOINT REINFORCEMENT",
          },
        ],
      }),
      sourceSheets: [
        {
          plan_sheet_id: sheetId,
          sheet_number: "S-100",
          sheet_name: "FOUNDATION PLAN",
          discipline: "Structural",
          source_lines: [{ line_number: "L015", text: "MASONRY CONTROL JOINT REINFORCEMENT" }],
        },
      ],
      totalSheetCount: 2,
    });

    expect(brief.items).toHaveLength(1);
    expect(brief.items[0]).toMatchObject({
      trade: "Concrete / Masonry",
      review_kind: "linear",
      sheet_number: "S-100",
      source_line: "L015",
    });
    expect(brief.warnings).toEqual([
      "2 AI prompts were omitted because their labels or citations were not supported by the supplied drawing text.",
      "1 sheet has no retained selectable note text and still requires manual review.",
    ]);
  });

  it("classifies from the displayed citation instead of hidden line text or bad discipline metadata", () => {
    const sheetId = "44444444-4444-4444-8444-444444444444";
    const brief = parsePlanScopeBrief({
      raw: JSON.stringify({
        items: [
          {
            trade: "Other",
            review_kind: "assembly",
            scope_label: "single ply roof",
            plan_sheet_id: sheetId,
            source_line: "L020",
            source_excerpt: "SINGLE PLY ROOF",
          },
          {
            trade: "Other",
            review_kind: "area",
            scope_label: "single ply roof",
            plan_sheet_id: sheetId,
            source_line: "L020",
            source_excerpt: "SINGLE PLY ROOF",
          },
          {
            trade: "Other",
            review_kind: "count",
            scope_label: "fire extinguisher",
            plan_sheet_id: sheetId,
            source_line: "L021",
            source_excerpt: "FIRE EXTINGUISHER",
          },
        ],
      }),
      sourceSheets: [
        {
          plan_sheet_id: sheetId,
          sheet_number: "A-000",
          sheet_name: "GENERAL NOTES",
          discipline: "Plumbing / Metals",
          source_lines: [
            {
              line_number: "L020",
              text: "SINGLE PLY ROOF CONSTRUCTION OVER METAL DECK",
            },
            {
              line_number: "L021",
              text: "FIRE EXTINGUISHER PLUMBING SYMBOL SCHEDULE",
            },
          ],
        },
      ],
      totalSheetCount: 1,
    });

    expect(brief.items).toHaveLength(2);
    expect(brief.items.map((item) => [item.scope_label, item.trade, item.review_kind])).toEqual([
      ["single ply roof", "Envelope / Roofing", "area"],
      ["fire extinguisher", "Fire Protection", "count"],
    ]);
    expect(brief.warnings).toEqual([
      "1 AI prompt was omitted because its label or citation was not supported by the supplied drawing text.",
    ]);
  });

  it("keeps the newest append-only Scope Brief decision and requires auditable overrides", () => {
    const baseReview: PlanScopeBriefReview = {
      id: "11111111-1111-4111-8111-111111111111",
      estimate_id: "22222222-2222-4222-8222-222222222222",
      plan_set_id: "33333333-3333-4333-8333-333333333333",
      ai_operation_id: "44444444-4444-4444-8444-444444444444",
      item_id: "scope-brief-cited1",
      version: 1,
      trade: "Electrical",
      review_kind: "count",
      scope_label: "exterior light fixture",
      plan_sheet_id: "55555555-5555-4555-8555-555555555555",
      source_line: "L021",
      source_excerpt: "EXTERIOR LIGHT FIXTURE",
      status: "deferred",
      next_action: "count_review",
      review_notes: "",
      reviewed_by: "66666666-6666-4666-8666-666666666666",
      reviewed_by_name: "Estimator",
      reviewed_at: "2026-07-16T00:00:00.000Z",
      created_at: "2026-07-16T00:00:00.000Z",
    };
    const latestReview: PlanScopeBriefReview = {
      ...baseReview,
      id: "77777777-7777-4777-8777-777777777777",
      version: 2,
      status: "accepted",
      reviewed_at: "2026-07-16T00:05:00.000Z",
    };

    expect(latestPlanScopeBriefReviews([latestReview, baseReview]).get(baseReview.item_id)).toEqual(
      latestReview,
    );
    expect(planScopeBriefReviewIsActionable(baseReview)).toBe(false);
    expect(planScopeBriefReviewIsActionable(latestReview)).toBe(true);
    expect(defaultScopeBriefNextAction("count")).toBe("count_review");
    expect(planScopeBriefStartActionLabel("count_review")).toBe("Start count review");
    expect(planScopeBriefStartActionLabel("length_review")).toBe("Prepare length takeoff");
    expect(
      planScopeBriefReviewDraftError({
        status: "accepted",
        nextAction: "pricing_review",
        defaultAction: "count_review",
        notes: "",
      }),
    ).toBe("Explain why the next action differs from the cited review type.");
    expect(
      planScopeBriefReviewDraftError({
        status: "excluded",
        nextAction: "none",
        defaultAction: "count_review",
        notes: "Covered by owner",
      }),
    ).toBeNull();
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
      guide: {
        kind: "linear_route",
        source: "ai_visual_hint",
        points: [
          { x: 0.2, y: 0.3 },
          { x: 0.7, y: 0.3 },
        ],
      },
    },
  ],
};

const queuedScope: MeasurementScopeQueueItem = {
  id: "11111111-1111-4111-8111-111111111111",
  estimate_id: "22222222-2222-4222-8222-222222222222",
  plan_sheet_id: "33333333-3333-4333-8333-333333333333",
  ai_operation_id: "44444444-4444-4444-8444-444444444444",
  suggestion_key: "measurement-test",
  scope_key: "linear:corridor gwb walls",
  label: "Corridor GWB walls",
  tool_type: "linear",
  unit: "LF",
  source_line: "L014",
  source_excerpt: "CONTINUOUS GWB AT CORRIDOR WALLS",
  source_anchor: { x: 0.1, y: 0.2, width: 0.3, height: 0.04 },
  guide: result.suggestions[0].guide ?? null,
  guide_source: "ai_visual_hint",
  status: "accepted",
  decision_by: "55555555-5555-4555-8555-555555555555",
  decision_by_name: "Estimator",
  decision_at: "2026-07-15T17:00:00.000Z",
  takeoff_measurement_id: null,
  estimate_line_item_id: null,
  library_item_id: null,
  completed_by: null,
  completed_by_name: "Team member",
  completed_at: null,
  created_at: "2026-07-15T17:00:00.000Z",
  updated_at: "2026-07-15T17:00:00.000Z",
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
  const showEvidence = vi.fn();
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
        queueItemBySuggestionId={{ "measurement-suggestion-1": queuedScope }}
        duplicateCountBySuggestionId={{ "measurement-suggestion-1": 2 }}
        activeEvidenceSourceLine=""
        activeGuideSuggestionId=""
        decisionPending={false}
        onAnalyze={() => {}}
        onPrepare={prepare}
        onShowEvidence={showEvidence}
        onShowGuide={() => {}}
        onDecision={() => {}}
        onClear={() => {}}
      />,
    ),
  );

  expect(container.textContent).toContain("AI reads selectable drawing notes");
  expect(container.textContent).toContain("L014 · “CONTINUOUS GWB AT CORRIDOR WALLS”");
  expect(container.textContent).toContain("Possible duplicate · 2 sheets");
  const note = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === "Note",
  );
  act(() => (note as HTMLButtonElement).click());
  expect(showEvidence).toHaveBeenCalledWith(result.suggestions[0]);
  const start = container.querySelector<HTMLButtonElement>(
    '[data-testid="measurement-suggestion-start-measurement-suggestion-1"]',
  );
  act(() => start!.click());
  expect(prepare).toHaveBeenCalledWith(result.suggestions[0]);
});

it("renders drawing guides as selectable dashed hints", () => {
  const select = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <svg viewBox="0 0 1000 700">
        <MeasurementGuideLayer
          suggestions={result.suggestions}
          activeSuggestionId=""
          viewSize={{ width: 1000, height: 700 }}
          onSelect={select}
        />
      </svg>,
    ),
  );

  const guide = container.querySelector<SVGGElement>(
    '[data-testid="measurement-guide-measurement-suggestion-1"]',
  );
  expect(guide).not.toBeNull();
  expect(
    container
      .querySelector('[data-testid="measurement-guide-path-measurement-suggestion-1"]')
      ?.getAttribute("stroke-dasharray"),
  ).toBe("7 6");
  act(() => guide!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(select).toHaveBeenCalledWith("measurement-suggestion-1");
});

it("keeps accepted visual-guide provenance available after the AI review session", () => {
  const restored = scopeItemAsSuggestion(queuedScope);

  expect(restored.guide).toEqual(result.suggestions[0].guide);
  expect(restored.guide?.source).toBe("ai_visual_hint");
  expect(restored.id).toBe(`scope-item-${queuedScope.id}`);
});

it("lets the estimator spotlight, hide, and replay a sparse AI attention layer", () => {
  const setMode = vi.fn();
  const replay = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <MeasurementAttentionDock
        count={3}
        activeIndex={1}
        mode="all"
        opacity={70}
        onPrevious={() => {}}
        onNext={() => {}}
        onModeChange={setMode}
        onOpacityChange={() => {}}
        onReplay={replay}
      />,
    ),
  );

  expect(container.textContent).toContain("AI attention layer");
  expect(container.textContent).toContain("Visual callouts only");
  expect(container.textContent).toContain("2/3");
  act(() =>
    container
      .querySelector<HTMLButtonElement>('[data-testid="measurement-attention-spotlight"]')!
      .click(),
  );
  expect(setMode).toHaveBeenCalledWith("spotlight");
  act(() =>
    container
      .querySelector<HTMLButtonElement>('[data-testid="measurement-attention-replay"]')!
      .click(),
  );
  expect(replay).toHaveBeenCalledOnce();
});

it("requires estimator acceptance before a visual hint can start a trusted trace", () => {
  const start = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <MeasurementGuideReviewBar
        suggestion={result.suggestions[0]}
        label="Corridor GWB walls"
        queueStatus="accepted"
        scaleVerified
        pending={false}
        onLabelChange={() => {}}
        onShowEvidence={() => {}}
        onAccept={() => {}}
        onReject={() => {}}
        onStartTrace={start}
        onClose={() => {}}
      />,
    ),
  );

  expect(container.textContent).toContain("cannot feed the estimate");
  expect(container.textContent).toContain("Estimator accepted");
  expect(
    container.querySelector<HTMLInputElement>('[data-testid="measurement-guide-label"]')?.disabled,
  ).toBe(true);
  const startButton = container.querySelector<HTMLButtonElement>(
    '[data-testid="measurement-guide-start"]',
  );
  act(() => startButton!.click());
  expect(start).toHaveBeenCalledOnce();
});
