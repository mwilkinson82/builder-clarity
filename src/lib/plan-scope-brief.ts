import {
  sourceExcerptIsSupported,
  type MeasurementSourceLine,
} from "@/lib/plan-room-measurement-assistant";

export const PLAN_SCOPE_BRIEF_TRADES = [
  "General Requirements",
  "Site / Civil",
  "Concrete / Masonry",
  "Metals / Wood",
  "Envelope / Roofing",
  "Openings",
  "Finishes",
  "Equipment / Furnishings",
  "Fire Protection",
  "Plumbing",
  "Mechanical",
  "Electrical",
  "Other",
] as const;

export const PLAN_SCOPE_BRIEF_REVIEW_KINDS = [
  "count",
  "linear",
  "area",
  "assembly",
  "allowance",
  "coordination",
] as const;

export type PlanScopeBriefTrade = (typeof PLAN_SCOPE_BRIEF_TRADES)[number];
export type PlanScopeBriefReviewKind = (typeof PLAN_SCOPE_BRIEF_REVIEW_KINDS)[number];

export interface PlanScopeBriefSourceSheet {
  plan_sheet_id: string;
  sheet_number: string;
  sheet_name: string;
  discipline: string;
  source_lines: MeasurementSourceLine[];
}

export interface PlanScopeBriefItem {
  id: string;
  trade: PlanScopeBriefTrade;
  review_kind: PlanScopeBriefReviewKind;
  scope_label: string;
  plan_sheet_id: string;
  sheet_number: string;
  sheet_name: string;
  source_line: string;
  source_excerpt: string;
  estimator_prompt: string;
}

export interface PlanScopeBrief {
  summary: string;
  items: PlanScopeBriefItem[];
  warnings: string[];
  source_sheet_count: number;
  total_sheet_count: number;
  source_line_count: number;
  cited_sheet_count: number;
}

export interface PlanScopeBriefResult extends PlanScopeBrief {
  operation_id: string;
  credits_charged: number;
  model: string;
  provider: string;
  generated_at: string;
}

const clean = (value: unknown, max: number) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const normalized = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const ADMINISTRATIVE_LINE =
  /^(?:project|drawing|sheet|revision|rev\.?|date|scale|architect|engineer|consultant|copyright|issued|permit set|structural|architectural|mechanical|electrical|plumbing|civil|nbs\b)(?:\s|:|-|$)/i;
const DIMENSION_ONLY =
  /^(?:\d+(?:\.\d+)?\s*)?(?:'|"|ft\b|feet\b|in\b|inch(?:es)?\b|x\b|±|ø|dia\b|typ\b|u\.n\.o\.?\b|o\.c\.?\b|@|[-/.,\s])+$/i;
const SCOPE_TERMS =
  /\b(?:install|provide|furnish|supply|remove|replace|demolish|existing|new|concrete|cement|masonry|block|brick|reinforc|rebar|footing|foundation|slab|wall|partition|framing|steel|wood|lumber|sheath|roof|membrane|flashing|insulat|waterproof|sealant|door|frame|jamb|window|glazing|ceiling|floor|finish|paint|coating|tile|countertop|casework|cabinet|equipment|fixture|accessory|toilet|lavatory|sink|drain|pipe|piping|plumbing|duct|diffuser|fan|hvac|mechanical|conduit|receptacle|switch|lighting|light|panel|electrical|alarm|sprinkler|fire|landscape|paving|curb|sidewalk|grading|excavat|trench|site|joint|anchorage|fastener|manufacturer|specification|schedule|allowance|blocking)\b/i;
const SCOPE_CONTEXT =
  /\b(?:shall|must|required|typical|detail|section|assembly|system|material|finish|legend|schedule|coordinate|verify|match|continuous|perimeter|interior|exterior)\b/i;

/**
 * Reduce dense PDF text into a fair, deterministic note sample per sheet.
 * This is only input selection; it does not decide that scope exists.
 */
export function selectPlanScopeBriefSourceLines(
  lines: MeasurementSourceLine[],
  options: { maxLines?: number; maxCharacters?: number } = {},
) {
  const maxLines = Math.max(1, Math.trunc(options.maxLines ?? 40));
  const maxCharacters = Math.max(500, Math.trunc(options.maxCharacters ?? 2_800));
  const seenText = new Set<string>();
  const candidates = lines
    .map((line, index) => {
      const text = clean(line.text, 500);
      const textKey = normalized(text);
      if (text.length < 8 || !textKey || seenText.has(textKey)) return null;
      if (ADMINISTRATIVE_LINE.test(text) || DIMENSION_ONLY.test(text)) return null;
      let score = 0;
      if (SCOPE_TERMS.test(text)) score += 4;
      if (SCOPE_CONTEXT.test(text)) score += 2;
      if (/\b(?:note|keynote|general notes?)\b/i.test(text)) score += 1;
      if (text.length >= 24) score += 1;
      if (score < 3) return null;
      seenText.add(textKey);
      return { line: { ...line, text }, index, score };
    })
    .filter(
      (candidate): candidate is { line: MeasurementSourceLine; index: number; score: number } =>
        candidate !== null,
    )
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const accepted: Array<{ line: MeasurementSourceLine; index: number }> = [];
  let characters = 0;
  for (const candidate of candidates) {
    const next = candidate.line.line_number.length + candidate.line.text.length + 3;
    if (accepted.length >= maxLines || characters + next > maxCharacters) continue;
    accepted.push(candidate);
    characters += next;
  }
  return accepted.sort((left, right) => left.index - right.index).map(({ line }) => line);
}

function parseJsonObject(raw: string) {
  const unfenced = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const firstBrace = unfenced.indexOf("{");
  const lastBrace = unfenced.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("The AI response did not contain a scope brief.");
  }
  const parsed = JSON.parse(unfenced.slice(firstBrace, lastBrace + 1)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The AI response was not a scope brief.");
  }
  return parsed as Record<string, unknown>;
}

