import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DEFAULT_VALUE_FOLLOWUP_PLAYBOOK,
  followupDueDate,
  personalizeFollowupTemplate,
  shouldShowPreparedFollowup,
  type FollowupChannel,
} from "@/lib/crm-followup-domain";

type DynamicError = { code?: string; message: string };
type DynamicResult<T = unknown> = { data: T | null; error: DynamicError | null };
type DynamicQuery = PromiseLike<DynamicResult> & {
  select(columns?: string): DynamicQuery;
  insert(values: unknown): DynamicQuery;
  update(values: unknown): DynamicQuery;
  eq(column: string, value: unknown): DynamicQuery;
  in(column: string, values: readonly unknown[]): DynamicQuery;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): DynamicQuery;
  limit(count: number): DynamicQuery;
  single(): Promise<DynamicResult>;
  maybeSingle(): Promise<DynamicResult>;
};
type DynamicClient = {
  from(relation: string): DynamicQuery;
  rpc(fn: string, args?: Record<string, unknown>): Promise<DynamicResult>;
};
type FollowupContext = { supabase: unknown; userId: string };

const dynamicClient = (supabase: unknown) => supabase as DynamicClient;
const table = (supabase: unknown, relation: string) => dynamicClient(supabase).from(relation);
const str = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : value == null ? fallback : String(value);
const nullableStr = (value: unknown) => {
  const normalized = str(value).trim();
  return normalized ? normalized : null;
};
const num = (value: unknown, fallback = 0) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
};
const bool = (value: unknown, fallback = false) => (typeof value === "boolean" ? value : fallback);

export type CrmValueAsset = {
  id: string;
  organization_id: string;
  title: string;
  description: string;
  source_type: "upload" | "link" | "google_drive";
  storage_path: string;
  external_url: string;
  original_file_name: string;
  content_type: string;
  size_bytes: number;
  tags: string[];
  audience: string;
  pipeline_stage: string;
  approved_for_external: boolean;
  created_at: string;
};

export type CrmFollowupPlaybookStep = {
  id: string;
  playbook_id: string;
  step_order: number;
  day_offset: number;
  channel: FollowupChannel;
  title: string;
  purpose: string;
  value_angle: string;
  subject_template: string;
  body_template: string;
  default_asset_id: string | null;
  require_review: boolean;
};

export type CrmFollowupPlaybook = {
  id: string;
  system_key: string;
  name: string;
  description: string;
  audience: string;
  trigger_stage: string;
  is_system: boolean;
  steps: CrmFollowupPlaybookStep[];
};

export type CrmFollowupEnrollment = {
  id: string;
  opportunity_id: string;
  playbook_id: string;
  owner_user_id: string | null;
  status: "active" | "paused" | "completed" | "stopped";
  started_at: string;
  playbook_name: string;
  opportunity_name: string;
};

export type CrmPreparedFollowup = {
  id: string;
  opportunity_id: string;
  playbook_enrollment_id: string;
  playbook_step_id: string;
  value_asset_id: string | null;
  owner_user_id: string | null;
  owner_name: string;
  channel: FollowupChannel;
  title: string;
  purpose: string;
  value_angle: string;
  due_date: string | null;
  subject: string;
  body: string;
  opportunity_name: string;
  client_name: string;
  contact_name: string;
  contact_email: string;
  playbook_name: string;
  day_offset: number;
};

export type CrmFollowupStudioSnapshot = {
  enabled: boolean;
  organizationId: string;
  assets: CrmValueAsset[];
  playbooks: CrmFollowupPlaybook[];
  enrollments: CrmFollowupEnrollment[];
  prepared: CrmPreparedFollowup[];
};

function normalizeAsset(row: Record<string, unknown>): CrmValueAsset {
  return {
    id: str(row.id),
    organization_id: str(row.organization_id),
    title: str(row.title),
    description: str(row.description),
    source_type: str(row.source_type, "upload") as CrmValueAsset["source_type"],
    storage_path: str(row.storage_path),
    external_url: str(row.external_url),
    original_file_name: str(row.original_file_name),
    content_type: str(row.content_type),
    size_bytes: num(row.size_bytes),
    tags: Array.isArray(row.tags) ? row.tags.map((tag) => str(tag)).filter(Boolean) : [],
    audience: str(row.audience),
    pipeline_stage: str(row.pipeline_stage),
    approved_for_external: bool(row.approved_for_external, true),
    created_at: str(row.created_at),
  };
}

