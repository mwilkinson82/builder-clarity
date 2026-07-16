export type MeasurementAssistantTool = "linear" | "area";
export type MeasurementEvidenceStrength = "direct" | "review";

export interface MeasurementGuidePoint {
  x: number;
  y: number;
}

export interface MeasurementVisualGuide {
  kind: "linear_route" | "area_region";
  points: MeasurementGuidePoint[];
  source: "ai_visual_hint";
}

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
  /**
   * A visual routing hint only. These points are never used to calculate or
   * persist a quantity; the estimator must place the trusted geometry.
   */
  guide?: MeasurementVisualGuide;
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
export const MEASUREMENT_GUIDE_LONG_EDGE_PX = 1_800;

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

const guidePoint = (value: unknown): MeasurementGuidePoint | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const x = Number(raw.x);
  const y = Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    return null;
  }
  return { x, y };
};

const pointDistance = (a: MeasurementGuidePoint, b: MeasurementGuidePoint) =>
  Math.hypot(a.x - b.x, a.y - b.y);

const signedArea = (points: MeasurementGuidePoint[]) =>
  points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;

const orientation = (
  a: MeasurementGuidePoint,
  b: MeasurementGuidePoint,
  c: MeasurementGuidePoint,
) => (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);

const pointOnSegment = (
  start: MeasurementGuidePoint,
  end: MeasurementGuidePoint,
  point: MeasurementGuidePoint,
) =>
  point.x >= Math.min(start.x, end.x) - 1e-9 &&
  point.x <= Math.max(start.x, end.x) + 1e-9 &&
  point.y >= Math.min(start.y, end.y) - 1e-9 &&
  point.y <= Math.max(start.y, end.y) + 1e-9;

const segmentsCross = (
  a: MeasurementGuidePoint,
  b: MeasurementGuidePoint,
  c: MeasurementGuidePoint,
  d: MeasurementGuidePoint,
) => {
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  if (first * second < 0 && third * fourth < 0) return true;
  if (Math.abs(first) <= 1e-9 && pointOnSegment(a, b, c)) return true;
  if (Math.abs(second) <= 1e-9 && pointOnSegment(a, b, d)) return true;
  if (Math.abs(third) <= 1e-9 && pointOnSegment(c, d, a)) return true;
  return Math.abs(fourth) <= 1e-9 && pointOnSegment(c, d, b);
};

const areaGuideSelfIntersects = (points: MeasurementGuidePoint[]) => {
  for (let left = 0; left < points.length; left += 1) {
    const leftNext = (left + 1) % points.length;
    for (let right = left + 1; right < points.length; right += 1) {
      const rightNext = (right + 1) % points.length;
      if (
        left === right ||
        leftNext === right ||
        rightNext === left ||
        (left === 0 && rightNext === 0)
      ) {
        continue;
      }
      if (segmentsCross(points[left], points[leftNext], points[right], points[rightNext])) {
        return true;
      }
    }
  }
  return false;
};

/**
 * Accept only bounded, visible, non-degenerate guide geometry. A malformed
 * model hint is omitted while its cited scope suggestion can still survive.
 */
export function parseMeasurementVisualGuide(
  value: unknown,
  tool: MeasurementAssistantTool,
): MeasurementVisualGuide | null {
  const object =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const rawPoints = Array.isArray(value)
    ? value
    : Array.isArray(object?.points)
      ? object.points
      : [];
  if (rawPoints.length < (tool === "linear" ? 2 : 3) || rawPoints.length > 16) return null;

  const points: MeasurementGuidePoint[] = [];
  for (const rawPoint of rawPoints) {
    const point = guidePoint(rawPoint);
    if (!point) return null;
    if (points.length === 0 || pointDistance(points.at(-1)!, point) >= 0.004) points.push(point);
  }
  if (tool === "area" && points.length > 3 && pointDistance(points[0], points.at(-1)!) < 0.004) {
    points.pop();
  }
  if (points.length < (tool === "linear" ? 2 : 3)) return null;

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (Math.hypot(width, height) < 0.025) return null;

  if (tool === "linear") {
    const routeLength = points
      .slice(1)
      .reduce((sum, point, index) => sum + pointDistance(points[index], point), 0);
    if (routeLength < 0.03) return null;
    return { kind: "linear_route", points, source: "ai_visual_hint" };
  }

  if (width < 0.01 || height < 0.01 || Math.abs(signedArea(points)) < 0.0001) return null;
  if (areaGuideSelfIntersects(points)) return null;
  return { kind: "area_region", points, source: "ai_visual_hint" };
}

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
const DETAIL_CAPTION_PATTERN =
  /^(?:typical\s+)?(?:door|window)\s+jamb\s+at\b|^(?:typical\s+)?(?:wall|roof|floor|ceiling|foundation)\s+(?:section|detail|elevation)\b/i;
