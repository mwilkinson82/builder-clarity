import { z } from "zod";

export const revisionImpactCategories = [
  "added",
  "removed",
  "modified",
  "clarification",
  "coordination",
  "unknown",
] as const;

export const revisionImpactActions = [
  "remeasure",
  "recount",
  "reprice",
  "scope_review",
  "no_quantity_change",
] as const;

export const revisionImpactStatuses = ["open", "resolved"] as const;
export const revisionImpactDispositions = [
  "no_estimate_impact",
  "impacts_logged",
  "needs_follow_up",
] as const;

export type RevisionImpactCategory = (typeof revisionImpactCategories)[number];
export type RevisionImpactAction = (typeof revisionImpactActions)[number];
export type RevisionImpactStatus = (typeof revisionImpactStatuses)[number];
export type RevisionImpactDisposition = (typeof revisionImpactDispositions)[number];

export const revisionImpactAiProvenanceSchema = z.object({
  source: z.literal("ai_revision_scope_review"),
  operation_id: z.string().uuid(),
  candidate_id: z.string().regex(/^revision-scope-candidate-\d{1,2}$/),
  citations: z
    .array(
      z.object({
        sheet_role: z.enum(["revision", "base"]),
        line_number: z.string().regex(/^L\d{3}$/),
        excerpt: z.string().trim().min(3).max(260),
      }),
    )
    .min(1)
    .max(2),
});

export const revisionImpactItemSchema = z.object({
  id: z.string().uuid(),
  category: z.enum(revisionImpactCategories),
  title: z.string().trim().min(3).max(160),
  required_action: z.enum(revisionImpactActions),
  status: z.enum(revisionImpactStatuses),
  notes: z.string().trim().max(1000),
  ai_provenance: revisionImpactAiProvenanceSchema.nullish().transform((value) => value ?? null),
});

export type RevisionImpactItem = z.infer<typeof revisionImpactItemSchema>;

export const revisionImpactReviewInputSchema = z
  .object({
    estimate_id: z.string().uuid(),
    revision_match_id: z.string().uuid(),
    disposition: z.enum(revisionImpactDispositions),
    summary_notes: z.string().trim().max(1500),
    impacts: z.array(revisionImpactItemSchema).max(100),
  })
  .superRefine((value, context) => {
    if (value.disposition === "no_estimate_impact" && value.impacts.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["impacts"],
        message: "A no-impact review cannot include estimating impacts.",
      });
    }
    if (value.disposition === "impacts_logged" && value.impacts.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["impacts"],
        message: "Log at least one estimating impact before completing this review.",
      });
    }
  });

export interface PlanRevisionImpactReview {
  id: string;
  estimate_id: string;
  revision_match_id: string;
  revision_sheet_id: string;
  base_sheet_id: string;
  version: number;
  disposition: RevisionImpactDisposition;
  summary_notes: string;
  impacts: RevisionImpactItem[];
  reviewed_by: string | null;
  reviewed_by_name: string;
  reviewed_at: string;
  created_at: string;
}

export const revisionImpactDispositionLabel = (value: RevisionImpactDisposition) =>
  ({
    no_estimate_impact: "No estimating impact",
    impacts_logged: "Impacts logged",
    needs_follow_up: "Needs follow-up",
  })[value];

export const revisionImpactCategoryLabel = (value: RevisionImpactCategory) =>
  ({
    added: "Added scope",
    removed: "Removed scope",
    modified: "Modified scope",
    clarification: "Clarification",
    coordination: "Coordination",
    unknown: "Unclassified",
  })[value];

export const revisionImpactActionLabel = (value: RevisionImpactAction) =>
  ({
    remeasure: "Remeasure",
    recount: "Recount",
    reprice: "Reprice",
    scope_review: "Scope review",
    no_quantity_change: "No quantity change",
  })[value];

export function normalizeRevisionImpactItems(value: unknown): RevisionImpactItem[] {
  const parsed = z.array(revisionImpactItemSchema).max(100).safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function revisionImpactDraftError({
  disposition,
  impacts,
}: {
  disposition: RevisionImpactDisposition;
  impacts: RevisionImpactItem[];
}) {
  if (disposition === "no_estimate_impact" && impacts.length > 0) {
    return "Remove the impact rows or change the sheet disposition.";
  }
  if (disposition === "impacts_logged" && impacts.length === 0) {
    return "Add at least one impact before saving this disposition.";
  }
  const invalid = impacts.find((impact) => impact.title.trim().length < 3);
  return invalid ? "Every impact needs a specific title." : null;
}