function normalizeStep(row: Record<string, unknown>): CrmFollowupPlaybookStep {
  return {
    id: str(row.id),
    playbook_id: str(row.playbook_id),
    step_order: num(row.step_order),
    day_offset: num(row.day_offset),
    channel: str(row.channel, "email") as FollowupChannel,
    title: str(row.title),
    purpose: str(row.purpose),
    value_angle: str(row.value_angle),
    subject_template: str(row.subject_template),
    body_template: str(row.body_template),
    default_asset_id: nullableStr(row.default_asset_id),
    require_review: bool(row.require_review, true),
  };
}

function previewPlaybook(): CrmFollowupPlaybook {
  return {
    id: "preview-value-first",
    system_key: DEFAULT_VALUE_FOLLOWUP_PLAYBOOK.systemKey,
    name: DEFAULT_VALUE_FOLLOWUP_PLAYBOOK.name,
    description: DEFAULT_VALUE_FOLLOWUP_PLAYBOOK.description,
    audience: DEFAULT_VALUE_FOLLOWUP_PLAYBOOK.audience,
    trigger_stage: DEFAULT_VALUE_FOLLOWUP_PLAYBOOK.triggerStage,
    is_system: true,
    steps: DEFAULT_VALUE_FOLLOWUP_PLAYBOOK.steps.map((step) => ({
      id: `preview-step-${step.stepOrder}`,
      playbook_id: "preview-value-first",
      step_order: step.stepOrder,
      day_offset: step.dayOffset,
      channel: step.channel,
      title: step.title,
      purpose: step.purpose,
      value_angle: step.valueAngle,
      subject_template: step.subjectTemplate,
      body_template: step.bodyTemplate,
      default_asset_id: null,
      require_review: true,
    })),
  };
}

function missingFollowupSchema(error: unknown) {
  const message =
    error && typeof error === "object" && "message" in error
      ? str((error as { message?: unknown }).message)
      : str(error);
  return (
    /crm_(value_assets|followup_playbooks|followup_playbook_steps|followup_enrollments)|playbook_enrollment_id|value_asset_id|owner_user_id/i.test(
      message,
    ) && /(schema cache|does not exist|could not find|relation|column)/i.test(message)
  );
}

