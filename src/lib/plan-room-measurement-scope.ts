import type {
  MeasurementAssistantSuggestion,
  MeasurementEvidenceAnchor,
  MeasurementVisualGuide,
} from "@/lib/plan-room-measurement-assistant";

export type MeasurementScopeStatus = "accepted" | "rejected" | "deferred" | "completed";
export type MeasurementScopeDecisionStatus = Exclude<MeasurementScopeStatus, "completed">;

export interface MeasurementScopeQueueItem {
  id: string;
  estimate_id: string;
  plan_sheet_id: string;
  ai_operation_id: string | null;
  suggestion_key: string;
  scope_key: string;
  label: string;
  tool_type: "linear" | "area";
  unit: "LF" | "SF";
  source_line: string;
  source_excerpt: string;
  source_anchor: MeasurementEvidenceAnchor | null;
  guide: MeasurementVisualGuide | null;
  guide_source: "ai_visual_hint" | null;
  status: MeasurementScopeStatus;
  decision_by: string | null;
  decision_by_name: string;
  decision_at: string;
  takeoff_measurement_id: string | null;
  estimate_line_item_id: string | null;
  library_item_id: string | null;
  completed_by: string | null;
  completed_by_name: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

const normalizedScopeText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function stableKey(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function measurementScopeKey(
  suggestion: Pick<MeasurementAssistantSuggestion, "tool" | "label">,
) {
  return `${suggestion.tool}:${normalizedScopeText(suggestion.label)}`;
}

export function measurementSuggestionKey(
  sheetId: string,
  suggestion: Pick<
    MeasurementAssistantSuggestion,
    "tool" | "label" | "source_line" | "source_excerpt"
  >,
) {
  const identity = [
    sheetId,
    suggestion.tool,
    normalizedScopeText(suggestion.label),
    suggestion.source_line.toUpperCase(),
    normalizedScopeText(suggestion.source_excerpt),
  ].join("|");
  return `measurement-${stableKey(identity)}`;
}

export function scopeItemAsSuggestion(item: MeasurementScopeQueueItem) {
  return {
    id: `scope-item-${item.id}`,
    label: item.label,
    tool: item.tool_type,
    unit: item.unit,
    source_line: item.source_line,
    source_excerpt: item.source_excerpt,
    rationale:
      item.tool_type === "linear"
        ? "Review the cited note, then trace only the supported scope as a linear takeoff."
        : "Review the cited note, then trace only the supported surface as an area takeoff.",
    evidence_strength: "review" as const,
    ...(item.guide ? { guide: item.guide } : {}),
  } satisfies MeasurementAssistantSuggestion;
}

export function duplicateScopeCounts(items: MeasurementScopeQueueItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.status === "rejected") continue;
    counts.set(item.scope_key, (counts.get(item.scope_key) ?? 0) + 1);
  }
  return counts;
}

export function measurementScopeStatusLabel(status: MeasurementScopeStatus) {
  if (status === "accepted") return "Queued";
  if (status === "deferred") return "Deferred";
  if (status === "rejected") return "Rejected";
  return "Measured";
}
