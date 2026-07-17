import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { HARBOR_DEMO_CLIENT, HARBOR_DEMO_JOB_NUMBER, HARBOR_DEMO_NAME } from "@/lib/demo-seed";
import { planCrmDemoSeed } from "@/lib/pipeline-demo-seed";

export const PIPELINE_STAGES = [
  "lead",
  "qualifying",
  "estimating",
  "bid_submitted",
  "negotiating",
  "won",
  "lost",
  "no_bid",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export type PipelineBidDecision = "undecided" | "bid" | "no_bid";
export type PipelineActivityType =
  | "created"
  | "stage_change"
  | "note_added"
  | "bid_decision"
  | "converted"
  | "field_update"
  | "archived";

export interface PipelineOpportunityRow {
  id: string;
  organization_id: string;
  created_by: string | null;
  account_id: string | null;
  primary_contact_id: string | null;
  name: string;
  client: string;
  client_contact_name: string;
  client_contact_email: string;
  client_contact_phone: string;
  stage: PipelineStage;
  estimated_contract: number;
  estimated_cost: number;
  estimated_gp_pct: number;
  bid_due_date: string | null;
  decision_date: string | null;
  probability: number;
  source: string;
  project_type: string;
  scope_summary: string;
  bid_decision: PipelineBidDecision;
  bid_decision_reason: string;
  bid_decision_date: string | null;
  converted_project_id: string | null;
  converted_at: string | null;
  assigned_to: string;
  notes: string;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
  archived: boolean;
  days_until_bid_due: number | null;
  account_name: string;
  primary_contact_name: string;
  primary_contact_email: string;
  next_action_id: string | null;
  next_action_title: string;
  next_action_due_date: string | null;
  next_action_priority: PipelineActionPriority;
  next_action_type: string;
}

export interface PipelineActivityRow {
  id: string;
  opportunity_id: string;
  organization_id: string;
  event_type: PipelineActivityType;
  from_value: string;
  to_value: string;
  notes: string;
  created_by: string | null;
  created_at: string;
}

export type PipelineActionPriority = "low" | "normal" | "high";

export interface PipelineAccountRow {
  id: string;
  organization_id: string;
  created_by: string | null;
  name: string;
  account_type: string;
  market_sector: string;
  relationship_stage: string;
  relationship_health: "strong" | "steady" | "watch" | "unknown";
  website: string;
  email: string;
  phone: string;
  address: string;
  source: string;
  owner_name: string;
  notes: string;
  last_touch_at: string | null;
  next_touch_at: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
  contact_count: number;
  open_opportunity_count: number;
  active_pipeline_value: number;
}

export interface PipelineContactRow {
  id: string;
  organization_id: string;
  account_id: string | null;
  created_by: string | null;
  name: string;
  title: string;
  email: string;
  phone: string;
  role: string;
  influence_level: "decision_maker" | "influencer" | "technical" | "admin" | "unknown";
  relationship_status: "active" | "warm" | "cold" | "inactive";
  notes: string;
  last_touch_at: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
  account_name: string;
}

export interface PipelineNextActionRow {
  id: string;
  organization_id: string;
  opportunity_id: string | null;
  account_id: string | null;
  contact_id: string | null;
  created_by: string | null;
  completed_by: string | null;
  owner_name: string;
  action_type: string;
  priority: PipelineActionPriority;
  title: string;
  notes: string;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  opportunity_name: string;
  account_name: string;
  contact_name: string;
}

export interface PipelineCrmSnapshot {
  accounts: PipelineAccountRow[];
  contacts: PipelineContactRow[];
  openActions: PipelineNextActionRow[];
}

export interface PipelineMember {
  user_id: string;
  label: string;
  email: string;
}

type DynamicSupabaseError = { code?: string; message: string };
type DynamicSupabaseResult<T = unknown> = { data: T | null; error: DynamicSupabaseError | null };
type DynamicSupabaseQuery = PromiseLike<DynamicSupabaseResult> & {
  select(columns?: string): DynamicSupabaseQuery;
  insert(values: unknown): DynamicSupabaseQuery;
  update(values: unknown): DynamicSupabaseQuery;
  eq(column: string, value: unknown): DynamicSupabaseQuery;
  in(column: string, values: readonly string[]): DynamicSupabaseQuery;
  order(
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean },
  ): DynamicSupabaseQuery;
  limit(count: number): DynamicSupabaseQuery;
  single(): Promise<DynamicSupabaseResult>;
  maybeSingle(): Promise<DynamicSupabaseResult>;
};
type DynamicSupabaseClient = {
  from(relation: string): DynamicSupabaseQuery;
  rpc(fn: string, args?: Record<string, unknown>): Promise<DynamicSupabaseResult>;
};
type PipelineServerContext = {
  supabase: unknown;
  userId: string;
};

const dynamicClient = (supabase: unknown) => supabase as DynamicSupabaseClient;
const dynamicTable = (supabase: unknown, relation: string) =>
  dynamicClient(supabase).from(relation);

const str = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : value == null ? fallback : String(value);
const num = (value: unknown, fallback = 0) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};
const bool = (value: unknown, fallback = false) => (typeof value === "boolean" ? value : fallback);
const nullableStr = (value: unknown) => (typeof value === "string" && value ? value : null);

