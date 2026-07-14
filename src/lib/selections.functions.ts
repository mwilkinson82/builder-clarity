import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  calculateSelectionDates,
  selectionInstallDate,
  type SelectionDecisionStatus,
  type SelectionProcurementStatus,
} from "@/lib/selections-domain";

export interface ProjectSelectionOptionRow {
  id: string;
  project_id: string;
  selection_id: string;
  title: string;
  description: string;
  manufacturer: string;
  model_number: string;
  finish: string;
  price_cents: number;
  is_recommended: boolean;
  sort_order: number;
}

export interface ProjectSelectionRow {
  id: string;
  project_id: string;
  selection_number: string;
  title: string;
  category: string;
  room_area: string;
  description: string;
  decision_status: SelectionDecisionStatus;
  procurement_status: SelectionProcurementStatus;
  schedule_activity_id: string | null;
  schedule_override_acknowledged: boolean;
  need_on_site_date: string | null;
  procurement_lead_days: number;
  delivery_buffer_days: number;
  client_review_days: number;
  order_by_date: string | null;
  client_decision_due_date: string | null;
  assigned_client_contact_id: string | null;
  selected_option_id: string | null;
  allowance_cents: number;
  client_visible: boolean;
  client_sent_at: string | null;
  client_decided_at: string | null;
  approved_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  options: ProjectSelectionOptionRow[];
}

export interface ProjectSelectionDecisionRow {
  id: string;
  project_id: string;
  selection_id: string;
  option_id: string | null;
  client_email: string;
  decision: "approved" | "revision_requested";
  notes: string;
  selection_version: number;
  created_at: string;
}

export interface SelectionClientSeat {
  accessId: string;
  contactId: string | null;
  name: string;
  email: string;
}

export interface SelectionScheduleActivity {
  id: string;
  activity_id: string;
  name: string;
  forecast_start_date: string | null;
  start_date: string | null;
  baseline_start_date: string | null;
}

const optionInput = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).default(""),
  manufacturer: z.string().max(200).default(""),
  model_number: z.string().max(200).default(""),
  finish: z.string().max(200).default(""),
  price_cents: z.number().int().min(0).default(0),
  is_recommended: z.boolean().default(false),
});

const saveSelectionInput = z.object({
  projectId: z.string().uuid(),
  selectionId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(240),
  category: z.string().max(120).default(""),
  room_area: z.string().max(120).default(""),
  description: z.string().max(4000).default(""),
  schedule_activity_id: z.string().uuid().nullable().default(null),
  schedule_override_acknowledged: z.boolean().default(false),
  need_on_site_date: z.string().date().nullable().default(null),
  procurement_lead_days: z.number().int().min(0).max(3650).default(0),
  delivery_buffer_days: z.number().int().min(0).max(365).default(0),
  client_review_days: z.number().int().min(0).max(365).default(7),
  assigned_client_contact_id: z.string().uuid().nullable().default(null),
  allowance_cents: z.number().int().min(0).default(0),
  options: z.array(optionInput).min(1).max(20),
});

type DbResult = { data: unknown; error: { message?: string; code?: string } | null };
type DbQuery = PromiseLike<DbResult> & {
  select: (...args: unknown[]) => DbQuery;
  insert: (...args: unknown[]) => DbQuery;
  update: (...args: unknown[]) => DbQuery;
  delete: (...args: unknown[]) => DbQuery;
  eq: (...args: unknown[]) => DbQuery;
  neq: (...args: unknown[]) => DbQuery;
  in: (...args: unknown[]) => DbQuery;
  order: (...args: unknown[]) => DbQuery;
  single: () => Promise<DbResult>;
  maybeSingle: () => Promise<DbResult>;
};
type ServerContext = {
  supabase: {
    from: (name: string) => DbQuery;
    rpc: (name: string, args?: Record<string, unknown>) => Promise<DbResult>;
  };
  userId: string;
  claims?: Record<string, unknown>;
};

