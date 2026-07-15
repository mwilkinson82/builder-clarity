export type MeasurementAssistantTool = "linear" | "area";
export type MeasurementEvidenceStrength = "direct" | "review";

export interface MeasurementSourceLine {
  line_number: string;
  text: string;
}

export interface MeasurementAssistantSuggestion {
  id: string;
  label: string;
  tool: MeasurementAssistantTool;
  unit: "LF" | "SF";
  source_line: string;
  source_excerpt: string;
  rationale: string;
  evidence_strength: MeasurementEvidenceStrength;
}

export interface MeasurementAssistantPlan {
  summary: string;
  suggestions: MeasurementAssistantSuggestion[];
  warnings: string[];
}

export interface MeasurementAssistantPlanResult extends MeasurementAssistantPlan {
  operation_id: string;
  credits_charged: number;
  model: string;
  provider: string;
  source_line_count: number;
}

export interface PdfMeasurementTextItem {
  text: string;
  x: number;
  y: number;
  height: number;
}

const clean = (value: unknown, max: number) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const normalizedText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function measurementSourceLineNumber(index: number) {
  return `L${String(index + 1).padStart(3, "0")}`;
}

/**
 * Convert positioned PDF text runs into stable, line-numbered evidence.
 * PDF coordinates grow bottom-up, so rows sort by descending y and then x.
 */
export function groupPdfMeasurementText(
  items: PdfMeasurementTextItem[],
  maxLines = 600,
): MeasurementSourceLine[] {
  const usable = items
    .map((item) => ({
      text: clean(item.text, 500),
      x: Number(item.x),
      y: Number(item.y),
      height: Math.max(1, Number(item.height) || 1),
    }))
    .filter(
      (item) =>
        item.text.length > 0 &&
        Number.isFinite(item.x) &&
        Number.isFinite(item.y) &&
        Number.isFinite(item.height),
    )
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const rows: Array<{ y: number; height: number; items: typeof usable }> = [];
  for (const item of usable) {
    const row = rows.find(
      (candidate) =>
        Math.abs(candidate.y - item.y) <= Math.max(2, candidate.height * 0.45, item.height * 0.45),
    );
    if (row) {
      row.items.push(item);
      row.y = (row.y + item.y) / 2;
      row.height = Math.max(row.height, item.height);
    } else {
      rows.push({ y: item.y, height: item.height, items: [item] });
    }
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) =>
      clean(
        row.items
          .sort((a, b) => a.x - b.x)
          .map((item) => item.text)
          .join(" "),
        500,
      ),
    )
    .filter(Boolean)
    .slice(0, Math.max(1, maxLines))
    .map((text, index) => ({ line_number: measurementSourceLineNumber(index), text }));
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const firstBrace = unfenced.indexOf("{");
  const lastBrace = unfenced.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("The AI response did not contain a measurement plan.");
  }
  const parsed = JSON.parse(unfenced.slice(firstBrace, lastBrace + 1)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The AI response was not a measurement plan.");
  }
  return parsed as Record<string, unknown>;
}

export function sourceExcerptIsSupported(line: string, excerpt: string) {
  const normalizedLine = normalizedText(line);
  const normalizedExcerpt = normalizedText(excerpt);
  if (!normalizedLine || normalizedExcerpt.length < 3) return false;
  if (normalizedLine.includes(normalizedExcerpt)) return true;
  const tokens = [...new Set(normalizedExcerpt.split(" ").filter((token) => token.length > 1))];
  if (tokens.length < 3) return false;
  const lineTokens = new Set(normalizedLine.split(" "));
  const supported = tokens.filter((token) => lineTokens.has(token)).length;
  return supported / tokens.length >= 0.8;
}

/**
 * Parse and constrain the model output. Suggestions without a real source
 * line and a supported excerpt are dropped before they can reach the UI.
 */
export function parseMeasurementAssistantPlan(
  raw: string,
  sourceLines: MeasurementSourceLine[],
): MeasurementAssistantPlan {
  const parsed = parseJsonObject(raw);
  const lineByNumber = new Map(sourceLines.map((line) => [line.line_number, line.text]));
  const rawSuggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
  const seen = new Set<string>();
  const suggestions: MeasurementAssistantSuggestion[] = [];

  for (const [index, value] of rawSuggestions.entries()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    const tool: MeasurementAssistantTool | null =
      item.tool === "linear" ? "linear" : item.tool === "area" ? "area" : null;
    if (!tool) continue;
    const sourceLine = clean(item.source_line, 12).toUpperCase();
    const line = lineByNumber.get(sourceLine);
    const excerpt = clean(item.source_excerpt, 260);
    if (!line || !sourceExcerptIsSupported(line, excerpt)) continue;
    const label = clean(item.label, 120);
    const rationale = clean(item.rationale, 240);
    if (!label || !rationale) continue;
    const dedupeKey = `${tool}:${normalizedText(label)}:${sourceLine}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    suggestions.push({
      id: `measurement-suggestion-${index + 1}`,
      label,
      tool,
      unit: tool === "linear" ? "LF" : "SF",
      source_line: sourceLine,
      source_excerpt: excerpt,
      rationale,
      evidence_strength: item.evidence_strength === "direct" ? "direct" : "review",
    });
    if (suggestions.length >= 12) break;
  }

  const warnings = (Array.isArray(parsed.warnings) ? parsed.warnings : [])
    .map((warning) => clean(warning, 240))
    .filter(Boolean)
    .slice(0, 6);

  return {
    summary:
      suggestions.length === 0
        ? "No reliable linear or area measurement scope was found in the extracted notes."
        : clean(parsed.summary, 500) ||
          `${suggestions.length} estimator-guided measurement suggestions found.`,
    suggestions,
    warnings,
  };
}

export function measurementAssistantTakeoffNote(suggestion: MeasurementAssistantSuggestion) {
  return [
    `AI measurement plan ${suggestion.source_line}: “${suggestion.source_excerpt}”`,
    `Estimator review: ${suggestion.rationale}`,
    "Geometry and final quantity placed by the estimator.",
  ].join("\n");
}