async function currentOrganizationId(context: FollowupContext) {
  const { data: ensured, error: ensureError } = await dynamicClient(context.supabase).rpc(
    "ensure_current_user_account",
  );
  if (ensureError) throw new Error(ensureError.message);
  if (!ensured) throw new Error("No Overwatch company workspace is available for this user.");

  const { data: memberships, error } = await table(context.supabase, "organization_memberships")
    .select("organization_id,status,created_at")
    .eq("user_id", context.userId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const first = Array.isArray(memberships) ? memberships[0] : null;
  return str((first as Record<string, unknown> | null)?.organization_id, str(ensured));
}

export const ensureCrmFollowupDefaults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const organizationId = await currentOrganizationId(context);
    const existingResult = await table(context.supabase, "crm_followup_playbooks")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("system_key", DEFAULT_VALUE_FOLLOWUP_PLAYBOOK.systemKey)
      .maybeSingle();
    if (existingResult.error && missingFollowupSchema(existingResult.error)) {
      return { enabled: false as const, created: false as const };
    }
    if (existingResult.error) throw new Error(existingResult.error.message);

    let playbookId = str((existingResult.data as Record<string, unknown> | null)?.id);
    let created = false;
    if (!playbookId) {
      const inserted = await table(context.supabase, "crm_followup_playbooks")
        .insert({
          organization_id: organizationId,
          created_by: context.userId,
          system_key: DEFAULT_VALUE_FOLLOWUP_PLAYBOOK.systemKey,
          name: DEFAULT_VALUE_FOLLOWUP_PLAYBOOK.name,
          description: DEFAULT_VALUE_FOLLOWUP_PLAYBOOK.description,
          audience: DEFAULT_VALUE_FOLLOWUP_PLAYBOOK.audience,
          trigger_stage: DEFAULT_VALUE_FOLLOWUP_PLAYBOOK.triggerStage,
          is_system: true,
        })
        .select("id")
        .single();
      if (inserted.error) {
        if (inserted.error.code === "23505") {
          return { enabled: true as const, created: false as const };
        }
        throw new Error(inserted.error.message);
      }
      playbookId = str((inserted.data as Record<string, unknown> | null)?.id);
      created = true;
    }

    const existingSteps = await table(context.supabase, "crm_followup_playbook_steps")
      .select("step_order")
      .eq("organization_id", organizationId)
      .eq("playbook_id", playbookId)
      .limit(100);
    if (existingSteps.error) throw new Error(existingSteps.error.message);
    const existingOrders = new Set(
      (Array.isArray(existingSteps.data) ? existingSteps.data : []).map((row) =>
        num((row as Record<string, unknown>).step_order),
      ),
    );
    const missingSteps = DEFAULT_VALUE_FOLLOWUP_PLAYBOOK.steps.filter(
      (step) => !existingOrders.has(step.stepOrder),
    );
    if (missingSteps.length > 0) {
      const insertedSteps = await table(context.supabase, "crm_followup_playbook_steps").insert(
        missingSteps.map((step) => ({
          organization_id: organizationId,
          playbook_id: playbookId,
          created_by: context.userId,
          step_order: step.stepOrder,
          day_offset: step.dayOffset,
          channel: step.channel,
          title: step.title,
          purpose: step.purpose,
          value_angle: step.valueAngle,
          subject_template: step.subjectTemplate,
          body_template: step.bodyTemplate,
          require_review: true,
        })),
      );
      if (insertedSteps.error) throw new Error(insertedSteps.error.message);
    }
    return { enabled: true as const, created };
  });

