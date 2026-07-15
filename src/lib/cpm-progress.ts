export type CpmProgressBasis = "reviewed_percent" | "installed_quantity";
export type CpmProgressDecision = "accepted" | "kept" | "overridden";

export interface CpmProgressActivity {
  id: string;
  activityId: string;
  name: string;
  division: string;
  currentPercent: number;
}

export interface CpmProgressEvidenceEntry {
  id: string;
  scheduleActivityId: string;
  entryDate: string;
  updatedAt: string;
  activity: string;
  quantity: number;
  unit: string;
  percentBasis: "sov" | "cpm";
  reviewedPercent: number;
  reviewedAt: string | null;
}

export interface CpmProgressControl {
  scheduleActivityId: string;
  basis: CpmProgressBasis;
  plannedQuantity: number | null;
  unit: string;
}

export interface CpmProgressReview {
  id: string;
  scheduleActivityId: string;
  basis: CpmProgressBasis;
  currentPercent: number;
  recommendedPercent: number;
  acceptedPercent: number;
  decision: CpmProgressDecision;
  note: string;
  reviewedBy: string;
  reviewedByName: string | null;
  reviewedAt: string;
}

export interface CpmProgressRecommendation extends CpmProgressActivity {
  basis: CpmProgressBasis;
  plannedQuantity: number | null;
  unit: string;
  installedQuantity: number | null;
  recommendedPercent: number | null;
  variancePercent: number | null;
  sourcePeriodStart: string | null;
  sourcePeriodEnd: string | null;
  sourceEntryId: string | null;
  sourceEntryIds: string[];
  evidenceCount: number;
  latestReview: CpmProgressReview | null;
  explanation: string;
}