const rows = (value: unknown) => (Array.isArray(value) ? (value as Record<string, unknown>[]) : []);
const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const num = (value: unknown) => (typeof value === "number" ? value : Number(value ?? 0));
const bool = (value: unknown) => value === true;

function isMissingSelections(error: unknown) {
  const candidate = error as { code?: string; message?: string } | null;
  return (
    candidate?.code === "PGRST205" ||
    /project_selections|schema cache|could not find the table/i.test(candidate?.message ?? "")
  );
}

function normalizeOption(row: Record<string, unknown>): ProjectSelectionOptionRow {
  return {
    id: str(row.id),
    project_id: str(row.project_id),
    selection_id: str(row.selection_id),
    title: str(row.title),
    description: str(row.description),
    manufacturer: str(row.manufacturer),
    model_number: str(row.model_number),
    finish: str(row.finish),
    price_cents: num(row.price_cents),
    is_recommended: bool(row.is_recommended),
    sort_order: num(row.sort_order),
  };
}

function normalizeSelection(
  row: Record<string, unknown>,
  options: ProjectSelectionOptionRow[],
): ProjectSelectionRow {
  return {
    id: str(row.id),
    project_id: str(row.project_id),
    selection_number: str(row.selection_number),
    title: str(row.title),
    category: str(row.category),
    room_area: str(row.room_area),
    description: str(row.description),
    decision_status: str(row.decision_status, "draft") as SelectionDecisionStatus,
    procurement_status: str(row.procurement_status, "not_released") as SelectionProcurementStatus,
    schedule_activity_id: str(row.schedule_activity_id) || null,
    schedule_override_acknowledged: bool(row.schedule_override_acknowledged),
    need_on_site_date: str(row.need_on_site_date) || null,
    procurement_lead_days: num(row.procurement_lead_days),
    delivery_buffer_days: num(row.delivery_buffer_days),
    client_review_days: num(row.client_review_days),
    order_by_date: str(row.order_by_date) || null,
    client_decision_due_date: str(row.client_decision_due_date) || null,
    assigned_client_contact_id: str(row.assigned_client_contact_id) || null,
    selected_option_id: str(row.selected_option_id) || null,
    allowance_cents: num(row.allowance_cents),
    client_visible: bool(row.client_visible),
    client_sent_at: str(row.client_sent_at) || null,
    client_decided_at: str(row.client_decided_at) || null,
    approved_at: str(row.approved_at) || null,
    version: num(row.version),
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
    options,
  };
}

function normalizeDecision(row: Record<string, unknown>): ProjectSelectionDecisionRow {
  return {
    id: str(row.id),
    project_id: str(row.project_id),
    selection_id: str(row.selection_id),
    option_id: str(row.option_id) || null,
    client_email: str(row.client_email),
    decision: str(row.decision) as ProjectSelectionDecisionRow["decision"],
    notes: str(row.notes),
    selection_version: num(row.selection_version),
    created_at: str(row.created_at),
  };
}

async function canManage(context: ServerContext, projectId: string) {
  const result = await context.supabase.rpc("can_manage_project", { p_project_id: projectId });
  if (result.error) throw new Error(result.error.message);
  if (!result.data)
    throw new Error("You do not have permission to manage this project's selections.");
}

async function selectionBundle(context: ServerContext, projectId: string, clientOnly = false) {
  const selectionQuery = context.supabase
    .from("project_selections")
    .select("*")
    .eq("project_id", projectId);
  const [selectionsRes, optionsRes, decisionsRes] = await Promise.all([
    clientOnly
      ? selectionQuery.eq("client_visible", true).order("client_decision_due_date")
      : selectionQuery.order("client_decision_due_date"),
    context.supabase
      .from("project_selection_options")
      .select("*")
      .eq("project_id", projectId)
      .order("sort_order"),
    context.supabase
      .from("project_selection_decisions")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
  ]);
  if (selectionsRes.error) {
    if (isMissingSelections(selectionsRes.error))
      return { selections: [], decisions: [], migrationRequired: true };
    throw new Error(selectionsRes.error.message);
  }
  if (optionsRes.error) throw new Error(optionsRes.error.message);
  if (decisionsRes.error) throw new Error(decisionsRes.error.message);
  const options = rows(optionsRes.data).map(normalizeOption);
  const selections = rows(selectionsRes.data).map((row) =>
    normalizeSelection(
      row,
      options.filter((option) => option.selection_id === str(row.id)),
    ),
  );
  return {
    selections,
    decisions: rows(decisionsRes.data).map(normalizeDecision),
    migrationRequired: false,
  };
}

