import {
  measurementAssistantPlanSummary,
  measurementSuggestionRationale,
  parseMeasurementAssistantPlan,
  type MeasurementAssistantPlan,
  type MeasurementAssistantSuggestion,
  type MeasurementSourceLine,
} from "@/lib/plan-room-measurement-assistant";

export interface PlanScopeCoverageRecord {
  operation_id: string;
  sheet_id: string;
  reviewed_at: string;
  model: string;
  credits_charged: number;
  source_line_count: number;
  plan: MeasurementAssistantPlan;
}

const clean = (value: unknown, max: number) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const objectValue = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function normalizedStoredSuggestion(
  value: unknown,
  index: number,
): MeasurementAssistantSuggestion | null {
  const item = objectValue(value);
  if (!item) return null;
  const tool = item.tool === "linear" ? "linear" : item.tool === "area" ? "area" : null;
  if (!tool) return null;
  const label = clean(item.label, 120);
  const sourceLine = clean(item.source_line, 12).toUpperCase();
  const sourceExcerpt = clean(item.source_excerpt, 260);
  if (!label || !/^L\d{3}$/.test(sourceLine) || sourceExcerpt.length < 3) return null;
  return {
    id: clean(item.id, 120) || `measurement-suggestion-${index + 1}`,
    label,
    tool,
    unit: tool === "linear" ? "LF" : "SF",
    source_line: sourceLine,
    source_excerpt: sourceExcerpt,
    rationale: measurementSuggestionRationale(tool),
    evidence_strength: "review",
  };
}

export function normalizePlanScopeCoverageRecord(value: unknown): PlanScopeCoverageRecord | null {
  const row = objectValue(value);
  if (!row) return null;
  const operationId = clean(row.id, 80);
  const sheetIds = Array.isArray(row.sheet_ids) ? row.sheet_ids : [];
  const sheetId = clean(sheetIds[0], 80);
  const result = objectValue(row.result);
  const requestContext = objectValue(row.request_context);
  if (!operationId || !sheetId || !result) return null;
  const storedSuggestions = (Array.isArray(result.suggestions) ? result.suggestions : [])
    .map(normalizedStoredSuggestion)
    .filter((item): item is MeasurementAssistantSuggestion => item !== null)
    .slice(0, 12);
  const sourceLines: MeasurementSourceLine[] = (
    Array.isArray(requestContext?.source_lines) ? requestContext.source_lines : []
  )
    .map((line) => {
      const item = objectValue(line);
      const lineNumber = clean(item?.line_number, 12).toUpperCase();
      const text = clean(item?.text, 500);
      return /^L\d{3}$/.test(lineNumber) && text ? { line_number: lineNumber, text } : null;
    })
    .filter((line): line is MeasurementSourceLine => line !== null)
    .slice(0, 600);
  const plan =
    sourceLines.length > 0
      ? parseMeasurementAssistantPlan(
          JSON.stringify({ suggestions: storedSuggestions }),
          sourceLines,
        )
      : {
          summary: measurementAssistantPlanSummary(storedSuggestions),
          suggestions: storedSuggestions,
          warnings: (Array.isArray(result.warnings) ? result.warnings : [])
            .map((warning) => clean(warning, 260))
            .filter(Boolean)
            .slice(0, 6),
        };
  return {
    operation_id: operationId,
    sheet_id: sheetId,
    reviewed_at: clean(row.updated_at || row.created_at, 80),
    model: clean(row.model_used, 120),
    credits_charged: Math.max(0, Math.trunc(Number(row.credits_charged) || 0)),
    source_line_count: Math.max(
      sourceLines.length,
      Math.max(0, Math.trunc(Number(requestContext?.source_line_count) || 0)),
    ),
    plan,
  };
}

/**
 * The operations query is newest-first. Keep one current review per sheet so
 * a plan-set matrix never double-counts earlier AI passes.
 */
export function latestPlanScopeCoverageRecords(rows: unknown[]) {
  const records: PlanScopeCoverageRecord[] = [];
  const seenSheets = new Set<string>();
  for (const row of rows) {
    const record = normalizePlanScopeCoverageRecord(row);
    if (!record || seenSheets.has(record.sheet_id)) continue;
    seenSheets.add(record.sheet_id);
    records.push(record);
  }
  return records;
}

export function planScopeCoverageDiscipline(input: { sheet_number: string; discipline: string }) {
  const prefix =
    input.sheet_number
      .trim()
      .toUpperCase()
      .match(/^[A-Z]+/)?.[0] ?? "";
  const inferred: Record<string, string> = {
    A: "Architectural",
    C: "Civil",
    E: "Electrical",
    FP: "Fire Protection",
    G: "General",
    L: "Landscape",
    M: "Mechanical",
    P: "Plumbing",
    S: "Structural",
  };
  return inferred[prefix] || clean(input.discipline, 80) || "Other";
}
