import type {
  PipelineCrmSnapshot,
  PipelineOpportunityRow,
  PipelineStage,
} from "@/lib/pipeline.functions";

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

// Sample accounts, contacts, and next actions share the opportunity's fixed id
// family: only the second-to-last id group differs (…0001XX opportunity,
// …0002XX account, …0003XX contact, …0004XX action) and the final digit is the
// shared 1-of-6 row index. Deleting a sample opportunity is a local-only action
// (the CRM is not seeded to the database yet), so the server snapshot that feeds
// the CRM command-center rollup still contains that sample's account/contact/
// action. These prefixes let us drop the matching rollup rows locally too.
export const DEMO_ACCOUNT_ID_PREFIX = "00000000-0000-4000-8000-00000000020";
export const DEMO_CONTACT_ID_PREFIX = "00000000-0000-4000-8000-00000000030";

export function isDemoAccountId(id: string) {
  return id.startsWith(DEMO_ACCOUNT_ID_PREFIX);
}

export function isDemoContactId(id: string) {
  return id.startsWith(DEMO_CONTACT_ID_PREFIX);
}

// localStorage key holding the ids of sample opportunities the user removed
// locally (sample CRM data is not seeded to the database, so deletions are
// client-side). The CRM workspace owns writes to it; the portfolio dashboard
// reads it so its Pipeline intake rollup reflects the same deletions.
export const DEMO_REMOVED_STORAGE_KEY = "overwatch.crm.demo-opportunity-removals.v1";

export function readDemoOpportunityRemovals(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DEMO_REMOVED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && isDemoOpportunityId(id));
  } catch {
    return [];
  }
}

