import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
    if (error) throw new Error(error.message);
    return Array.isArray(rows)
      ? rows.map((row) => normalizeOpportunity(row as Record<string, unknown>))
      : [];
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
    if (error) throw new Error(error.message);
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
    if (beforeError) throw new Error(beforeError.message);
    if (!beforeRow) throw new Error("Opportunity not found.");
    const before = normalizeOpportunity(beforeRow as Record<string, unknown>);

    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data.patch)) {
      if (value === undefined) continue;
      if (key.endsWith("_date")) patch[key] = cleanDate(value as string | null);
      else patch[key] = typeof value === "string" ? value.trim() : value;
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
    if (error) throw new Error(error.message);

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
    if (error) throw new Error(error.message);
    if (!opportunity) throw new Error("Opportunity not found.");

    const { data: activityRows, error: activityError } = await dynamicTable(
      context.supabase,
      "pipeline_activity_log",
    )
      .select("*")
      .eq("opportunity_id", data.id)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });
    if (activityError) throw new Error(activityError.message);

    return {
      opportunity: normalizeOpportunity(opportunity as Record<string, unknown>),
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
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Opportunity not found.");

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
    if (updateError) throw new Error(updateError.message);
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
    const { error } = await dynamicTable(context.supabase, "pipeline_opportunities")
      .update({ archived: true, last_activity_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    await logActivity(context, {
      opportunityId: data.id,
      organizationId,
      eventType: "archived",
      notes: "Opportunity archived",
    });
    return { ok: true };
  });
