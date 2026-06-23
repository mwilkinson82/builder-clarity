import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { COStatus, COType } from "@/lib/projects.functions";

export type ClientAccessStatus = "pending" | "active" | "revoked";
export type ClientChangeOrderStatus = "not_sent" | "sent" | "approved" | "rejected";
export type ClientApprovalDecision = "approved" | "rejected" | "comment";

export interface ClientContactRow {
  id: string;
  organization_id: string;
  name: string;
  email: string;
  company: string;
  title: string;
  phone: string;
  notes: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectClientAccessRow {
  id: string;
  project_id: string;
  contact_id: string | null;
  email: string;
  client_user_id: string | null;
  role: string;
  status: ClientAccessStatus;
  can_view_change_orders: boolean;
  can_view_daily_reports: boolean;
  can_view_billing: boolean;
  accepted_at: string | null;
  last_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientPortalChangeOrder {
  id: string;
  project_id: string;
  number: string;
  description: string;
  contract_amount: number;
  status: COStatus;
  probability: number;
  owner: string;
  notes: string;
  co_type: COType;
  client_visible: boolean;
  client_status: ClientChangeOrderStatus;
  client_notes: string;
  client_sent_at: string | null;
  client_decided_at: string | null;
}

export interface ChangeOrderApprovalRow {
  id: string;
  project_id: string;
  change_order_id: string;
  contact_id: string | null;
  client_user_id: string | null;
  client_email: string;
  decision: ClientApprovalDecision;
  notes: string;
  document_version: string;
  user_agent: string;
  created_at: string;
}

export interface ClientPortalProjectRow {
  id: string;
  organization_id: string | null;
  name: string;
  client: string;
  job_number: string;
  project_manager: string;
  baseline_completion_date: string | null;
  forecast_completion_date: string | null;
  percent_complete: number;
}

const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
const bool = (v: unknown, d = false) => (typeof v === "boolean" ? v : d);

const contactInput = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
  company: z.string().max(200).default(""),
  title: z.string().max(200).default(""),
  phone: z.string().max(80).default(""),
  notes: z.string().max(2000).default(""),
});

const accessPatchInput = z.object({
  accessId: z.string().uuid(),
  status: z.enum(["pending", "active", "revoked"]).optional(),
  can_view_change_orders: z.boolean().optional(),
  can_view_daily_reports: z.boolean().optional(),
  can_view_billing: z.boolean().optional(),
  last_sent_at: z.string().datetime().nullable().optional(),
});

type ServerContext = {
  supabase: unknown;
  userId: string;
  claims?: Record<string, unknown>;
};

function db(context: ServerContext) {
  return context.supabase as any;
}

function normalizeContact(row: Record<string, unknown>): ClientContactRow {
  return {
    id: row.id as string,
    organization_id: row.organization_id as string,
    name: str(row.name),
    email: str(row.email),
    company: str(row.company),
    title: str(row.title),
    phone: str(row.phone),
    notes: str(row.notes),
    status: str(row.status, "active"),
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
  };
}

function normalizeAccess(row: Record<string, unknown>): ProjectClientAccessRow {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    contact_id: (row.contact_id as string | null) ?? null,
    email: str(row.email),
    client_user_id: (row.client_user_id as string | null) ?? null,
    role: str(row.role, "client"),
    status: str(row.status, "pending") as ClientAccessStatus,
    can_view_change_orders: bool(row.can_view_change_orders, true),
    can_view_daily_reports: bool(row.can_view_daily_reports),
    can_view_billing: bool(row.can_view_billing),
    accepted_at: (row.accepted_at as string | null) ?? null,
    last_sent_at: (row.last_sent_at as string | null) ?? null,
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
  };
}

function normalizeChangeOrder(row: Record<string, unknown>): ClientPortalChangeOrder {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    number: str(row.number),
    description: str(row.description),
    contract_amount: num(row.contract_amount),
    status: str(row.status, "Pending") as COStatus,
    probability: num(row.probability),
    owner: str(row.owner),
    notes: str(row.notes),
    co_type: str(row.co_type, "other") as COType,
    client_visible: bool(row.client_visible),
    client_status: str(row.client_status, "not_sent") as ClientChangeOrderStatus,
    client_notes: str(row.client_notes),
    client_sent_at: (row.client_sent_at as string | null) ?? null,
    client_decided_at: (row.client_decided_at as string | null) ?? null,
  };
}

function normalizeApproval(row: Record<string, unknown>): ChangeOrderApprovalRow {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    change_order_id: row.change_order_id as string,
    contact_id: (row.contact_id as string | null) ?? null,
    client_user_id: (row.client_user_id as string | null) ?? null,
    client_email: str(row.client_email),
    decision: str(row.decision, "comment") as ClientApprovalDecision,
    notes: str(row.notes),
    document_version: str(row.document_version),
    user_agent: str(row.user_agent),
    created_at: str(row.created_at),
  };
}