export const listProjectSelections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerContext;
    await canManage(ctx, data.projectId);
    const bundle = await selectionBundle(ctx, data.projectId);
    const [activitiesRes, accessRes, contactsRes] = await Promise.all([
      ctx.supabase
        .from("schedule_activities")
        .select("id,activity_id,name,forecast_start_date,start_date,baseline_start_date")
        .eq("project_id", data.projectId)
        .order("sort_order"),
      ctx.supabase
        .from("project_client_access")
        .select("id,contact_id,email,status,can_view_selections")
        .eq("project_id", data.projectId)
        .neq("status", "revoked"),
      ctx.supabase.from("client_contacts").select("id,name,email").neq("status", "inactive"),
    ]);
    if (activitiesRes.error) throw new Error(activitiesRes.error.message);
    if (accessRes.error && !bundle.migrationRequired) throw new Error(accessRes.error.message);
    if (contactsRes.error) throw new Error(contactsRes.error.message);
    const contacts = new Map(rows(contactsRes.data).map((contact) => [str(contact.id), contact]));
    const clientSeats: SelectionClientSeat[] = rows(accessRes.data)
      .filter((access) => access.can_view_selections !== false)
      .map((access) => {
        const contact = contacts.get(str(access.contact_id));
        return {
          accessId: str(access.id),
          contactId: str(access.contact_id) || null,
          name: str(contact?.name) || str(access.email),
          email: str(access.email),
        };
      });
    const scheduleActivities: SelectionScheduleActivity[] = rows(activitiesRes.data).map((row) => ({
      id: str(row.id),
      activity_id: str(row.activity_id),
      name: str(row.name),
      forecast_start_date: str(row.forecast_start_date) || null,
      start_date: str(row.start_date) || null,
      baseline_start_date: str(row.baseline_start_date) || null,
    }));
    return { ...bundle, clientSeats, scheduleActivities };
  });

