import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  BillingApplicationEventRow,
  BillingInvoiceRow,
  BillingStatus,
  COStatus,
  COType,
  PaymentLedgerRow,
} from "@/lib/projects.functions";
import type { BillingLineItemRow } from "@/lib/billing.functions";

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

export interface ClientPortalDailyReportAttachment {
  name: string;
  path: string;
  type: string;
}

export interface ClientPortalDailyReport {
  id: string;
  project_id: string;
  report_date: string;
  author: string;
  weather: string;
  crew_count: number;
  manpower: string;
  work_performed: string;
  delays: string;
  safety_notes: string;
  visitors: string;
  quality_notes: string;
  notes: string;
  attachments: ClientPortalDailyReportAttachment[];
  client_visible: boolean;
}

export interface ClientPortalBillingApplication {
  id: string;
  project_id: string;
  application_number: string;
  invoice_number: string;
  submitted_date: string | null;
  due_date: string | null;
  billing_period: string;
  contract_amount: number;
  change_order_amount: number;
  amount_billed: number;
  paid_to_date: number;
  retainage: number;
  status: BillingStatus;
  notes: string;
  sort_order: number;
  status_events: BillingApplicationEventRow[];
  line_items: BillingLineItemRow[];
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

export interface ClientPortalPermissions {
  canViewChangeOrders: boolean;
  canViewDailyReports: boolean;
  canViewBilling: boolean;
}

const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
const bool = (v: unknown, d = false) => (typeof v === "boolean" ? v : d);
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const rows = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v as Record<string, unknown>[]) : [];

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

type SupabaseResult<T = unknown> = {
  data: T;
  error: { message?: string; code?: string } | null;
};

type SupabaseQuery = PromiseLike<SupabaseResult> & {
  select: (...args: unknown[]) => SupabaseQuery;
  insert: (...args: unknown[]) => SupabaseQuery;
  update: (...args: unknown[]) => SupabaseQuery;
  upsert: (...args: unknown[]) => SupabaseQuery;
  delete: (...args: unknown[]) => SupabaseQuery;
  eq: (...args: unknown[]) => SupabaseQuery;
  neq: (...args: unknown[]) => SupabaseQuery;
  ilike: (...args: unknown[]) => SupabaseQuery;
  in: (...args: unknown[]) => SupabaseQuery;
  order: (...args: unknown[]) => SupabaseQuery;
  limit: (...args: unknown[]) => SupabaseQuery;
  single: (...args: unknown[]) => Promise<SupabaseResult>;
  maybeSingle: (...args: unknown[]) => Promise<SupabaseResult>;
};

type SupabaseLike = {
  from: (relation: string) => SupabaseQuery;
  rpc: (functionName: string, args?: Record<string, unknown>) => Promise<SupabaseResult>;
};

function db(context: ServerContext) {
  return context.supabase as SupabaseLike;
}

function isMissingRpcError(error: unknown) {
  const message = str((error as { message?: unknown })?.message);
  const code = str((error as { code?: unknown })?.code);
  return (
    code === "PGRST202" ||
    /schema cache|could not find the function|function .* does not exist/i.test(message)
  );
}

function isMissingBillingApplicationsError(error: unknown) {
  const message = str((error as { message?: unknown })?.message);
  const code = str((error as { code?: unknown })?.code);
  return (
    code === "PGRST205" ||
    /billing_applications|schema cache|could not find the table/i.test(message)
  );
}

function isMissingBillingApplicationEventsError(error: unknown) {
  const message = str((error as { message?: unknown })?.message);
  const code = str((error as { code?: unknown })?.code);
  return (
    code === "PGRST205" ||
    /billing_application_events|schema cache|could not find the table/i.test(message)
  );
}

function isMissingBillingInvoicesError(error: unknown) {
  const message = str((error as { message?: unknown })?.message);
  const code = str((error as { code?: unknown })?.code);
  return (
    code === "PGRST205" || /billing_invoices|schema cache|could not find the table/i.test(message)
  );
}

function isMissingPaymentLedgerError(error: unknown) {
  const message = str((error as { message?: unknown })?.message);
  const code = str((error as { code?: unknown })?.code);
  return (
    code === "PGRST205" || /payment_ledger|schema cache|could not find the table/i.test(message)
  );
}

function isMissingBillingLineItemsError(error: unknown) {
  const message = str((error as { message?: unknown })?.message);
  const code = str((error as { code?: unknown })?.code);
  return (
    code === "PGRST205" || /billing_line_items|schema cache|could not find the table/i.test(message)
  );
}