function cleanDate(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function daysUntil(value: string | null) {
  if (!value) return null;
  const due = new Date(`${value}T00:00:00`).getTime();
  if (Number.isNaN(due)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((due - today.getTime()) / 86400000);
}

function normalizeOpportunity(row: Record<string, unknown>): PipelineOpportunityRow {
  const bidDue = nullableStr(row.bid_due_date);
  return {
    id: str(row.id),
    organization_id: str(row.organization_id),
    created_by: nullableStr(row.created_by),
    account_id: nullableStr(row.account_id),
    primary_contact_id: nullableStr(row.primary_contact_id),
    name: str(row.name),
    client: str(row.client),
    client_contact_name: str(row.client_contact_name),
    client_contact_email: str(row.client_contact_email),
    client_contact_phone: str(row.client_contact_phone),
    stage: str(row.stage, "lead") as PipelineStage,
    estimated_contract: num(row.estimated_contract),
    estimated_cost: num(row.estimated_cost),
    estimated_gp_pct: num(row.estimated_gp_pct),
    bid_due_date: bidDue,
    decision_date: nullableStr(row.decision_date),
    probability: num(row.probability, 50),
    source: str(row.source),
    project_type: str(row.project_type),
    scope_summary: str(row.scope_summary),
    bid_decision: str(row.bid_decision, "undecided") as PipelineBidDecision,
    bid_decision_reason: str(row.bid_decision_reason),
    bid_decision_date: nullableStr(row.bid_decision_date),
    converted_project_id: nullableStr(row.converted_project_id),
    converted_at: nullableStr(row.converted_at),
    assigned_to: str(row.assigned_to),
    notes: str(row.notes),
    last_activity_at: str(row.last_activity_at),
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
    archived: bool(row.archived),
    days_until_bid_due: daysUntil(bidDue),
    account_name: str(row.account_name),
    primary_contact_name: str(row.primary_contact_name),
    primary_contact_email: str(row.primary_contact_email),
    next_action_id: nullableStr(row.next_action_id),
    next_action_title: str(row.next_action_title),
    next_action_due_date: nullableStr(row.next_action_due_date),
    next_action_priority: str(row.next_action_priority, "normal") as PipelineActionPriority,
    next_action_type: str(row.next_action_type, "follow_up"),
  };
}

function normalizeActivity(row: Record<string, unknown>): PipelineActivityRow {
  return {
    id: str(row.id),
    opportunity_id: str(row.opportunity_id),
    organization_id: str(row.organization_id),
    event_type: str(row.event_type, "field_update") as PipelineActivityType,
    from_value: str(row.from_value),
    to_value: str(row.to_value),
    notes: str(row.notes),
    created_by: nullableStr(row.created_by),
    created_at: str(row.created_at),
  };
}

function normalizeAccount(row: Record<string, unknown>): PipelineAccountRow {
  return {
    id: str(row.id),
    organization_id: str(row.organization_id),
    created_by: nullableStr(row.created_by),
    name: str(row.name),
    account_type: str(row.account_type, "client"),
    market_sector: str(row.market_sector),
    relationship_stage: str(row.relationship_stage, "prospect"),
    relationship_health: str(
      row.relationship_health,
      "unknown",
    ) as PipelineAccountRow["relationship_health"],
    website: str(row.website),
    email: str(row.email),
    phone: str(row.phone),
    address: str(row.address),
    source: str(row.source),
    owner_name: str(row.owner_name),
    notes: str(row.notes),
    last_touch_at: nullableStr(row.last_touch_at),
    next_touch_at: nullableStr(row.next_touch_at),
    archived: bool(row.archived),
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
    contact_count: num(row.contact_count),
    open_opportunity_count: num(row.open_opportunity_count),
    active_pipeline_value: num(row.active_pipeline_value),
  };
}

function normalizeContact(row: Record<string, unknown>): PipelineContactRow {
  return {
    id: str(row.id),
    organization_id: str(row.organization_id),
    account_id: nullableStr(row.account_id),
    created_by: nullableStr(row.created_by),
    name: str(row.name),
    title: str(row.title),
    email: str(row.email),
    phone: str(row.phone),
    role: str(row.role),
    influence_level: str(row.influence_level, "unknown") as PipelineContactRow["influence_level"],
    relationship_status: str(
      row.relationship_status,
      "active",
    ) as PipelineContactRow["relationship_status"],
    notes: str(row.notes),
    last_touch_at: nullableStr(row.last_touch_at),
    archived: bool(row.archived),
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
    account_name: str(row.account_name),
  };
}

function normalizeNextAction(row: Record<string, unknown>): PipelineNextActionRow {
  return {
    id: str(row.id),
    organization_id: str(row.organization_id),
    opportunity_id: nullableStr(row.opportunity_id),
    account_id: nullableStr(row.account_id),
    contact_id: nullableStr(row.contact_id),
    created_by: nullableStr(row.created_by),
    completed_by: nullableStr(row.completed_by),
    owner_name: str(row.owner_name),
    action_type: str(row.action_type, "follow_up"),
    priority: str(row.priority, "normal") as PipelineActionPriority,
    title: str(row.title),
    notes: str(row.notes),
    due_date: nullableStr(row.due_date),
    completed_at: nullableStr(row.completed_at),
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
    opportunity_name: str(row.opportunity_name),
    account_name: str(row.account_name),
    contact_name: str(row.contact_name),
  };
}

async function currentOrganizationId(context: PipelineServerContext) {
  const { data: ensuredOrganizationId, error: accountError } = await (
    context.supabase as {
      rpc(fn: "ensure_current_user_account"): Promise<DynamicSupabaseResult<string>>;
    }
  ).rpc("ensure_current_user_account");
  if (accountError) throw new Error(accountError.message);
  if (!ensuredOrganizationId)
    throw new Error("No Overwatch company workspace is available for this user.");

  const { data: memberships, error } = await (
    context.supabase as {
      from(relation: "organization_memberships"): DynamicSupabaseQuery;
    }
  )
    .from("organization_memberships")
    .select("organization_id,status,created_at")
    .eq("user_id", context.userId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const active = Array.isArray(memberships)
    ? memberships.find((membership) => str((membership as Record<string, unknown>).organization_id))
    : null;
  return str((active as Record<string, unknown> | null)?.organization_id, ensuredOrganizationId);
}

async function logActivity(
  context: PipelineServerContext,
  input: {
    opportunityId: string;
    organizationId: string;
    eventType: PipelineActivityType;
    fromValue?: string;
    toValue?: string;
    notes?: string;
  },
) {
  const { error } = await dynamicTable(context.supabase, "pipeline_activity_log").insert({
    opportunity_id: input.opportunityId,
    organization_id: input.organizationId,
    event_type: input.eventType,
    from_value: input.fromValue ?? "",
    to_value: input.toValue ?? "",
    notes: input.notes ?? "",
    created_by: context.userId,
  });
  if (error) throw new Error(error.message);
}

const ACTIVE_STAGE_SET = new Set<PipelineStage>([
  "lead",
  "qualifying",
  "estimating",
  "bid_submitted",
  "negotiating",
]);

function compactUnique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function datePlusDays(days: number) {
  const next = new Date();
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function sortOpenActions(a: PipelineNextActionRow, b: PipelineNextActionRow) {
  const aDue = a.due_date ? new Date(`${a.due_date}T00:00:00`).getTime() : Infinity;
  const bDue = b.due_date ? new Date(`${b.due_date}T00:00:00`).getTime() : Infinity;
  if (aDue !== bDue) return aDue - bDue;
  const priorityScore: Record<PipelineActionPriority, number> = { high: 0, normal: 1, low: 2 };
  return priorityScore[a.priority] - priorityScore[b.priority];
}

function isMissingPipelineSchemaError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? str((error as { message?: unknown }).message)
        : str(error);
  return (
    /pipeline_(opportunities|accounts|contacts|next_actions|activity_log)/i.test(message) &&
    /(schema cache|does not exist|could not find|relation|table)/i.test(message)
  );
}

const DEMO_OWNER_NAME = "Marshall Wilkinson";

const DEMO_CRM_SEEDS = [
  {
    opportunityId: "00000000-0000-4000-8000-000000000101",
    accountId: "00000000-0000-4000-8000-000000000201",
    contactId: "00000000-0000-4000-8000-000000000301",
    actionId: "00000000-0000-4000-8000-000000000401",
    name: "Harbor Residence Preconstruction",
    client: "Private Luxury Residence",
    contactName: "Evelyn Harbor",
    contactTitle: "Owner Representative",
    contactEmail: "evelyn.harbor@demo.overwatch.example",
    contactPhone: "(555) 014-2601",
    stage: "won" as PipelineStage,
    contract: 3200000,
    cost: 2720000,
    probability: 100,
    source: "Repeat client",
    projectType: "Residential",
    marketSector: "Private luxury residential",
    bidDueOffset: -68,
    decisionOffset: -56,
    bidDecision: "bid" as PipelineBidDecision,
    scope:
      "Luxury residential renovation and addition with schedule-sensitive owner selections, custom cabinetry, and exterior living scope.",
    accountHealth: "strong" as const,
    relationshipStage: "active client",
    actionTitle: "Review CRM handoff notes against active IOR risk ledger",
    actionDueOffset: 1,
    actionPriority: "high" as PipelineActionPriority,
    actionType: "handoff_review",
  },
  {
    opportunityId: "00000000-0000-4000-8000-000000000102",
    accountId: "00000000-0000-4000-8000-000000000202",
    contactId: "00000000-0000-4000-8000-000000000302",
    actionId: "00000000-0000-4000-8000-000000000402",
    name: "Bayview Townhomes Phase II",
    client: "Seaside Development Group",
    contactName: "Darren Ellis",
    contactTitle: "VP Development",
    contactEmail: "darren.ellis@demo.overwatch.example",
    contactPhone: "(555) 014-4470",
    stage: "negotiating" as PipelineStage,
    contract: 5400000,
    cost: 4590000,
    probability: 72,
    source: "Referral",
    projectType: "Residential",
    marketSector: "Multifamily",
    bidDueOffset: -6,
    decisionOffset: 9,
    bidDecision: "bid" as PipelineBidDecision,
    scope:
      "Second phase of coastal townhomes. Owner is asking for schedule compression options and alternates before award.",
    accountHealth: "steady" as const,
    relationshipStage: "proposal",
    actionTitle: "Send value-engineering alternate log and revised schedule narrative",
    actionDueOffset: 0,
    actionPriority: "high" as PipelineActionPriority,
    actionType: "proposal_follow_up",
  },
  {
    opportunityId: "00000000-0000-4000-8000-000000000103",
    accountId: "00000000-0000-4000-8000-000000000203",
    contactId: "00000000-0000-4000-8000-000000000303",
    actionId: "00000000-0000-4000-8000-000000000403",
    name: "Lakeside Medical Buildout",
    client: "Lakeside Health Group",
    contactName: "Priya Shah",
    contactTitle: "Facilities Director",
    contactEmail: "priya.shah@demo.overwatch.example",
    contactPhone: "(555) 014-8821",
    stage: "bid_submitted" as PipelineStage,
    contract: 1850000,
    cost: 1562000,
    probability: 58,
    source: "Architect relationship",
    projectType: "Commercial",
    marketSector: "Healthcare",
    bidDueOffset: -2,
    decisionOffset: 5,
    bidDecision: "bid" as PipelineBidDecision,
    scope:
      "Occupied medical office renovation with phasing constraints, infection-control protection, and after-hours work allowances.",
    accountHealth: "watch" as const,
    relationshipStage: "shortlist",
    actionTitle: "Call facilities director to confirm decision committee timeline",
    actionDueOffset: 1,
    actionPriority: "normal" as PipelineActionPriority,
    actionType: "call",
  },
  {
    opportunityId: "00000000-0000-4000-8000-000000000104",
    accountId: "00000000-0000-4000-8000-000000000204",
    contactId: "00000000-0000-4000-8000-000000000304",
    actionId: "00000000-0000-4000-8000-000000000404",
    name: "North Ridge Clubhouse Renovation",
    client: "North Ridge HOA",
    contactName: "Marisa Chen",
    contactTitle: "Board President",
    contactEmail: "marisa.chen@demo.overwatch.example",
    contactPhone: "(555) 014-3308",
    stage: "estimating" as PipelineStage,
    contract: 2400000,
    cost: 2030000,
    probability: 42,
    source: "Plan room",
    projectType: "Commercial",
    marketSector: "Community / amenity",
    bidDueOffset: 6,
    decisionOffset: 21,
    bidDecision: "undecided" as PipelineBidDecision,
    scope:
      "Clubhouse interior renovation, pool deck repairs, new service bar, and ADA restroom upgrades.",
    accountHealth: "unknown" as const,
    relationshipStage: "estimating",
    actionTitle: "Confirm pool deck allowance and board approval rules before final bid",
    actionDueOffset: 3,
    actionPriority: "normal" as PipelineActionPriority,
    actionType: "scope_clarification",
  },
  {
    opportunityId: "00000000-0000-4000-8000-000000000105",
    accountId: "00000000-0000-4000-8000-000000000205",
    contactId: "00000000-0000-4000-8000-000000000305",
    actionId: "00000000-0000-4000-8000-000000000405",
    name: "Oak & Pine Retail Shell",
    client: "Oak & Pine Holdings",
    contactName: "Nolan Briggs",
    contactTitle: "Asset Manager",
    contactEmail: "nolan.briggs@demo.overwatch.example",
    contactPhone: "(555) 014-1184",
    stage: "qualifying" as PipelineStage,
    contract: 980000,
    cost: 842000,
    probability: 28,
    source: "Broker intro",
    projectType: "Commercial",
    marketSector: "Retail",
    bidDueOffset: 12,
    decisionOffset: 30,
    bidDecision: "undecided" as PipelineBidDecision,
    scope:
      "Warm shell conversion for two retail tenants. Budget is early and landlord work letter still needs definition.",
    accountHealth: "unknown" as const,
    relationshipStage: "qualifying",
    actionTitle: "Run bid/no-bid screen for tenant-readiness and design completeness",
    actionDueOffset: 2,
    actionPriority: "normal" as PipelineActionPriority,
    actionType: "qualification",
  },
  {
    opportunityId: "00000000-0000-4000-8000-000000000106",
    accountId: "00000000-0000-4000-8000-000000000206",
    contactId: "00000000-0000-4000-8000-000000000306",
    actionId: "00000000-0000-4000-8000-000000000406",
    name: "City Works Storage Addition",
    client: "City Works Operations",
    contactName: "Rafael Ortiz",
    contactTitle: "Operations Manager",
    contactEmail: "rafael.ortiz@demo.overwatch.example",
    contactPhone: "(555) 014-7790",
    stage: "no_bid" as PipelineStage,
    contract: 760000,
    cost: 714000,
    probability: 0,
    source: "Municipal bid board",
    projectType: "Industrial",
    marketSector: "Public works",
    bidDueOffset: -11,
    decisionOffset: -9,
    bidDecision: "no_bid" as PipelineBidDecision,
    scope:
      "Small equipment-storage addition. Schedule liquidated damages and incomplete drawings made the risk/reward profile poor.",
    accountHealth: "watch" as const,
    relationshipStage: "no-bid",
    actionTitle: "Log no-bid reason and watch for cleaner future release",
    actionDueOffset: 7,
    actionPriority: "low" as PipelineActionPriority,
    actionType: "relationship_note",
  },
];

function demoOpportunities(organizationId: string, userId: string) {
  const nowIso = new Date().toISOString();
  return DEMO_CRM_SEEDS.map((seed): PipelineOpportunityRow => ({
    id: seed.opportunityId,
    organization_id: organizationId,
    created_by: userId,
    account_id: seed.accountId,
    primary_contact_id: seed.contactId,
    name: seed.name,
    client: seed.client,
    client_contact_name: seed.contactName,
    client_contact_email: seed.contactEmail,
    client_contact_phone: seed.contactPhone,
    stage: seed.stage,
    estimated_contract: seed.contract,
    estimated_cost: seed.cost,
    estimated_gp_pct: seed.contract > 0 ? ((seed.contract - seed.cost) / seed.contract) * 100 : 0,
    bid_due_date: datePlusDays(seed.bidDueOffset),
    decision_date: datePlusDays(seed.decisionOffset),
    probability: seed.probability,
    source: seed.source,
    project_type: seed.projectType,
    scope_summary: seed.scope,
    bid_decision: seed.bidDecision,
    bid_decision_reason:
      seed.bidDecision === "no_bid"
        ? "Drawings were incomplete, schedule penalties were heavy, and the margin profile was too thin."
        : "",
    bid_decision_date: seed.bidDecision === "undecided" ? null : datePlusDays(seed.decisionOffset),
    converted_project_id: null,
    converted_at: seed.stage === "won" ? datePlusDays(seed.decisionOffset) : null,
    assigned_to: DEMO_OWNER_NAME,
    notes:
      seed.stage === "won"
        ? "Sample won pursuit connected to the Harbor Residence teaching project."
        : "Sample CRM pursuit showing relationship, bid/no-bid, and follow-up behavior.",
    last_activity_at: nowIso,
    created_at: nowIso,
    updated_at: nowIso,
    archived: false,
    days_until_bid_due: daysUntil(datePlusDays(seed.bidDueOffset)),
    account_name: seed.client,
    primary_contact_name: seed.contactName,
    primary_contact_email: seed.contactEmail,
    next_action_id: seed.actionId,
    next_action_title: seed.actionTitle,
    next_action_due_date: datePlusDays(seed.actionDueOffset),
    next_action_priority: seed.actionPriority,
    next_action_type: seed.actionType,
  }));
}

function demoCrmSnapshot(organizationId: string, userId: string): PipelineCrmSnapshot {
  const opportunities = demoOpportunities(organizationId, userId);
  const nowIso = new Date().toISOString();
  const accounts = DEMO_CRM_SEEDS.map((seed): PipelineAccountRow => {
    const accountOpportunities = opportunities.filter(
      (opportunity) =>
        opportunity.account_id === seed.accountId && ACTIVE_STAGE_SET.has(opportunity.stage),
    );
    return {
      id: seed.accountId,
      organization_id: organizationId,
      created_by: userId,
      name: seed.client,
      account_type: "client",
      market_sector: seed.marketSector,
      relationship_stage: seed.relationshipStage,
      relationship_health: seed.accountHealth,
      website: "",
      email: seed.contactEmail,
      phone: seed.contactPhone,
      address: "",
      source: seed.source,
      owner_name: DEMO_OWNER_NAME,
      notes: `Sample CRM account for ${seed.name}.`,
      last_touch_at: nowIso,
      next_touch_at: datePlusDays(seed.actionDueOffset),
      archived: false,
      created_at: nowIso,
      updated_at: nowIso,
      contact_count: 1,
      open_opportunity_count: accountOpportunities.length,
      active_pipeline_value: accountOpportunities.reduce(
        (total, opportunity) =>
          total + opportunity.estimated_contract * (opportunity.probability / 100),
        0,
      ),
    };
  }).sort(
    (a, b) => b.active_pipeline_value - a.active_pipeline_value || a.name.localeCompare(b.name),
  );
  const contacts = DEMO_CRM_SEEDS.map((seed): PipelineContactRow => ({
    id: seed.contactId,
    organization_id: organizationId,
    account_id: seed.accountId,
    created_by: userId,
    name: seed.contactName,
    title: seed.contactTitle,
    email: seed.contactEmail,
    phone: seed.contactPhone,
    role: seed.stage === "won" ? "Client decision maker" : "Pursuit contact",
    influence_level: seed.stage === "won" ? "decision_maker" : "influencer",
    relationship_status: seed.stage === "no_bid" ? "warm" : "active",
    notes: `Sample CRM contact for ${seed.client}.`,
    last_touch_at: nowIso,
    archived: false,
    created_at: nowIso,
    updated_at: nowIso,
    account_name: seed.client,
  }));
  const openActions = DEMO_CRM_SEEDS.map((seed): PipelineNextActionRow => ({
    id: seed.actionId,
    organization_id: organizationId,
    opportunity_id: seed.opportunityId,
    account_id: seed.accountId,
    contact_id: seed.contactId,
    created_by: userId,
    completed_by: null,
    owner_name: DEMO_OWNER_NAME,
    action_type: seed.actionType,
    priority: seed.actionPriority,
    title: seed.actionTitle,
    notes: `Sample next action for ${seed.name}.`,
    due_date: datePlusDays(seed.actionDueOffset),
    completed_at: null,
    created_at: nowIso,
    updated_at: nowIso,
    opportunity_name: seed.name,
    account_name: seed.client,
    contact_name: seed.contactName,
  }))
    .sort(sortOpenActions)
    .slice(0, 12);

  return { accounts, contacts, openActions };
}

function demoActivity(
  opportunity: PipelineOpportunityRow,
  organizationId: string,
  userId: string,
): PipelineActivityRow[] {
  const nowIso = new Date().toISOString();
  return [
    {
      id: `${opportunity.id.slice(0, 35)}a`,
      opportunity_id: opportunity.id,
      organization_id: organizationId,
      event_type: "created",
      from_value: "",
      to_value: opportunity.name,
      notes: "Sample CRM demo opportunity.",
      created_by: userId,
      created_at: nowIso,
    },
    {
      id: `${opportunity.id.slice(0, 35)}b`,
      opportunity_id: opportunity.id,
      organization_id: organizationId,
      event_type: "field_update",
      from_value: "",
      to_value: opportunity.next_action_title,
      notes: `Next action queued: ${opportunity.next_action_title}`,
      created_by: userId,
      created_at: nowIso,
    },
  ];
}

async function attachOpportunityRelations(
  context: PipelineServerContext,
  opportunities: PipelineOpportunityRow[],
) {
  if (opportunities.length === 0) return opportunities;

  const accountIds = compactUnique(opportunities.map((opportunity) => opportunity.account_id));
  const contactIds = compactUnique(
    opportunities.map((opportunity) => opportunity.primary_contact_id),
  );
  const opportunityIds = opportunities.map((opportunity) => opportunity.id);

  const [accountsRes, contactsRes, actionsRes] = await Promise.all([
    accountIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : dynamicTable(context.supabase, "pipeline_accounts")
          .select("*")
          .in("id", accountIds)
          .limit(500),
    contactIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : dynamicTable(context.supabase, "pipeline_contacts")
          .select("*")
          .in("id", contactIds)
          .limit(500),
    dynamicTable(context.supabase, "pipeline_next_actions")
      .select("*")
      .in("opportunity_id", opportunityIds)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(500),
  ]);
  if (accountsRes.error || contactsRes.error || actionsRes.error) {
    const relationError = accountsRes.error ?? contactsRes.error ?? actionsRes.error;
    if (isMissingPipelineSchemaError(relationError)) {
      return opportunities.map((opportunity) => ({
        ...opportunity,
        account_name: opportunity.account_name || opportunity.client,
        primary_contact_name: opportunity.primary_contact_name || opportunity.client_contact_name,
        primary_contact_email:
          opportunity.primary_contact_email || opportunity.client_contact_email,
      }));
    }
    throw new Error(relationError?.message ?? "Could not load CRM relationships.");
  }

  const accountById = new Map(
    (Array.isArray(accountsRes.data) ? accountsRes.data : []).map((row) => {
      const account = normalizeAccount(row as Record<string, unknown>);
      return [account.id, account];
    }),
  );
  const contactById = new Map(
    (Array.isArray(contactsRes.data) ? contactsRes.data : []).map((row) => {
      const contact = normalizeContact(row as Record<string, unknown>);
      return [contact.id, contact];
    }),
  );
  const actionsByOpportunity = new Map<string, PipelineNextActionRow[]>();
  (Array.isArray(actionsRes.data) ? actionsRes.data : [])
    .map((row) => normalizeNextAction(row as Record<string, unknown>))
    .filter((action) => !action.completed_at && action.opportunity_id)
    .sort(sortOpenActions)
    .forEach((action) => {
      const key = action.opportunity_id ?? "";
      actionsByOpportunity.set(key, [...(actionsByOpportunity.get(key) ?? []), action]);
    });

  return opportunities.map((opportunity) => {
    const account = opportunity.account_id ? accountById.get(opportunity.account_id) : null;
    const contact = opportunity.primary_contact_id
      ? contactById.get(opportunity.primary_contact_id)
      : null;
    const nextAction = actionsByOpportunity.get(opportunity.id)?.[0] ?? null;
    return {
      ...opportunity,
      account_name: account?.name ?? "",
      primary_contact_name: contact?.name ?? "",
      primary_contact_email: contact?.email ?? "",
      next_action_id: nextAction?.id ?? null,
      next_action_title: nextAction?.title ?? "",
      next_action_due_date: nextAction?.due_date ?? null,
      next_action_priority: nextAction?.priority ?? "normal",
      next_action_type: nextAction?.action_type ?? "follow_up",
    };
  });
}

async function ensurePipelineAccount(
  context: PipelineServerContext,
  input: {
    organizationId: string;
    name: string;
    source?: string;
    ownerName?: string;
    marketSector?: string;
    relationshipStage?: string;
    relationshipHealth?: PipelineAccountRow["relationship_health"];
    notes?: string;
  },
) {
  const name = input.name.trim();
  if (!name) return null;
  const { data: existing, error: existingError } = await dynamicTable(
    context.supabase,
    "pipeline_accounts",
  )
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("name", name)
    .eq("archived", false)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) return str((existing as Record<string, unknown>).id);

  const { data: created, error } = await dynamicTable(context.supabase, "pipeline_accounts")
    .insert({
      organization_id: input.organizationId,
      created_by: context.userId,
      name,
      account_type: "client",
      market_sector: input.marketSector ?? "",
      relationship_stage: input.relationshipStage ?? "prospect",
      relationship_health: input.relationshipHealth ?? "unknown",
      source: input.source ?? "",
      owner_name: input.ownerName ?? "",
      notes: input.notes ?? "",
      last_touch_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return str((created as Record<string, unknown> | null)?.id);
}

async function ensurePipelineContact(
  context: PipelineServerContext,
  input: {
    organizationId: string;
    accountId: string | null;
    name: string;
    email?: string;
    phone?: string;
    title?: string;
    role?: string;
    influenceLevel?: PipelineContactRow["influence_level"];
    relationshipStatus?: PipelineContactRow["relationship_status"];
    notes?: string;
  },
) {
  const name = input.name.trim();
  const email = (input.email ?? "").trim();
  if (!name && !email) return null;

  let existingQuery = dynamicTable(context.supabase, "pipeline_contacts")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("archived", false)
    .limit(1);
  existingQuery = email ? existingQuery.eq("email", email) : existingQuery.eq("name", name);
  const { data: existingRows, error: existingError } = await existingQuery;
  if (existingError) throw new Error(existingError.message);
  if (Array.isArray(existingRows) && existingRows[0]) {
    return str((existingRows[0] as Record<string, unknown>).id);
  }

  const { data: created, error } = await dynamicTable(context.supabase, "pipeline_contacts")
    .insert({
      organization_id: input.organizationId,
      account_id: input.accountId,
      created_by: context.userId,
      name: name || email,
      title: input.title ?? "",
      email,
      phone: (input.phone ?? "").trim(),
      role: input.role ?? "",
      influence_level: input.influenceLevel ?? "unknown",
      relationship_status: input.relationshipStatus ?? "active",
      notes: input.notes ?? "",
      last_touch_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return str((created as Record<string, unknown> | null)?.id);
}

const listInput = z.object({ includeArchived: z.boolean().optional() }).optional();

export const listOpportunities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { includeArchived?: boolean }) => listInput.parse(input))
  .handler(async ({ data, context }) => {
    const organizationId = await currentOrganizationId(context);
    let query = dynamicTable(context.supabase, "pipeline_opportunities")
      .select("*")
      .eq("organization_id", organizationId)
      .order("last_activity_at", { ascending: false });
    if (!data?.includeArchived) {
      query = query.eq("archived", false);
    }
    const { data: rows, error } = await query;
    if (error) {
      if (isMissingPipelineSchemaError(error)) {
        return demoOpportunities(organizationId, context.userId);
      }
      throw new Error(error.message);
    }
    const opportunities = Array.isArray(rows)
      ? rows.map((row) => normalizeOpportunity(row as Record<string, unknown>))
      : [];
    return attachOpportunityRelations(context, opportunities);
  });

export const listPipelineMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const organizationId = await currentOrganizationId(context);
    const { data: memberships, error } = await dynamicTable(
      context.supabase,
      "organization_memberships",
    )
      .select("user_id,invited_email,status,created_at")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const memberRows = Array.isArray(memberships) ? (memberships as Record<string, unknown>[]) : [];
    const userIds = memberRows.map((member) => str(member.user_id)).filter(Boolean);
    const profilesRes =
      userIds.length === 0
        ? { data: [], error: null }
        : await dynamicTable(context.supabase, "profiles")
            .select("id,email,full_name")
            .in("id", userIds)
            .limit(500);
    if (profilesRes.error) throw new Error(profilesRes.error.message);

    const profiles = new Map(
      (Array.isArray(profilesRes.data) ? profilesRes.data : []).map((profile) => {
        const row = profile as Record<string, unknown>;
        return [str(row.id), row];
      }),
    );

    return memberRows.map((member): PipelineMember => {
      const userId = str(member.user_id);
      const profile = profiles.get(userId);
      const email = str(profile?.email, str(member.invited_email));
      const fullName = str(profile?.full_name);
      return {
        user_id: userId,
        label: fullName || email || "Team member",
        email,
      };
    });
  });

export const listCrmSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PipelineCrmSnapshot> => {
    const organizationId = await currentOrganizationId(context);
    const [accountsRes, contactsRes, opportunitiesRes, actionsRes] = await Promise.all([
      dynamicTable(context.supabase, "pipeline_accounts")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("archived", false)
        .order("updated_at", { ascending: false })
        .limit(200),
      dynamicTable(context.supabase, "pipeline_contacts")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("archived", false)
        .order("updated_at", { ascending: false })
        .limit(300),
      dynamicTable(context.supabase, "pipeline_opportunities")
        .select(
          "id,name,organization_id,account_id,primary_contact_id,stage,estimated_contract,probability,archived",
        )
        .eq("organization_id", organizationId)
        .eq("archived", false)
        .limit(500),
      dynamicTable(context.supabase, "pipeline_next_actions")
        .select("*")
        .eq("organization_id", organizationId)
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(500),
    ]);
    const schemaError =
      accountsRes.error ?? contactsRes.error ?? opportunitiesRes.error ?? actionsRes.error;
    if (schemaError) {
      if (isMissingPipelineSchemaError(schemaError)) {
        return demoCrmSnapshot(organizationId, context.userId);
      }
      throw new Error(schemaError.message);
    }

    const baseAccounts = (Array.isArray(accountsRes.data) ? accountsRes.data : []).map((row) =>
      normalizeAccount(row as Record<string, unknown>),
    );
    const baseContacts = (Array.isArray(contactsRes.data) ? contactsRes.data : []).map((row) =>
      normalizeContact(row as Record<string, unknown>),
    );
    const opportunities = Array.isArray(opportunitiesRes.data)
      ? (opportunitiesRes.data as Record<string, unknown>[])
      : [];
    const opportunityById = new Map(
      opportunities.map((row) => [
        str(row.id),
        {
          id: str(row.id),
          name: str(row.name),
          account_id: nullableStr(row.account_id),
          primary_contact_id: nullableStr(row.primary_contact_id),
          stage: str(row.stage, "lead") as PipelineStage,
          estimated_contract: num(row.estimated_contract),
          probability: num(row.probability, 50),
        },
      ]),
    );
    const accountById = new Map(baseAccounts.map((account) => [account.id, account]));
    const contactById = new Map(baseContacts.map((contact) => [contact.id, contact]));

    const accounts = baseAccounts
      .map((account) => {
        const accountOpportunities = Array.from(opportunityById.values()).filter(
          (opportunity) =>
            opportunity.account_id === account.id && ACTIVE_STAGE_SET.has(opportunity.stage),
        );
        return {
          ...account,
          contact_count: baseContacts.filter((contact) => contact.account_id === account.id).length,
          open_opportunity_count: accountOpportunities.length,
          active_pipeline_value: accountOpportunities.reduce(
            (total, opportunity) =>
              total + opportunity.estimated_contract * (opportunity.probability / 100),
            0,
          ),
        };
      })
      .sort(
        (a, b) => b.active_pipeline_value - a.active_pipeline_value || a.name.localeCompare(b.name),
      );
    const contacts = baseContacts
      .map((contact) => ({
        ...contact,
        account_name: contact.account_id ? (accountById.get(contact.account_id)?.name ?? "") : "",
      }))
      .sort((a, b) => a.account_name.localeCompare(b.account_name) || a.name.localeCompare(b.name));
    const openActions = (Array.isArray(actionsRes.data) ? actionsRes.data : [])
      .map((row) => normalizeNextAction(row as Record<string, unknown>))
      .filter((action) => !action.completed_at)
      .map((action) => {
        const linkedOpportunity = action.opportunity_id
          ? opportunityById.get(action.opportunity_id)
          : null;
        return {
          ...action,
          opportunity_name:
            action.opportunity_name ||
            (action.opportunity_id ? str(opportunityById.get(action.opportunity_id)?.name) : ""),
          account_name:
            action.account_id && accountById.has(action.account_id)
              ? (accountById.get(action.account_id)?.name ?? "")
              : linkedOpportunity?.account_id
                ? (accountById.get(linkedOpportunity.account_id)?.name ?? "")
                : "",
          contact_name:
            action.contact_id && contactById.has(action.contact_id)
              ? (contactById.get(action.contact_id)?.name ?? "")
              : linkedOpportunity?.primary_contact_id
                ? (contactById.get(linkedOpportunity.primary_contact_id)?.name ?? "")
                : "",
        };
      })
      .sort(sortOpenActions)
      .slice(0, 12);

    return { accounts, contacts, openActions };
  });

const nextActionInput = z.object({
  opportunity_id: z.string().uuid().nullable().optional(),
  account_id: z.string().uuid().nullable().optional(),
  contact_id: z.string().uuid().nullable().optional(),
  owner_name: z.string().max(200).default(""),
  action_type: z.string().max(80).default("follow_up"),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  title: z.string().min(1).max(240),
  notes: z.string().max(3000).default(""),
  due_date: z.string().nullable().optional(),
});
export type CreateNextActionInput = z.infer<typeof nextActionInput>;

export const createNextAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => nextActionInput.parse(input))
  .handler(async ({ data, context }) => {
    const organizationId = await currentOrganizationId(context);
    if (!data.opportunity_id && !data.account_id && !data.contact_id) {
      throw new Error("Link this action to an opportunity, account, or contact.");
    }
    const { data: created, error } = await dynamicTable(context.supabase, "pipeline_next_actions")
      .insert({
        organization_id: organizationId,
        opportunity_id: data.opportunity_id ?? null,
        account_id: data.account_id ?? null,
        contact_id: data.contact_id ?? null,
        created_by: context.userId,
        owner_name: data.owner_name.trim(),
        action_type: data.action_type.trim() || "follow_up",
        priority: data.priority,
        title: data.title.trim(),
        notes: data.notes.trim(),
        due_date: cleanDate(data.due_date),
      })
      .select("id")
      .single();
    if (error) {
      if (isMissingPipelineSchemaError(error)) {
        return { id: "00000000-0000-4000-8000-000000000499" };
      }
      throw new Error(error.message);
    }
    if (data.opportunity_id) {
      await logActivity(context, {
        opportunityId: data.opportunity_id,
        organizationId,
        eventType: "field_update",
        notes: `Next action created: ${data.title.trim()}`,
      });
    }
    return { id: str((created as Record<string, unknown> | null)?.id) };
  });