export const listCrmFollowupStudio = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CrmFollowupStudioSnapshot> => {
    const organizationId = await currentOrganizationId(context);
    const [assets, playbooks, steps, enrollments, actions, opportunities] = await Promise.all([
      table(context.supabase, "crm_value_assets")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("archived", false)
        .order("created_at", { ascending: false })
        .limit(200),
      table(context.supabase, "crm_followup_playbooks")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("active", true)
        .order("created_at", { ascending: true })
        .limit(100),
      table(context.supabase, "crm_followup_playbook_steps")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("active", true)
        .order("step_order", { ascending: true })
        .limit(500),
      table(context.supabase, "crm_followup_enrollments")
        .select("*")
        .eq("organization_id", organizationId)
        .order("started_at", { ascending: false })
        .limit(500),
      table(context.supabase, "pipeline_next_actions")
        .select("*")
        .eq("organization_id", organizationId)
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(1000),
      table(context.supabase, "pipeline_opportunities")
        .select(
          "id,name,client,client_contact_name,client_contact_email,assigned_to,stage,archived",
        )
        .eq("organization_id", organizationId)
        .eq("archived", false)
        .limit(1000),
    ]);

    const firstError =
      assets.error ??
      playbooks.error ??
      steps.error ??
      enrollments.error ??
      actions.error ??
      opportunities.error;
    if (firstError) {
      if (missingFollowupSchema(firstError)) {
        return {
          enabled: false,
          organizationId,
          assets: [],
          playbooks: [previewPlaybook()],
          enrollments: [],
          prepared: [],
        };
      }
      throw new Error(firstError.message);
    }

    const assetRows = (Array.isArray(assets.data) ? assets.data : []).map((row) =>
      normalizeAsset(row as Record<string, unknown>),
    );
    const stepRows = (Array.isArray(steps.data) ? steps.data : []).map((row) =>
      normalizeStep(row as Record<string, unknown>),
    );
    const playbookRows = (Array.isArray(playbooks.data) ? playbooks.data : []).map((row) => {
      const source = row as Record<string, unknown>;
      const id = str(source.id);
      return {
        id,
        system_key: str(source.system_key),
        name: str(source.name),
        description: str(source.description),
        audience: str(source.audience),
        trigger_stage: str(source.trigger_stage),
        is_system: bool(source.is_system),
        steps: stepRows.filter((step) => step.playbook_id === id),
      } satisfies CrmFollowupPlaybook;
    });
    const opportunityById = new Map(
      (Array.isArray(opportunities.data) ? opportunities.data : []).map((row) => {
        const source = row as Record<string, unknown>;
        return [str(source.id), source];
      }),
    );
    const playbookById = new Map(playbookRows.map((playbook) => [playbook.id, playbook]));
    const stepById = new Map(stepRows.map((step) => [step.id, step]));

    const enrollmentRows = (Array.isArray(enrollments.data) ? enrollments.data : [])
      .map((row) => {
        const source = row as Record<string, unknown>;
        const opportunityId = str(source.opportunity_id);
        const playbookId = str(source.playbook_id);
        return {
          id: str(source.id),
          opportunity_id: opportunityId,
          playbook_id: playbookId,
          owner_user_id: nullableStr(source.owner_user_id),
          status: str(source.status, "active") as CrmFollowupEnrollment["status"],
          started_at: str(source.started_at),
          playbook_name: playbookById.get(playbookId)?.name ?? "Follow-up playbook",
          opportunity_name: str(opportunityById.get(opportunityId)?.name, "Opportunity"),
        } satisfies CrmFollowupEnrollment;
      })
      // Archived opportunities are intentionally absent from opportunityById.
      // Never let a stale enrollment resurrect an anonymous "Opportunity" card.
      .filter((enrollment) => opportunityById.has(enrollment.opportunity_id));

    const enrollmentById = new Map(enrollmentRows.map((enrollment) => [enrollment.id, enrollment]));

    const prepared = (Array.isArray(actions.data) ? actions.data : [])
      .map((row) => row as Record<string, unknown>)
      .filter((row) => {
        const enrollmentId = nullableStr(row.playbook_enrollment_id);
        const opportunityId = str(row.opportunity_id);
        return (
          Boolean(enrollmentId) &&
          shouldShowPreparedFollowup({
            opportunityActive: opportunityById.has(opportunityId),
            enrollmentStatus: enrollmentId
              ? (enrollmentById.get(enrollmentId)?.status ?? null)
              : null,
            completedAt: nullableStr(row.completed_at),
            skippedAt: nullableStr(row.skipped_at),
          })
        );
      })
      .map((row) => {
        const opportunityId = str(row.opportunity_id);
        const opportunity = opportunityById.get(opportunityId);
        const stepId = str(row.playbook_step_id);
        const step = stepById.get(stepId);
        const enrollmentId = str(row.playbook_enrollment_id);
        const enrollment = enrollmentById.get(enrollmentId);
        return {
          id: str(row.id),
          opportunity_id: opportunityId,
          playbook_enrollment_id: enrollmentId,
          playbook_step_id: stepId,
          value_asset_id: nullableStr(row.value_asset_id),
          owner_user_id: nullableStr(row.owner_user_id),
          owner_name: str(row.owner_name),
          channel: str(row.action_type, "email") as FollowupChannel,
          title: str(row.title),
          purpose: step?.purpose ?? str(row.notes),
          value_angle: str(row.value_angle, step?.value_angle ?? ""),
          due_date: nullableStr(row.due_date),
          subject: str(row.subject),
          body: str(row.body),
          opportunity_name: str(opportunity?.name, "Opportunity"),
          client_name: str(opportunity?.client),
          contact_name: str(opportunity?.client_contact_name),
          contact_email: str(opportunity?.client_contact_email),
          playbook_name: enrollment?.playbook_name ?? "Follow-up playbook",
          day_offset: step?.day_offset ?? 0,
        } satisfies CrmPreparedFollowup;
      });

    return {
      enabled: true,
      organizationId,
      assets: assetRows,
      playbooks: playbookRows,
      enrollments: enrollmentRows,
      prepared,
    };
  });