function normalizeClientProject(row: Record<string, unknown>): ClientPortalProjectRow {
  return {
    id: row.id as string,
    organization_id: (row.organization_id as string | null) ?? null,
    name: str(row.name),
    client: str(row.client),
    job_number: str(row.job_number),
    project_manager: str(row.project_manager),
    baseline_completion_date: (row.baseline_completion_date as string | null) ?? null,
    forecast_completion_date: (row.forecast_completion_date as string | null) ?? null,
    percent_complete: num(row.percent_complete),
  };
}

async function requireCanManageProject(context: ServerContext, projectId: string) {
  const { data, error } = await db(context).rpc("can_manage_project", { p_project_id: projectId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("You do not have permission to manage this project.");
}

async function loadProjectForManagement(context: ServerContext, projectId: string) {
  await requireCanManageProject(context, projectId);
  const { data, error } = await db(context)
    .from("projects")
    .select("id,organization_id,name,client,job_number,project_manager")
    .eq("id", projectId)
    .single();
  if (error) throw new Error(error.message);
  if (!data?.organization_id) throw new Error("This project is missing an Overwatch team.");
  return data as Record<string, unknown> & { organization_id: string };
}

export const getClientPortalManagement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const project = await loadProjectForManagement(context as ServerContext, data.projectId);
    const organizationId = project.organization_id;
    const [contactsRes, accessRes, changeOrdersRes, approvalsRes] = await Promise.all([
      db(context)
        .from("client_contacts")
        .select("*")
        .eq("organization_id", organizationId)
        .neq("status", "inactive")
        .order("created_at", { ascending: false }),
      db(context)
        .from("project_client_access")
        .select("*")
        .eq("project_id", data.projectId)
        .neq("status", "revoked")
        .order("created_at", { ascending: false }),
      db(context)
        .from("change_orders")
        .select("*")
        .eq("project_id", data.projectId)
        .order("number"),
      db(context)
        .from("change_order_approvals")
        .select("*")
        .eq("project_id", data.projectId)
        .order("created_at", { ascending: false }),
    ]);

    if (contactsRes.error) throw new Error(contactsRes.error.message);
    if (accessRes.error) throw new Error(accessRes.error.message);
    if (changeOrdersRes.error) throw new Error(changeOrdersRes.error.message);
    if (approvalsRes.error) throw new Error(approvalsRes.error.message);

    return {
      project: normalizeClientProject(project),
      contacts: (contactsRes.data ?? []).map((row: Record<string, unknown>) =>
        normalizeContact(row),
      ),
      access: (accessRes.data ?? []).map((row: Record<string, unknown>) => normalizeAccess(row)),
      changeOrders: (changeOrdersRes.data ?? []).map((row: Record<string, unknown>) =>
        normalizeChangeOrder(row),
      ),
      approvals: (approvalsRes.data ?? []).map((row: Record<string, unknown>) =>
        normalizeApproval(row),
      ),
    };
  });

export const upsertClientContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof contactInput>) => contactInput.parse(input))
  .handler(async ({ data, context }) => {
    const project = await loadProjectForManagement(context as ServerContext, data.projectId);
    const email = data.email.trim().toLowerCase();
    const payload = {
      organization_id: project.organization_id,
      created_by: (context as ServerContext).userId,
      name: data.name.trim(),
      email,
      company: data.company.trim(),
      title: data.title.trim(),
      phone: data.phone.trim(),
      notes: data.notes.trim(),
      status: "active",
    };

    const { data: existing, error: findError } = await db(context)
      .from("client_contacts")
      .select("*")
      .eq("organization_id", project.organization_id)
      .ilike("email", email)
      .neq("status", "inactive")
      .maybeSingle();
    if (findError) throw new Error(findError.message);

    const query = existing
      ? db(context).from("client_contacts").update(payload).eq("id", existing.id)
      : db(context).from("client_contacts").insert(payload);
    const { data: saved, error } = await query.select("*").single();
    if (error) throw new Error(error.message);
    return { contact: normalizeContact(saved as Record<string, unknown>) };
  });

export const grantClientProjectAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string; contactId: string }) =>
    z.object({ projectId: z.string().uuid(), contactId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const project = await loadProjectForManagement(context as ServerContext, data.projectId);
    const { data: contact, error: contactError } = await db(context)
      .from("client_contacts")
      .select("*")
      .eq("id", data.contactId)
      .single();
    if (contactError) throw new Error(contactError.message);
    if (!contact || contact.organization_id !== project.organization_id) {
      throw new Error("This client contact does not belong to the project team.");
    }

    const email = str(contact.email).trim().toLowerCase();
    const payload = {
      project_id: data.projectId,
      contact_id: data.contactId,
      email,
      role: "client",
      status: "pending" as ClientAccessStatus,
      can_view_change_orders: true,
      can_view_daily_reports: false,
      can_view_billing: false,
      invited_by: (context as ServerContext).userId,
    };
    const { data: existing, error: findError } = await db(context)
      .from("project_client_access")
      .select("*")
      .eq("project_id", data.projectId)
      .ilike("email", email)
      .neq("status", "revoked")
      .maybeSingle();
    if (findError) throw new Error(findError.message);

    const query = existing
      ? db(context).from("project_client_access").update(payload).eq("id", existing.id)
      : db(context).from("project_client_access").insert(payload);
    const { data: saved, error } = await query.select("*").single();
    if (error) throw new Error(error.message);
    return { access: normalizeAccess(saved as Record<string, unknown>) };
  });