export const completeNextAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const organizationId = await currentOrganizationId(context);
    const { data: actionRow, error: lookupError } = await dynamicTable(
      context.supabase,
      "pipeline_next_actions",
    )
      .select("*")
      .eq("id", data.id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (lookupError) {
      if (isMissingPipelineSchemaError(lookupError)) return { ok: true };
      throw new Error(lookupError.message);
    }
    if (!actionRow) {
      if (DEMO_CRM_SEEDS.some((seed) => seed.actionId === data.id)) return { ok: true };
      throw new Error("Next action not found.");
    }
    const action = normalizeNextAction(actionRow as Record<string, unknown>);
    const completedAt = new Date().toISOString();
    const { error } = await dynamicTable(context.supabase, "pipeline_next_actions")
      .update({
        completed_at: completedAt,
        completed_by: context.userId,
      })
      .eq("id", data.id)
      .eq("organization_id", organizationId);
    if (error) {
      if (isMissingPipelineSchemaError(error)) return { ok: true };
      throw new Error(error.message);
    }
    if (action.opportunity_id) {
      await logActivity(context, {
        opportunityId: action.opportunity_id,
        organizationId,
        eventType: "field_update",
        notes: `Next action completed: ${action.title}`,
      });
    }
    return { ok: true };
  });