const valueAssetInput = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(3000).default(""),
  source_type: z.enum(["upload", "link", "google_drive"]),
  storage_path: z.string().max(800).default(""),
  external_url: z.string().max(2000).default(""),
  original_file_name: z.string().max(300).default(""),
  content_type: z.string().max(200).default(""),
  size_bytes: z.number().int().min(0).max(26_214_400).default(0),
  tags: z.array(z.string().min(1).max(60)).max(12).default([]),
  audience: z.string().max(300).default(""),
  pipeline_stage: z.string().max(80).default(""),
});
export type CreateCrmValueAssetInput = z.infer<typeof valueAssetInput>;

export const createCrmValueAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => valueAssetInput.parse(input))
  .handler(async ({ data, context }) => {
    const organizationId = await currentOrganizationId(context);
    const storagePath = data.storage_path.trim();
    const externalUrl = data.external_url.trim();
    if (data.source_type === "upload" && !storagePath.startsWith(`${organizationId}/`)) {
      throw new Error("The uploaded file is not in this company's CRM library.");
    }
    if (data.source_type !== "upload") {
      const parsed = z.string().url().safeParse(externalUrl);
      if (!parsed.success) throw new Error("Enter a valid resource URL.");
      if (data.source_type === "google_drive") {
        const host = new URL(externalUrl).hostname.toLowerCase();
        if (host !== "drive.google.com" && host !== "docs.google.com") {
          throw new Error("Use a Google Drive or Google Docs sharing link for this resource.");
        }
      }
    }
    const inserted = await table(context.supabase, "crm_value_assets")
      .insert({
        organization_id: organizationId,
        created_by: context.userId,
        title: data.title.trim(),
        description: data.description.trim(),
        source_type: data.source_type,
        storage_path: storagePath,
        external_url: externalUrl,
        original_file_name: data.original_file_name.trim(),
        content_type: data.content_type.trim(),
        size_bytes: data.size_bytes,
        tags: data.tags.map((tag) => tag.trim()).filter(Boolean),
        audience: data.audience.trim(),
        pipeline_stage: data.pipeline_stage.trim(),
        approved_for_external: true,
      })
      .select("id")
      .single();
    if (inserted.error) {
      if (missingFollowupSchema(inserted.error)) {
        throw new Error("The Follow-Up Studio database migration has not been applied yet.");
      }
      throw new Error(inserted.error.message);
    }
    return { id: str((inserted.data as Record<string, unknown> | null)?.id) };
  });

const enrollmentInput = z.object({
  opportunity_id: z.string().uuid(),
  playbook_id: z.string().uuid(),
  owner_user_id: z.string().uuid().nullable().optional(),
});

