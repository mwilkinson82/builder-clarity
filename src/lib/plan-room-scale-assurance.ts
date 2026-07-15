import type { PlanRoomPoint, PlanRoomViewSize } from "@/lib/plan-room-math";

export const SCALE_ASSURANCE_TOLERANCE_PCT = 1.5;

export type ScaleAssuranceOutcome = "verified" | "conflict";

export type ScaleAssuranceCheckInput = {
  points: [PlanRoomPoint, PlanRoomPoint];
  labeled_distance_feet: number;
};

export type ScaleAssuranceCheckPreview = ScaleAssuranceCheckInput & {
  check_number: number;
  pixel_distance: number;
  measured_distance_feet: number;
  variance_pct: number;
  implied_scale_feet_per_pixel: number;
};

export type ScaleAssuranceSummary = {
  outcome: ScaleAssuranceOutcome;
  maxVariancePct: number;
  scaleSpreadPct: number;
  correctedScaleFeetPerPixel: number;
};

export type ScaleAssessmentEvidence = {
  check_number: number;
  points: [PlanRoomPoint, PlanRoomPoint];
  labeled_distance_feet: number;
  pixel_distance: number;
  measured_distance_feet: number;
  variance_pct: number;
  implied_scale_feet_per_pixel: number;
};

export interface ScaleAssessmentRow {
  id: string;
  estimate_id: string;
  plan_sheet_id: string;
  scale_revision: number;
  outcome: ScaleAssuranceOutcome;
  tolerance_pct: number;
  max_variance_pct: number;
  scale_spread_pct: number;
  evidence: ScaleAssessmentEvidence[];
  notes: string;
  created_by: string | null;
  created_at: string;
}

export type RecordScaleAssessmentResult = {
  assessment_id: string;
  outcome: ScaleAssuranceOutcome;
  max_variance_pct: number;
  scale_spread_pct: number;
  verified_at: string | null;
  evidence: ScaleAssessmentEvidence[];
};

const finite = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function previewScaleAssuranceCheck({
  points,
  labeledDistanceFeet,
  scaleFeetPerPixel,
  viewSize,
  checkNumber,
}: {
  points: [PlanRoomPoint, PlanRoomPoint];
  labeledDistanceFeet: number;
  scaleFeetPerPixel: number;
  viewSize: PlanRoomViewSize;
  checkNumber: number;
}): ScaleAssuranceCheckPreview | null {
  if (labeledDistanceFeet <= 0 || scaleFeetPerPixel <= 0) return null;
  const [start, end] = points;
  const pixelDistance = Math.hypot(
    (end.x - start.x) * viewSize.width,
    (end.y - start.y) * viewSize.height,
  );
  if (!Number.isFinite(pixelDistance) || pixelDistance <= 0.5) return null;
  const measuredDistanceFeet = pixelDistance * scaleFeetPerPixel;
  const variancePct = ((measuredDistanceFeet - labeledDistanceFeet) / labeledDistanceFeet) * 100;
  return {
    check_number: checkNumber,
    points,
    labeled_distance_feet: labeledDistanceFeet,
    pixel_distance: pixelDistance,
    measured_distance_feet: measuredDistanceFeet,
    variance_pct: variancePct,
    implied_scale_feet_per_pixel: labeledDistanceFeet / pixelDistance,
  };
}

export function summarizeScaleAssuranceChecks(
  checks: ScaleAssuranceCheckPreview[],
  tolerancePct = SCALE_ASSURANCE_TOLERANCE_PCT,
): ScaleAssuranceSummary | null {
  if (checks.length !== 2) return null;
  const implied = checks.map((check) => check.implied_scale_feet_per_pixel);
  const maxVariancePct = Math.max(...checks.map((check) => Math.abs(check.variance_pct)));
  const minScale = Math.min(...implied);
  const maxScale = Math.max(...implied);
  const midpoint = (minScale + maxScale) / 2;
  const scaleSpreadPct = midpoint > 0 ? ((maxScale - minScale) / midpoint) * 100 : 0;
  const correctedScaleFeetPerPixel = implied.reduce((sum, value) => sum + value, 0) / 2;
  return {
    outcome:
      maxVariancePct <= tolerancePct && scaleSpreadPct <= tolerancePct ? "verified" : "conflict",
    maxVariancePct,
    scaleSpreadPct,
    correctedScaleFeetPerPixel,
  };
}

export function normalizeScaleAssessment(row: Record<string, unknown>): ScaleAssessmentRow {
  const rawEvidence = Array.isArray(row.evidence) ? row.evidence : [];
  const evidence = rawEvidence.map((item) => {
    const raw = (item ?? {}) as Record<string, unknown>;
    const rawPoints = Array.isArray(raw.points) ? raw.points : [];
    const point = (value: unknown): PlanRoomPoint => {
      const candidate = (value ?? {}) as Record<string, unknown>;
      return { x: finite(candidate.x), y: finite(candidate.y) };
    };
    return {
      check_number: Math.round(finite(raw.check_number)),
      points: [point(rawPoints[0]), point(rawPoints[1])] as [PlanRoomPoint, PlanRoomPoint],
      labeled_distance_feet: finite(raw.labeled_distance_feet),
      pixel_distance: finite(raw.pixel_distance),
      measured_distance_feet: finite(raw.measured_distance_feet),
      variance_pct: finite(raw.variance_pct),
      implied_scale_feet_per_pixel: finite(raw.implied_scale_feet_per_pixel),
    };
  });
  return {
    id: String(row.id ?? ""),
    estimate_id: String(row.estimate_id ?? ""),
    plan_sheet_id: String(row.plan_sheet_id ?? ""),
    scale_revision: Math.round(finite(row.scale_revision, 1)),
    outcome: row.outcome === "verified" ? "verified" : "conflict",
    tolerance_pct: finite(row.tolerance_pct, SCALE_ASSURANCE_TOLERANCE_PCT),
    max_variance_pct: finite(row.max_variance_pct),
    scale_spread_pct: finite(row.scale_spread_pct),
    evidence,
    notes: String(row.notes ?? ""),
    created_by: row.created_by == null ? null : String(row.created_by),
    created_at: String(row.created_at ?? ""),
  };
}

export function isCurrentScaleAssessment(
  assessment: Pick<ScaleAssessmentRow, "scale_revision"> | null,
  scaleRevision: number,
) {
  return Boolean(assessment && assessment.scale_revision === scaleRevision);
}