// Prune the CRM snapshot so its rollup reflects locally-removed sample
// opportunities. Only sample rows (fixed demo ids) are ever touched — real
// database accounts/contacts/actions pass through untouched, so this is a no-op
// once a company has its own CRM data.
export function pruneRemovedDemoCrm(
  snapshot: PipelineCrmSnapshot,
  removedOpportunityIds: string[],
): PipelineCrmSnapshot {
  const removedIndices = new Set(
    removedOpportunityIds.filter(isDemoOpportunityId).map((id) => id.slice(-1)),
  );
  if (removedIndices.size === 0) return snapshot;
  const removedOpportunitySet = new Set(removedOpportunityIds);
  const isRemovedDemoRow = (id: string, isDemoRow: (id: string) => boolean) =>
    isDemoRow(id) && removedIndices.has(id.slice(-1));
  return {
    accounts: snapshot.accounts.filter((account) => !isRemovedDemoRow(account.id, isDemoAccountId)),
    contacts: snapshot.contacts.filter((contact) => !isRemovedDemoRow(contact.id, isDemoContactId)),
    openActions: snapshot.openActions.filter(
      (action) => !(action.opportunity_id && removedOpportunitySet.has(action.opportunity_id)),
    ),
  };
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

// ---------------------------------------------------------------------------
// v2 CRM reskin helpers (spec-b6-crm)
// ---------------------------------------------------------------------------

// Kanban board columns. Lost + No-bid are MERGED into one visual column with a
// combined header + count. To preserve the exact drag mutation semantics (a card
// carries a real stage, and a no-bid card must NOT be silently relabelled "lost"
// on drop), the merged column renders two labelled drop zones — one per stage —
// under the single header. Every other stage is its own column.
export type KanbanColumn =
  | { kind: "single"; stage: PipelineStage }
  | { kind: "group"; label: string; stages: PipelineStage[] };

export const KANBAN_COLUMNS: KanbanColumn[] = [
  { kind: "single", stage: "lead" },
  { kind: "single", stage: "qualifying" },
  { kind: "single", stage: "estimating" },
  { kind: "single", stage: "bid_submitted" },
  { kind: "single", stage: "negotiating" },
  { kind: "single", stage: "won" },
  { kind: "group", label: "Lost / No-bid", stages: ["lost", "no_bid"] },
];

// Column-heading tone per the v2 spec: Negotiating = clay, Won = good,
// Lost/No-bid = crit, everything else neutral foreground (no second accent).
export function stageHeadingClass(stage: PipelineStage): string {
  if (stage === "negotiating") return "text-clay";
  if (stage === "won") return "text-success";
  if (stage === "lost" || stage === "no_bid") return "text-danger";
  return "text-foreground";
}

// Short mini-tile labels for the "Pipeline at a glance" per-stage row.
export const ACTIVE_STAGE_SHORT_LABELS: Record<PipelineStage, string> = {
  lead: "Lead",
  qualifying: "Qual",
  estimating: "Est",
  bid_submitted: "Bid",
  negotiating: "Neg",
  won: "Won",
  lost: "Lost",
  no_bid: "No-bid",
};

export interface PipelineMetricsSummary {
  activeCount: number;
  weighted: number;
  avgGp: number;
  dueThisWeek: number;
  winRate: number;
  totalPursuit: number;
  stageCounts: Record<PipelineStage, number>;
}

// Single source of truth for every CRM headline metric — consumed by the glance
// card and lifted to the page footer. Keeps the two views from ever disagreeing.
export function computePipelineMetrics(
  opportunities: PipelineOpportunityRow[],
): PipelineMetricsSummary {
  const active = opportunities.filter(
    (opportunity) => ACTIVE_STAGES.includes(opportunity.stage) && !opportunity.archived,
  );
  const weighted = active.reduce(
    (total, opportunity) =>
      total + opportunity.estimated_contract * (opportunity.probability / 100),
    0,
  );
  const totalPursuit = active.reduce(
    (total, opportunity) => total + opportunity.estimated_contract,
    0,
  );
  const avgGp =
    active.length === 0
      ? 0
      : active.reduce((total, opportunity) => total + opportunity.estimated_gp_pct, 0) /
        active.length;
  const dueThisWeek = active.filter((opportunity) => {
    const days = opportunity.days_until_bid_due;
    return days !== null && days >= 0 && days <= 7;
  }).length;
  const ninetyDaysAgo = Date.now() - 90 * 86400000;
  const recentDecisions = opportunities.filter((opportunity) => {
    if (!["won", "lost"].includes(opportunity.stage)) return false;
    const value = opportunity.decision_date ?? opportunity.converted_at ?? opportunity.updated_at;
    const date = new Date(value).getTime();
    return Number.isFinite(date) && date >= ninetyDaysAgo;
  });
  const wins = recentDecisions.filter((opportunity) => opportunity.stage === "won").length;
  const winRate = recentDecisions.length === 0 ? 0 : (wins / recentDecisions.length) * 100;
  const stageCounts = STAGE_ORDER.reduce(
    (acc, stage) => {
      acc[stage] = 0;
      return acc;
    },
    {} as Record<PipelineStage, number>,
  );
  for (const opportunity of opportunities) {
    if (!opportunity.archived) stageCounts[opportunity.stage] += 1;
  }
  return {
    activeCount: active.length,
    weighted,
    avgGp,
    dueThisWeek,
    winRate,
    totalPursuit,
    stageCounts,
  };
}

// The bid-timing chip shown on kanban cards and the "Bids due" rail. Reads the
// server-computed days_until_bid_due so it never drifts from the list/table view.
export function bidChip(opportunity: PipelineOpportunityRow): { label: string; tone: string } {
  const days = opportunity.days_until_bid_due;
  if (days === null) {
    return {
      label: opportunity.bid_due_date ? shortDate(opportunity.bid_due_date) : "No bid date",
      tone: "text-muted-foreground",
    };
  }
  if (days < 0) return { label: `Bid ${Math.abs(days)}d late`, tone: "text-danger" };
  if (days === 0) return { label: "Bid today", tone: "text-danger" };
  return { label: `Bid ${days}d`, tone: bidUrgencyClass(opportunity) };
}

// Relative due-date pill for CRM next actions (Today / Tomorrow / Overdue Nd).
export function actionDuePill(dueDate: string | null): { label: string; tone: string } {
  if (!dueDate) return { label: "No date", tone: "text-muted-foreground" };
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return { label: dueDate, tone: "text-muted-foreground" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return { label: `Overdue ${Math.abs(diffDays)}d`, tone: "text-danger" };
  if (diffDays === 0) return { label: "Today", tone: "text-clay" };
  if (diffDays === 1) return { label: "Tomorrow", tone: "text-muted-foreground" };
  return { label: shortDate(dueDate), tone: "text-muted-foreground" };
}
