import { z } from "zod";

export type PlanSheetIdentityCandidate = {
  plan_sheet_id: string;
  sheet_number: string;
  sheet_name: string;
  confidence: number;
  evidence: string;
};

const identityCandidateSchema = z.object({
  plan_sheet_id: z.string().uuid(),
  sheet_number: z.string().trim().max(80),
  sheet_name: z.string().trim().max(240),
  confidence: z.number().min(0).max(1),
  evidence: z.string().trim().max(240),
});

const identityResponseSchema = z.object({
  identities: z.array(identityCandidateSchema).max(80),
});

function parsedJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI returned no sheet-identity JSON.");
  return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
}

export function parsePlanSheetIdentityResponse({
  raw,
  requestedSheetIds,
}: {
  raw: string;
  requestedSheetIds: string[];
}): PlanSheetIdentityCandidate[] {
  const parsed = identityResponseSchema.parse(parsedJsonObject(raw));
  const requested = new Set(requestedSheetIds);
  const seen = new Set<string>();
  return parsed.identities.filter((candidate) => {
    if (!requested.has(candidate.plan_sheet_id) || seen.has(candidate.plan_sheet_id)) return false;
    seen.add(candidate.plan_sheet_id);
    return Boolean(candidate.sheet_number && candidate.confidence >= 0.55);
  });
}

export function isPlaceholderPlanSheet(
  sheet: { page_number: number; sheet_number: string; sheet_name: string },
  planSet?: { name?: string | null; source_file_name?: string | null } | null,
) {
  const placeholderNumber = /^PG-\d{3,}$/i.test(sheet.sheet_number.trim());
  if (!placeholderNumber) return false;
  const normalizedName = sheet.sheet_name.trim().replace(/\.pdf$/i, "");
  const expectedPage = `Page ${sheet.page_number}`.toLowerCase();
  const setNames = [planSet?.name, planSet?.source_file_name]
    .map((value) =>
      value
        ?.trim()
        .replace(/\.pdf$/i, "")
        .toLowerCase(),
    )
    .filter(Boolean);
  return (
    !normalizedName ||
    normalizedName.toLowerCase() === expectedPage ||
    setNames.includes(normalizedName.toLowerCase())
  );
}