export const ensurePipelineCrmDemo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const organizationId = await currentOrganizationId(context);
    const { data: existingRows, error: existingError } = await dynamicTable(
      context.supabase,
      "pipeline_opportunities",
    )
      .select("id")
      .eq("organization_id", organizationId)
      .eq("archived", false)
      .limit(1);
    if (existingError) {
      if (isMissingPipelineSchemaError(existingError)) {
        return { seeded: false as const, reason: "schema_missing" };
      }
      throw new Error(existingError.message);
    }
    if (Array.isArray(existingRows) && existingRows.length > 0) {
      return { seeded: false as const, reason: "crm_not_empty" };
    }

    // Both lookups deliberately INCLUDE archived rows: an archived Harbor
    // demo project is the "this company opted out" tombstone (PR #76), and
    // the CRM demo seeder must seed nothing — not seed unlinked copies.
    const { data: harborProject } = await dynamicTable(context.supabase, "projects")
      .select("id,archived_at")
      .eq("organization_id", organizationId)
      .eq("job_number", HARBOR_DEMO_JOB_NUMBER)
      .maybeSingle();
    let harborProjectRow = harborProject as { id?: unknown; archived_at?: unknown } | null;
    if (!harborProjectRow) {
      const { data: harborByName } = await dynamicTable(context.supabase, "projects")
        .select("id,archived_at")
        .eq("organization_id", organizationId)
        .eq("name", HARBOR_DEMO_NAME)
        .eq("client", HARBOR_DEMO_CLIENT)
        .limit(1)
        .maybeSingle();
      harborProjectRow = harborByName as { id?: unknown; archived_at?: unknown } | null;
    }
    const seedPlan = planCrmDemoSeed(harborProjectRow);
    if (seedPlan.action === "skip") {
      return { seeded: false as const, reason: "demo_opted_out" };
    }
    const harborProjectId = seedPlan.harborProjectId;
    const nowIso = new Date().toISOString();
    const ownerName = "Marshall Wilkinson";
    const seedOpportunities = [
      {
        name: "Harbor Residence Preconstruction",
        client: "Private Luxury Residence",
        contactName: "Evelyn Harbor",
        contactTitle: "Owner Representative",
        contactEmail: "evelyn.harbor@demo.overwatch.example",
        contactPhone: "(555) 014-2601",
        stage: "won" as PipelineStage,
        contract: 3200000,
        cost: 2720000,
        probability: 100,
        source: "Repeat client",
        projectType: "Residential",
        marketSector: "Private luxury residential",
        bidDueDate: datePlusDays(-68),
        decisionDate: datePlusDays(-56),
        bidDecision: "bid" as PipelineBidDecision,
        scope:
          "Luxury residential renovation and addition with schedule-sensitive owner selections, custom cabinetry, and exterior living scope.",
        accountHealth: "strong" as const,
        relationshipStage: "active client",
        convertedProjectId: harborProjectId,
        actionTitle: "Review CRM handoff notes against active IOR risk ledger",
        actionDue: datePlusDays(1),
        actionPriority: "high" as PipelineActionPriority,
        actionType: "handoff_review",
      },
      {
        name: "Bayview Townhomes Phase II",
        client: "Seaside Development Group",
        contactName: "Darren Ellis",
        contactTitle: "VP Development",
        contactEmail: "darren.ellis@demo.overwatch.example",
        contactPhone: "(555) 014-4470",
        stage: "negotiating" as PipelineStage,
        contract: 5400000,
        cost: 4590000,
        probability: 72,
        source: "Referral",
        projectType: "Residential",
        marketSector: "Multifamily",
        bidDueDate: datePlusDays(-6),
        decisionDate: datePlusDays(9),
        bidDecision: "bid" as PipelineBidDecision,
        scope:
          "Second phase of coastal townhomes. Owner is asking for schedule compression options and alternates before award.",
        accountHealth: "steady" as const,
        relationshipStage: "proposal",
        actionTitle: "Send value-engineering alternate log and revised schedule narrative",
        actionDue: datePlusDays(0),
        actionPriority: "high" as PipelineActionPriority,
        actionType: "proposal_follow_up",
      },
      {
        name: "Lakeside Medical Buildout",
        client: "Lakeside Health Group",
        contactName: "Priya Shah",
        contactTitle: "Facilities Director",
        contactEmail: "priya.shah@demo.overwatch.example",
        contactPhone: "(555) 014-8821",
        stage: "bid_submitted" as PipelineStage,
        contract: 1850000,
        cost: 1562000,
        probability: 58,
        source: "Architect relationship",
        projectType: "Commercial",
        marketSector: "Healthcare",
        bidDueDate: datePlusDays(-2),
        decisionDate: datePlusDays(5),
        bidDecision: "bid" as PipelineBidDecision,
        scope:
          "Occupied medical office renovation with phasing constraints, infection-control protection, and after-hours work allowances.",
        accountHealth: "watch" as const,
        relationshipStage: "shortlist",
        actionTitle: "Call facilities director to confirm decision committee timeline",
        actionDue: datePlusDays(1),
        actionPriority: "normal" as PipelineActionPriority,
        actionType: "call",
      },
      {
        name: "North Ridge Clubhouse Renovation",
        client: "North Ridge HOA",
        contactName: "Marisa Chen",
        contactTitle: "Board President",
        contactEmail: "marisa.chen@demo.overwatch.example",
        contactPhone: "(555) 014-3308",
        stage: "estimating" as PipelineStage,
        contract: 2400000,
        cost: 2030000,
        probability: 42,
        source: "Plan room",
        projectType: "Commercial",
        marketSector: "Community / amenity",
        bidDueDate: datePlusDays(6),
        decisionDate: datePlusDays(21),
        bidDecision: "undecided" as PipelineBidDecision,
        scope:
          "Clubhouse interior renovation, pool deck repairs, new service bar, and ADA restroom upgrades.",
        accountHealth: "unknown" as const,
        relationshipStage: "estimating",
        actionTitle: "Confirm pool deck allowance and board approval rules before final bid",
        actionDue: datePlusDays(3),
        actionPriority: "normal" as PipelineActionPriority,
        actionType: "scope_clarification",
      },
      {
        name: "Oak & Pine Retail Shell",
        client: "Oak & Pine Holdings",
        contactName: "Nolan Briggs",
        contactTitle: "Asset Manager",
        contactEmail: "nolan.briggs@demo.overwatch.example",
        contactPhone: "(555) 014-1184",
        stage: "qualifying" as PipelineStage,
        contract: 980000,
        cost: 842000,
        probability: 28,
        source: "Broker intro",
        projectType: "Commercial",
        marketSector: "Retail",
        bidDueDate: datePlusDays(12),
        decisionDate: datePlusDays(30),
        bidDecision: "undecided" as PipelineBidDecision,
        scope:
          "Warm shell conversion for two retail tenants. Budget is early and landlord work letter still needs definition.",
        accountHealth: "unknown" as const,
        relationshipStage: "qualifying",
        actionTitle: "Run bid/no-bid screen for tenant-readiness and design completeness",
        actionDue: datePlusDays(2),
        actionPriority: "normal" as PipelineActionPriority,
        actionType: "qualification",
      },
      {
        name: "City Works Storage Addition",
        client: "City Works Operations",
        contactName: "Rafael Ortiz",
        contactTitle: "Operations Manager",
        contactEmail: "rafael.ortiz@demo.overwatch.example",
        contactPhone: "(555) 014-7790",
        stage: "no_bid" as PipelineStage,
        contract: 760000,
        cost: 714000,
        probability: 0,
        source: "Municipal bid board",
        projectType: "Industrial",
        marketSector: "Public works",
        bidDueDate: datePlusDays(-11),
        decisionDate: datePlusDays(-9),
        bidDecision: "no_bid" as PipelineBidDecision,
        scope:
          "Small equipment-storage addition. Schedule liquidated damages and incomplete drawings made the risk/reward profile poor.",
        accountHealth: "watch" as const,
        relationshipStage: "no-bid",
        actionTitle: "Log no-bid reason and watch for cleaner future release",
        actionDue: datePlusDays(7),
        actionPriority: "low" as PipelineActionPriority,
        actionType: "relationship_note",
      },
    ];

    const createdOpportunityIds: string[] = [];
    for (const seed of seedOpportunities) {
      const accountId = await ensurePipelineAccount(context, {
        organizationId,
        name: seed.client,
        source: seed.source,
        ownerName,
        marketSector: seed.marketSector,
        relationshipStage: seed.relationshipStage,
        relationshipHealth: seed.accountHealth,
        notes: `Seed CRM account for ${seed.name}.`,
      });
      const contactId = await ensurePipelineContact(context, {
        organizationId,
        accountId,
        name: seed.contactName,
        email: seed.contactEmail,
        phone: seed.contactPhone,
        title: seed.contactTitle,
        role: seed.stage === "won" ? "Client decision maker" : "Pursuit contact",
        influenceLevel: seed.stage === "won" ? "decision_maker" : "influencer",
        relationshipStatus: seed.stage === "no_bid" ? "warm" : "active",
        notes: `Seed CRM contact for ${seed.client}.`,
      });
      const { data: created, error } = await dynamicTable(
        context.supabase,
        "pipeline_opportunities",
      )
        .insert({
          organization_id: organizationId,
          created_by: context.userId,
          account_id: accountId,
          primary_contact_id: contactId,
          name: seed.name,
          client: seed.client,
          client_contact_name: seed.contactName,
          client_contact_email: seed.contactEmail,
          client_contact_phone: seed.contactPhone,
          stage: seed.stage,
          estimated_contract: seed.contract,
          estimated_cost: seed.cost,
          bid_due_date: seed.bidDueDate,
          decision_date: seed.decisionDate,
          probability: seed.probability,
          source: seed.source,
          project_type: seed.projectType,
          scope_summary: seed.scope,
          bid_decision: seed.bidDecision,
          bid_decision_reason:
            seed.bidDecision === "no_bid"
              ? "Drawings were incomplete, schedule penalties were heavy, and the margin profile was too thin."
              : "",
          bid_decision_date: seed.bidDecision === "undecided" ? null : seed.decisionDate,
          converted_project_id: seed.convertedProjectId ?? null,
          converted_at: seed.convertedProjectId ? nowIso : null,
          assigned_to: ownerName,
          notes:
            seed.stage === "won"
              ? "Sample won pursuit linked to the Harbor Residence teaching project."
              : "Sample CRM pursuit seeded so the workspace demonstrates relationship and follow-up behavior.",
          last_activity_at: nowIso,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      const opportunityId = str((created as Record<string, unknown> | null)?.id);
      createdOpportunityIds.push(opportunityId);
      await logActivity(context, {
        opportunityId,
        organizationId,
        eventType: "created",
        toValue: seed.name,
        notes: "Seeded CRM demo opportunity.",
      });
      if (seed.stage === "won") {
        await logActivity(context, {
          opportunityId,
          organizationId,
          eventType: "stage_change",
          fromValue: "bid_submitted",
          toValue: "won",
          notes: "Demo pursuit awarded and connected to Harbor Residence.",
        });
      }
      const { error: actionError } = await dynamicTable(
        context.supabase,
        "pipeline_next_actions",
      ).insert({
        organization_id: organizationId,
        opportunity_id: opportunityId,
        account_id: accountId,
        contact_id: contactId,
        created_by: context.userId,
        owner_name: ownerName,
        action_type: seed.actionType,
        priority: seed.actionPriority,
        title: seed.actionTitle,
        notes: `Seed next action for ${seed.name}.`,
        due_date: seed.actionDue,
      });
      if (actionError) throw new Error(actionError.message);
      if (seed.convertedProjectId) {
        const { error: projectLinkError } = await dynamicTable(context.supabase, "projects")
          .update({ source_opportunity_id: opportunityId })
          .eq("id", seed.convertedProjectId)
          .eq("organization_id", organizationId);
        if (projectLinkError) throw new Error(projectLinkError.message);
      }
    }

    return {
      seeded: true as const,
      opportunityCount: createdOpportunityIds.length,
      harborProjectLinked: Boolean(harborProjectId),
    };
  });

