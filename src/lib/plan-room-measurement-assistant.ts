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
  width?: number;
}

export interface MeasurementEvidenceAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MeasurementSourceEvidence extends MeasurementSourceLine {
  anchor: MeasurementEvidenceAnchor;
}

export const MEASUREMENT_EVIDENCE_TIMEOUT_MS = 25_000;

export async function withMeasurementEvidenceTimeout<T>(
  operation: Promise<T>,
  step: string,
  timeoutMs = MEASUREMENT_EVIDENCE_TIMEOUT_MS,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () =>
        reject(
          new Error(
            `${step} took too long. Try the review again or open the source PDF for manual takeoff.`,
          ),
        ),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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

const GENERIC_SCOPE_TOKENS = new Set([
  "area",
  "areas",
  "existing",
  "exterior",
  "interior",
  "location",
  "locations",
  "new",
  "overall",
  "plan",
  "run",
  "runs",
  "scope",
  "system",
  "systems",
  "type",
  "types",
  "work",
]);

const AREA_SCOPE_PATTERN =
  /\b(?:ceiling grids?|ceiling tiles?|floors?|roofs?|slabs?|decks?|paving|pavements?|asphalt|concrete pads?|membranes?|coatings?|paints?|finishes?|wall coverings?|tiles?|gwb|gypsum boards?|insulation|waterproofing|stucco|siding|surfaces?)\b/i;
const LINEAR_SCOPE_PATTERN =
  /\b(?:walls?|partitions?|curbs?|pipes?|conduits?|ducts?|fences?|railings?|bases?|trim|moldings?|joints?|footings?|foundations?|masonry|perimeters?|edges?|gutters?|downspouts?|beams?|headers?|sills?|tracks?)\b/i;
const COUNT_LIKE_SCOPE_PATTERN =
  /\b(?:access panels?|doors?|windows?|fixtures?|equipment|diffusers?|receptacles?|fans?|bollards?|sinks?|toilets?|urinals?|lavatories|appliances?|devices?|units?|cabinets?|markers?)\b/i;

const scopeToken = (token: string) => {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && /(?:ches|shes|sses|xes|zes)$/.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
};

function meaningfulScopeTokens(value: string) {
  return [
    ...new Set(
      normalizedText(value)
        .split(" ")
        .filter((token) => token.length > 2 && !GENERIC_SCOPE_TOKENS.has(token))
        .map(scopeToken),
    ),
  ];
}

function labelIsSupportedByLine(label: string, line: string) {
  const labelTokens = meaningfulScopeTokens(label);
  if (labelTokens.length === 0) return false;
  const lineTokens = new Set(meaningfulScopeTokens(line));
  const supported = labelTokens.filter((token) => lineTokens.has(token)).length;
  return supported === labelTokens.length;
}

function toolIsSupportedByLine(tool: MeasurementAssistantTool, line: string) {
  if (tool === "linear") return LINEAR_SCOPE_PATTERN.test(line);
  return AREA_SCOPE_PATTERN.test(line) && !COUNT_LIKE_SCOPE_PATTERN.test(line);
}

function groundedSuggestionRationale(tool: MeasurementAssistantTool) {
  return tool === "linear"
    ? "Review the cited note, then trace only the supported scope as a linear takeoff."
    : "Review the cited note, then trace only the supported surface as an area takeoff.";
}

function groundedPlanSummary(suggestions: MeasurementAssistantSuggestion[]) {
  if (suggestions.length === 0) {
    return "No reliable linear or area measurement scope was found in the extracted notes.";
  }
  const visibleLabels = suggestions.slice(0, 3).map((suggestion) => suggestion.label);
  const labels =
    visibleLabels.length === 1
      ? visibleLabels[0]
      : `${visibleLabels.slice(0, -1).join(", ")} and ${visibleLabels.at(-1)}`;
  const remaining = suggestions.length - visibleLabels.length;
  return `Cited measurement scope found for ${labels}${remaining > 0 ? ` and ${remaining} more` : ""}.`;
}

export function measurementSourceLineNumber(index: number) {
  return `L${String(index + 1).padStart(3, "0")}`;
}

/**
 * Convert positioned PDF text runs into stable, line-numbered evidence.
 * PDF coordinates grow bottom-up, so rows sort by descending y and then x.
 */
function groupedPdfMeasurementRows(items: PdfMeasurementTextItem[], maxLines: number) {
  const usable = items
    .map((item) => ({
      text: clean(item.text, 500),
      x: Number(item.x),
      y: Number(item.y),
      height: Math.max(1, Number(item.height) || 1),
      width: Math.max(
        1,
        Number(item.width) || clean(item.text, 500).length * Math.max(1, Number(item.height)) * 0.5,
      ),
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
    .map((row) => ({
      text: clean(
        row.items
          .sort((a, b) => a.x - b.x)
          .map((item) => item.text)
          .join(" "),
        500,
      ),
      items: row.items,
    }))
    .filter((row) => row.text)
    .slice(0, Math.max(1, maxLines));
}

export function groupPdfMeasurementText(
  items: PdfMeasurementTextItem[],
  maxLines = 600,
): MeasurementSourceLine[] {
  return groupedPdfMeasurementRows(items, maxLines).map((row, index) => ({
    line_number: measurementSourceLineNumber(index),
    text: row.text,
  }));
}

export function groupPdfMeasurementEvidence(
  items: PdfMeasurementTextItem[],
  pageWidth: number,
  pageHeight: number,
  maxLines = 600,
): MeasurementSourceEvidence[] {
  const safeWidth = Math.max(1, pageWidth);
  const safeHeight = Math.max(1, pageHeight);
  return groupedPdfMeasurementRows(items, maxLines).map((row, index) => {
    const maxTextHeight = Math.max(...row.items.map((item) => item.height), 1);
    const left = Math.max(0, Math.min(...row.items.map((item) => item.x)) - maxTextHeight * 0.35);
    const right = Math.min(
      safeWidth,
      Math.max(...row.items.map((item) => item.x + item.width)) + maxTextHeight * 0.35,
    );
    const topPdf = Math.min(
      safeHeight,
      Math.max(...row.items.map((item) => item.y + item.height * 0.9)),
    );
    const bottomPdf = Math.max(
      0,
      Math.min(...row.items.map((item) => item.y - item.height * 0.25)),
    );
    return {
      line_number: measurementSourceLineNumber(index),
      text: row.text,
      anchor: {
        x: left / safeWidth,
        y: Math.max(0, (safeHeight - topPdf) / safeHeight),
        width: Math.max(0.002, (right - left) / safeWidth),
        height: Math.max(0.002, (topPdf - bottomPdf) / safeHeight),
      },
    };
  });
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
 * Parse and constrain the model output. A citation alone is not enough: the
 * label must match the visible cited excerpt and the requested LF/SF tool must
 * be plausible from that same evidence. Model-authored explanations are
 * replaced with deterministic copy so hidden line content or uncited assembly
 * inference never reaches the estimator.
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
    if (
      !label ||
      !labelIsSupportedByLine(label, excerpt) ||
      !toolIsSupportedByLine(tool, excerpt)
    ) {
      continue;
    }
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
      rationale: groundedSuggestionRationale(tool),
      evidence_strength: "review",
    });
    if (suggestions.length >= 12) break;
  }

  const rejectedCount = Math.max(0, rawSuggestions.length - suggestions.length);
  const warnings = rejectedCount
    ? [
        `${rejectedCount} AI suggestion${rejectedCount === 1 ? " was" : "s were"} omitted because the cited note did not support the proposed scope or measurement tool.`,
      ]
    : [];

  return {
    summary: groundedPlanSummary(suggestions),
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