export const enrollOpportunityInFollowupPlaybook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => enrollmentInput.parse(input))
  .handler(async ({ data, context }) => {
    const organizationId = await currentOrganizationId(context);
    const [opportunityResult, playbookResult, stepResult, existingResult] = await Promise.all([
      table(context.supabase, "pipeline_opportunities")
        .select("*")
        .eq("id", data.opportunity_id)
        .eq("organization_id", organizationId)
        .eq("archived", false)
        .maybeSingle(),
      table(context.supabase, "crm_followup_playbooks")
        .select("*")
        .eq("id", data.playbook_id)
        .eq("organization_id", organizationId)
        .eq("active", true)
        .maybeSingle(),
      table(context.supabase, "crm_followup_playbook_steps")
        .select("*")
        .eq("playbook_id", data.playbook_id)
        .eq("organization_id", organizationId)
        .eq("active", true)
        .order("step_order", { ascending: true })
        .limit(100),
      table(context.supabase, "crm_followup_enrollments")
        .select("id,status")
        .eq("opportunity_id", data.opportunity_id)
        .eq("organization_id", organizationId)
        .in("status", ["active", "paused"])
        .limit(1),
    ]);
    const lookupError =
      opportunityResult.error ?? playbookResult.error ?? stepResult.error ?? existingResult.error;
    if (lookupError) {
      if (missingFollowupSchema(lookupError)) {
        throw new Error("The Follow-Up Studio database migration has not been applied yet.");
      }
      throw new Error(lookupError.message);
    }
    if (!opportunityResult.data) throw new Error("That opportunity is not available.");
    if (!playbookResult.data) throw new Error("That follow-up playbook is not available.");
    if (Array.isArray(existingResult.data) && existingResult.data.length > 0) {
      throw new Error("This opportunity already has an active follow-up playbook.");
    }
    const stepRows = Array.isArray(stepResult.data)
      ? stepResult.data.map((row) => normalizeStep(row as Record<string, unknown>))
      : [];
    if (stepRows.length === 0) throw new Error("This playbook has no active follow-up steps.");

    const ownerUserId = data.owner_user_id ?? context.userId;
    const membership = await table(context.supabase, "organization_memberships")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("user_id", ownerUserId)
      .eq("status", "active")
      .maybeSingle();
    if (membership.error) throw new Error(membership.error.message);
    if (!membership.data) throw new Error("Choose an active team member to own this follow-up.");

    const profile = await table(context.supabase, "profiles")
      .select("full_name,email")
      .eq("id", ownerUserId)
      .maybeSingle();
    if (profile.error) throw new Error(profile.error.message);
    const opportunity = opportunityResult.data as Record<string, unknown>;
    const ownerProfile = profile.data as Record<string, unknown> | null;
    const ownerName =
      str(opportunity.assigned_to).trim() ||
      str(ownerProfile?.full_name).trim() ||
      str(ownerProfile?.email).trim() ||
      "Project team";

    const enrollmentResult = await table(context.supabase, "crm_followup_enrollments")
      .insert({
        organization_id: organizationId,
        opportunity_id: data.opportunity_id,
        playbook_id: data.playbook_id,
        created_by: context.userId,
        owner_user_id: ownerUserId,
        status: "active",
      })
      .select("id,started_at")
      .single();
    if (enrollmentResult.error) {
      if (enrollmentResult.error.code === "23505") {
        throw new Error("This opportunity already has an active follow-up playbook.");
      }
      throw new Error(enrollmentResult.error.message);
    }
    const enrollment = enrollmentResult.data as Record<string, unknown>;
    const enrollmentId = str(enrollment.id);
    const startedAt = new Date(str(enrollment.started_at, new Date().toISOString()));
    const contextValues = {
      contactName: str(opportunity.client_contact_name),
      opportunityName: str(opportunity.name, "your project"),
      clientName: str(opportunity.client),
      ownerName,
    };
    const actionResult = await table(context.supabase, "pipeline_next_actions").insert(
      stepRows.map((step) => ({
        organization_id: organizationId,
        opportunity_id: data.opportunity_id,
        account_id: nullableStr(opportunity.account_id),
        contact_id: nullableStr(opportunity.primary_contact_id),
        created_by: context.userId,
        owner_user_id: ownerUserId,
        owner_name: ownerName,
        action_type: step.channel,
        priority: "normal",
        title: step.title,
        notes: step.purpose,
        due_date: followupDueDate(startedAt, step.day_offset),
        playbook_enrollment_id: enrollmentId,
        playbook_step_id: step.id,
        value_asset_id: step.default_asset_id,
        subject: personalizeFollowupTemplate(step.subject_template, contextValues),
        body: personalizeFollowupTemplate(step.body_template, contextValues),
        value_angle: step.value_angle,
      })),
    );
    if (actionResult.error) {
      await table(context.supabase, "crm_followup_enrollments")
        .update({ status: "stopped", stop_reason: "Action creation failed" })
        .eq("id", enrollmentId)
        .eq("organization_id", organizationId);
      throw new Error(actionResult.error.message);
    }
    const activityResult = await table(context.supabase, "pipeline_activity_log").insert({
      opportunity_id: data.opportunity_id,
      organization_id: organizationId,
      event_type: "field_update",
      from_value: "",
      to_value: str((playbookResult.data as Record<string, unknown>).name),
      notes: `Follow-up playbook enrolled with ${stepRows.length} prepared steps.`,
      created_by: context.userId,
    });
    if (activityResult.error) throw new Error(activityResult.error.message);
    return { enrollmentId, actionCount: stepRows.length };
  });

const draftInput = z.object({
  id: z.string().uuid(),
  subject: z.string().max(500),
  body: z.string().max(20_000),
  value_asset_id: z.string().uuid().nullable().optional(),
});