const createOpportunityInput = z.object({
  name: z.string().min(1).max(200),
  client: z.string().max(200).default(""),
  client_contact_name: z.string().max(200).default(""),
  client_contact_email: z.string().email().or(z.literal("")).default(""),
  client_contact_phone: z.string().max(80).default(""),
  estimated_contract: z.number().min(0).default(0),
  estimated_cost: z.number().min(0).default(0),
  bid_due_date: z.string().nullable().optional(),
  decision_date: z.string().nullable().optional(),
  probability: z.number().int().min(0).max(100).default(50),
  source: z.string().max(160).default(""),
  project_type: z.string().max(160).default(""),
  scope_summary: z.string().max(5000).default(""),
  assigned_to: z.string().max(200).default(""),
  notes: z.string().max(5000).default(""),
});
export type CreateOpportunityInput = z.infer<typeof createOpportunityInput>;

export const createOpportunity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createOpportunityInput.parse(input))
  .handler(async ({ data, context }) => {
    const organizationId = await currentOrganizationId(context);
    let accountId: string | null;
    let contactId: string | null;
    try {
      accountId = await ensurePipelineAccount(context, {
        organizationId,
        name: data.client,
        source: data.source,
        ownerName: data.assigned_to,
        marketSector: data.project_type,
        relationshipStage: "prospect",
        relationshipHealth: "unknown",
      });
      contactId = await ensurePipelineContact(context, {
        organizationId,
        accountId,
        name: data.client_contact_name,
        email: data.client_contact_email,
        phone: data.client_contact_phone,
        role: "Primary pursuit contact",
        influenceLevel: "influencer",
        relationshipStatus: "active",
      });
    } catch (error) {
      if (isMissingPipelineSchemaError(error)) {
        return { id: "00000000-0000-4000-8000-000000000199", duplicateWarning: false };
      }
      throw error;
    }
    const { data: existingRows } = await dynamicTable(context.supabase, "pipeline_opportunities")
      .select("id,name,client")
      .eq("organization_id", organizationId)
      .eq("archived", false)
      .limit(50);
    const normalizedName = data.name.trim().toLowerCase();
    const normalizedClient = data.client.trim().toLowerCase();
    const duplicateWarning = Array.isArray(existingRows)
      ? existingRows.some((row) => {
          const existing = row as Record<string, unknown>;
          return (
            str(existing.client).trim().toLowerCase() === normalizedClient &&
            str(existing.name).trim().toLowerCase() === normalizedName
          );
        })
      : false;

    const { data: created, error } = await dynamicTable(context.supabase, "pipeline_opportunities")
      .insert({
        organization_id: organizationId,
        created_by: context.userId,
        account_id: accountId,
        primary_contact_id: contactId,
        name: data.name.trim(),
        client: data.client.trim(),
        client_contact_name: data.client_contact_name.trim(),
        client_contact_email: data.client_contact_email.trim(),
        client_contact_phone: data.client_contact_phone.trim(),
        estimated_contract: data.estimated_contract,
        estimated_cost: data.estimated_cost,
        bid_due_date: cleanDate(data.bid_due_date),
        decision_date: cleanDate(data.decision_date),
        probability: data.probability,
        source: data.source.trim(),
        project_type: data.project_type.trim(),
        scope_summary: data.scope_summary.trim(),
        assigned_to: data.assigned_to.trim(),
        notes: data.notes.trim(),
      })
      .select("id,organization_id")
      .single();
    if (error) {
      if (isMissingPipelineSchemaError(error)) {
        return { id: "00000000-0000-4000-8000-000000000199", duplicateWarning: false };
      }
      throw new Error(error.message);
    }
    const row = created as Record<string, unknown> | null;
    if (!row) throw new Error("Opportunity did not save.");

    await logActivity(context, {
      opportunityId: str(row.id),
      organizationId,
      eventType: "created",
      toValue: data.name.trim(),
    });

    return { id: str(row.id), duplicateWarning };
  });

