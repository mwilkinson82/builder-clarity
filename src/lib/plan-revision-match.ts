export interface RevisionSheetIdentity {
  id: string;
  plan_set_id: string;
  plan_set_name: string;
  plan_set_created_at: string;
  sheet_number: string;
  sheet_name: string;
  discipline: string;
  page_number: number;
}

export interface RevisionMatchCandidate {
  base_sheet_id: string;
  confidence: number;
  evidence: string[];
}

export interface PlanRevisionMatchProposal {
  revision_sheet_id: string;
  base_sheet_id: string | null;
  method: "deterministic" | "ai" | "manual" | "unmatched";
  confidence: number;
  evidence: string[];
  reason: string;
}

export type PlanRevisionReviewAction = "accepted" | "rejected" | "unmatched";

// Do not ask the model to rank metadata coincidences that are too weak to be
// useful to an estimator. A matching PDF position (0.02) or generic title-word
// overlap (up to 0.12) must never become an AI suggestion on its own.
export const AI_REVISION_CANDIDATE_MIN_CONFIDENCE = 0.2;

const identityText = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\b(?:REV(?:ISION)?|ISSUE)\s*[A-Z0-9-]+$/i, "")
    .replace(/[^A-Z0-9]+/g, "")
    .trim();

const titleTokens = (value: string) =>
  new Set(
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter((token) => token.length >= 2 && !["PLAN", "SHEET", "PAGE"].includes(token)),
  );

const tokenSimilarity = (left: string, right: string) => {
  const a = titleTokens(left);
  const b = titleTokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  const overlap = [...a].filter((token) => b.has(token)).length;
  return overlap / Math.max(a.size, b.size);
};

const roundedConfidence = (value: number) =>
  Math.round(Math.max(0, Math.min(0.99, value)) * 100) / 100;

export function scoreRevisionMatch(
  revision: RevisionSheetIdentity,
  base: RevisionSheetIdentity,
): RevisionMatchCandidate {
  const evidence: string[] = [];
  const revisionNumber = identityText(revision.sheet_number);
  const baseNumber = identityText(base.sheet_number);
  const revisionName = identityText(revision.sheet_name);
  const baseName = identityText(base.sheet_name);
  const revisionDiscipline = identityText(revision.discipline);
  const baseDiscipline = identityText(base.discipline);
  let confidence = 0;

  if (revisionNumber && revisionNumber === baseNumber) {
    confidence += 0.78;
    evidence.push(`Sheet number matches: ${revision.sheet_number || base.sheet_number}`);
  }
  if (revisionName && revisionName === baseName) {
    confidence += 0.15;
    evidence.push(`Sheet title matches: ${revision.sheet_name || base.sheet_name}`);
  } else {
    const similarity = tokenSimilarity(revision.sheet_name, base.sheet_name);
    if (similarity >= 0.6) {
      confidence += similarity * 0.12;
      evidence.push("Sheet-title words substantially overlap");
    }
  }
  if (revisionDiscipline && baseDiscipline && revisionDiscipline === baseDiscipline) {
    confidence += 0.05;
    evidence.push(`Discipline matches: ${revision.discipline}`);
  }
  if (revision.page_number === base.page_number) {
    confidence += 0.02;
    evidence.push(`PDF page position matches: ${revision.page_number}`);
  }

  return {
    base_sheet_id: base.id,
    confidence: roundedConfidence(confidence),
    evidence,
  };
}

export function rankRevisionCandidates(
  revision: RevisionSheetIdentity,
  baseSheets: RevisionSheetIdentity[],
  limit = 5,
) {
  return baseSheets
    .map((base) => ({
      ...scoreRevisionMatch(revision, base),
      base_created_at: base.plan_set_created_at,
    }))
    .filter((candidate) => candidate.confidence >= AI_REVISION_CANDIDATE_MIN_CONFIDENCE)
    .sort((left, right) => {
      if (right.confidence !== left.confidence) return right.confidence - left.confidence;
      return right.base_created_at.localeCompare(left.base_created_at);
    })
    .slice(0, Math.max(1, limit))
    .map(({ base_created_at: _createdAt, ...candidate }) => candidate);
}

export function deterministicRevisionProposal(
  revision: RevisionSheetIdentity,
  baseSheets: RevisionSheetIdentity[],
): PlanRevisionMatchProposal | null {
  const ranked = rankRevisionCandidates(revision, baseSheets, 2);
  const first = ranked[0];
  if (!first || first.confidence < 0.85) return null;
  const runnerUp = ranked[1];
  if (runnerUp && first.confidence - runnerUp.confidence < 0.08) return null;
  return {
    revision_sheet_id: revision.id,
    base_sheet_id: first.base_sheet_id,
    method: "deterministic",
    confidence: first.confidence,
    evidence: first.evidence,
    reason: "The normalized sheet identity has one strong prior-set match.",
  };
}

const record = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function parseJsonObject(raw: string) {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try {
    return record(JSON.parse(trimmed));
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return {};
    try {
      return record(JSON.parse(trimmed.slice(start, end + 1)));
    } catch {
      return {};
    }
  }
}

export function parseAiRevisionMatches({
  raw,
  revisionSheets,
  candidateMap,
}: {
  raw: string;
  revisionSheets: RevisionSheetIdentity[];
  candidateMap: Map<string, RevisionMatchCandidate[]>;
}): PlanRevisionMatchProposal[] {
  const allowedRevisionIds = new Set(revisionSheets.map((sheet) => sheet.id));
  const usedRevisionIds = new Set<string>();
  const usedBaseIds = new Set<string>();
  const parsed = parseJsonObject(raw);
  const rows = Array.isArray(parsed.matches) ? parsed.matches : [];
  const proposals: PlanRevisionMatchProposal[] = [];

  for (const value of rows) {
    const row = record(value);
    const revisionSheetId = String(row.revision_sheet_id ?? "").trim();
    const baseSheetId = String(row.base_sheet_id ?? "").trim();
    if (
      !allowedRevisionIds.has(revisionSheetId) ||
      usedRevisionIds.has(revisionSheetId) ||
      !baseSheetId ||
      usedBaseIds.has(baseSheetId)
    ) {
      continue;
    }
    const allowedCandidate = (candidateMap.get(revisionSheetId) ?? []).find(
      (candidate) => candidate.base_sheet_id === baseSheetId,
    );
    if (!allowedCandidate) continue;
    const statedConfidence = Number(row.confidence);
    const confidence = Number.isFinite(statedConfidence)
      ? roundedConfidence(Math.min(statedConfidence, allowedCandidate.confidence))
      : allowedCandidate.confidence;
    usedRevisionIds.add(revisionSheetId);
    usedBaseIds.add(baseSheetId);
    proposals.push({
      revision_sheet_id: revisionSheetId,
      base_sheet_id: baseSheetId,
      method: "ai",
      confidence,
      evidence: allowedCandidate.evidence,
      reason:
        String(row.reason ?? "")
          .trim()
          .slice(0, 300) || "AI selected one supplied metadata candidate for estimator review.",
    });
  }

  return proposals;
}

export function revisionMatchCredits(sheetCount: number) {
  if (!Number.isFinite(sheetCount) || sheetCount <= 0) return 0;
  return Math.max(1, Math.ceil(Math.min(500, Math.trunc(sheetCount)) / 100));
}