export const saveProjectSelection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof saveSelectionInput>) => saveSelectionInput.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerContext;
    await canManage(ctx, data.projectId);
    let current: Record<string, unknown> | null = null;
    if (data.selectionId) {
      const currentRes = await ctx.supabase
        .from("project_selections")
        .select("*")
        .eq("id", data.selectionId)
        .eq("project_id", data.projectId)
        .single();
      if (currentRes.error) throw new Error(currentRes.error.message);
      current = currentRes.data as Record<string, unknown>;
    }
    let needOnSiteDate = data.need_on_site_date;
    if (data.schedule_activity_id) {
      const activityRes = await ctx.supabase
        .from("schedule_activities")
        .select("forecast_start_date,start_date,baseline_start_date")
        .eq("id", data.schedule_activity_id)
        .eq("project_id", data.projectId)
        .single();
      if (activityRes.error) throw new Error(activityRes.error.message);
      needOnSiteDate = selectionInstallDate(activityRes.data as SelectionScheduleActivity);
      if (!needOnSiteDate)
        throw new Error(
          "The linked CPM activity needs a start date before it can drive this selection.",
        );
    } else if (!data.schedule_override_acknowledged) {
      throw new Error(
        "Link a CPM schedule activity, or acknowledge that this selection is being scheduled manually.",
      );
    } else if (!needOnSiteDate) {
      throw new Error("Enter a manual need-on-site date for this selection.");
    }
    const dates = calculateSelectionDates({
      needOnSiteDate,
      procurementLeadDays: data.procurement_lead_days,
      deliveryBufferDays: data.delivery_buffer_days,
      clientReviewDays: data.client_review_days,
    });
    const shared = {
      title: data.title,
      category: data.category,
      room_area: data.room_area,
      description: data.description,
      schedule_activity_id: data.schedule_activity_id,
      schedule_override_acknowledged: data.schedule_override_acknowledged,
      need_on_site_date: dates.needOnSiteDate,
      procurement_lead_days: data.procurement_lead_days,
      delivery_buffer_days: data.delivery_buffer_days,
      client_review_days: data.client_review_days,
      order_by_date: dates.orderByDate,
      client_decision_due_date: dates.clientDecisionDueDate,
      assigned_client_contact_id: data.assigned_client_contact_id,
      allowance_cents: data.allowance_cents,
      updated_by: ctx.userId,
    };
    let selectionId = data.selectionId;
    if (selectionId) {
      const updateRes = await ctx.supabase
        .from("project_selections")
        .update({
          ...shared,
          decision_status: "draft",
          client_visible: false,
          client_sent_at: null,
          client_decided_at: null,
          approved_at: null,
          selected_option_id: null,
          version: num(current?.version) + 1,
        })
        .eq("id", selectionId)
        .eq("project_id", data.projectId);
      if (updateRes.error) throw new Error(updateRes.error.message);
      const deleteRes = await ctx.supabase
        .from("project_selection_options")
        .delete()
        .eq("selection_id", selectionId)
        .eq("project_id", data.projectId);
      if (deleteRes.error) throw new Error(deleteRes.error.message);
    } else {
      const existingRes = await ctx.supabase
        .from("project_selections")
        .select("id")
        .eq("project_id", data.projectId);
      if (existingRes.error && !isMissingSelections(existingRes.error))
        throw new Error(existingRes.error.message);
      const insertRes = await ctx.supabase
        .from("project_selections")
        .insert({
          ...shared,
          project_id: data.projectId,
          selection_number: `SEL-${String(rows(existingRes.data).length + 1).padStart(3, "0")}`,
          created_by: ctx.userId,
        })
        .select("id")
        .single();
      if (insertRes.error) throw new Error(insertRes.error.message);
      selectionId = str((insertRes.data as Record<string, unknown>).id);
    }
    const optionRows = data.options.map((option, index) => ({
      project_id: data.projectId,
      selection_id: selectionId,
      title: option.title,
      description: option.description,
      manufacturer: option.manufacturer,
      model_number: option.model_number,
      finish: option.finish,
      price_cents: option.price_cents,
      is_recommended: option.is_recommended,
      sort_order: index,
    }));
    const optionsRes = await ctx.supabase.from("project_selection_options").insert(optionRows);
    if (optionsRes.error) throw new Error(optionsRes.error.message);
    return { ok: true, selectionId };
  });