const opportunityPatchInput = z.object({
  name: z.string().min(1).max(200).optional(),
  client: z.string().max(200).optional(),
  client_contact_name: z.string().max(200).optional(),
  client_contact_email: z.string().email().or(z.literal("")).optional(),
  client_contact_phone: z.string().max(80).optional(),
  stage: z.enum(PIPELINE_STAGES).optional(),
  estimated_contract: z.number().min(0).optional(),
  estimated_cost: z.number().min(0).optional(),
  bid_due_date: z.string().nullable().optional(),
  decision_date: z.string().nullable().optional(),
  probability: z.number().int().min(0).max(100).optional(),
  source: z.string().max(160).optional(),
  project_type: z.string().max(160).optional(),
  scope_summary: z.string().max(5000).optional(),
  bid_decision: z.enum(["undecided", "bid", "no_bid"]).optional(),
  bid_decision_reason: z.string().max(5000).optional(),
  bid_decision_date: z.string().nullable().optional(),
  assigned_to: z.string().max(200).optional(),
  notes: z.string().max(5000).optional(),
});

const updateOpportunityInput = z.object({
  id: z.string().uuid(),
  patch: opportunityPatchInput,
});

export const updateOpportunity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => updateOpportunityInput.parse(input))
  .handler(async ({ data, context }) => {
    const organizationId = await currentOrganizationId(context);
    const { data: beforeRow, error: beforeError } = await dynamicTable(
      context.supabase,
      "pipeline_opportunities",
    )
      .select("*")
      .eq("id", data.id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (beforeError) {
      if (isMissingPipelineSchemaError(beforeError)) return { ok: true };
      throw new Error(beforeError.message);
    }
    if (!beforeRow) {
      if (DEMO_CRM_SEEDS.some((seed) => seed.opportunityId === data.id)) return { ok: true };
      throw new Error("Opportunity not found.");
    }
    const before = normalizeOpportunity(beforeRow as Record<string, unknown>);

    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data.patch)) {
      if (value === undefined) continue;
      if (key.endsWith("_date")) patch[key] = cleanDate(value as string | null);
      else patch[key] = typeof value === "string" ? value.trim() : value;
    }
    const nextClient = str(patch.client, before.client);
    let nextAccountId = before.account_id;
    if (nextClient) {
      nextAccountId = await ensurePipelineAccount(context, {
        organizationId,
        name: nextClient,
        source: str(patch.source, before.source),
        ownerName: str(patch.assigned_to, before.assigned_to),
        marketSector: str(patch.project_type, before.project_type),
      });
      patch.account_id = nextAccountId;
    }
    const nextContactName = str(patch.client_contact_name, before.client_contact_name);
    const nextContactEmail = str(patch.client_contact_email, before.client_contact_email);
    const nextContactPhone = str(patch.client_contact_phone, before.client_contact_phone);
    if (nextContactName || nextContactEmail || nextContactPhone) {
      const nextContactId = await ensurePipelineContact(context, {
        organizationId,
        accountId: nextAccountId,
        name: nextContactName,
        email: nextContactEmail,
        phone: nextContactPhone,
        role: "Primary pursuit contact",
        influenceLevel: "influencer",
      });
      patch.primary_contact_id = nextContactId;
    }
    if (data.patch.bid_decision === "no_bid") {
      patch.stage = "no_bid";
      patch.bid_decision_date = patch.bid_decision_date ?? new Date().toISOString().slice(0, 10);
    }
    patch.last_activity_at = new Date().toISOString();

    const { error } = await dynamicTable(context.supabase, "pipeline_opportunities")
      .update(patch)
      .eq("id", data.id)
      .eq("organization_id", organizationId);
    if (error) {
      if (isMissingPipelineSchemaError(error)) return { ok: true };
      throw new Error(error.message);
    }

    const nextStage = str(patch.stage, before.stage);
    if (nextStage !== before.stage) {
      await logActivity(context, {
        opportunityId: before.id,
        organizationId,
        eventType: "stage_change",
        fromValue: before.stage,
        toValue: nextStage,
      });
    }
    const nextBidDecision = str(patch.bid_decision, before.bid_decision);
    if (nextBidDecision !== before.bid_decision) {
      await logActivity(context, {
        opportunityId: before.id,
        organizationId,
        eventType: "bid_decision",
        fromValue: before.bid_decision,
        toValue: nextBidDecision,
      });
    }
    if (nextStage === before.stage && nextBidDecision === before.bid_decision) {
      await logActivity(context, {
        opportunityId: before.id,
        organizationId,
        eventType: "field_update",
        notes: "Opportunity details updated",
      });
    }

    return { ok: true };
  });