const LOCATION_ONLY_SCOPE_PATTERN =
  /\blocations?\b[\s\S]*\b(?:access panels?|blocking|doors?|fixtures?|grab bars?|openings?|windows?)\b/i;
const SPAN_LANGUAGE_PATTERN =
  /\b(?:along|continuous|entire|full[-\s]?height|length|perimeter|run|trace|wall[-\s]?to[-\s]?wall)\b/i;
const DIMENSION_FRAGMENT_PATTERN = /(?:℄|\bC\/?L\b)[\s\S]*(?:\d+['"-]|\b\d+\s+\d+\b)/i;
const CODE_LIMIT_FRAGMENT_PATTERN =
  /\b(?:floor|wall|ceiling|roof|attic)\s+area\s+(?:permitted|allowed|allowable)\b|\bpermitted\s+in\s+clear\b/i;
const DIRECTION_ONLY_MATERIAL_FRAGMENT_PATTERN =
  /^(?:roofing\s+)?(?:membrane|flashing|waterproofing)\s+(?:up|down|over|around)(?:\s+and\s+(?:up|down|over|around))*$/i;

function excerptSupportsMeasurableScope(excerpt: string) {
  if (DETAIL_CAPTION_PATTERN.test(excerpt)) return false;
  if (DIMENSION_FRAGMENT_PATTERN.test(excerpt)) return false;
  if (CODE_LIMIT_FRAGMENT_PATTERN.test(excerpt)) return false;
  if (DIRECTION_ONLY_MATERIAL_FRAGMENT_PATTERN.test(excerpt.trim())) return false;
  if (LOCATION_ONLY_SCOPE_PATTERN.test(excerpt) && !SPAN_LANGUAGE_PATTERN.test(excerpt)) {
    return false;
  }
  return true;
}

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

export function measurementSuggestionRationale(tool: MeasurementAssistantTool) {
  return tool === "linear"
    ? "Review the cited note, then trace only the supported scope as a linear takeoff."
    : "Review the cited note, then trace only the supported surface as an area takeoff.";
}

export function measurementAssistantPlanSummary(suggestions: MeasurementAssistantSuggestion[]) {
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
  let invalidGuideCount = 0;

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
      !toolIsSupportedByLine(tool, excerpt) ||
      !excerptSupportsMeasurableScope(excerpt)
    ) {
      continue;
    }
    const dedupeKey = `${tool}:${normalizedText(label)}:${sourceLine}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const guideCandidate = item.guide_points ?? item.guide;
    const guide = guideCandidate == null ? null : parseMeasurementVisualGuide(guideCandidate, tool);
    if (guideCandidate != null && !guide) invalidGuideCount += 1;
    suggestions.push({
      id: `measurement-suggestion-${index + 1}`,
      label,
      tool,
      unit: tool === "linear" ? "LF" : "SF",
      source_line: sourceLine,
      source_excerpt: excerpt,
      rationale: measurementSuggestionRationale(tool),
      evidence_strength: "review",
      ...(guide ? { guide } : {}),
    });
    if (suggestions.length >= 12) break;
  }

  const rejectedCount = Math.max(0, rawSuggestions.length - suggestions.length);
  const warnings = [
    ...(rejectedCount
      ? [
          `${rejectedCount} AI suggestion${rejectedCount === 1 ? " was" : "s were"} omitted because the cited note did not support the proposed scope or measurement tool.`,
        ]
      : []),
    ...(invalidGuideCount
      ? [
          `${invalidGuideCount} drawing location hint${invalidGuideCount === 1 ? " was" : "s were"} omitted because the proposed geometry was not usable.`,
        ]
      : []),
  ];

  return {
    summary: measurementAssistantPlanSummary(suggestions),
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