export interface CpmProgressDecisionResolution {
  acceptedPercent: number;
  reviewNote: string;
  updatesCpm: boolean;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function percent(value: number): number {
  return Math.min(100, Math.max(0, finite(value)));
}

export function resolveCpmProgressDecision({
  decision,
  currentPercent,
  recommendedPercent,
  requestedPercent,
  note,
}: {
  decision: CpmProgressDecision;
  currentPercent: number;
  recommendedPercent: number;
  requestedPercent: number;
  note: string;
}): CpmProgressDecisionResolution {
  if (decision === "accepted") {
    return {
      acceptedPercent: recommendedPercent,
      reviewNote: note.trim(),
      updatesCpm: true,
    };
  }
  if (decision === "kept") {
    return {
      acceptedPercent: currentPercent,
      reviewNote: "",
      updatesCpm: false,
    };
  }
  if (
    !Number.isFinite(requestedPercent) ||
    requestedPercent < 0 ||
    requestedPercent > 100 ||
    Math.abs(requestedPercent - recommendedPercent) <= 0.01 ||
    Math.abs(requestedPercent - currentPercent) <= 0.01
  ) {
    throw new Error("A different CPM value must differ from both the recommendation and CPM now.");
  }
  if (!note.trim()) {
    throw new Error("Explain why the CPM value differs from the Daily WIP recommendation.");
  }
  return {
    acceptedPercent: requestedPercent,
    reviewNote: note.trim(),
    updatesCpm: true,
  };
}

export function canonicalCpmProgressUnit(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const aliases: Record<string, string> = {
    "sq ft": "sf",
    sqft: "sf",
    "square feet": "sf",
    "square foot": "sf",
    "lin ft": "lf",
    "linear feet": "lf",
    "linear foot": "lf",
    each: "ea",
    units: "ea",
    unit: "ea",
  };
  return aliases[normalized] ?? normalized;
}

function newestFirst(a: CpmProgressEvidenceEntry, b: CpmProgressEvidenceEntry): number {
  return (
    b.entryDate.localeCompare(a.entryDate) ||
    b.updatedAt.localeCompare(a.updatedAt) ||
    b.id.localeCompare(a.id)
  );
}

export function buildCpmProgressRecommendations({
  activities,
  entries,
  controls,
  reviews,
}: {
  activities: CpmProgressActivity[];
  entries: CpmProgressEvidenceEntry[];
  controls: CpmProgressControl[];
  reviews: CpmProgressReview[];
}): CpmProgressRecommendation[] {
  const controlByActivity = new Map(controls.map((row) => [row.scheduleActivityId, row]));
  const latestReviewByActivity = new Map<string, CpmProgressReview>();
  for (const review of [...reviews].sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt))) {
    if (!latestReviewByActivity.has(review.scheduleActivityId)) {
      latestReviewByActivity.set(review.scheduleActivityId, review);
    }
  }

  const reviewedEntriesByActivity = new Map<string, CpmProgressEvidenceEntry[]>();
  for (const entry of entries) {
    if (!entry.reviewedAt || !entry.scheduleActivityId) continue;
    const rows = reviewedEntriesByActivity.get(entry.scheduleActivityId) ?? [];
    rows.push(entry);
    reviewedEntriesByActivity.set(entry.scheduleActivityId, rows);
  }

  return activities
    .map<CpmProgressRecommendation | null>((activity) => {
      const evidence = (reviewedEntriesByActivity.get(activity.id) ?? []).sort(newestFirst);
      const control = controlByActivity.get(activity.id);
      const latestReview = latestReviewByActivity.get(activity.id) ?? null;
      if (evidence.length === 0 && !control && !latestReview) return null;

      const basis = control?.basis ?? "reviewed_percent";
      const unit = control?.unit.trim() ?? "";
      const plannedQuantity = control?.plannedQuantity ?? null;
      let includedEvidence: CpmProgressEvidenceEntry[] = [];
      let installedQuantity: number | null = null;
      let recommendedPercent: number | null = null;
      let explanation = "";

      if (basis === "installed_quantity") {
        const canonicalUnit = canonicalCpmProgressUnit(unit);
        includedEvidence = evidence.filter(
          (entry) => entry.quantity > 0 && canonicalCpmProgressUnit(entry.unit) === canonicalUnit,
        );
        installedQuantity = includedEvidence.reduce(
          (sum, entry) => sum + Math.max(0, finite(entry.quantity)),
          0,
        );
        if (
          plannedQuantity &&
          plannedQuantity > 0 &&
          canonicalUnit &&
          includedEvidence.length > 0
        ) {
          recommendedPercent = percent((installedQuantity / plannedQuantity) * 100);
          explanation = `${installedQuantity.toLocaleString()} ${unit} installed ÷ ${plannedQuantity.toLocaleString()} ${unit} planned`;
        } else if (!plannedQuantity || plannedQuantity <= 0 || !canonicalUnit) {
          explanation = "Set the planned quantity and unit before using installed quantity.";
        } else {
          explanation = `No reviewed Daily WIP quantity matches ${unit}.`;
        }
      } else {
        includedEvidence = evidence.filter((entry) => entry.percentBasis === "cpm");
        const latestPercent = includedEvidence[0];
        if (latestPercent) {
          recommendedPercent = percent(latestPercent.reviewedPercent);
          explanation = `Latest PM-reviewed Daily WIP activity percent from ${latestPercent.entryDate}`;
        } else {
          explanation = "Set the linked Daily WIP percent basis to CPM and review the work line.";
        }
      }

      const chronological = [...includedEvidence].sort((a, b) =>
        a.entryDate.localeCompare(b.entryDate),
      );
      return {
        ...activity,
        basis,
        plannedQuantity,
        unit,
        installedQuantity,
        recommendedPercent,
        variancePercent:
          recommendedPercent == null ? null : recommendedPercent - activity.currentPercent,
        sourcePeriodStart: chronological[0]?.entryDate ?? null,
        sourcePeriodEnd: chronological.at(-1)?.entryDate ?? null,
        sourceEntryId: includedEvidence[0]?.id ?? null,
        sourceEntryIds: includedEvidence.map((entry) => entry.id),
        evidenceCount: includedEvidence.length,
        latestReview,
        explanation,
      };
    })
    .filter((row): row is CpmProgressRecommendation => row != null)
    .sort((a, b) => {
      const actionA = a.recommendedPercent == null ? -1 : Math.abs(a.variancePercent ?? 0);
      const actionB = b.recommendedPercent == null ? -1 : Math.abs(b.variancePercent ?? 0);
      return actionB - actionA || a.activityId.localeCompare(b.activityId);
    });
}