export const getOpportunity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const organizationId = await currentOrganizationId(context);
    const { data: opportunity, error } = await dynamicTable(
      context.supabase,
      "pipeline_opportunities",
    )
      .select("*")
      .eq("id", data.id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) {
      if (isMissingPipelineSchemaError(error)) {
        const demo = demoOpportunities(organizationId, context.userId).find(
          (row) => row.id === data.id,
        );
        if (demo) {
          return {
            opportunity: demo,
            activity: demoActivity(demo, organizationId, context.userId),
          };
        }
      }
      throw new Error(error.message);
    }
    if (!opportunity) {
      const demo = demoOpportunities(organizationId, context.userId).find(
        (row) => row.id === data.id,
      );
      if (demo) {
        return {
          opportunity: demo,
          activity: demoActivity(demo, organizationId, context.userId),
        };
      }
      throw new Error("Opportunity not found.");
    }

    const { data: activityRows, error: activityError } = await dynamicTable(
      context.supabase,
      "pipeline_activity_log",
    )
      .select("*")
      .eq("opportunity_id", data.id)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });
    if (activityError) {
      if (isMissingPipelineSchemaError(activityError)) {
        const normalized = normalizeOpportunity(opportunity as Record<string, unknown>);
        return {
          opportunity: normalized,
          activity: demoActivity(normalized, organizationId, context.userId),
        };
      }
      throw new Error(activityError.message);
    }

    const [enrichedOpportunity] = await attachOpportunityRelations(context, [
      normalizeOpportunity(opportunity as Record<string, unknown>),
    ]);

    return {
      opportunity: enrichedOpportunity,
      activity: Array.isArray(activityRows)
        ? activityRows.map((row) => normalizeActivity(row as Record<string, unknown>))
        : [],
    };
  });