async function readClientModuleAccess(
  context: ServerContext,
  functionName: string,
  projectId: string,
  fallback: boolean,
) {
  const { data, error } = await db(context).rpc(functionName, { p_project_id: projectId });
  if (error) {
    if (isMissingRpcError(error)) return fallback;
    throw new Error(error.message);
  }
  return Boolean(data);
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

function normalizeDailyAttachment(row: unknown): ClientPortalDailyReportAttachment | null {
  if (typeof row !== "object" || row === null || Array.isArray(row)) return null;
  const item = row as Record<string, unknown>;
  const path = str(item.path).trim();
  if (!path) return null;
  return {
    name: str(item.name, "Daily report attachment"),
    path,
    type: str(item.type, "application/octet-stream"),
  };
}

function normalizeDailyReport(row: Record<string, unknown>): ClientPortalDailyReport {
  const manifest = Array.isArray(row.attachment_manifest)
    ? row.attachment_manifest
        .map((item) => normalizeDailyAttachment(item))
        .filter((item): item is ClientPortalDailyReportAttachment => Boolean(item))
    : [];
  const legacyAttachment =
    manifest.length === 0 && str(row.attachment_path).trim()
      ? [
          {
            name: str(row.attachment_name, "Daily report attachment"),
            path: str(row.attachment_path),
            type: str(row.attachment_type, "application/octet-stream"),
          },
        ]
      : [];

  return {
    id: row.id as string,
    project_id: row.project_id as string,
    report_date: str(row.report_date),
    author: str(row.author),
    weather: str(row.weather),
    crew_count: num(row.crew_count),
    manpower: str(row.manpower),
    work_performed: str(row.work_performed),
    delays: str(row.delays),
    safety_notes: str(row.safety_notes),
    visitors: str(row.visitors),
    quality_notes: str(row.quality_notes),
    notes: str(row.notes),
    attachments: manifest.length > 0 ? manifest : legacyAttachment,
    client_visible: bool(row.client_visible),
  };
}

function normalizeBillingApplication(row: Record<string, unknown>): ClientPortalBillingApplication {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    application_number: str(row.application_number),
    invoice_number: str(row.invoice_number),
    submitted_date: (row.submitted_date as string | null) ?? null,
    due_date: (row.due_date as string | null) ?? null,
    billing_period: str(row.billing_period),
    contract_amount: num(row.contract_amount),
    change_order_amount: num(row.change_order_amount),
    amount_billed: num(row.amount_billed),
    paid_to_date: num(row.paid_to_date),
    retainage: num(row.retainage),
    status: str(row.status, "draft") as BillingStatus,
    notes: str(row.notes),
    sort_order: num(row.sort_order),
    status_events: [],
    line_items: [],
  };
}

function normalizeBillingLineItem(row: Record<string, unknown>): BillingLineItemRow {
  return {
    id: row.id as string,
    billing_application_id: row.billing_application_id as string,
    project_id: row.project_id as string,
    cost_bucket_id: (row.cost_bucket_id as string | null) ?? null,
    cost_code: str(row.cost_code),
    description: str(row.description),
    billing_method: str(row.billing_method, "percent") as BillingLineItemRow["billing_method"],
    scheduled_value_cents: num(row.scheduled_value_cents),
    change_order_value_cents: num(row.change_order_value_cents),
    work_completed_previous_cents: num(row.work_completed_previous_cents),
    materials_stored_previous_cents: num(row.materials_stored_previous_cents),
    work_completed_this_period_cents: num(row.work_completed_this_period_cents),
    materials_stored_this_period_cents: num(row.materials_stored_this_period_cents),
    work_completed_to_date_cents: num(row.work_completed_to_date_cents),
    materials_stored_to_date_cents: num(row.materials_stored_to_date_cents),
    total_completed_and_stored_cents: num(row.total_completed_and_stored_cents),
    billing_percent_complete: num(row.billing_percent_complete),
    balance_to_finish_cents: num(row.balance_to_finish_cents),
    retainage_pct: num(row.retainage_pct),
    retainage_held_cents: num(row.retainage_held_cents),
    retainage_released_cents: num(row.retainage_released_cents),
    sort_order: num(row.sort_order),
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
  };
}