export const updateSelectionProcurementStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { selectionId: string; status: SelectionProcurementStatus }) =>
    z
      .object({
        selectionId: z.string().uuid(),
        status: z.enum(["not_released", "ordered", "shipped", "received", "installed"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerContext;
    const currentRes = await ctx.supabase
      .from("project_selections")
      .select("project_id")
      .eq("id", data.selectionId)
      .single();
    if (currentRes.error) throw new Error(currentRes.error.message);
    const projectId = str((currentRes.data as Record<string, unknown>).project_id);
    await canManage(ctx, projectId);
    const updateRes = await ctx.supabase
      .from("project_selections")
      .update({ procurement_status: data.status, updated_by: ctx.userId })
      .eq("id", data.selectionId);
    if (updateRes.error) throw new Error(updateRes.error.message);
    return { ok: true };
  });

export const sendSelectionForClientDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { selectionId: string }) =>
    z.object({ selectionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerContext;
    const selectionRes = await ctx.supabase
      .from("project_selections")
      .select("*")
      .eq("id", data.selectionId)
      .single();
    if (selectionRes.error) throw new Error(selectionRes.error.message);
    const selection = selectionRes.data as Record<string, unknown>;
    const projectId = str(selection.project_id);
    await canManage(ctx, projectId);
    const contactId = str(selection.assigned_client_contact_id);
    if (!contactId) throw new Error("Choose a client contact before sending this selection.");
    const [contactRes, accessRes, projectRes, optionsRes] = await Promise.all([
      ctx.supabase.from("client_contacts").select("id,name,email").eq("id", contactId).single(),
      ctx.supabase
        .from("project_client_access")
        .select("id,email")
        .eq("project_id", projectId)
        .eq("contact_id", contactId)
        .neq("status", "revoked")
        .maybeSingle(),
      ctx.supabase.from("projects").select("name,job_number").eq("id", projectId).single(),
      ctx.supabase
        .from("project_selection_options")
        .select("id")
        .eq("selection_id", data.selectionId),
    ]);
    if (contactRes.error) throw new Error(contactRes.error.message);
    if (accessRes.error) throw new Error(accessRes.error.message);
    if (!accessRes.data)
      throw new Error("Grant this contact a client portal seat before sending the selection.");
    if (projectRes.error) throw new Error(projectRes.error.message);
    if (optionsRes.error) throw new Error(optionsRes.error.message);
    if (rows(optionsRes.data).length === 0)
      throw new Error("Add at least one option before sending.");
    const accessId = str((accessRes.data as Record<string, unknown>).id);
    const accessUpdate = await ctx.supabase
      .from("project_client_access")
      .update({ can_view_selections: true, last_sent_at: new Date().toISOString() })
      .eq("id", accessId);
    if (accessUpdate.error) throw new Error(accessUpdate.error.message);
    const sentAt = new Date().toISOString();
    const updateRes = await ctx.supabase
      .from("project_selections")
      .update({
        decision_status: "sent",
        client_visible: true,
        client_sent_at: sentAt,
        updated_by: ctx.userId,
      })
      .eq("id", data.selectionId);
    if (updateRes.error) throw new Error(updateRes.error.message);
    const contact = contactRes.data as Record<string, unknown>;
    const project = projectRes.data as Record<string, unknown>;
    return {
      selectionId: data.selectionId,
      recipientEmail: str(contact.email),
      clientName: str(contact.name),
      projectName: str(project.name),
      jobNumber: str(project.job_number),
      selectionTitle: str(selection.title),
      selectionNumber: str(selection.selection_number),
      selectionVersion: num(selection.version),
      clientSentAt: sentAt,
      decisionDueDate: str(selection.client_decision_due_date) || null,
      needOnSiteDate: str(selection.need_on_site_date) || null,
    };
  });

export const deleteProjectSelection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { selectionId: string }) =>
    z.object({ selectionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerContext;
    const currentRes = await ctx.supabase
      .from("project_selections")
      .select("project_id")
      .eq("id", data.selectionId)
      .single();
    if (currentRes.error) throw new Error(currentRes.error.message);
    await canManage(ctx, str((currentRes.data as Record<string, unknown>).project_id));
    const result = await ctx.supabase
      .from("project_selections")
      .delete()
      .eq("id", data.selectionId);
    if (result.error) throw new Error(result.error.message);
    return { ok: true };
  });

export const listClientSelections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) =>
    selectionBundle(context as unknown as ServerContext, data.projectId, true),
  );

export const recordClientSelectionDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      selectionId: string;
      optionId: string | null;
      decision: "approved" | "revision_requested";
      notes: string;
    }) =>
      z
        .object({
          selectionId: z.string().uuid(),
          optionId: z.string().uuid().nullable(),
          decision: z.enum(["approved", "revision_requested"]),
          notes: z.string().max(4000).default(""),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerContext;
    const result = await ctx.supabase.rpc("record_client_selection_decision", {
      p_selection_id: data.selectionId,
      p_option_id: data.optionId,
      p_decision: data.decision,
      p_notes: data.notes,
      p_user_agent: str(ctx.claims?.user_agent),
    });
    if (result.error) throw new Error(result.error.message);
    return { ok: true, decisionId: result.data as string };
  });