export const addOpportunityNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; note: string }) =>
    z.object({ id: z.string().uuid(), note: z.string().min(1).max(5000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const organizationId = await currentOrganizationId(context);
    const { data: row, error } = await dynamicTable(context.supabase, "pipeline_opportunities")
      .select("id,organization_id")
      .eq("id", data.id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) {
      if (isMissingPipelineSchemaError(error)) return { ok: true };
      throw new Error(error.message);
    }
    if (!row) {
      if (DEMO_CRM_SEEDS.some((seed) => seed.opportunityId === data.id)) return { ok: true };
      throw new Error("Opportunity not found.");
    }

    await logActivity(context, {
      opportunityId: data.id,
      organizationId,
      eventType: "note_added",
      notes: data.note.trim(),
    });

    const { error: updateError } = await dynamicTable(context.supabase, "pipeline_opportunities")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("organization_id", organizationId);
    if (updateError) {
      if (isMissingPipelineSchemaError(updateError)) return { ok: true };
      throw new Error(updateError.message);
    }
    return { ok: true };
  });

export const convertToProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: projectId, error } = await dynamicClient(context.supabase).rpc(
      "convert_pipeline_opportunity_to_project",
      { p_opportunity_id: data.id },
    );
    if (error) throw new Error(error.message);
    if (!projectId) throw new Error("Project did not save.");
    return { project_id: str(projectId) };
  });

export const archiveOpportunity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const organizationId = await currentOrganizationId(context);
    const { data: existing, error: lookupError } = await dynamicTable(
      context.supabase,
      "pipeline_opportunities",
    )
      .select("id")
      .eq("id", data.id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (lookupError) {
      if (isMissingPipelineSchemaError(lookupError)) return { ok: true };
      throw new Error(lookupError.message);
    }
    if (!existing) {
      if (DEMO_CRM_SEEDS.some((seed) => seed.opportunityId === data.id)) return { ok: true };
      throw new Error("Opportunity not found.");
    }
    const { error } = await dynamicTable(context.supabase, "pipeline_opportunities")
      .update({ archived: true, last_activity_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("organization_id", organizationId);
    if (error) {
      if (isMissingPipelineSchemaError(error)) return { ok: true };
      throw new Error(error.message);
    }
    await logActivity(context, {
      opportunityId: data.id,
      organizationId,
      eventType: "archived",
      notes: "Opportunity deleted (moved to Archived)",
    });
    return { ok: true };
  });
