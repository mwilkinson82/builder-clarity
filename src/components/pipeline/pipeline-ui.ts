import type { PipelineOpportunityRow, PipelineStage } from "@/lib/pipeline.functions";

export const STAGE_LABELS: Record<PipelineStage, string> = {
  lead: "Lead",
  qualifying: "Qualifying",
  estimating: "Estimating",
  bid_submitted: "Bid Submitted",
  negotiating: "Negotiating",
  won: "Won",
  lost: "Lost",
  no_bid: "No-Bid",
};

export const STAGE_ORDER: PipelineStage[] = [
  "lead",
  "qualifying",
  "estimating",
  "bid_submitted",
  "negotiating",
  "won",
  "lost",
  "no_bid",
];

export const ACTIVE_STAGES: PipelineStage[] = [
  "lead",
  "qualifying",
  "estimating",
  "bid_submitted",
  "negotiating",
];

export const STAGE_PILL_CLASS: Record<PipelineStage, string> = {
  lead: "border-muted bg-muted/40 text-muted-foreground",
  qualifying: "border-secondary/40 bg-secondary/15 text-secondary-foreground",
  estimating: "border-secondary/40 bg-secondary/15 text-secondary-foreground",
  bid_submitted: "border-accent/40 bg-accent/12 text-accent",
  negotiating: "border-accent/40 bg-accent/12 text-accent",
  won: "border-success/40 bg-success/12 text-success",
  lost: "border-danger/40 bg-danger/12 text-danger",
  no_bid: "border-danger/40 bg-danger/12 text-danger",
};

export type PipelineViewMode = "kanban" | "list";
export type PipelineSortMode = "last_activity_at" | "bid_due_date" | "estimated_contract";

// In-memory sample opportunities (shown while the CRM is empty) share this
// fixed id prefix; they are not database rows, so destructive actions on
// them are handled locally instead of on the server.
export const DEMO_OPPORTUNITY_ID_PREFIX = "00000000-0000-4000-8000-00000000010";

export function isDemoOpportunityId(id: string) {
  return id.startsWith(DEMO_OPPORTUNITY_ID_PREFIX);
}

export function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function bidUrgencyClass(opportunity: PipelineOpportunityRow) {
  const days = opportunity.days_until_bid_due;
  if (days === null) return "text-muted-foreground";
  if (days < 0) return "text-danger";
  if (days < 3) return "text-danger";
  if (days < 7) return "text-warning";
  return "text-muted-foreground";
}

export function gpToneClass(gp: number) {
  if (gp >= 15) return "text-success";
  if (gp >= 8) return "text-warning";
  return "text-danger";
}

export function shortDate(value: string | null) {
  if (!value) return "No date";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