function normalizeBillingApplicationEvent(
  row: Record<string, unknown>,
): BillingApplicationEventRow {
  return {
    id: row.id as string,
    billing_application_id: row.billing_application_id as string,
    project_id: row.project_id as string,
    event_type: str(row.event_type, "status_change"),
    from_status: str(row.from_status),
    to_status: str(row.to_status),
    amount: num(row.amount),
    notes: str(row.notes),
    created_by: (row.created_by as string | null) ?? null,
    created_at: str(row.created_at),
  };
}

function normalizePaymentLedger(row: Record<string, unknown>): PaymentLedgerRow {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    invoice_id: row.invoice_id as string,
    billing_application_id: (row.billing_application_id as string | null) ?? null,
    amount: num(row.amount),
    processor_fee: num(row.processor_fee),
    overwatch_fee: num(row.overwatch_fee),
    net_payout: num(row.net_payout),
    payment_method: str(row.payment_method, "manual"),
    processor: str(row.processor, "manual"),
    processor_payment_id: str(row.processor_payment_id),
    stripe_checkout_session_id: str(row.stripe_checkout_session_id),
    stripe_payment_intent_id: str(row.stripe_payment_intent_id),
    stripe_charge_id: str(row.stripe_charge_id),
    receipt_url: str(row.receipt_url),
    status: str(row.status, "succeeded") as PaymentLedgerRow["status"],
    paid_at: str(row.paid_at),
    notes: str(row.notes),
    reference: str(row.reference),
    created_by: (row.created_by as string | null) ?? null,
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
  };
}

