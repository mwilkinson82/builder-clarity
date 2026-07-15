import {
  sourceExcerptIsSupported,
  type MeasurementSourceLine,
} from "@/lib/plan-room-measurement-assistant";
import type { RevisionImpactItem } from "@/lib/plan-revision-impact";

export type RevisionScopeSheetRole = "revision" | "base";

export interface RevisionScopeCitation {
  sheet_role: RevisionScopeSheetRole;
  line_number: string;
  excerpt: string;
}

export interface RevisionScopeCandidate {
  id: string;
  title: string;
  revision_citation: RevisionScopeCitation;
  base_citation: RevisionScopeCitation | null;
}

export interface RevisionScopeAssistantResult {
  candidates: RevisionScopeCandidate[];
  summary: string;
  warnings: string[];
  operation_id: string;
  credits_charged: number;
  model: string;
  provider: string;
}

const CONSTRUCTION_SCOPE_PATTERN =
  /\b(?:wall|partition|foundation|footing|slab|concrete|masonry|steel|framing|roof|roofing|ceiling|floor|finish|paint|coating|tile|insulation|waterproofing|door|window|millwork|casework|cabinet|counter|plumbing|pipe|piping|fixture|mechanical|duct|ductwork|diffuser|equipment|electrical|conduit|receptacle|switch|lighting|light|fire alarm|sprinkler|sitework|grading|paving|curb|sidewalk|landscape|railing|fence|demolition|remove|relocate|replace|install|provide)\w*\b/i;

const ADMIN_ONLY_PATTERN =
  /^(?:issued? for|permit set|bid set|construction set|revision|rev\.?\s*[a-z0-9-]+|date|drawn by|checked by|project no\.?|sheet title)\b/i;

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

function parseJsonObject(raw: string): Record<string, unknown> {
  const unfenced = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try {
    const parsed = JSON.parse(unfenced.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function citationFromModel({
  row,
  prefix,
  role,
  lineByNumber,
}: {
  row: Record<string, unknown>;
  prefix: "revision" | "base";
  role: RevisionScopeSheetRole;
  lineByNumber: Map<string, string>;
}): RevisionScopeCitation | null {
  const lineNumber = clean(row[`${prefix}_line`], 12).toUpperCase();
  const excerpt = clean(row[`${prefix}_excerpt`], 260);
  const sourceLine = lineByNumber.get(lineNumber);
  if (!sourceLine || !sourceExcerptIsSupported(sourceLine, excerpt)) return null;
  return { sheet_role: role, line_number: lineNumber, excerpt };
}

function titleFromRevisionExcerpt(excerpt: string) {
  const concise = clean(
    excerpt.replace(/^(?:note|new|add|added|revise|revised|modify|modified)\s*[:.-]?\s*/i, ""),
    145,
  );
  return clean(`Review: ${concise || excerpt}`, 160);
}

/**
 * Constrain model output to supplied, visible PDF text. The model can select
 * likely estimating-relevant note differences, but it cannot author the title,
 * classify an impact, select a quantity action, or claim the drawing changed.
 */
export function parseRevisionScopeCandidates({
  raw,
  revisionLines,
  baseLines,
}: {
  raw: string;
  revisionLines: MeasurementSourceLine[];
  baseLines: MeasurementSourceLine[];
}): { candidates: RevisionScopeCandidate[]; warnings: string[]; summary: string } {
  const revisionByNumber = new Map(revisionLines.map((line) => [line.line_number, line.text]));
  const baseByNumber = new Map(baseLines.map((line) => [line.line_number, line.text]));
  const normalizedBaseLines = new Set(
    baseLines.map((line) => normalized(line.text)).filter(Boolean),
  );
  const parsed = parseJsonObject(raw);
  const rawCandidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  const candidates: RevisionScopeCandidate[] = [];
  const seen = new Set<string>();

  for (const value of rawCandidates) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    const revisionCitation = citationFromModel({
      row,
      prefix: "revision",
      role: "revision",
      lineByNumber: revisionByNumber,
    });
    if (!revisionCitation) continue;
    const baseLine = clean(row.base_line, 12).toUpperCase();
    const baseExcerpt = clean(row.base_excerpt, 260);
    const baseCitation =
      baseLine || baseExcerpt
        ? citationFromModel({ row, prefix: "base", role: "base", lineByNumber: baseByNumber })
        : null;
    if ((baseLine || baseExcerpt) && !baseCitation) continue;
    if (!CONSTRUCTION_SCOPE_PATTERN.test(revisionCitation.excerpt)) continue;
    if (ADMIN_ONLY_PATTERN.test(revisionCitation.excerpt)) continue;
    const revisionText = normalized(revisionCitation.excerpt);
    const baseText = baseCitation ? normalized(baseCitation.excerpt) : "";
    if (!revisionText || revisionText === baseText) continue;
    if (
      !baseCitation &&
      normalizedBaseLines.has(normalized(revisionByNumber.get(revisionCitation.line_number) ?? ""))
    ) {
      continue;
    }
    const dedupeKey = `${revisionCitation.line_number}:${revisionText}:${baseCitation?.line_number ?? ""}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    candidates.push({
      id: `revision-scope-candidate-${candidates.length + 1}`,
      title: titleFromRevisionExcerpt(revisionCitation.excerpt),
      revision_citation: revisionCitation,
      base_citation: baseCitation,
    });
    if (candidates.length >= 12) break;
  }

  const rejected = Math.max(0, rawCandidates.length - candidates.length);
  return {
    candidates,
    summary:
      candidates.length > 0
        ? `${candidates.length} cited note difference${candidates.length === 1 ? "" : "s"} ready for estimator review.`
        : "No estimating-relevant note difference passed the citation and scope checks.",
    warnings: rejected
      ? [
          `${rejected} AI candidate${rejected === 1 ? " was" : "s were"} omitted because the visible note text did not support it.`,
        ]
      : [],
  };
}

export function revisionScopeCandidateNotes(candidate: RevisionScopeCandidate) {
  const citations = [
    `Revision ${candidate.revision_citation.line_number}: “${candidate.revision_citation.excerpt}”`,
    candidate.base_citation
      ? `Prior ${candidate.base_citation.line_number}: “${candidate.base_citation.excerpt}”`
      : "No prior-note counterpart was cited.",
  ];
  return [
    ...citations,
    "AI compared selectable note text only. Estimator must verify the drawing and classify the impact.",
  ].join("\n");
}

export function revisionScopeCandidateToImpact({
  candidate,
  operationId,
  impactId,
}: {
  candidate: RevisionScopeCandidate;
  operationId: string;
  impactId: string;
}): RevisionImpactItem {
  return {
    id: impactId,
    category: "unknown",
    title: candidate.title,
    required_action: "scope_review",
    status: "open",
    notes: revisionScopeCandidateNotes(candidate),
    ai_provenance: {
      source: "ai_revision_scope_review",
      operation_id: operationId,
      candidate_id: candidate.id,
      citations: [
        candidate.revision_citation,
        ...(candidate.base_citation ? [candidate.base_citation] : []),
      ],
    },
  };
}