export const updatePreparedFollowup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => draftInput.parse(input))
  .handler(async ({ data, context }) => {
    const organizationId = await currentOrganizationId(context);
    if (data.value_asset_id) {
      const asset = await table(context.supabase, "crm_value_assets")
        .select("id")
        .eq("id", data.value_asset_id)
        .eq("organization_id", organizationId)
        .eq("archived", false)
        .maybeSingle();
      if (asset.error) throw new Error(asset.error.message);
      if (!asset.data) throw new Error("That value resource is not available.");
    }
    const action = await table(context.supabase, "pipeline_next_actions")
      .select("id,playbook_enrollment_id")
      .eq("id", data.id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (action.error) throw new Error(action.error.message);
    if (
      !action.data ||
      !nullableStr((action.data as Record<string, unknown>).playbook_enrollment_id)
    ) {
      throw new Error("That prepared follow-up was not found.");
    }
    const updated = await table(context.supabase, "pipeline_next_actions")
      .update({
        subject: data.subject.trim(),
        body: data.body.trim(),
        value_asset_id: data.value_asset_id ?? null,
      })
      .eq("id", data.id)
      .eq("organization_id", organizationId);
    if (updated.error) throw new Error(updated.error.message);
    return { ok: true };
  });

const completionInput = z.object({
  id: z.string().uuid(),
  outcome: z.enum([
    "sent",
    "connected",
    "no_response",
    "meeting_scheduled",
    "not_interested",
    "other",
  ]),
  outcome_notes: z.string().max(5000).default(""),
});

export const completePreparedFollowup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => completionInput.parse(input))
  .handler(async ({ data, context }) => {
    const organizationId = await currentOrganizationId(context);
    const action = await table(context.supabase, "pipeline_next_actions")
      .select("*")
      .eq("id", data.id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (action.error) throw new Error(action.error.message);
    if (!action.data) throw new Error("That prepared follow-up was not found.");
    const row = action.data as Record<string, unknown>;
    const enrollmentId = nullableStr(row.playbook_enrollment_id);
    if (!enrollmentId) throw new Error("That action is not part of a follow-up playbook.");
    const completedAt = new Date().toISOString();
    const updated = await table(context.supabase, "pipeline_next_actions")
      .update({
        completed_at: completedAt,
        completed_by: context.userId,
        outcome: data.outcome,
        outcome_notes: data.outcome_notes.trim(),
        sent_at: data.outcome === "sent" ? completedAt : null,
      })
      .eq("id", data.id)
      .eq("organization_id", organizationId);
    if (updated.error) throw new Error(updated.error.message);

    const remainingResult = await table(context.supabase, "pipeline_next_actions")
      .select("id,completed_at,skipped_at")
      .eq("playbook_enrollment_id", enrollmentId)
      .eq("organization_id", organizationId)
      .limit(100);
    if (remainingResult.error) throw new Error(remainingResult.error.message);
    const remaining = (Array.isArray(remainingResult.data) ? remainingResult.data : []).filter(
      (item) => {
        const candidate = item as Record<string, unknown>;
        return !nullableStr(candidate.completed_at) && !nullableStr(candidate.skipped_at);
      },
    );
    if (remaining.length === 0) {
      const finished = await table(context.supabase, "crm_followup_enrollments")
        .update({ status: "completed", completed_at: completedAt })
        .eq("id", enrollmentId)
        .eq("organization_id", organizationId);
      if (finished.error) throw new Error(finished.error.message);
    }

    const activity = await table(context.supabase, "pipeline_activity_log").insert({
      opportunity_id: str(row.opportunity_id),
      organization_id: organizationId,
      event_type: "note_added",
      from_value: "",
      to_value: data.outcome,
      notes: `Follow-up completed: ${str(row.title)}${
        data.outcome_notes.trim() ? ` — ${data.outcome_notes.trim()}` : ""
      }`,
      created_by: context.userId,
    });
    if (activity.error) throw new Error(activity.error.message);
    return { ok: true, playbookCompleted: remaining.length === 0 };
  });