function normalizeBillingInvoice(row: Record<string, unknown>): BillingInvoiceRow {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    billing_application_id: (row.billing_application_id as string | null) ?? null,
    invoice_number: str(row.invoice_number),
    title: str(row.title),
    issue_date: (row.issue_date as string | null) ?? null,
    due_date: (row.due_date as string | null) ?? null,
    subtotal: num(row.subtotal),
    retainage: num(row.retainage),
    total_due: num(row.total_due),
    paid_amount: num(row.paid_amount),
    status: str(row.status, "draft") as BillingInvoiceRow["status"],
    client_visible: bool(row.client_visible),
    payment_enabled: bool(row.payment_enabled),
    payment_url: str(row.payment_url),
    stripe_checkout_session_id: str(row.stripe_checkout_session_id),
    stripe_payment_intent_id: str(row.stripe_payment_intent_id),
    online_payment_status: str(
      row.online_payment_status,
      "not_enabled",
    ) as BillingInvoiceRow["online_payment_status"],
    payment_link_sent_at: (row.payment_link_sent_at as string | null) ?? null,
    sent_at: (row.sent_at as string | null) ?? null,
    paid_at: (row.paid_at as string | null) ?? null,
    notes: str(row.notes),
    enabled_payment_methods:
      row.enabled_payment_methods && typeof row.enabled_payment_methods === "object"
        ? (row.enabled_payment_methods as Record<string, boolean>)
        : {},
    payment_events: [],
    sent_recipients: Array.isArray(row.sent_recipients) ? (row.sent_recipients as string[]) : [],
    first_viewed_at: (row.first_viewed_at as string | null) ?? null,
    last_viewed_at: (row.last_viewed_at as string | null) ?? null,
    view_count: num(row.view_count),
    collections_log: str(row.collections_log),
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
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
  const project = record(data);
  if (!project.organization_id) throw new Error("This project is missing an Overwatch company.");
  return project as Record<string, unknown> & { organization_id: string };
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
      contacts: rows(contactsRes.data).map((row) => normalizeContact(row)),
      access: rows(accessRes.data).map((row) => normalizeAccess(row)),
      changeOrders: rows(changeOrdersRes.data).map((row) => normalizeChangeOrder(row)),
      approvals: rows(approvalsRes.data).map((row) => normalizeApproval(row)),
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
    const existingContact = existing ? record(existing) : null;

    const query = existingContact
      ? db(context).from("client_contacts").update(payload).eq("id", existingContact.id)
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
    const contactRow = record(contact);
    if (!contactRow.id || contactRow.organization_id !== project.organization_id) {
      throw new Error("This client contact does not belong to the project team.");
    }

    const email = str(contactRow.email).trim().toLowerCase();
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
    const existingAccess = existing ? record(existing) : null;

    const query = existingAccess
      ? db(context).from("project_client_access").update(payload).eq("id", existingAccess.id)
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
    const accessRow = record(access);
    await requireCanManageProject(context as ServerContext, accessRow.project_id as string);

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
    const accessRow = record(access);
    await requireCanManageProject(context as ServerContext, accessRow.project_id as string);

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
    const changeOrderRow = record(co);
    await requireCanManageProject(context as ServerContext, changeOrderRow.project_id as string);

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

export interface ClientInvoiceRemittance {
  bankName: string;
  routingNumber: string;
  accountNumber: string;
  wireInstructions: string;
  memo: string;
}

export interface ClientInvoicePaymentOptions {
  invoiceId: string;
  /** Direct bank transfer details, present when enabled for this invoice. */
  remittance: ClientInvoiceRemittance | null;
  /** Stripe methods the client can start right now (guardrail applied). */
  card: boolean;
  achDebit: boolean;
}

/**
 * Per-invoice "How to pay" data for the client portal. Runs with the admin
 * client because portal clients cannot (and must not) read
 * organization_payment_profiles or organizations directly: exposure is scoped
 * here to exactly the invoices the client already passed RLS for, and only
 * when the contractor turned the method on for that invoice.
 */
async function buildClientPaymentOptions(
  invoices: BillingInvoiceRow[],
  organizationId: string | null,
): Promise<ClientInvoicePaymentOptions[]> {
  if (!organizationId || invoices.length === 0) return [];

  let admin: unknown;
  let domain: typeof import("@/lib/payments-domain");
  try {
    // Dynamic imports keep server-only credentials out of the client bundle.
    const stripeServer = await import("@/lib/stripe.server");
    domain = await import("@/lib/payments-domain");
    admin = stripeServer.createSupabaseAdminClient();
  } catch {
    // Admin credentials not configured: portal falls back to legacy
    // payment_url buttons only.
    return [];
  }

  const from = (relation: string) => (admin as SupabaseLike).from(relation);

  const [profileRes, orgRes] = await Promise.all([
    from("organization_payment_profiles")
      .select(
        "bank_name,routing_number,account_number,wire_instructions,remittance_memo_template,default_payment_methods,stripe_amount_threshold_cents",
      )
      .eq("organization_id", organizationId)
      .maybeSingle(),
    from("organizations")
      .select("stripe_connect_account_id,stripe_connect_status,payment_processor_ready")
      .eq("id", organizationId)
      .maybeSingle(),
  ]);
  // Pre-migration or missing rows: no profile, no direct-bank block.
  const profile = profileRes.error ? null : (profileRes.data as Record<string, unknown> | null);
  const org = orgRes.error ? null : (orgRes.data as Record<string, unknown> | null);

  const hasBankDetails = Boolean(
    profile && profile.bank_name && profile.routing_number && profile.account_number,
  );
  const stripeReady = domain.stripeConnectReady({
    accountId: str(org?.stripe_connect_account_id),
    connectStatus: str(org?.stripe_connect_status, "not_connected"),
    processorReady: bool(org?.payment_processor_ready),
  });
  const thresholdCents = num(profile?.stripe_amount_threshold_cents);

  return invoices
    .filter((invoice) => invoice.status !== "void" && invoice.status !== "draft")
    .map((invoice) => {
      const enabled = domain.resolveEnabledMethods(
        invoice.enabled_payment_methods,
        profile?.default_payment_methods ?? null,
      );
      const availability = domain.methodAvailability({
        hasPaymentProfile: hasBankDetails,
        stripeReady,
        enabled,
        invoiceTotalCents: domain.dollarsToCents(invoice.total_due),
        thresholdCents,
      });
      return {
        invoiceId: invoice.id,
        remittance: availability.direct_bank.available
          ? {
              bankName: str(profile?.bank_name),
              routingNumber: str(profile?.routing_number),
              accountNumber: str(profile?.account_number),
              wireInstructions: str(profile?.wire_instructions),
              memo: domain.renderRemittanceMemo(
                str(profile?.remittance_memo_template),
                invoice.invoice_number,
              ),
            }
          : null,
        card: availability.card.available,
        achDebit: availability.ach_debit.available,
      };
    });
}

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
    const clientCanReadProject = Boolean(clientAccessRes.data);
    const internalCanReadProject = Boolean(internalAccessRes.data);
    if (!clientCanReadProject && !internalCanReadProject) {
      throw new Error("You do not have client access to this project.");
    }

    const [canViewChangeOrders, canViewDailyReports, canViewBilling] = internalCanReadProject
      ? [true, true, true]
      : await Promise.all([
          readClientModuleAccess(
            context as ServerContext,
            "can_view_client_change_orders",
            data.projectId,
            clientCanReadProject,
          ),
          readClientModuleAccess(
            context as ServerContext,
            "can_view_client_daily_reports",
            data.projectId,
            false,
          ),
          readClientModuleAccess(
            context as ServerContext,
            "can_view_client_billing",
            data.projectId,
            false,
          ),
        ]);

    const [
      projectRes,
      changeOrdersRes,
      approvalsRes,
      billingApplicationsRes,
      billingEventsRes,
      billingInvoicesRes,
      paymentLedgerRes,
      dailyReportsRes,
    ] = await Promise.all([
      db(context)
        .from("projects")
        .select(
          "id,organization_id,name,client,job_number,project_manager,baseline_completion_date,forecast_completion_date,percent_complete",
        )
        .eq("id", data.projectId)
        .single(),
      canViewChangeOrders
        ? db(context)
            .from("change_orders")
            .select("*")
            .eq("project_id", data.projectId)
            .eq("client_visible", true)
            .order("number")
        : Promise.resolve({ data: [], error: null }),
      canViewChangeOrders
        ? db(context)
            .from("change_order_approvals")
            .select("*")
            .eq("project_id", data.projectId)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      canViewBilling
        ? db(context)
            .from("billing_applications")
            .select("*")
            .eq("project_id", data.projectId)
            .order("sort_order")
        : Promise.resolve({ data: [], error: null }),
      canViewBilling
        ? db(context)
            .from("billing_application_events")
            .select("*")
            .eq("project_id", data.projectId)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      canViewBilling
        ? db(context)
            .from("billing_invoices")
            .select("*")
            .eq("project_id", data.projectId)
            .order("issue_date", { ascending: false, nullsFirst: false })
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      canViewBilling
        ? db(context)
            .from("payment_ledger")
            .select("*")
            .eq("project_id", data.projectId)
            .order("paid_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      canViewDailyReports
        ? db(context)
            .from("daily_reports")
            .select("*")
            .eq("project_id", data.projectId)
            .eq("client_visible", true)
            .order("report_date", { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (projectRes.error) throw new Error(projectRes.error.message);
    if (changeOrdersRes.error) throw new Error(changeOrdersRes.error.message);
    if (approvalsRes.error) throw new Error(approvalsRes.error.message);
    if (
      billingApplicationsRes.error &&
      !isMissingBillingApplicationsError(billingApplicationsRes.error)
    ) {
      throw new Error(billingApplicationsRes.error.message);
    }
    if (billingEventsRes.error && !isMissingBillingApplicationEventsError(billingEventsRes.error)) {
      throw new Error(billingEventsRes.error.message);
    }
    if (billingInvoicesRes.error && !isMissingBillingInvoicesError(billingInvoicesRes.error)) {
      throw new Error(billingInvoicesRes.error.message);
    }
    if (paymentLedgerRes.error && !isMissingPaymentLedgerError(paymentLedgerRes.error)) {
      throw new Error(paymentLedgerRes.error.message);
    }
    if (dailyReportsRes.error) throw new Error(dailyReportsRes.error.message);

    const billingEvents = billingEventsRes.error
      ? []
      : rows(billingEventsRes.data).map((row) => normalizeBillingApplicationEvent(row));
    const billingEventsByApplication = new Map<string, BillingApplicationEventRow[]>();
    billingEvents.forEach((event: BillingApplicationEventRow) => {
      const existing = billingEventsByApplication.get(event.billing_application_id) ?? [];
      existing.push(event);
      billingEventsByApplication.set(event.billing_application_id, existing);
    });
    const paymentEvents = paymentLedgerRes.error
      ? []
      : rows(paymentLedgerRes.data).map((row) => normalizePaymentLedger(row));
    const paymentsByInvoice = new Map<string, PaymentLedgerRow[]>();
    paymentEvents.forEach((payment: PaymentLedgerRow) => {
      const existing = paymentsByInvoice.get(payment.invoice_id) ?? [];
      existing.push(payment);
      paymentsByInvoice.set(payment.invoice_id, existing);
    });
    const normalizedBillingApplications = billingApplicationsRes.error
      ? []
      : rows(billingApplicationsRes.data).map((row) => normalizeBillingApplication(row));
    const lineItemsByApplication = new Map<string, BillingLineItemRow[]>();
    if (canViewBilling && normalizedBillingApplications.length > 0) {
      const lineItemsRes = await db(context)
        .from("billing_line_items")
        .select("*")
        .eq("project_id", data.projectId)
        .in(
          "billing_application_id",
          normalizedBillingApplications.map((app: ClientPortalBillingApplication) => app.id),
        )
        .order("sort_order");
      if (lineItemsRes.error && !isMissingBillingLineItemsError(lineItemsRes.error)) {
        throw new Error(lineItemsRes.error.message);
      }
      if (!lineItemsRes.error) {
        rows(lineItemsRes.data)
          .map((row) => normalizeBillingLineItem(row))
          .forEach((line: BillingLineItemRow) => {
            const existing = lineItemsByApplication.get(line.billing_application_id) ?? [];
            existing.push(line);
            lineItemsByApplication.set(line.billing_application_id, existing);
          });
      }
    }

    const clientInvoices = billingInvoicesRes.error
      ? []
      : rows(billingInvoicesRes.data).map((row) => normalizeBillingInvoice(row));
    const invoicePaymentOptions = canViewBilling
      ? await buildClientPaymentOptions(
          clientInvoices,
          str((projectRes.data as Record<string, unknown>)?.organization_id) || null,
        )
      : [];

    return {
      project: normalizeClientProject(projectRes.data as Record<string, unknown>),
      changeOrders: rows(changeOrdersRes.data).map((row) => normalizeChangeOrder(row)),
      approvals: rows(approvalsRes.data).map((row) => normalizeApproval(row)),
      billingApplications: normalizedBillingApplications.map(
        (app: ClientPortalBillingApplication) => ({
          ...app,
          status_events: billingEventsByApplication.get(app.id) ?? [],
          line_items: lineItemsByApplication.get(app.id) ?? [],
        }),
      ),
      billingInvoices: clientInvoices.map((invoice) => ({
        ...invoice,
        payment_events: paymentsByInvoice.get(invoice.id) ?? [],
      })),
      invoicePaymentOptions,
      dailyReports: rows(dailyReportsRes.data).map((row) => normalizeDailyReport(row)),
      portalPermissions: {
        canViewChangeOrders,
        canViewDailyReports,
        canViewBilling,
      } satisfies ClientPortalPermissions,
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

/**
 * Lightweight viewed signal (GETTINGPAID1): when a CLIENT portal user opens
 * an invoice detail, stamp it server-side. Not an email pixel — the portal
 * open is the event. Internal team views are never recorded, so "viewed"
 * on the cockpit always means the client saw it. Best-effort by design: it
 * silently no-ops until the tracking migration is applied.
 */
export const recordInvoicePortalView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { invoiceId: string }) =>
    z.object({ invoiceId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const invoiceRes = await db(context)
      .from("billing_invoices")
      .select("id,project_id,client_visible")
      .eq("id", data.invoiceId)
      .maybeSingle();
    if (invoiceRes.error || !invoiceRes.data) return { ok: true, recorded: false };
    const invoice = invoiceRes.data as Record<string, unknown>;
    if (!bool(invoice.client_visible)) return { ok: true, recorded: false };

    const projectId = String(invoice.project_id);
    const [clientBillingRes, internalRes] = await Promise.all([
      db(context).rpc("can_view_client_billing", { p_project_id: projectId }),
      db(context).rpc("can_read_project", { p_project_id: projectId }),
    ]);
    // Only genuine client views count; the team opening its own invoice is
    // not a "client viewed it" signal.
    if (clientBillingRes.error || !clientBillingRes.data) return { ok: true, recorded: false };
    if (!internalRes.error && internalRes.data) return { ok: true, recorded: false };

    try {
      const stripeServer = await import("@/lib/stripe.server");
      const admin = stripeServer.createSupabaseAdminClient() as unknown as SupabaseLike;
      const currentRes = await admin
        .from("billing_invoices")
        .select("first_viewed_at,view_count")
        .eq("id", data.invoiceId)
        .maybeSingle();
      if (currentRes.error) return { ok: true, recorded: false };
      const current = (currentRes.data ?? {}) as Record<string, unknown>;
      const nowIso = new Date().toISOString();
      const updateRes = await admin
        .from("billing_invoices")
        .update({
          first_viewed_at: (current.first_viewed_at as string | null) ?? nowIso,
          last_viewed_at: nowIso,
          view_count: num(current.view_count) + 1,
        })
        .eq("id", data.invoiceId);
      return { ok: true, recorded: !updateRes.error };
    } catch {
      // Admin credentials or tracking columns unavailable: the viewed signal
      // simply stays off — never break the portal for it.
      return { ok: true, recorded: false };
    }
  });