function stableKey(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function labelIsSupported(label: string, line: string) {
  const lineTokens = new Set(normalized(line).split(" ").filter(Boolean));
  const labelTokens = [
    ...new Set(
      normalized(label)
        .split(" ")
        .filter((token) => token.length > 2 && !["and", "the", "for", "scope"].includes(token)),
    ),
  ];
  if (labelTokens.length === 0) return false;
  return labelTokens.filter((token) => lineTokens.has(token)).length / labelTokens.length >= 0.8;
}

function reviewKindIsSupported(reviewKind: PlanScopeBriefReviewKind, line: string) {
  if (reviewKind === "count") {
    return /\b(?:door|window|fixture|device|equipment|fan|receptacle|switch|light|diffuser|register|sink|toilet|lavatory|accessor|panel|symbol|schedule)\b/i.test(
      line,
    );
  }
  if (reviewKind === "linear") {
    return /\b(?:wall|partition|curb|joint|pipe|piping|duct|conduit|trench|edge|perimeter|run|flashing|sealant|reinforc|railing|fence)\b/i.test(
      line,
    );
  }
  if (reviewKind === "area") {
    return /\b(?:area|floor|roof|slab|ceiling|surface|finish|paint|coating|tile|membrane|paving|wall covering|insulation|waterproof)\b/i.test(
      line,
    );
  }
  if (reviewKind === "assembly") {
    return /\b(?:assembly|system|layer|build-?up|wall type|roof type|partition type|construction|materials?)\b/i.test(
      line,
    );
  }
  if (reviewKind === "allowance") {
    return /\b(?:allowance|alternate|selection|selected|specification|specified|owner|tbd|as directed|manufacturer)\b/i.test(
      line,
    );
  }
  return true;
}

function inferredTrade(line: string, discipline: string): PlanScopeBriefTrade {
  const evidence = `${line} ${discipline}`;
  if (/\b(?:fire alarm|sprinkler|fire protection|standpipe)\b/i.test(evidence)) {
    return "Fire Protection";
  }
  if (/\b(?:plumbing|toilet|lavatory|sink|sanitary|domestic water|drain|sewer)\b/i.test(evidence)) {
    return "Plumbing";
  }
  if (/\b(?:mechanical|hvac|duct|diffuser|register|air handling|fan)\b/i.test(evidence)) {
    return "Mechanical";
  }
  if (
    /\b(?:electrical|lighting|light fixture|receptacle|switch|conduit|panelboard)\b/i.test(evidence)
  ) {
    return "Electrical";
  }
  if (
    /\b(?:site|civil|grading|paving|curb|sidewalk|landscape|excavat|stormwater)\b/i.test(evidence)
  ) {
    return "Site / Civil";
  }
  if (
    /\b(?:concrete|masonry|block|brick|rebar|reinforc|footing|foundation|slab)\b/i.test(evidence)
  ) {
    return "Concrete / Masonry";
  }
  if (/\b(?:steel|metal|wood|lumber|framing|truss|joist|sheath)\b/i.test(evidence)) {
    return "Metals / Wood";
  }
  if (
    /\b(?:roof|membrane|flashing|waterproof|insulation|siding|exterior cladding)\b/i.test(evidence)
  ) {
    return "Envelope / Roofing";
  }
  if (/\b(?:door|frame|jamb|window|glazing|hardware)\b/i.test(evidence)) return "Openings";
  if (/\b(?:floor finish|ceiling|paint|coating|tile|drywall|gwb|countertop)\b/i.test(evidence)) {
    return "Finishes";
  }
  if (/\b(?:equipment|furnishing|casework|cabinet|accessor)\b/i.test(evidence)) {
    return "Equipment / Furnishings";
  }
  if (/\b(?:general|architectural)\b/i.test(discipline)) return "General Requirements";
  return "Other";
}

export function planScopeBriefEstimatorPrompt(reviewKind: PlanScopeBriefReviewKind) {
  if (reviewKind === "count") {
    return "Confirm the symbol or schedule definition, then count only estimator-accepted instances.";
  }
  if (reviewKind === "linear") {
    return "Confirm the cited scope, establish drawing scale, then trace the supported run manually.";
  }
  if (reviewKind === "area") {
    return "Confirm the cited surface or footprint, establish drawing scale, then trace the boundary manually.";
  }
  if (reviewKind === "assembly") {
    return "Confirm the cited build-up and its layers before applying any material or labor factors.";
  }
  if (reviewKind === "allowance") {
    return "Confirm the specification, owner direction, and pricing basis before carrying an allowance.";
  }
  return "Review the cited note for scope ownership, coordination, and estimate impact.";
}

export function planScopeBriefSummary(items: PlanScopeBriefItem[]) {
  if (items.length === 0) {
    return "No sufficiently supported scope prompt was retained from the supplied selectable notes.";
  }
  const sheets = new Set(items.map((item) => item.plan_sheet_id)).size;
  return `${items.length} cited scope prompt${items.length === 1 ? "" : "s"} retained across ${sheets} sheet${sheets === 1 ? "" : "s"}.`;
}

/**
 * Fail-closed parser for the model response. Every displayed prompt is checked
 * against the exact supplied sheet and line; model explanations are discarded.
 */
export function parsePlanScopeBrief({
  raw,
  sourceSheets,
  totalSheetCount,
}: {
  raw: string;
  sourceSheets: PlanScopeBriefSourceSheet[];
  totalSheetCount: number;
}): PlanScopeBrief {
  const parsed = parseJsonObject(raw);
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const sheetById = new Map(sourceSheets.map((sheet) => [sheet.plan_sheet_id, sheet]));
  const lineByCitation = new Map<string, string>();
  for (const sheet of sourceSheets) {
    for (const line of sheet.source_lines) {
      lineByCitation.set(`${sheet.plan_sheet_id}:${line.line_number}`, line.text);
    }
  }

  const trades = new Set<string>(PLAN_SCOPE_BRIEF_TRADES);
  const reviewKinds = new Set<string>(PLAN_SCOPE_BRIEF_REVIEW_KINDS);
  const seen = new Set<string>();
  const items: PlanScopeBriefItem[] = [];

  for (const value of rawItems) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    const sheetId = clean(item.plan_sheet_id, 80);
    const sheet = sheetById.get(sheetId);
    const sourceLine = clean(item.source_line, 12).toUpperCase();
    const line = lineByCitation.get(`${sheetId}:${sourceLine}`);
    const excerpt = clean(item.source_excerpt, 260);
    const scopeLabel = clean(item.scope_label, 120);
    const trade = clean(item.trade, 80);
    const reviewKind = clean(item.review_kind, 40);
    if (
      !sheet ||
      !line ||
      !/^L\d{3}$/.test(sourceLine) ||
      !sourceExcerptIsSupported(line, excerpt) ||
      !labelIsSupported(scopeLabel, line) ||
      !trades.has(trade) ||
      !reviewKinds.has(reviewKind) ||
      !reviewKindIsSupported(reviewKind as PlanScopeBriefReviewKind, line)
    ) {
      continue;
    }
    const dedupeKey = `${sheetId}:${sourceLine}:${normalized(scopeLabel)}:${reviewKind}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const typedReviewKind = reviewKind as PlanScopeBriefReviewKind;
    items.push({
      id: `scope-brief-${stableKey(dedupeKey)}`,
      trade: inferredTrade(line, sheet.discipline),
      review_kind: typedReviewKind,
      scope_label: scopeLabel,
      plan_sheet_id: sheetId,
      sheet_number: sheet.sheet_number,
      sheet_name: sheet.sheet_name,
      source_line: sourceLine,
      source_excerpt: excerpt,
      estimator_prompt: planScopeBriefEstimatorPrompt(typedReviewKind),
    });
    if (items.length >= 36) break;
  }

  const rejectedCount = Math.max(0, rawItems.length - items.length);
  const warnings = [
    ...(rejectedCount > 0
      ? [
          `${rejectedCount} AI prompt${rejectedCount === 1 ? " was" : "s were"} omitted because ${rejectedCount === 1 ? "its label or citation was" : "their labels or citations were"} not supported by the supplied drawing text.`,
        ]
      : []),
    ...(sourceSheets.length < totalSheetCount
      ? [
          totalSheetCount - sourceSheets.length === 1
            ? "1 sheet has no retained selectable note text and still requires manual review."
            : `${totalSheetCount - sourceSheets.length} sheets have no retained selectable note text and still require manual review.`,
        ]
      : []),
  ];

  return {
    summary: planScopeBriefSummary(items),
    items,
    warnings,
    source_sheet_count: sourceSheets.length,
    total_sheet_count: Math.max(sourceSheets.length, Math.trunc(totalSheetCount)),
    source_line_count: sourceSheets.reduce((sum, sheet) => sum + sheet.source_lines.length, 0),
    cited_sheet_count: new Set(items.map((item) => item.plan_sheet_id)).size,
  };
}