export const updateClientProjectAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof accessPatchInput>) => accessPatchInput.parse(input))
  .handler(async ({ data, context }) => {
    const { accessId, ...patch } = data;
    const { data: access, error: accessError } = await db(context)
      .from("project_client_access")
      .select("id,project_id")
      .eq("id", accessId)
      .single();
    if (accessError) throw new Error(accessError.message);
    await requireCanManageProject(context as ServerContext, access.project_id as string);

    const { data: saved, error } = await db(context)
      .from("project_client_access")
      .update(patch)
      .eq("id", accessId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { access: normalizeAccess(saved as Record<string, unknown>) };
  });

export const revokeClientProjectAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { accessId: string }) =>
    z.object({ accessId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: access, error: accessError } = await db(context)
      .from("project_client_access")
      .select("id,project_id")
      .eq("id", data.accessId)
      .single();
    if (accessError) throw new Error(accessError.message);
    await requireCanManageProject(context as ServerContext, access.project_id as string);

    const { error } = await db(context)
      .from("project_client_access")
      .update({ status: "revoked" })
      .eq("id", data.accessId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setChangeOrderClientVisibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { changeOrderId: string; client_visible: boolean }) =>
    z.object({ changeOrderId: z.string().uuid(), client_visible: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: co, error: coError } = await db(context)
      .from("change_orders")
      .select("id,project_id")
      .eq("id", data.changeOrderId)
      .single();
    if (coError) throw new Error(coError.message);
    await requireCanManageProject(context as ServerContext, co.project_id as string);

    const patch = data.client_visible
      ? {
          client_visible: true,
          client_status: "sent",
          client_sent_at: new Date().toISOString(),
        }
      : {
          client_visible: false,
          client_status: "not_sent",
          client_sent_at: null,
        };
    const { data: saved, error } = await db(context)
      .from("change_orders")
      .update(patch)
      .eq("id", data.changeOrderId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { changeOrder: normalizeChangeOrder(saved as Record<string, unknown>) };
  });

export const getClientPortalProject = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const [clientAccessRes, internalAccessRes] = await Promise.all([
      db(context).rpc("can_read_client_project", { p_project_id: data.projectId }),
      db(context).rpc("can_read_project", { p_project_id: data.projectId }),
    ]);
    if (clientAccessRes.error) throw new Error(clientAccessRes.error.message);
    if (internalAccessRes.error) throw new Error(internalAccessRes.error.message);
    if (!clientAccessRes.data && !internalAccessRes.data) {
      throw new Error("You do not have client access to this project.");
    }

    const [projectRes, changeOrdersRes, approvalsRes] = await Promise.all([
      db(context)
        .from("projects")
        .select(
          "id,organization_id,name,client,job_number,project_manager,baseline_completion_date,forecast_completion_date,percent_complete",
        )
        .eq("id", data.projectId)
        .single(),
      db(context)
        .from("change_orders")
        .select("*")
        .eq("project_id", data.projectId)
        .eq("client_visible", true)
        .order("number"),
      db(context)
        .from("change_order_approvals")
        .select("*")
        .eq("project_id", data.projectId)
        .order("created_at", { ascending: false }),
    ]);
    if (projectRes.error) throw new Error(projectRes.error.message);
    if (changeOrdersRes.error) throw new Error(changeOrdersRes.error.message);
    if (approvalsRes.error) throw new Error(approvalsRes.error.message);

    return {
      project: normalizeClientProject(projectRes.data as Record<string, unknown>),
      changeOrders: (changeOrdersRes.data ?? []).map((row: Record<string, unknown>) =>
        normalizeChangeOrder(row),
      ),
      approvals: (approvalsRes.data ?? []).map((row: Record<string, unknown>) =>
        normalizeApproval(row),
      ),
    };
  });

export const recordClientChangeOrderDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { changeOrderId: string; decision: ClientApprovalDecision; notes: string }) =>
      z
        .object({
          changeOrderId: z.string().uuid(),
          decision: z.enum(["approved", "rejected", "comment"]),
          notes: z.string().max(2000).default(""),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: approvalId, error } = await db(context).rpc(
      "record_client_change_order_decision",
      {
        p_change_order_id: data.changeOrderId,
        p_decision: data.decision,
        p_notes: data.notes,
        p_user_agent: str((context as ServerContext).claims?.user_agent),
      },
    );
    if (error) throw new Error(error.message);
    return { ok: true, approvalId: approvalId as string };
  });
