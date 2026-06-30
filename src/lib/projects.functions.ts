import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { normalizeBillingNumberLabel } from "@/lib/billing-labels";
import { COMPANY_ASSET_BUCKET, companyLogoPath, versionAssetUrl } from "@/lib/company-assets";
import {
  computeRollup,
  computeScheduleVarianceWeeks,
  evaluateWarnings,
  guidanceTargets,
  exposureByCategory,
  exposureAging,
  remainingExposureValue,
  type Phase,
  type Rollup,
  type Warning,
  type ExposureCategory,
  type ResponsePath,
  type HoldClass,
  type ExposureStatus,
} from "@/lib/ior";

type DynamicSupabaseError = { code?: string; message: string };
type DynamicSupabaseLooseData = Record<string, unknown> & Record<string, unknown>[];
type DynamicSupabaseResult<T = DynamicSupabaseLooseData> = {
  data: T | null;
  error: DynamicSupabaseError | null;
};
type DynamicSupabaseQuery = PromiseLike<DynamicSupabaseResult> & {
  select(columns?: string): DynamicSupabaseQuery;
  insert(values: unknown): DynamicSupabaseQuery;
  update(values: unknown): DynamicSupabaseQuery;
  delete(): DynamicSupabaseQuery;
  upsert(values: unknown, options?: { onConflict?: string }): DynamicSupabaseQuery;
  in(column: string, values: readonly string[]): Promise<DynamicSupabaseResult<unknown[]>>;
  eq(column: string, value: unknown): DynamicSupabaseQuery;
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
};

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as DynamicSupabaseClient).from(relation);

export type COStatus = "Approved" | "Pending" | "Denied";
export type DecisionStatus = "open" | "in_progress" | "resolved" | "overdue";
export type ClientChangeOrderStatus = "not_sent" | "sent" | "approved" | "rejected";

export interface ProjectRow {
  id: string;
  organization_id: string | null;
  organization_name: string;
  organization_logo_url: string;
  job_number: string;
  name: string;
  client: string;
  original_contract: number;
  original_cost_budget: number;
  default_retainage_pct: number;
  schedule_variance_weeks: number;
  phase: Phase;
  percent_complete: number;
  hold_variance_note: string;
  last_reviewed_at: string | null;
  next_review_at: string | null;
  forecast_completion_date: string | null;
  baseline_completion_date: string | null;
  last_review_summary: string;
  project_manager: string;
  source_opportunity_id: string | null;
}

export interface ExposureRow {
  id: string;
  project_id: string;
  title: string;
  description: string;
  category: ExposureCategory;
  dollar_exposure: number;
  probability: number;
  schedule_impact_weeks: number | null;
  owner: string;
  response_path: ResponsePath;
  release_condition: string;
  released_amount: number;
  release_note: string;
  release_updated_at: string | null;
  hold_class: HoldClass;
  status: ExposureStatus;
  due_date: string | null;
  next_review_at: string | null;
  opened_at: string;
  resolved_at: string | null;
  notes: string;
}

export type COType =
  | "owner_change"
  | "design_error"
  | "design_omission"
  | "unforeseen_condition"
  | "missed_scope"
  | "sub_issued"
  | "other";

export interface ChangeOrderRow {
  id: string;
  project_id: string;
  number: string;
  description: string;
  contract_amount: number;
  cost_amount: number;
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

export interface BucketRow {
  id: string;
  project_id: string;
  cost_code: string;
  bucket: string;
  original_budget: number;
  actual_to_date: number;
  ftc: number;
  sort_order: number;
  source_type: "original_sov" | "change_order" | "added_cost";
  source_date: string | null;
  source_note: string;
  retainage_pct: number;
  billing_method: "percent" | "unit" | "material";
  contract_quantity: number;
  unit: string;
  earned_percent_complete: number;
}

export interface SovImportRow {
  id: string;
  project_id: string;
  imported_by: string | null;
  mode: "replace" | "append";
  source_type: string;
  source_name: string;
  source_sheet: string;
  profile: string;
  confidence: "high" | "medium" | "low" | "unknown";
  has_header: boolean;
  raw_rows: number;
  staged_rows: number;
  inserted_count: number;
  updated_count: number;
  skipped_count: number;
  merged_rows: number;
  total_budget: number;
  original_cost_budget: number;
  selected_budget_column: number | null;
  selected_budget_label: string;
  column_map: Json;
  amount_choices: Json;
  warnings: Json;
  created_at: string;
}

export interface SovMappingProfileRow {
  id: string;
  organization_id: string;
  created_by: string | null;
  name: string;
  normalized_name: string;
  source_type: string;
  source_sheet: string;
  profile: string;
  confidence: "high" | "medium" | "low" | "unknown";
  has_header: boolean;
  column_map: Json;
  selected_budget_column: number | null;
  selected_budget_label: string;
  sample_headers: Json;
  amount_choices: Json;
  warnings: Json;
  last_used_at: string | null;
  use_count: number;
  created_at: string;
  updated_at: string;
}

export type BillingStatus = "draft" | "submitted" | "paid" | "partial" | "rejected";

export interface BillingApplicationRow {
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
  has_line_detail: boolean;
  total_retainage_held: number;
  retainage_released_this_period: number;
  status: BillingStatus;
  notes: string;
  sort_order: number;
  status_events: BillingApplicationEventRow[];
}

export interface BillingApplicationEventRow {
  id: string;
  billing_application_id: string;
  project_id: string;
  event_type: string;
  from_status: string;
  to_status: string;
  amount: number;
  notes: string;
  created_by: string | null;
  created_at: string;
}

export type InvoiceStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "void";

export type PaymentStatus = "pending" | "succeeded" | "failed" | "refunded" | "void";
export type OnlinePaymentStatus =
  | "not_enabled"
  | "pending"
  | "paid"
  | "expired"
  | "failed"
  | "refunded";

export interface BillingInvoiceRow {
  id: string;
  project_id: string;
  billing_application_id: string | null;
  invoice_number: string;
  title: string;
  issue_date: string | null;
  due_date: string | null;
  subtotal: number;
  retainage: number;
  total_due: number;
  paid_amount: number;
  status: InvoiceStatus;
  client_visible: boolean;
  payment_enabled: boolean;
  payment_url: string;
  stripe_checkout_session_id: string;
  stripe_payment_intent_id: string;
  online_payment_status: OnlinePaymentStatus;
  payment_link_sent_at: string | null;
  sent_at: string | null;
  paid_at: string | null;
  notes: string;
  payment_events: PaymentLedgerRow[];
  created_at: string;
  updated_at: string;
}

export interface PaymentLedgerRow {
  id: string;
  project_id: string;
  invoice_id: string;
  billing_application_id: string | null;
  amount: number;
  processor_fee: number;
  overwatch_fee: number;
  net_payout: number;
  payment_method: string;
  processor: string;
  processor_payment_id: string;
  stripe_checkout_session_id: string;
  stripe_payment_intent_id: string;
  stripe_charge_id: string;
  receipt_url: string;
  status: PaymentStatus;
  paid_at: string;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DecisionRow {
  id: string;
  project_id: string;
  decision: string;
  impact: string;
  owner: string;
  due_date: string | null;
  status: DecisionStatus;
  linked_exposure_id: string | null;
  linked_co_id: string | null;
  notes: string;
}

export interface ReviewRow {
  id: string;
  project_id: string;
  reviewed_at: string;
  reviewer: string;
  forecast_completion_date_before: string | null;
  forecast_completion_date_after: string | null;
  summary_notes: string;
  body_markdown: string;
  status: string;
  email_recipients: string[];
  pdf_style: string;
  kpi_snapshot: Json;
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);

type SupabaseWithStorage = {
  storage: {
    from: (bucket: string) => {
      getPublicUrl: (path: string) => { data: { publicUrl: string } };
    };
  };
};

function organizationLogoUrl(
  supabase: unknown,
  organization: { id?: unknown; logo_url?: unknown; updated_at?: unknown },
) {
  const storedLogoUrl = str(organization.logo_url);
  if (storedLogoUrl) return storedLogoUrl;

  const organizationId = str(organization.id);
  if (!organizationId) return "";

  const { data } = (supabase as SupabaseWithStorage).storage
    .from(COMPANY_ASSET_BUCKET)
    .getPublicUrl(companyLogoPath(organizationId));
  return versionAssetUrl(data.publicUrl, str(organization.updated_at));
}

const normalizeSovMappingProfile = (row: Record<string, unknown>): SovMappingProfileRow => ({
  id: row.id as string,
  organization_id: row.organization_id as string,
  created_by: (row.created_by as string | null) ?? null,
  name: str(row.name),
  normalized_name: str(row.normalized_name),
  source_type: str(row.source_type),
  source_sheet: str(row.source_sheet),
  profile: str(row.profile),
  confidence: str(row.confidence, "unknown") as SovMappingProfileRow["confidence"],
  has_header: Boolean(row.has_header ?? true),
  column_map: (row.column_map ?? {}) as Json,
  selected_budget_column:
    row.selected_budget_column == null ? null : num(row.selected_budget_column),
  selected_budget_label: str(row.selected_budget_label),
  sample_headers: (row.sample_headers ?? []) as Json,
  amount_choices: (row.amount_choices ?? []) as Json,
  warnings: (row.warnings ?? []) as Json,
  last_used_at: (row.last_used_at as string | null) ?? null,
  use_count: num(row.use_count),
  created_at: str(row.created_at),
  updated_at: str(row.updated_at),
});

const isMissingRestColumn = (error: { code?: string; message?: string } | null, column: string) => {
  const message = (error?.message ?? "").toLowerCase();
  const target = column.toLowerCase();
  return (
    (error?.code === "PGRST204" && message.includes(`'${target}' column`)) ||
    message.includes(`column ${target} does not exist`) ||
    message.includes(`.${target} does not exist`)
  );
};

const isMissingRestRelation = (
  error: { code?: string; message?: string } | null,
  relation: string,
) => {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST205" &&
    (message.includes(`'public.${relation}'`) ||
      message.includes(`'${relation}'`) ||
      message.includes("schema cache"))
  );
};

const PROJECT_METADATA_MIGRATION = "20260622140000_project_metadata_hardening.sql";
const PROJECT_METADATA_COLUMNS = [
  "job_number",
  "project_manager",
  "baseline_completion_date",
  "forecast_completion_date",
  "schedule_variance_weeks",
  "hold_variance_note",
] as const;

const cleanOptionalDate = (value: string | null | undefined) =>
  value && value.trim() ? value : null;

const projectSchemaError = (column: string) =>
  `Supabase schema is missing public.projects.${column}. Apply ${PROJECT_METADATA_MIGRATION} and refresh the Supabase schema cache before saving project metadata.`;

const throwIfProjectSchemaError = (error: { code?: string; message?: string } | null) => {
  for (const column of PROJECT_METADATA_COLUMNS) {
    if (isMissingRestColumn(error, column)) throw new Error(projectSchemaError(column));
  }
};

const normalizeProject = (p: Record<string, unknown>): ProjectRow => ({
  id: p.id as string,
  organization_id: (p.organization_id as string | null) ?? null,
  organization_name: str(p.organization_name),
  organization_logo_url: str(p.organization_logo_url),
  job_number: str(p.job_number),
  name: p.name as string,
  client: str(p.client),
  original_contract: num(p.original_contract),
  original_cost_budget: num(p.original_cost_budget),
  default_retainage_pct: num(p.default_retainage_pct ?? 10),
  schedule_variance_weeks: num(p.schedule_variance_weeks),
  phase: (p.phase as Phase) ?? "Early",
  percent_complete: num(p.percent_complete),
  hold_variance_note: str(p.hold_variance_note),
  last_reviewed_at: (p.last_reviewed_at as string | null) ?? null,
  next_review_at: (p.next_review_at as string | null) ?? null,
  forecast_completion_date: (p.forecast_completion_date as string | null) ?? null,
  baseline_completion_date: (p.baseline_completion_date as string | null) ?? null,
  last_review_summary: str(p.last_review_summary),
  project_manager: str(p.project_manager),
  source_opportunity_id: (p.source_opportunity_id as string | null) ?? null,
});

const normalizeBillingApplication = (b: Record<string, unknown>): BillingApplicationRow => ({
  id: b.id as string,
  project_id: b.project_id as string,
  application_number: normalizeBillingNumberLabel(str(b.application_number)),
  invoice_number: normalizeBillingNumberLabel(str(b.invoice_number)),
  submitted_date: (b.submitted_date as string | null) ?? null,
  due_date: (b.due_date as string | null) ?? null,
  billing_period: str(b.billing_period),
  contract_amount: num(b.contract_amount),
  change_order_amount: num(b.change_order_amount),
  amount_billed: num(b.amount_billed),
  paid_to_date: num(b.paid_to_date),
  retainage: num(b.retainage),
  has_line_detail: Boolean(b.has_line_detail ?? false),
  total_retainage_held: num(b.total_retainage_held),
  retainage_released_this_period: num(b.retainage_released_this_period),
  status: str(b.status, "draft") as BillingStatus,
  notes: str(b.notes),
  sort_order: num(b.sort_order),
  status_events: [],
});

const normalizeBillingApplicationEvent = (
  row: Record<string, unknown>,
): BillingApplicationEventRow => ({
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
});

const normalizePaymentLedger = (row: Record<string, unknown>): PaymentLedgerRow => ({
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
  status: str(row.status, "succeeded") as PaymentStatus,
  paid_at: str(row.paid_at, new Date().toISOString()),
  notes: str(row.notes),
  created_by: (row.created_by as string | null) ?? null,
  created_at: str(row.created_at),
  updated_at: str(row.updated_at),
});

const normalizeBillingInvoice = (row: Record<string, unknown>): BillingInvoiceRow => ({
  id: row.id as string,
  project_id: row.project_id as string,
  billing_application_id: (row.billing_application_id as string | null) ?? null,
  invoice_number: normalizeBillingNumberLabel(str(row.invoice_number)),
  title: normalizeBillingNumberLabel(str(row.title)),
  issue_date: (row.issue_date as string | null) ?? null,
  due_date: (row.due_date as string | null) ?? null,
  subtotal: num(row.subtotal),
  retainage: num(row.retainage),
  total_due: num(row.total_due),
  paid_amount: num(row.paid_amount),
  status: str(row.status, "draft") as InvoiceStatus,
  client_visible: Boolean(row.client_visible ?? false),
  payment_enabled: Boolean(row.payment_enabled ?? false),
  payment_url: str(row.payment_url),
  stripe_checkout_session_id: str(row.stripe_checkout_session_id),
  stripe_payment_intent_id: str(row.stripe_payment_intent_id),
  online_payment_status: str(row.online_payment_status, "not_enabled") as OnlinePaymentStatus,
  payment_link_sent_at: (row.payment_link_sent_at as string | null) ?? null,
  sent_at: (row.sent_at as string | null) ?? null,
  paid_at: (row.paid_at as string | null) ?? null,
  notes: str(row.notes),
  payment_events: [],
  created_at: str(row.created_at),
  updated_at: str(row.updated_at),
});

const normalizeExposure = (e: Record<string, unknown>): ExposureRow => ({
  id: e.id as string,
  project_id: e.project_id as string,
  title: str(e.title),
  description: str(e.description),
  category: (e.category as ExposureCategory) ?? "other",
  dollar_exposure: num(e.dollar_exposure),
  probability: num(e.probability),
  schedule_impact_weeks: e.schedule_impact_weeks == null ? null : num(e.schedule_impact_weeks),
  owner: str(e.owner),
  response_path: (e.response_path as ResponsePath) ?? "accept",
  release_condition: str(e.release_condition),
  released_amount: num(e.released_amount),
  release_note: str(e.release_note),
  release_updated_at: (e.release_updated_at as string | null) ?? null,
  hold_class: (e.hold_class as HoldClass) ?? "E-Hold",
  status: (e.status as ExposureStatus) ?? "active",
  due_date: (e.due_date as string | null) ?? null,
  next_review_at: (e.next_review_at as string | null) ?? null,
  opened_at: str(e.opened_at, new Date().toISOString()),
  resolved_at: (e.resolved_at as string | null) ?? null,
  notes: str(e.notes),
});

// ---------------- LIST + GET ----------------

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error: accountError } = await context.supabase.rpc("ensure_current_user_account");
    if (accountError) throw new Error(accountError.message);

    const { data: rawProjects, error } = await context.supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const projects = (rawProjects ?? []).map(normalizeProject);
    const ids = projects.map((p) => p.id);
    if (ids.length === 0) return [];
    const organizationIds = Array.from(
      new Set(projects.map((p) => p.organization_id).filter((id): id is string => Boolean(id))),
    );

    const [expRes, cosRes, bucketsRes, decisionsRes, organizationsRes] = await Promise.all([
      context.supabase.from("exposures").select("*").in("project_id", ids),
      context.supabase
        .from("change_orders")
        .select("project_id,contract_amount,cost_amount,status,probability")
        .in("project_id", ids),
      context.supabase
        .from("cost_buckets")
        .select("project_id,bucket,original_budget,actual_to_date,ftc")
        .in("project_id", ids),
      context.supabase
        .from("decisions")
        .select("project_id,decision,impact,owner,due_date,status,linked_exposure_id")
        .in("project_id", ids),
      organizationIds.length === 0
        ? { data: [], error: null }
        : dynamicTable(context.supabase, "organizations")
            .select("id,name,logo_url,updated_at")
            .in("id", organizationIds),
    ]);
    if (expRes.error) throw new Error(expRes.error.message);
    if (cosRes.error) throw new Error(cosRes.error.message);
    if (bucketsRes.error) throw new Error(bucketsRes.error.message);
    if (decisionsRes.error) throw new Error(decisionsRes.error.message);
    let organizationRows = (organizationsRes.data ?? []) as Record<string, unknown>[];
    if (organizationsRes.error) {
      if (!isMissingRestColumn(organizationsRes.error, "logo_url")) {
        throw new Error(organizationsRes.error.message);
      }
      const fallbackOrganizationsRes =
        organizationIds.length === 0
          ? { data: [], error: null }
          : await dynamicTable(context.supabase, "organizations")
              .select("id,name,updated_at")
              .in("id", organizationIds);
      if (fallbackOrganizationsRes.error) throw new Error(fallbackOrganizationsRes.error.message);
      organizationRows = (fallbackOrganizationsRes.data ?? []) as Record<string, unknown>[];
    }

    let dailyReportRows: Record<string, unknown>[] = [];
    const dailyReportsRes = await dynamicTable(context.supabase, "daily_reports")
      .select("project_id,report_date,client_visible")
      .in("project_id", ids);
    if (dailyReportsRes.error) {
      if (isMissingRestColumn(dailyReportsRes.error, "client_visible")) {
        const fallbackRes = await context.supabase
          .from("daily_reports")
          .select("project_id,report_date")
          .in("project_id", ids);
        if (fallbackRes.error && !isMissingRestRelation(fallbackRes.error, "daily_reports")) {
          throw new Error(fallbackRes.error.message);
        }
        dailyReportRows = (fallbackRes.data ?? []) as unknown[] as Record<string, unknown>[];
      } else if (!isMissingRestRelation(dailyReportsRes.error, "daily_reports")) {
        throw new Error(dailyReportsRes.error.message);
      }
    } else {
      dailyReportRows = (dailyReportsRes.data ?? []) as unknown[] as Record<string, unknown>[];
    }

    type Keyed = { project_id: string };
    const groupBy = <T extends Keyed>(rows: readonly unknown[]): Record<string, T[]> => {
      const m: Record<string, T[]> = {};
      for (const r of rows as T[]) (m[r.project_id] ||= []).push(r);
      return m;
    };
    const eByP = groupBy<{ project_id: string } & Record<string, unknown>>(expRes.data ?? []);
    const cByP = groupBy<{ project_id: string } & Record<string, unknown>>(cosRes.data ?? []);
    const bByP = groupBy<{ project_id: string } & Record<string, unknown>>(bucketsRes.data ?? []);
    const dByP = groupBy<{ project_id: string } & Record<string, unknown>>(decisionsRes.data ?? []);
    const drByP = groupBy<{ project_id: string } & Record<string, unknown>>(dailyReportRows);
    const organizationsById = new Map(
      organizationRows.map((organization) => {
        const organizationId = str(organization.id);
        return [
          organizationId,
          {
            name: str(organization.name),
            logo_url: organizationLogoUrl(context.supabase, organization),
          },
        ] as const;
      }),
    );

    return projects.map((p) => {
      const exposures = (eByP[p.id] ?? []).map((e) => ({
        title: str(e.title),
        category: (e.category as ExposureCategory) ?? "other",
        dollar_exposure: num(e.dollar_exposure),
        probability: num(e.probability),
        hold_class: (e.hold_class as HoldClass) ?? "E-Hold",
        status: (e.status as ExposureStatus) ?? "active",
        response_path: (e.response_path as ResponsePath) ?? "accept",
        released_amount: num(e.released_amount),
        owner: str(e.owner),
        opened_at: (e.opened_at as string | null) ?? null,
        next_review_at: (e.next_review_at as string | null) ?? null,
      }));
      const cos = (cByP[p.id] ?? []).map((c) => ({
        contract_amount: num(c.contract_amount),
        cost_amount: num(c.cost_amount),
        status: (c.status as COStatus) ?? "Pending",
        probability: num(c.probability),
      }));
      const buckets = (bByP[p.id] ?? []).map((b) => ({
        cost_code: str(b.cost_code),
        bucket: str(b.bucket),
        original_budget: num(b.original_budget),
        actual_to_date: num(b.actual_to_date),
        ftc: num(b.ftc),
      }));
      const r = computeRollup(p, buckets, cos, exposures);
      const warnings = evaluateWarnings(p, buckets, cos, exposures, r);
      const lastReview = p.last_reviewed_at ? new Date(p.last_reviewed_at).getTime() : null;
      const daysSinceReview = lastReview ? Math.floor((Date.now() - lastReview) / 86400000) : null;
      const topCat = exposureByCategory(exposures)[0]?.category ?? null;
      const liveExposures = exposures.filter(
        (e) => e.status === "active" || e.status === "escalated",
      );
      const topExposure =
        liveExposures.reduce<(typeof liveExposures)[number] | null>(
          (current, e) =>
            !current || remainingExposureValue(e) > remainingExposureValue(current) ? e : current,
          null,
        ) ?? null;
      const activeScheduleRiskCount = exposures.filter(
        (e) =>
          remainingExposureValue(e) > 0 &&
          (e.category === "schedule_compression" ||
            e.category === "procurement" ||
            e.category === "owner_decision"),
      ).length;
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const decisions = (dByP[p.id] ?? []).map((d) => ({
        decision: str(d.decision),
        impact: str(d.impact),
        owner: str(d.owner),
        due_date: (d.due_date as string | null) ?? null,
        status: (d.status as DecisionStatus) ?? "open",
        linked_exposure_id: (d.linked_exposure_id as string | null) ?? null,
      }));
      const activeDecisions = decisions.filter(
        (d) => d.status === "open" || d.status === "in_progress" || d.status === "overdue",
      );
      const overdueDecisions = activeDecisions.filter((d) => {
        if (d.status === "overdue") return true;
        if (!d.due_date) return false;
        return new Date(`${d.due_date}T00:00:00`).getTime() < todayStart.getTime();
      });
      const nextDecision = activeDecisions
        .filter((d) => d.due_date)
        .sort(
          (a, b) =>
            new Date(`${a.due_date}T00:00:00`).getTime() -
            new Date(`${b.due_date}T00:00:00`).getTime(),
        )[0];
      const dailyReports = drByP[p.id] ?? [];
      const lastDailyReportDate =
        dailyReports
          .map((report) => str(report.report_date))
          .filter(Boolean)
          .sort(
            (a, b) => new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime(),
          )[0] ?? null;
      const daysSinceDailyReport = lastDailyReportDate
        ? Math.max(
            0,
            Math.floor(
              (Date.now() - new Date(`${lastDailyReportDate}T00:00:00`).getTime()) / 86400000,
            ),
          )
        : null;
      return {
        id: p.id,
        organization_id: p.organization_id,
        organization_name:
          (p.organization_id ? organizationsById.get(p.organization_id)?.name : "") ||
          "Unassigned company",
        organization_logo_url:
          (p.organization_id ? organizationsById.get(p.organization_id)?.logo_url : "") || "",
        job_number: p.job_number,
        name: p.name,
        client: p.client,
        project_manager: p.project_manager,
        source_opportunity_id: p.source_opportunity_id,
        phase: p.phase,
        percent_complete: p.percent_complete,
        schedule_variance_weeks: p.schedule_variance_weeks,
        original_contract: p.original_contract,
        forecasted_final_contract: r.forecastedFinalContract,
        forecasted_final_cost: r.forecastedFinalCost,
        forecasted_gp_before_holds: r.forecastedGPBeforeHolds,
        original_gp: r.originalGP,
        indicated_gp: r.indicatedGP,
        indicated_gp_pct: r.indicatedGPpct,
        original_gp_pct: r.originalGPpct,
        gp_at_risk: r.gpAtRisk,
        exposure_holds: r.exposureHolds,
        contingency_hold: r.contingencyHold,
        risk_allocated: r.exposureHolds + r.contingencyHold,
        schedule_risk_count: activeScheduleRiskCount,
        warning_count: warnings.length,
        days_since_review: daysSinceReview,
        top_category: topCat,
        top_exposure_title: topExposure?.title ?? "",
        top_exposure_value: topExposure ? remainingExposureValue(topExposure) : 0,
        top_exposure_hold_class: topExposure?.hold_class ?? null,
        top_exposure_owner: topExposure?.owner ?? "",
        active_decision_count: activeDecisions.length,
        overdue_decision_count: overdueDecisions.length,
        next_decision_due: nextDecision?.due_date ?? null,
        daily_report_count: dailyReports.length,
        client_visible_daily_report_count: dailyReports.filter((report) =>
          Boolean(report.client_visible),
        ).length,
        last_daily_report_date: lastDailyReportDate,
        days_since_daily_report: daysSinceDailyReport,
        daily_report_attachment_count: dailyReports.reduce(
          (total, report) => total + Math.max(0, num(report.attachment_count)),
          0,
        ),
        daily_report_attachment_bytes: dailyReports.reduce(
          (total, report) => total + Math.max(0, num(report.attachment_bytes)),
          0,
        ),
      };
    });
  });

export const getProject = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error: accountError } = await context.supabase.rpc("ensure_current_user_account");
    if (accountError) throw new Error(accountError.message);

    const pid = data.projectId;
    const [pRes, eRes, cRes, bRes, dRes, rRes, siRes] = await Promise.all([
      context.supabase.from("projects").select("*").eq("id", pid).maybeSingle(),
      context.supabase
        .from("exposures")
        .select("*")
        .eq("project_id", pid)
        .order("opened_at", { ascending: false }),
      context.supabase.from("change_orders").select("*").eq("project_id", pid).order("number"),
      context.supabase.from("cost_buckets").select("*").eq("project_id", pid).order("sort_order"),
      context.supabase
        .from("decisions")
        .select("*")
        .eq("project_id", pid)
        .order("due_date", { ascending: true, nullsFirst: false }),
      context.supabase
        .from("reviews")
        .select("*")
        .eq("project_id", pid)
        .order("reviewed_at", { ascending: false })
        .limit(10),
      dynamicTable(context.supabase, "sov_imports")
        .select("*")
        .eq("project_id", pid)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);
    const billRes = await context.supabase
      .from("billing_applications")
      .select("*")
      .eq("project_id", pid)
      .order("sort_order");
    const invoiceRes = await dynamicTable(context.supabase, "billing_invoices")
      .select("*")
      .eq("project_id", pid)
      .order("issue_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (pRes.error) throw new Error(pRes.error.message);
    if (!pRes.data) throw new Error("Project not found");
    if (isHarborDemoProject(pRes.data as Record<string, unknown>)) {
      await seedHarborDemoCpmActivities(context.supabase, pid, []);
    }
    if (eRes.error) throw new Error(eRes.error.message);
    if (cRes.error) throw new Error(cRes.error.message);
    if (bRes.error) throw new Error(bRes.error.message);
    if (dRes.error) throw new Error(dRes.error.message);
    if (rRes.error) throw new Error(rRes.error.message);
    const sovImportsTableMissing =
      siRes.error &&
      (siRes.error.message.includes("sov_imports") || siRes.error.message.includes("schema cache"));
    if (siRes.error && !sovImportsTableMissing) throw new Error(siRes.error.message);
    const billingTableMissing =
      billRes.error &&
      (billRes.error.message.includes("billing_applications") ||
        billRes.error.message.includes("schema cache"));
    if (billRes.error && !billingTableMissing) throw new Error(billRes.error.message);
    const billingInvoicesTableMissing =
      invoiceRes.error &&
      (isMissingRestRelation(invoiceRes.error, "billing_invoices") ||
        invoiceRes.error.message.includes("billing_invoices") ||
        invoiceRes.error.message.includes("schema cache"));
    if (invoiceRes.error && !billingInvoicesTableMissing) throw new Error(invoiceRes.error.message);

    let billingEventRows: BillingApplicationEventRow[] = [];
    if (!billingTableMissing && (billRes.data ?? []).length > 0) {
      const billingEventRes = await dynamicTable(context.supabase, "billing_application_events")
        .select("*")
        .eq("project_id", pid)
        .order("created_at", { ascending: false });
      const billingEventsTableMissing =
        billingEventRes.error &&
        (billingEventRes.error.message.includes("billing_application_events") ||
          billingEventRes.error.message.includes("schema cache"));
      if (billingEventRes.error && !billingEventsTableMissing) {
        throw new Error(billingEventRes.error.message);
      }
      billingEventRows = billingEventsTableMissing
        ? []
        : ((billingEventRes.data ?? []) as unknown[]).map((row) =>
            normalizeBillingApplicationEvent(row as Record<string, unknown>),
          );
    }
    let paymentRows: PaymentLedgerRow[] = [];
    if (!billingInvoicesTableMissing && (invoiceRes.data ?? []).length > 0) {
      const paymentRes = await dynamicTable(context.supabase, "payment_ledger")
        .select("*")
        .eq("project_id", pid)
        .order("paid_at", { ascending: false });
      const paymentTableMissing =
        paymentRes.error &&
        (isMissingRestRelation(paymentRes.error, "payment_ledger") ||
          paymentRes.error.message.includes("payment_ledger") ||
          paymentRes.error.message.includes("schema cache"));
      if (paymentRes.error && !paymentTableMissing) throw new Error(paymentRes.error.message);
      paymentRows = paymentTableMissing
        ? []
        : ((paymentRes.data ?? []) as unknown[]).map((row) =>
            normalizePaymentLedger(row as Record<string, unknown>),
          );
    }

    let project = normalizeProject(pRes.data as Record<string, unknown>);
    if (project.organization_id) {
      const organizationRes = await dynamicTable(context.supabase, "organizations")
        .select("id,name,logo_url,updated_at")
        .eq("id", project.organization_id)
        .maybeSingle();
      if (organizationRes.error) {
        if (!isMissingRestColumn(organizationRes.error, "logo_url")) {
          throw new Error(organizationRes.error.message);
        }
        const fallbackOrganizationRes = await dynamicTable(context.supabase, "organizations")
          .select("id,name,updated_at")
          .eq("id", project.organization_id)
          .maybeSingle();
        if (fallbackOrganizationRes.error) throw new Error(fallbackOrganizationRes.error.message);
        const fallbackOrganization = fallbackOrganizationRes.data as Record<string, unknown> | null;
        project = {
          ...project,
          organization_name: str(fallbackOrganization?.name),
          organization_logo_url: organizationLogoUrl(context.supabase, fallbackOrganization ?? {}),
        };
      } else if (organizationRes.data) {
        const organization = organizationRes.data as Record<string, unknown>;
        project = {
          ...project,
          organization_name: str(organization.name),
          organization_logo_url: organizationLogoUrl(context.supabase, organization),
        };
      }
    }
    const projectWithOrganization = project;
    let sovMappingProfiles: SovMappingProfileRow[] = [];
    if (project.organization_id) {
      const profileRes = await dynamicTable(context.supabase, "sov_mapping_profiles")
        .select("*")
        .eq("organization_id", project.organization_id)
        .order("updated_at", { ascending: false })
        .limit(25);
      const profilesTableMissing =
        profileRes.error &&
        (profileRes.error.message.includes("sov_mapping_profiles") ||
          profileRes.error.message.includes("schema cache"));
      if (profileRes.error && !profilesTableMissing) throw new Error(profileRes.error.message);
      sovMappingProfiles = profilesTableMissing
        ? []
        : ((profileRes.data ?? []) as unknown[]).map((row) =>
            normalizeSovMappingProfile(row as Record<string, unknown>),
          );
    }
    const exposures: ExposureRow[] = (eRes.data ?? []).map((r) =>
      normalizeExposure(r as Record<string, unknown>),
    );
    const changeOrders: ChangeOrderRow[] = (cRes.data ?? []).map((c) => {
      const o = c as Record<string, unknown>;
      return {
        id: o.id as string,
        project_id: o.project_id as string,
        number: str(o.number),
        description: str(o.description),
        contract_amount: num(o.contract_amount),
        cost_amount: num(o.cost_amount),
        status: (o.status as COStatus) ?? "Pending",
        probability: num(o.probability),
        owner: str(o.owner),
        notes: str(o.notes),
        co_type: str(o.co_type, "other") as COType,
        client_visible: Boolean(o.client_visible ?? false),
        client_status: str(o.client_status, "not_sent") as ClientChangeOrderStatus,
        client_notes: str(o.client_notes),
        client_sent_at: (o.client_sent_at as string | null) ?? null,
        client_decided_at: (o.client_decided_at as string | null) ?? null,
      };
    });

    const buckets: BucketRow[] = (bRes.data ?? []).map((b) => {
      const o = b as Record<string, unknown>;
      return {
        id: o.id as string,
        project_id: o.project_id as string,
        cost_code: str(o.cost_code),
        bucket: str(o.bucket),
        original_budget: num(o.original_budget),
        actual_to_date: num(o.actual_to_date),
        ftc: num(o.ftc),
        sort_order: num(o.sort_order),
        source_type: str(o.source_type, "original_sov") as BucketRow["source_type"],
        source_date: (o.source_date as string | null) ?? null,
        source_note: str(o.source_note),
        retainage_pct: num(o.retainage_pct ?? 10),
        billing_method: str(o.billing_method, "percent") as BucketRow["billing_method"],
        contract_quantity: num(o.contract_quantity),
        unit: str(o.unit),
        earned_percent_complete: num(o.earned_percent_complete),
      };
    });
    const billingEventsByApplication = new Map<string, BillingApplicationEventRow[]>();
    billingEventRows.forEach((event) => {
      const existing = billingEventsByApplication.get(event.billing_application_id) ?? [];
      existing.push(event);
      billingEventsByApplication.set(event.billing_application_id, existing);
    });
    const billingApplications: BillingApplicationRow[] = billingTableMissing
      ? []
      : (billRes.data ?? []).map((b) => {
          const app = normalizeBillingApplication(b as Record<string, unknown>);
          return {
            ...app,
            status_events: billingEventsByApplication.get(app.id) ?? [],
          };
        });
    const paymentsByInvoice = new Map<string, PaymentLedgerRow[]>();
    paymentRows.forEach((payment) => {
      const existing = paymentsByInvoice.get(payment.invoice_id) ?? [];
      existing.push(payment);
      paymentsByInvoice.set(payment.invoice_id, existing);
    });
    const billingInvoices: BillingInvoiceRow[] = billingInvoicesTableMissing
      ? []
      : ((invoiceRes.data ?? []) as unknown[]).map((row) => {
          const invoice = normalizeBillingInvoice(row as Record<string, unknown>);
          return {
            ...invoice,
            payment_events: paymentsByInvoice.get(invoice.id) ?? [],
          };
        });
    const decisions: DecisionRow[] = (dRes.data ?? []).map((d) => {
      const o = d as Record<string, unknown>;
      return {
        id: o.id as string,
        project_id: o.project_id as string,
        decision: str(o.decision),
        impact: str(o.impact),
        owner: str(o.owner),
        due_date: (o.due_date as string | null) ?? null,
        status: (o.status as DecisionStatus) ?? "open",
        linked_exposure_id: (o.linked_exposure_id as string | null) ?? null,
        linked_co_id: (o.linked_co_id as string | null) ?? null,
        notes: str(o.notes),
      };
    });
    const reviews: ReviewRow[] = (rRes.data ?? []).map((r) => {
      const o = r as Record<string, unknown>;
      return {
        id: o.id as string,
        project_id: o.project_id as string,
        reviewed_at: str(o.reviewed_at),
        reviewer: str(o.reviewer),
        forecast_completion_date_before:
          (o.forecast_completion_date_before as string | null) ?? null,
        forecast_completion_date_after: (o.forecast_completion_date_after as string | null) ?? null,
        summary_notes: str(o.summary_notes),
        body_markdown: str(o.body_markdown),
        status: str(o.status, "published"),
        email_recipients: Array.isArray(o.email_recipients) ? (o.email_recipients as string[]) : [],
        pdf_style: str(o.pdf_style, "executive"),
        kpi_snapshot: (o.kpi_snapshot ?? {}) as Json,
      };
    });
    const sovImports: SovImportRow[] = sovImportsTableMissing
      ? []
      : ((siRes.data ?? []) as unknown[]).map((r) => {
          const o = r as Record<string, unknown>;
          return {
            id: o.id as string,
            project_id: o.project_id as string,
            imported_by: (o.imported_by as string | null) ?? null,
            mode: str(o.mode, "replace") as SovImportRow["mode"],
            source_type: str(o.source_type),
            source_name: str(o.source_name),
            source_sheet: str(o.source_sheet),
            profile: str(o.profile),
            confidence: str(o.confidence, "unknown") as SovImportRow["confidence"],
            has_header: Boolean(o.has_header ?? true),
            raw_rows: num(o.raw_rows),
            staged_rows: num(o.staged_rows),
            inserted_count: num(o.inserted_count),
            updated_count: num(o.updated_count),
            skipped_count: num(o.skipped_count),
            merged_rows: num(o.merged_rows),
            total_budget: num(o.total_budget),
            original_cost_budget: num(o.original_cost_budget),
            selected_budget_column:
              o.selected_budget_column == null ? null : num(o.selected_budget_column),
            selected_budget_label: str(o.selected_budget_label),
            column_map: (o.column_map ?? {}) as Json,
            amount_choices: (o.amount_choices ?? []) as Json,
            warnings: (o.warnings ?? []) as Json,
            created_at: str(o.created_at),
          };
        });

    const rollup: Rollup = computeRollup(project, buckets, changeOrders, exposures);
    const guidance = guidanceTargets(project.phase, rollup.remainingCost);
    const warnings: Warning[] = evaluateWarnings(project, buckets, changeOrders, exposures, rollup);
    const byCategory = exposureByCategory(exposures);
    const aging = exposureAging(exposures);

    return {
      project: projectWithOrganization,
      exposures,
      changeOrders,
      buckets,
      decisions,
      reviews,
      sovImports,
      sovMappingProfiles,
      billingApplications,
      billingInvoices,
      rollup,
      guidance,
      warnings,
      byCategory,
      aging,
    };
  });

// ---------------- PROJECT CRUD ----------------

const DEFAULT_BUCKETS = ["Sitework", "Structure", "Envelope", "MEP", "Finishes", "GC/OH"];

const createProjectInput = z.object({
  name: z.string().min(1).max(200),
  job_number: z.string().max(100).default(""),
  client: z.string().max(200).default(""),
  project_manager: z.string().max(200).default(""),
  phase: z.enum(["Early", "Middle", "Late"]).default("Early"),
  original_contract: z.number().min(0),
  original_cost_budget: z.number().min(0),
  baseline_completion_date: z.string().nullable().optional(),
  forecast_completion_date: z.string().nullable().optional(),
});

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createProjectInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: ensuredOrganizationId, error: accountError } = await context.supabase.rpc(
      "ensure_current_user_account",
    );
    if (accountError) throw new Error(accountError.message);
    if (!ensuredOrganizationId)
      throw new Error("No Overwatch company workspace is available for this user.");

    let organizationId = ensuredOrganizationId as string;
    const { data: writableMemberships, error: membershipsError } = await context.supabase
      .from("organization_memberships")
      .select("organization_id,role,status,created_at")
      .eq("user_id", context.userId)
      .eq("status", "active")
      .order("created_at", { ascending: true });
    if (membershipsError) throw new Error(membershipsError.message);

    const activeOrganizationId = writableMemberships?.find(
      (membership) => membership.organization_id,
    )?.organization_id;
    if (activeOrganizationId) {
      organizationId = activeOrganizationId as string;
    }

    const { data: organization, error: orgError } = await context.supabase
      .from("organizations")
      .select("id")
      .eq("id", organizationId)
      .single();
    if (orgError) throw new Error(orgError.message);

    const baselineCompletion = cleanOptionalDate(data.baseline_completion_date);
    const forecastCompletion = cleanOptionalDate(data.forecast_completion_date);
    const baseInsert = {
      owner_id: context.userId,
      organization_id: organizationId,
      name: data.name,
      job_number: data.job_number.trim(),
      client: data.client,
      project_manager: data.project_manager,
      phase: data.phase,
      original_contract: data.original_contract,
      original_cost_budget: data.original_cost_budget,
      baseline_completion_date: baselineCompletion,
      forecast_completion_date: forecastCompletion,
      schedule_variance_weeks:
        computeScheduleVarianceWeeks(baselineCompletion, forecastCompletion) ?? 0,
    };
    const { data: row, error } = await context.supabase
      .from("projects")
      .insert(baseInsert)
      .select("id")
      .single();
    throwIfProjectSchemaError(error);
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Project did not save.");

    const per = data.original_cost_budget / DEFAULT_BUCKETS.length;
    const { error: bErr } = await context.supabase.from("cost_buckets").insert(
      DEFAULT_BUCKETS.map((bucket, i) => ({
        project_id: row.id,
        cost_code: "",
        bucket,
        original_budget: per,
        actual_to_date: 0,
        ftc: per,
        sort_order: i + 1,
      })),
    );
    if (bErr) throw new Error(bErr.message);

    return { id: row.id };
  });

const updateFinancialsInput = z.object({
  projectId: z.string().uuid(),
  patch: z.object({
    name: z.string().min(1).max(200).optional(),
    job_number: z.string().max(100).optional(),
    client: z.string().max(200).optional(),
    original_contract: z.number().min(0).optional(),
    original_cost_budget: z.number().min(0).optional(),
    schedule_variance_weeks: z.number().int().optional(),
    phase: z.enum(["Early", "Middle", "Late"]).optional(),
    percent_complete: z.number().min(0).max(100).optional(),
    hold_variance_note: z.string().max(2000).optional(),
    forecast_completion_date: z.string().optional().nullable(),
    baseline_completion_date: z.string().optional().nullable(),
    last_review_summary: z.string().max(4000).optional(),
    project_manager: z.string().max(200).optional(),
  }),
});

export const updateProjectFinancials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => updateFinancialsInput.parse(input))
  .handler(async ({ data, context }) => {
    const patch = { ...data.patch };
    delete patch.schedule_variance_weeks;

    if ("baseline_completion_date" in patch) {
      patch.baseline_completion_date = cleanOptionalDate(patch.baseline_completion_date);
    }
    if ("forecast_completion_date" in patch) {
      patch.forecast_completion_date = cleanOptionalDate(patch.forecast_completion_date);
    }

    if ("baseline_completion_date" in patch || "forecast_completion_date" in patch) {
      const { data: current, error: loadError } = await context.supabase
        .from("projects")
        .select("baseline_completion_date, forecast_completion_date")
        .eq("id", data.projectId)
        .single();
      throwIfProjectSchemaError(loadError);
      if (loadError) throw new Error(loadError.message);

      const baseline =
        patch.baseline_completion_date !== undefined
          ? patch.baseline_completion_date
          : ((current.baseline_completion_date as string | null) ?? null);
      const forecast =
        patch.forecast_completion_date !== undefined
          ? patch.forecast_completion_date
          : ((current.forecast_completion_date as string | null) ?? null);
      patch.schedule_variance_weeks = computeScheduleVarianceWeeks(baseline, forecast) ?? 0;
    }

    const savePatch = (nextPatch: typeof patch) =>
      context.supabase
        .from("projects")
        .update(nextPatch)
        .eq("id", data.projectId)
        .select("*")
        .single();

    const { data: updated, error } = await savePatch(patch);
    throwIfProjectSchemaError(error);
    if (error) throw new Error(error.message);
    return {
      ok: true,
      project: normalizeProject(updated as Record<string, unknown>),
    };
  });

// ---------------- EXPOSURES ----------------

const EXPOSURE_CATEGORIES = [
  "owner_decision",
  "design_drift",
  "trade_performance",
  "procurement",
  "schedule_compression",
  "allowance_overrun",
  "field_change",
  "closeout_punch",
  "other",
] as const;
const RESPONSE_PATHS = ["eliminate", "recover", "offset", "accept"] as const;
const HOLD_CLASSES = ["E-Hold", "C-Hold", "Both", "None"] as const;
const EXPOSURE_STATUSES = [
  "active",
  "escalated",
  "recovered",
  "eliminated",
  "accepted",
  "released",
] as const;

const exposureInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  category: z.enum(EXPOSURE_CATEGORIES).default("other"),
  dollar_exposure: z.number().min(0),
  probability: z.number().min(0).max(100).default(100),
  schedule_impact_weeks: z.number().nullable().optional(),
  owner: z.string().max(200).default(""),
  response_path: z.enum(RESPONSE_PATHS),
  release_condition: z.string().max(500).default(""),
  released_amount: z.number().min(0).default(0),
  release_note: z.string().max(2000).default(""),
  release_updated_at: z.string().nullable().optional(),
  hold_class: z.enum(HOLD_CLASSES).default("E-Hold"),
  status: z.enum(EXPOSURE_STATUSES).default("active"),
  due_date: z.string().nullable().optional(),
  next_review_at: z.string().nullable().optional(),
  notes: z.string().max(2000).default(""),
});

export const createExposure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string } & z.input<typeof exposureInput>) =>
    z.object({ projectId: z.string().uuid() }).merge(exposureInput).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { projectId, ...rest } = data;
    const insertExposure = (payload: typeof rest) =>
      context.supabase
        .from("exposures")
        .insert({ project_id: projectId, ...payload })
        .select("id")
        .single();
    let { data: inserted, error } = await insertExposure(rest);
    if (isMissingRestColumn(error, "released_amount")) {
      const retry: Record<string, unknown> = { ...rest };
      delete retry.released_amount;
      delete retry.release_note;
      delete retry.release_updated_at;
      ({ data: inserted, error } = await insertExposure(retry as typeof rest));
    }
    if (error) throw new Error(error.message);
    return { ok: true, id: (inserted as { id: string } | null)?.id ?? "" };
  });

export const updateExposure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string } & Partial<z.input<typeof exposureInput>>) =>
    z.object({ id: z.string().uuid() }).merge(exposureInput.partial()).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const savePatch = (nextPatch: typeof patch) =>
      context.supabase.from("exposures").update(nextPatch).eq("id", id);
    let { error } = await savePatch(patch);
    if (isMissingRestColumn(error, "released_amount")) {
      const retry = { ...patch };
      delete retry.released_amount;
      delete retry.release_note;
      delete retry.release_updated_at;
      ({ error } = await savePatch(retry));
    }
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteExposure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: exposure, error: findError } = await context.supabase
      .from("exposures")
      .select("id")
      .eq("id", data.id)
      .maybeSingle();
    if (findError) throw new Error(findError.message);
    if (!exposure) throw new Error("Risk was not found or is not accessible.");

    const { error: scheduleLinkError } = await context.supabase
      .from("schedule_risks")
      .update({ linked_exposure_id: null })
      .eq("linked_exposure_id", data.id);
    if (scheduleLinkError && !isMissingRestColumn(scheduleLinkError, "linked_exposure_id")) {
      throw new Error(scheduleLinkError.message);
    }

    const { error: decisionLinkError } = await context.supabase
      .from("decisions")
      .update({ linked_exposure_id: null })
      .eq("linked_exposure_id", data.id);
    if (decisionLinkError) throw new Error(decisionLinkError.message);

    const { data: deleted, error } = await context.supabase
      .from("exposures")
      .delete()
      .eq("id", data.id)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!deleted) throw new Error("Risk did not delete. Refresh and try again.");
    return { ok: true, id: deleted.id as string };
  });

// ---------------- CHANGE ORDERS ----------------

const CO_TYPES = [
  "owner_change",
  "design_error",
  "design_omission",
  "unforeseen_condition",
  "missed_scope",
  "sub_issued",
  "other",
] as const;

const coInput = z.object({
  number: z.string().max(50).default(""),
  description: z.string().min(1).max(500),
  contract_amount: z.number(),
  cost_amount: z.number(),
  status: z.enum(["Approved", "Pending", "Denied"]).default("Pending"),
  probability: z.number().min(0).max(100).default(100),
  owner: z.string().max(200).default(""),
  notes: z.string().max(2000).default(""),
  co_type: z.enum(CO_TYPES).default("other"),
});

export const createChangeOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string } & z.input<typeof coInput>) =>
    z.object({ projectId: z.string().uuid() }).merge(coInput).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { projectId, ...rest } = data;
    const { error } = await context.supabase
      .from("change_orders")
      .insert({ project_id: projectId, ...rest });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateChangeOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string } & Partial<z.input<typeof coInput>>) =>
    z.object({ id: z.string().uuid() }).merge(coInput.partial()).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("change_orders").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteChangeOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("change_orders").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------- COST BUCKETS ----------------

const bucketInput = z.object({
  id: z.string().uuid(),
  patch: z.object({
    cost_code: z.string().max(80).optional(),
    bucket: z.string().min(1).max(100).optional(),
    original_budget: z.number().min(0).optional(),
    actual_to_date: z.number().min(0).optional(),
    ftc: z.number().min(0).optional(),
    source_type: z.enum(["original_sov", "change_order", "added_cost"]).optional(),
    source_date: z.string().nullable().optional(),
    source_note: z.string().max(500).optional(),
  }),
});

export const updateBucket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => bucketInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("cost_buckets")
      .update(data.patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const createBucketInput = z.object({
  projectId: z.string().uuid(),
  cost_code: z.string().max(80).default(""),
  bucket: z.string().min(1).max(100),
  original_budget: z.number().min(0).default(0),
  actual_to_date: z.number().min(0).default(0),
  ftc: z.number().min(0).default(0),
  source_type: z.enum(["original_sov", "change_order", "added_cost"]).default("added_cost"),
  source_date: z.string().nullable().optional(),
  source_note: z.string().max(500).default(""),
});

export const createBucket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof createBucketInput>) => createBucketInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: last } = await context.supabase
      .from("cost_buckets")
      .select("sort_order")
      .eq("project_id", data.projectId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sort_order = ((last?.sort_order as number | undefined) ?? 0) + 1;
    const { error } = await context.supabase.from("cost_buckets").insert({
      project_id: data.projectId,
      cost_code: data.cost_code.trim(),
      bucket: data.bucket,
      original_budget: data.original_budget,
      actual_to_date: data.actual_to_date,
      ftc: data.ftc,
      source_type: data.source_type,
      source_date: data.source_date ?? new Date().toISOString().slice(0, 10),
      source_note: data.source_note,
      sort_order,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteBucket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("cost_buckets").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------- DECISIONS ----------------

const DECISION_STATUSES = ["open", "in_progress", "resolved", "overdue"] as const;

const decisionInput = z.object({
  decision: z.string().min(1).max(500),
  impact: z.string().max(5000).default(""),
  owner: z.string().max(200).default(""),
  due_date: z.string().nullable().optional(),
  status: z.enum(DECISION_STATUSES).default("open"),
  linked_exposure_id: z.string().uuid().nullable().optional(),
  linked_co_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(5000).default(""),
});

export const createDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string } & z.input<typeof decisionInput>) =>
    z.object({ projectId: z.string().uuid() }).merge(decisionInput).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { projectId, ...rest } = data;
    const { error } = await context.supabase
      .from("decisions")
      .insert({ project_id: projectId, ...rest });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string } & Partial<z.input<typeof decisionInput>>) =>
    z.object({ id: z.string().uuid() }).merge(decisionInput.partial()).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("decisions").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("decisions").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------- BILLING APPLICATIONS ----------------

const BILLING_STATUSES = ["draft", "submitted", "paid", "partial", "rejected"] as const;

const billingApplicationInput = z.object({
  application_number: z.string().max(100).default(""),
  invoice_number: z.string().max(100).default(""),
  submitted_date: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  billing_period: z.string().max(100).default(""),
  contract_amount: z.number().min(0).default(0),
  change_order_amount: z.number().min(0).default(0),
  amount_billed: z.number().min(0).default(0),
  paid_to_date: z.number().min(0).default(0),
  retainage: z.number().min(0).default(0),
  status: z.enum(BILLING_STATUSES).default("draft"),
  notes: z.string().max(2000).default(""),
  sort_order: z.number().int().optional(),
});

function isMissingBillingEventsTable(error: unknown) {
  const message =
    error instanceof Error ? error.message : str((error as { message?: unknown })?.message);
  return /billing_application_events|schema cache/i.test(message);
}

async function recordBillingApplicationEvent(
  supabase: unknown,
  input: {
    billing_application_id: string;
    project_id: string;
    event_type: string;
    from_status?: string;
    to_status?: string;
    amount?: number;
    notes?: string;
  },
) {
  const { error } = await dynamicTable(supabase, "billing_application_events").insert({
    billing_application_id: input.billing_application_id,
    project_id: input.project_id,
    event_type: input.event_type,
    from_status: input.from_status ?? "",
    to_status: input.to_status ?? "",
    amount: input.amount ?? 0,
    notes: input.notes ?? "",
  });
  if (error && !isMissingBillingEventsTable(error)) throw new Error(error.message);
}

export const createBillingApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string } & z.input<typeof billingApplicationInput>) =>
    z.object({ projectId: z.string().uuid() }).merge(billingApplicationInput).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { projectId, ...rest } = data;
    const billingPayload = {
      ...rest,
      application_number: normalizeBillingNumberLabel(rest.application_number),
      invoice_number: normalizeBillingNumberLabel(rest.invoice_number),
    };
    const { data: last } = await context.supabase
      .from("billing_applications")
      .select("sort_order")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sort_order = rest.sort_order ?? ((last?.sort_order as number | undefined) ?? 0) + 1;
    const { data: created, error } = await context.supabase
      .from("billing_applications")
      .insert({
        project_id: projectId,
        ...billingPayload,
        sort_order,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const createdRow = normalizeBillingApplication(created as Record<string, unknown>);
    await recordBillingApplicationEvent(context.supabase, {
      billing_application_id: createdRow.id,
      project_id: projectId,
      event_type: "created",
      from_status: "",
      to_status: createdRow.status,
      amount: createdRow.amount_billed,
      notes: createdRow.notes || "Pay application created.",
    });
    return { ok: true };
  });

export const updateBillingApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { id: string; patch: Partial<z.input<typeof billingApplicationInput>> }) =>
      z.object({ id: z.string().uuid(), patch: billingApplicationInput.partial() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const normalizedPatch = { ...data.patch };
    if (typeof normalizedPatch.application_number === "string") {
      normalizedPatch.application_number = normalizeBillingNumberLabel(
        normalizedPatch.application_number,
      );
    }
    if (typeof normalizedPatch.invoice_number === "string") {
      normalizedPatch.invoice_number = normalizeBillingNumberLabel(normalizedPatch.invoice_number);
    }
    const { data: before, error: beforeError } = await context.supabase
      .from("billing_applications")
      .select("id,project_id,status,amount_billed,paid_to_date,application_number")
      .eq("id", data.id)
      .maybeSingle();
    if (beforeError) throw new Error(beforeError.message);
    if (!before) throw new Error("Pay app not found.");

    const { error } = await context.supabase
      .from("billing_applications")
      .update(normalizedPatch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    const previousStatus = str(before.status, "draft");
    const nextStatus = normalizedPatch.status;
    const statusChanged = typeof nextStatus === "string" && nextStatus !== previousStatus;
    const previousPaid = num(before.paid_to_date);
    const nextPaid = normalizedPatch.paid_to_date;
    const paidChanged = typeof nextPaid === "number" && nextPaid !== previousPaid;

    if (statusChanged || paidChanged) {
      const eventType = statusChanged ? "status_change" : "payment_update";
      const eventNotes = statusChanged
        ? `${normalizeBillingNumberLabel(str(before.application_number, "Pay app"))} moved from ${previousStatus} to ${nextStatus}.`
        : `${normalizeBillingNumberLabel(str(before.application_number, "Pay app"))} paid-to-date updated from ${previousPaid} to ${nextPaid}.`;
      await recordBillingApplicationEvent(context.supabase, {
        billing_application_id: data.id,
        project_id: before.project_id as string,
        event_type: eventType,
        from_status: previousStatus,
        to_status: statusChanged ? nextStatus : previousStatus,
        amount: paidChanged ? nextPaid : num(before.amount_billed),
        notes: eventNotes,
      });
    }

    return { ok: true };
  });

export const deleteBillingApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("billing_applications")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------- BILLING INVOICES + PAYMENTS ----------------

const INVOICE_STATUSES = [
  "draft",
  "sent",
  "viewed",
  "partially_paid",
  "paid",
  "overdue",
  "void",
] as const;

const billingInvoiceInput = z.object({
  billing_application_id: z.string().uuid().nullable().optional(),
  invoice_number: z.string().max(100).default(""),
  title: z.string().max(200).default(""),
  issue_date: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  subtotal: z.number().min(0).default(0),
  retainage: z.number().min(0).default(0),
  total_due: z.number().min(0).default(0),
  paid_amount: z.number().min(0).default(0),
  status: z.enum(INVOICE_STATUSES).default("draft"),
  client_visible: z.boolean().default(false),
  notes: z.string().max(4000).default(""),
});

const paymentLedgerInput = z.object({
  invoiceId: z.string().uuid(),
  amount: z.number().positive(),
  processor_fee: z.number().min(0).default(0),
  overwatch_fee: z.number().min(0).default(0),
  paid_at: z.string().optional(),
  payment_method: z.string().max(100).default("manual"),
  processor: z.string().max(100).default("manual"),
  processor_payment_id: z.string().max(200).default(""),
  notes: z.string().max(4000).default(""),
});

function isInvoiceSentStatus(status: InvoiceStatus) {
  return status !== "draft" && status !== "void";
}

function paymentAdjustedInvoiceStatus(totalDue: number, paidAmount: number): InvoiceStatus {
  if (totalDue > 0 && paidAmount >= totalDue) return "paid";
  if (paidAmount > 0) return "partially_paid";
  return "sent";
}

function firstActiveInvoice(data: unknown) {
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return rows.find(
    (row): row is Record<string, unknown> =>
      Boolean(row) &&
      typeof row === "object" &&
      str((row as Record<string, unknown>).status, "draft") !== "void",
  );
}

export const createBillingInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string } & z.input<typeof billingInvoiceInput>) =>
    z.object({ projectId: z.string().uuid() }).merge(billingInvoiceInput).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { projectId, ...rest } = data;
    const status = rest.status as InvoiceStatus;
    const sentAt = isInvoiceSentStatus(status) ? new Date().toISOString() : null;
    const paidAt = status === "paid" ? new Date().toISOString() : null;
    if (rest.billing_application_id) {
      const { data: existingPayAppInvoices, error: existingPayAppInvoiceError } =
        await dynamicTable(context.supabase, "billing_invoices")
          .select("id,invoice_number,status")
          .eq("project_id", projectId)
          .eq("billing_application_id", rest.billing_application_id)
          .limit(5);
      if (existingPayAppInvoiceError) throw new Error(existingPayAppInvoiceError.message);
      const existingPayAppInvoice = firstActiveInvoice(existingPayAppInvoices);
      if (existingPayAppInvoice) {
        throw new Error(
          `This pay app already has invoice ${normalizeBillingNumberLabel(str(existingPayAppInvoice.invoice_number, ""))}. Void or edit the existing invoice before creating another.`,
        );
      }
    }
    const invoiceNumber = normalizeBillingNumberLabel(rest.invoice_number);
    const invoicePayload = {
      ...rest,
      invoice_number: invoiceNumber,
      title: normalizeBillingNumberLabel(rest.title),
    };
    if (invoiceNumber) {
      const { data: existingInvoiceNumbers, error: existingInvoiceNumberError } =
        await dynamicTable(context.supabase, "billing_invoices")
          .select("id,invoice_number,status")
          .eq("project_id", projectId)
          .eq("invoice_number", invoiceNumber)
          .limit(5);
      if (existingInvoiceNumberError) throw new Error(existingInvoiceNumberError.message);
      const existingInvoiceNumber = firstActiveInvoice(existingInvoiceNumbers);
      if (existingInvoiceNumber) {
        throw new Error(
          `Invoice ${invoiceNumber} already exists for this project. Use a unique invoice number or edit the existing invoice.`,
        );
      }
    }
    const { data: created, error } = await dynamicTable(context.supabase, "billing_invoices")
      .insert({
        project_id: projectId,
        ...invoicePayload,
        invoice_number: invoiceNumber,
        sent_at: sentAt,
        paid_at: paidAt,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return {
      ok: true,
      invoice: normalizeBillingInvoice(created as Record<string, unknown>),
    };
  });

export const updateBillingInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; patch: Partial<z.input<typeof billingInvoiceInput>> }) =>
    z.object({ id: z.string().uuid(), patch: billingInvoiceInput.partial() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: before, error: loadError } = await dynamicTable(
      context.supabase,
      "billing_invoices",
    )
      .select("status,sent_at,paid_at")
      .eq("id", data.id)
      .single();
    if (loadError) throw new Error(loadError.message);
    if (!before) throw new Error("Invoice not found.");

    const patch: Record<string, unknown> = { ...data.patch };
    if (typeof patch.invoice_number === "string") {
      patch.invoice_number = normalizeBillingNumberLabel(patch.invoice_number);
    }
    if (typeof patch.title === "string") {
      patch.title = normalizeBillingNumberLabel(patch.title);
    }
    const nextStatus = data.patch.status as InvoiceStatus | undefined;
    if (nextStatus && isInvoiceSentStatus(nextStatus) && !before.sent_at) {
      patch.sent_at = new Date().toISOString();
    }
    if (nextStatus === "paid" && !before.paid_at) {
      patch.paid_at = new Date().toISOString();
    }

    const { data: updated, error } = await dynamicTable(context.supabase, "billing_invoices")
      .update(patch)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return {
      ok: true,
      invoice: normalizeBillingInvoice(updated as Record<string, unknown>),
    };
  });

export const deleteBillingInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await dynamicTable(context.supabase, "billing_invoices")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const recordInvoicePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof paymentLedgerInput>) => paymentLedgerInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: invoice, error: invoiceError } = await dynamicTable(
      context.supabase,
      "billing_invoices",
    )
      .select("id,project_id,billing_application_id,total_due")
      .eq("id", data.invoiceId)
      .single();
    if (invoiceError) throw new Error(invoiceError.message);
    if (!invoice) throw new Error("Invoice not found.");

    const projectId = invoice.project_id as string;
    const billingApplicationId = (invoice.billing_application_id as string | null) ?? null;
    const processorFee = data.processor_fee ?? 0;
    const overwatchFee = data.overwatch_fee ?? 0;
    const netPayout = Math.max(0, data.amount - processorFee - overwatchFee);
    const { error: insertError } = await dynamicTable(context.supabase, "payment_ledger").insert({
      project_id: projectId,
      invoice_id: data.invoiceId,
      billing_application_id: billingApplicationId,
      amount: data.amount,
      processor_fee: processorFee,
      overwatch_fee: overwatchFee,
      net_payout: netPayout,
      payment_method: data.payment_method,
      processor: data.processor,
      processor_payment_id: data.processor_payment_id,
      status: "succeeded",
      paid_at: data.paid_at ? new Date(data.paid_at).toISOString() : new Date().toISOString(),
      notes: data.notes,
    });
    if (insertError) throw new Error(insertError.message);

    const { data: payments, error: paymentsError } = await dynamicTable(
      context.supabase,
      "payment_ledger",
    )
      .select("amount,status")
      .eq("invoice_id", data.invoiceId)
      .eq("status", "succeeded");
    if (paymentsError) throw new Error(paymentsError.message);

    const paidAmount = ((payments ?? []) as Record<string, unknown>[]).reduce(
      (sum: number, payment: Record<string, unknown>) => sum + num(payment.amount),
      0,
    );
    const totalDue = num(invoice.total_due);
    const nextStatus = paymentAdjustedInvoiceStatus(totalDue, paidAmount);
    const paidAt = nextStatus === "paid" ? new Date().toISOString() : null;

    const { error: updateInvoiceError } = await dynamicTable(context.supabase, "billing_invoices")
      .update({
        paid_amount: paidAmount,
        status: nextStatus,
        paid_at: paidAt,
      })
      .eq("id", data.invoiceId);
    if (updateInvoiceError) throw new Error(updateInvoiceError.message);

    if (billingApplicationId) {
      const { error: updatePayAppError } = await context.supabase
        .from("billing_applications")
        .update({
          paid_to_date: paidAmount,
          status: nextStatus === "paid" ? "paid" : "partial",
        })
        .eq("id", billingApplicationId);
      if (updatePayAppError) throw new Error(updatePayAppError.message);

      await recordBillingApplicationEvent(context.supabase, {
        billing_application_id: billingApplicationId,
        project_id: projectId,
        event_type: "payment_update",
        from_status: "",
        to_status: nextStatus === "paid" ? "paid" : "partial",
        amount: paidAmount,
        notes: `Invoice payment recorded: ${data.notes || "manual payment"}`,
      });
    }

    return { ok: true, paidAmount, status: nextStatus };
  });

// ---------------- REVIEWS ----------------

const submitReviewInput = z.object({
  projectId: z.string().uuid(),
  reviewer: z.string().max(200).default(""),
  forecast_completion_date_before: z.string().nullable().optional(),
  forecast_completion_date_after: z.string().nullable().optional(),
  summary_notes: z.string().max(4000).default(""),
  body_markdown: z.string().max(20000).default(""),
  pdf_style: z.enum(["executive", "structured"]).default("executive"),
  email_recipients: z.array(z.string().email().max(254)).max(20).default([]),
  kpi_snapshot: z.record(z.string(), z.unknown()).default({}),
});

export const submitReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof submitReviewInput>) => submitReviewInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: inserted, error } = await context.supabase
      .from("reviews")
      .insert({
        project_id: data.projectId,
        reviewer: data.reviewer,
        forecast_completion_date_before: data.forecast_completion_date_before ?? null,
        forecast_completion_date_after: data.forecast_completion_date_after ?? null,
        summary_notes: data.summary_notes,
        body_markdown: data.body_markdown,
        pdf_style: data.pdf_style,
        email_recipients: data.email_recipients,
        kpi_snapshot: data.kpi_snapshot as Json,
        status: "published",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const patch: {
      last_reviewed_at: string;
      last_review_summary: string;
      forecast_completion_date?: string;
      schedule_variance_weeks?: number;
    } = {
      last_reviewed_at: new Date().toISOString(),
      last_review_summary: data.summary_notes,
    };
    if (data.forecast_completion_date_after) {
      patch.forecast_completion_date = data.forecast_completion_date_after;
      const { data: current, error: currentError } = await context.supabase
        .from("projects")
        .select("baseline_completion_date")
        .eq("id", data.projectId)
        .single();
      if (currentError) throw new Error(currentError.message);
      patch.schedule_variance_weeks =
        computeScheduleVarianceWeeks(
          (current.baseline_completion_date as string | null) ?? null,
          data.forecast_completion_date_after,
        ) ?? 0;
    }
    const { error: pErr } = await context.supabase
      .from("projects")
      .update(patch)
      .eq("id", data.projectId);
    if (pErr) throw new Error(pErr.message);

    return { ok: true, reviewId: inserted.id };
  });

const updateReviewInput = z.object({
  id: z.string().uuid(),
  patch: z.object({
    body_markdown: z.string().max(20000).optional(),
    status: z.enum(["draft", "published"]).optional(),
    email_recipients: z.array(z.string().email().max(254)).max(20).optional(),
    pdf_style: z.enum(["executive", "structured"]).optional(),
  }),
});

export const updateReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof updateReviewInput>) => updateReviewInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("reviews").update(data.patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------- SOV IMPORT ----------------

const importBucketRow = z.object({
  cost_code: z.string().max(80).default(""),
  bucket: z.string().min(1).max(200),
  original_budget: z.number().min(0),
  actual_to_date: z.number().min(0),
  ftc: z.number().min(0),
  actual_to_date_provided: z.boolean().default(false),
  ftc_provided: z.boolean().default(false),
  sort_order: z.number().int().min(0),
  source_type: z.enum(["original_sov", "change_order", "added_cost"]).default("original_sov"),
  source_date: z.string().nullable().optional(),
  source_note: z.string().max(500).default(""),
});

type ImportBucketRow = z.infer<typeof importBucketRow>;

const importMetadataInput = z
  .object({
    source_type: z.string().max(50).default(""),
    source_name: z.string().max(300).default(""),
    source_sheet: z.string().max(200).default(""),
    profile: z.string().max(120).default(""),
    confidence: z.enum(["high", "medium", "low", "unknown"]).default("unknown"),
    has_header: z.boolean().default(true),
    raw_rows: z.number().int().min(0).default(0),
    staged_rows: z.number().int().min(0).default(0),
    skipped_rows: z.number().int().min(0).default(0),
    merged_rows: z.number().int().min(0).default(0),
    total_budget: z.number().min(0).default(0),
    selected_budget_column: z.number().int().nullable().optional(),
    selected_budget_label: z.string().max(200).default(""),
    column_map: z.record(z.string(), z.string()).default({}),
    amount_choices: z
      .array(
        z
          .object({
            columnIndex: z.number().int(),
            label: z.string().max(200),
            total: z.number(),
            sampleCount: z.number().int().min(0),
            recommended: z.boolean(),
            basis: z.string().max(40),
            note: z.string().max(500),
          })
          .passthrough(),
      )
      .default([]),
    warnings: z.array(z.string().max(1000)).max(20).default([]),
  })
  .default({});

const importInput = z.object({
  projectId: z.string().uuid(),
  mode: z.enum(["replace", "append"]).default("replace"),
  rows: z.array(importBucketRow).min(1).max(500),
  metadata: importMetadataInput,
});

const saveSovMappingProfileInput = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(120),
  source_type: z.string().max(50).default(""),
  source_sheet: z.string().max(200).default(""),
  profile: z.string().max(120).default(""),
  confidence: z.enum(["high", "medium", "low", "unknown"]).default("unknown"),
  has_header: z.boolean().default(true),
  column_map: z.record(z.string(), z.string()).default({}),
  selected_budget_column: z.number().int().nullable().optional(),
  selected_budget_label: z.string().max(200).default(""),
  sample_headers: z.array(z.string().max(200)).max(80).default([]),
  amount_choices: z.array(z.unknown()).max(40).default([]),
  warnings: z.array(z.string().max(1000)).max(20).default([]),
});

const normalizeImportKey = (value: string) => value.trim().toLowerCase();

const consolidateImportRows = (rows: ImportBucketRow[]): ImportBucketRow[] => {
  const consolidated: ImportBucketRow[] = [];
  const byKey = new Map<string, ImportBucketRow>();

  for (const row of rows) {
    const codeKey = normalizeImportKey(row.cost_code);
    const key = codeKey ? `code:${codeKey}` : `bucket:${normalizeImportKey(row.bucket)}`;
    const existing = byKey.get(key);
    if (!existing) {
      const clone = { ...row };
      byKey.set(key, clone);
      consolidated.push(clone);
      continue;
    }

    existing.original_budget += row.original_budget;
    existing.actual_to_date += row.actual_to_date;
    existing.ftc += row.ftc;
    existing.actual_to_date_provided =
      existing.actual_to_date_provided || row.actual_to_date_provided;
    existing.ftc_provided = existing.ftc_provided || row.ftc_provided;
    existing.source_note =
      existing.source_note || row.source_note || "Merged duplicate estimate lines";
  }

  return consolidated;
};

export const saveSovMappingProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof saveSovMappingProfileInput>) =>
    saveSovMappingProfileInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: project, error: projectErr } = await context.supabase
      .from("projects")
      .select("id, organization_id")
      .eq("id", data.projectId)
      .single();
    if (projectErr || !project) {
      throw new Error(projectErr?.message ?? "Project not found or not accessible.");
    }
    const organizationId = (project as { organization_id: string | null }).organization_id;
    if (!organizationId) {
      throw new Error("This project is not attached to a company workspace yet.");
    }

    const name = data.name.trim();
    const normalizedName = name.toLowerCase();
    const { data: profile, error } = await dynamicTable(context.supabase, "sov_mapping_profiles")
      .upsert(
        {
          organization_id: organizationId,
          created_by: context.userId,
          name,
          normalized_name: normalizedName,
          source_type: data.source_type,
          source_sheet: data.source_sheet,
          profile: data.profile,
          confidence: data.confidence,
          has_header: data.has_header,
          column_map: data.column_map,
          selected_budget_column: data.selected_budget_column ?? null,
          selected_budget_label: data.selected_budget_label,
          sample_headers: data.sample_headers,
          amount_choices: data.amount_choices as Json,
          warnings: data.warnings,
        },
        { onConflict: "organization_id,normalized_name" },
      )
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, profile: normalizeSovMappingProfile(profile as Record<string, unknown>) };
  });

export const importCostBuckets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof importInput>) => importInput.parse(input))
  .handler(async ({ data, context }) => {
    const importRows = consolidateImportRows(data.rows);
    const seenCodes = new Set<string>();
    const seenNames = new Set<string>();
    for (const row of importRows) {
      const codeKey = normalizeImportKey(row.cost_code);
      if (codeKey) {
        if (seenCodes.has(codeKey)) {
          throw new Error(`Duplicate cost code in import: ${row.cost_code}.`);
        }
        seenCodes.add(codeKey);
      } else {
        const nameKey = normalizeImportKey(row.bucket);
        if (seenNames.has(nameKey)) {
          throw new Error(`Duplicate bucket name in import: ${row.bucket}.`);
        }
        seenNames.add(nameKey);
      }
    }

    const { data: project, error: projectErr } = await context.supabase
      .from("projects")
      .select("id")
      .eq("id", data.projectId)
      .single();
    if (projectErr || !project) {
      throw new Error(projectErr?.message ?? "Project not found or not accessible.");
    }

    if (data.mode === "replace") {
      const { error: delErr } = await context.supabase
        .from("cost_buckets")
        .delete()
        .eq("project_id", data.projectId);
      if (delErr) throw new Error(delErr.message);
    }

    let inserted = 0;
    let updated = 0;
    const today = new Date().toISOString().slice(0, 10);
    const rowsForInsert = importRows.map((r, i) => ({
      project_id: data.projectId,
      cost_code: r.cost_code.trim(),
      bucket: r.bucket,
      original_budget: r.original_budget,
      actual_to_date: r.actual_to_date,
      ftc: r.ftc,
      source_type: r.source_type,
      source_date: r.source_date ?? today,
      source_note: r.source_note,
      sort_order: i + 1,
    }));

    if (data.mode === "replace") {
      const { error } = await context.supabase.from("cost_buckets").insert(rowsForInsert);
      if (error) throw new Error(error.message);
      inserted = rowsForInsert.length;
    } else {
      const { data: existingRows, error: existingErr } = await context.supabase
        .from("cost_buckets")
        .select("*")
        .eq("project_id", data.projectId)
        .order("sort_order");
      if (existingErr) throw new Error(existingErr.message);

      const byCode = new Map<string, Record<string, unknown>>();
      const byName = new Map<string, Record<string, unknown>>();
      for (const existing of existingRows ?? []) {
        const codeKey = normalizeImportKey(str(existing.cost_code));
        if (codeKey) byCode.set(codeKey, existing as Record<string, unknown>);
        byName.set(normalizeImportKey(str(existing.bucket)), existing as Record<string, unknown>);
      }

      let nextOrder =
        (existingRows ?? []).reduce((max, row) => Math.max(max, num(row.sort_order)), 0) + 1;

      for (const incoming of importRows) {
        const codeKey = normalizeImportKey(incoming.cost_code);
        const nameKey = normalizeImportKey(incoming.bucket);
        const match = (codeKey ? byCode.get(codeKey) : null) ?? byName.get(nameKey);
        const source_date = incoming.source_date ?? today;
        if (match?.id) {
          const patch = {
            cost_code: incoming.cost_code.trim(),
            bucket: incoming.bucket,
            original_budget: incoming.original_budget,
            ...(incoming.actual_to_date_provided
              ? { actual_to_date: incoming.actual_to_date }
              : {}),
            ...(incoming.ftc_provided ? { ftc: incoming.ftc } : {}),
            source_type: incoming.source_type,
            source_date,
            source_note: incoming.source_note || "Updated from SOV import",
          };
          const { error: updateErr } = await context.supabase
            .from("cost_buckets")
            .update(patch)
            .eq("id", match.id as string);
          if (updateErr) throw new Error(updateErr.message);
          updated += 1;
        } else {
          const { error: insertErr } = await context.supabase.from("cost_buckets").insert({
            project_id: data.projectId,
            cost_code: incoming.cost_code.trim(),
            bucket: incoming.bucket,
            original_budget: incoming.original_budget,
            actual_to_date: incoming.actual_to_date,
            ftc: incoming.ftc,
            source_type: incoming.source_type,
            source_date,
            source_note: incoming.source_note,
            sort_order: nextOrder,
          });
          if (insertErr) throw new Error(insertErr.message);
          nextOrder += 1;
          inserted += 1;
        }
      }
    }

    // Treat the imported SOV as the source of truth for the project's
    // Original Cost Budget so Day-1 GP At Risk is $0. We use forecasted cost
    // (actual + FTC), not scheduled value, because forecasted cost is what
    // rolls into Indicated GP — anchoring Original to the same number means
    // any future drift shows up as real margin erosion.
    const { data: allBuckets, error: sumErr } = await context.supabase
      .from("cost_buckets")
      .select("actual_to_date, ftc")
      .eq("project_id", data.projectId);
    if (sumErr) throw new Error(sumErr.message);
    const total = (allBuckets ?? []).reduce(
      (s, b) => s + Number(b.actual_to_date ?? 0) + Number(b.ftc ?? 0),
      0,
    );
    const { error: updErr } = await context.supabase
      .from("projects")
      .update({ original_cost_budget: total })
      .eq("id", data.projectId);
    if (updErr) throw new Error(updErr.message);

    const metadata = data.metadata;
    const importBudgetTotal =
      metadata.total_budget || importRows.reduce((sum, row) => sum + row.original_budget, 0);
    let importHistorySaved = false;
    let importHistoryError = "";
    const { error: importHistoryErr } = await dynamicTable(context.supabase, "sov_imports").insert({
      project_id: data.projectId,
      imported_by: context.userId,
      mode: data.mode,
      source_type: metadata.source_type,
      source_name: metadata.source_name,
      source_sheet: metadata.source_sheet,
      profile: metadata.profile,
      confidence: metadata.confidence,
      has_header: metadata.has_header,
      raw_rows: metadata.raw_rows,
      staged_rows: metadata.staged_rows || importRows.length,
      inserted_count: inserted,
      updated_count: updated,
      skipped_count: metadata.skipped_rows,
      merged_rows: metadata.merged_rows,
      total_budget: importBudgetTotal,
      original_cost_budget: total,
      selected_budget_column: metadata.selected_budget_column ?? null,
      selected_budget_label: metadata.selected_budget_label,
      column_map: metadata.column_map,
      amount_choices: metadata.amount_choices,
      warnings: metadata.warnings,
    });
    if (importHistoryErr) {
      importHistoryError = importHistoryErr.message;
    } else {
      importHistorySaved = true;
    }

    return {
      ok: true,
      inserted,
      updated,
      originalCostBudget: total,
      importHistorySaved,
      importHistoryError,
    };
  });

// ---------------- DEMO SEED ----------------
// Every company workspace should have one fully built Harbor Residence project
// so new users can learn the IOR workflow before loading their own job.

const HARBOR_DEMO_JOB_NUMBER = "DEMO-HARBOR";
const HARBOR_DEMO_NAME = "Harbor Residence";
const HARBOR_DEMO_CLIENT = "Private Luxury Residence";
const HARBOR_DEMO_PROJECT_MANAGER = "Marshall Wilkinson";
const HARBOR_DEMO_FIRST_CPM_ACTIVITY_ID = "01-010";

const harborDemoBuckets = [
  {
    cost_code: "0100",
    bucket: "Sitework",
    original_budget: 220000,
    actual_to_date: 215000,
    ftc: 8000,
  },
  {
    cost_code: "0300",
    bucket: "Structure",
    original_budget: 540000,
    actual_to_date: 520000,
    ftc: 35000,
  },
  {
    cost_code: "0700",
    bucket: "Envelope",
    original_budget: 430000,
    actual_to_date: 300000,
    ftc: 160000,
  },
  {
    cost_code: "1500",
    bucket: "MEP",
    original_budget: 480000,
    actual_to_date: 260000,
    ftc: 240000,
  },
  {
    cost_code: "0900",
    bucket: "Finishes",
    original_budget: 780000,
    actual_to_date: 180000,
    ftc: 690000,
  },
  {
    cost_code: "0130",
    bucket: "GC/OH",
    original_budget: 270000,
    actual_to_date: 150000,
    ftc: 142000,
  },
] as const;

const harborDemoExposures = [
  {
    title: "Cabinets misassembled and damaged on delivery",
    description:
      "Vendor missed the cabinet measurements. The cabinets arrived with wrong dimensions and damaged doors.",
    category: "procurement",
    dollar_exposure: 20000,
    probability: 100,
    schedule_impact_weeks: 2,
    owner: "Vendor",
    response_path: "recover",
    release_condition: "Vendor credit issued and replacement delivery confirmed.",
    released_amount: 0,
    release_note: "",
    hold_class: "E-Hold",
    status: "active",
    due_date: "2026-07-06",
    next_review_at: "2026-06-28",
    notes:
      "Plan: document the damaged delivery, request vendor credit, and confirm replacement dates before rough-in sequence is affected.",
  },
  {
    title: "Remaining finish-phase uncertainty",
    description: "General contingency for trim, paint, and closeout variability.",
    category: "other",
    dollar_exposure: 65000,
    probability: 100,
    schedule_impact_weeks: null,
    owner: "PM",
    response_path: "accept",
    release_condition: "Release as finish trades are bought out and closeout scope is stable.",
    released_amount: 0,
    release_note: "",
    hold_class: "C-Hold",
    status: "active",
    due_date: "2026-08-15",
    next_review_at: "2026-07-15",
    notes:
      "Contingency is being gardened until finish scope, trim, and punch-list exposure settle.",
  },
  {
    title: "Weak drywall subcontractor",
    description: "Quality issues may require supplemental crew.",
    category: "trade_performance",
    dollar_exposure: 15000,
    probability: 100,
    schedule_impact_weeks: 1,
    owner: "R. Singh",
    response_path: "accept",
    release_condition: "Drywall quality accepted and rework avoided.",
    released_amount: 0,
    release_note: "",
    hold_class: "E-Hold",
    status: "active",
    due_date: "2026-06-26",
    next_review_at: "2026-06-26",
    notes:
      "Plan: assign foreman to inspect daily and decide whether to supplement manpower by Friday.",
  },
  {
    title: "Late appliance selection",
    description: "Selection delay threatens MEP rough-in sequence.",
    category: "owner_decision",
    dollar_exposure: 12000,
    probability: 100,
    schedule_impact_weeks: 1,
    owner: "K. Alvarez",
    response_path: "accept",
    release_condition: "Appliance package approved and lead times confirmed.",
    released_amount: 0,
    release_note: "",
    hold_class: "E-Hold",
    status: "active",
    due_date: "2026-06-24",
    next_review_at: "2026-06-24",
    notes:
      "Plan: escalate selection decision to owner and document schedule impact if not approved.",
  },
  {
    title: "Window delivery delay",
    description: "Manufacturer pushed ship date five weeks; acceleration may be required.",
    category: "schedule_compression",
    dollar_exposure: 18000,
    probability: 50,
    schedule_impact_weeks: 3,
    owner: "K. Alvarez",
    response_path: "offset",
    release_condition: "Recovered by resequencing dry-in and avoiding acceleration cost.",
    released_amount: 0,
    release_note: "",
    hold_class: "E-Hold",
    status: "active",
    due_date: "2026-06-29",
    next_review_at: "2026-06-29",
    notes: "Plan: resequence dry-in work and price acceleration as a fallback.",
  },
  {
    title: "Lighting allowance overrun",
    description: "Owner selections are trending thirty percent over allowance.",
    category: "allowance_overrun",
    dollar_exposure: 22000,
    probability: 100,
    schedule_impact_weeks: null,
    owner: "M. Chen",
    response_path: "accept",
    release_condition: "Final lighting package signed and purchase orders issued.",
    released_amount: 22000,
    release_note: "Recovered through owner approval of the lighting upgrade.",
    release_updated_at: "2026-06-11T18:00:00.000Z",
    hold_class: "E-Hold",
    status: "recovered",
    due_date: null,
    next_review_at: null,
    notes: "Closed example: dollars were released when the owner accepted the upgrade.",
  },
  {
    title: "Unapproved electrical changes",
    description: "Field changes not yet captured in change orders.",
    category: "field_change",
    dollar_exposure: 9500,
    probability: 100,
    schedule_impact_weeks: null,
    owner: "J. Patel",
    response_path: "offset",
    release_condition: "Electrical field changes approved or offset by buyout savings.",
    released_amount: 9500,
    release_note: "Offset against buyout savings.",
    release_updated_at: "2026-06-11T18:30:00.000Z",
    hold_class: "E-Hold",
    status: "recovered",
    due_date: null,
    next_review_at: null,
    notes: "Closed example: dollars moved out of active E-Hold once the offset was documented.",
  },
  {
    title: "Electrician contingency overrun",
    description: "Known electrical productivity and small-scope contingency.",
    category: "trade_performance",
    dollar_exposure: 2000,
    probability: 100,
    schedule_impact_weeks: null,
    owner: "BMB",
    response_path: "eliminate",
    release_condition: "Accepted within the original contingency plan.",
    released_amount: 2000,
    release_note: "Accepted and closed against planned contingency.",
    release_updated_at: "2026-06-11T19:00:00.000Z",
    hold_class: "C-Hold",
    status: "accepted",
    due_date: null,
    next_review_at: null,
    notes:
      "Closed C-Hold example for teaching the difference between active holds and released risk.",
  },
] as const;

const harborDemoChangeOrders = [
  {
    number: "CO-001",
    description: "Owner-requested wine room expansion",
    contract_amount: 145000,
    cost_amount: 122000,
    status: "Pending",
    probability: 50,
    owner: "PM",
    notes: "Client-facing example waiting on signature.",
    co_type: "owner_change",
    client_visible: true,
    client_status: "sent",
    client_sent_at: "2026-06-10T16:00:00.000Z",
  },
  {
    number: "CO-002",
    description: "Upgraded primary bath stone package",
    contract_amount: 65000,
    cost_amount: 58000,
    status: "Approved",
    probability: 100,
    owner: "PM",
    notes: "Approved change order example.",
    co_type: "owner_change",
    client_visible: true,
    client_status: "approved",
    client_sent_at: "2026-06-05T15:00:00.000Z",
    client_decided_at: "2026-06-07T17:00:00.000Z",
  },
  {
    number: "CO-003",
    description: "Pool equipment relocation",
    contract_amount: 85000,
    cost_amount: 72000,
    status: "Pending",
    probability: 75,
    owner: "PM",
    notes: "Probability-weighted into the IOR rollup.",
    co_type: "owner_change",
    client_visible: true,
    client_status: "sent",
    client_sent_at: "2026-06-12T15:30:00.000Z",
  },
  {
    number: "CO-004",
    description: "Outdoor kitchen scope add",
    contract_amount: 120000,
    cost_amount: 98000,
    status: "Pending",
    probability: 50,
    owner: "PM",
    notes: "Shared with client so the portal shows multiple approval states.",
    co_type: "owner_change",
    client_visible: true,
    client_status: "sent",
    client_sent_at: "2026-06-12T15:35:00.000Z",
  },
] as const;

const HARBOR_DEMO_CPM_ACTIVITIES = [
  {
    activity_id: "01-010",
    name: "Contract award and preconstruction complete",
    division: "00 - Procurement / Preconstruction",
    start_date: "2026-02-03",
    finish_date: "2026-02-07",
    percent_complete: 100,
    predecessor_activity_ids: [],
    successor_activity_ids: ["01-020", "12-010"],
    notes:
      "Baseline launch activity. This anchors the CPM network before site mobilization and long-lead procurement.",
  },
  {
    activity_id: "01-020",
    name: "Site mobilization and layout",
    division: "01 - General Requirements",
    start_date: "2026-02-10",
    finish_date: "2026-02-14",
    percent_complete: 100,
    predecessor_activity_ids: ["01-010"],
    successor_activity_ids: ["31-010"],
    notes:
      "Mobilization, layout, temporary protection, and trade coordination before field production begins.",
  },
  {
    activity_id: "31-010",
    name: "Sitework, utilities, and erosion control",
    division: "31 - Earthwork / Sitework",
    start_date: "2026-02-17",
    finish_date: "2026-02-28",
    percent_complete: 100,
    predecessor_activity_ids: ["01-020"],
    successor_activity_ids: ["03-010"],
    notes:
      "Site readiness activity. Completing this cleanly protects foundation start and early project momentum.",
  },
  {
    activity_id: "03-010",
    name: "Foundations and slab",
    division: "03 - Concrete",
    start_date: "2026-03-03",
    finish_date: "2026-03-21",
    percent_complete: 100,
    predecessor_activity_ids: ["31-010"],
    successor_activity_ids: ["06-010"],
    notes: "Foundation and slab work complete. This drives the structural shell.",
  },
  {
    activity_id: "06-010",
    name: "Framing and structural shell",
    division: "06 - Wood / Framing",
    start_date: "2026-03-24",
    finish_date: "2026-04-18",
    percent_complete: 100,
    predecessor_activity_ids: ["03-010"],
    successor_activity_ids: ["07-010", "22-010", "23-010", "26-010"],
    notes:
      "Structural shell complete. Multiple rough-in and dry-in paths start once this is released.",
  },
  {
    activity_id: "07-010",
    name: "Dry-in envelope and roof",
    division: "07 - Thermal / Moisture",
    start_date: "2026-04-21",
    finish_date: "2026-05-09",
    percent_complete: 100,
    predecessor_activity_ids: ["06-010"],
    successor_activity_ids: ["08-010", "32-010"],
    notes:
      "Dry-in finished one week later than baseline, which contributes to later rough-in and finish pressure.",
  },
  {
    activity_id: "08-010",
    name: "Windows and exterior doors",
    division: "08 - Openings",
    start_date: "2026-05-12",
    finish_date: "2026-06-02",
    percent_complete: 80,
    predecessor_activity_ids: ["07-010"],
    successor_activity_ids: ["09-010"],
    notes:
      "Window delivery moved five weeks. The PM is tracking resequencing before acceleration costs become real exposure.",
  },
  {
    activity_id: "22-010",
    name: "Plumbing rough-in",
    division: "22 - Plumbing",
    start_date: "2026-04-28",
    finish_date: "2026-05-16",
    percent_complete: 100,
    predecessor_activity_ids: ["06-010"],
    successor_activity_ids: ["09-010"],
    notes: "Plumbing rough-in complete and ready for inspection closeout.",
  },
  {
    activity_id: "23-010",
    name: "HVAC rough-in",
    division: "23 - HVAC",
    start_date: "2026-04-28",
    finish_date: "2026-05-16",
    percent_complete: 100,
    predecessor_activity_ids: ["06-010"],
    successor_activity_ids: ["09-010"],
    notes: "HVAC rough-in complete. Coordination hold is now on appliance and opening decisions.",
  },
  {
    activity_id: "26-010",
    name: "Electrical rough-in",
    division: "26 - Electrical",
    start_date: "2026-04-29",
    finish_date: "2026-05-20",
    percent_complete: 100,
    predecessor_activity_ids: ["06-010"],
    successor_activity_ids: ["09-010"],
    notes:
      "Electrical rough-in complete. Lighting allowance exposure remains in the IOR because selections exceeded allowance.",
  },
  {
    activity_id: "09-010",
    name: "Rough inspections and insulation",
    division: "09 - Finishes",
    start_date: "2026-05-23",
    finish_date: "2026-06-05",
    percent_complete: 65,
    predecessor_activity_ids: ["08-010", "22-010", "23-010", "26-010"],
    successor_activity_ids: ["09-020"],
    notes:
      "Rough inspections and insulation are the current handoff point into drywall. This is where the late appliance and window issues show up in the schedule.",
  },
  {
    activity_id: "09-020",
    name: "Drywall hang and finish",
    division: "09 - Finishes",
    start_date: "2026-06-06",
    finish_date: "2026-06-28",
    percent_complete: 40,
    predecessor_activity_ids: ["09-010"],
    successor_activity_ids: ["09-030", "12-020"],
    notes:
      "Drywall is active and under performance watch. If quality slips, the E-Hold becomes a trade-performance recovery action.",
  },
  {
    activity_id: "09-030",
    name: "Tile and interior finish start",
    division: "09 - Finishes",
    start_date: "2026-06-24",
    finish_date: "2026-07-15",
    percent_complete: 20,
    predecessor_activity_ids: ["09-020"],
    successor_activity_ids: ["09-040"],
    notes:
      "Interior finish activity overlaps late drywall areas where possible so the team can claw back schedule without buying full acceleration.",
  },
  {
    activity_id: "12-010",
    name: "Cabinet fabrication and delivery",
    division: "12 - Furnishings / Casework",
    start_date: "2026-04-20",
    finish_date: "2026-07-03",
    percent_complete: 50,
    predecessor_activity_ids: ["01-010"],
    successor_activity_ids: ["12-020"],
    notes:
      "Cabinets were misassembled and damaged. This is a long-lead procurement activity tied directly to a recoverable E-Hold.",
  },
  {
    activity_id: "12-020",
    name: "Cabinet install and built-ins",
    division: "12 - Furnishings / Casework",
    start_date: "2026-07-06",
    finish_date: "2026-07-17",
    percent_complete: 0,
    predecessor_activity_ids: ["09-020", "12-010"],
    successor_activity_ids: ["22-020", "26-020", "09-040"],
    notes:
      "Install cannot start until drywall areas and replacement cabinet delivery are released.",
  },
  {
    activity_id: "22-020",
    name: "Trim plumbing and fixtures",
    division: "22 - Plumbing",
    start_date: "2026-07-20",
    finish_date: "2026-07-28",
    percent_complete: 0,
    predecessor_activity_ids: ["12-020"],
    successor_activity_ids: ["99-010"],
    notes:
      "Trim plumbing follows cabinet and finish release. This should be watched for owner-furnished fixture decisions.",
  },
  {
    activity_id: "26-020",
    name: "Trim electrical and lighting package",
    division: "26 - Electrical",
    start_date: "2026-07-20",
    finish_date: "2026-07-31",
    percent_complete: 0,
    predecessor_activity_ids: ["12-020"],
    successor_activity_ids: ["99-010"],
    notes:
      "Lighting selections drove allowance exposure. This activity shows how financial exposure and CPM logic meet.",
  },
  {
    activity_id: "09-040",
    name: "Paint, final finishes, and punch prep",
    division: "09 - Finishes",
    start_date: "2026-07-18",
    finish_date: "2026-08-01",
    percent_complete: 0,
    predecessor_activity_ids: ["09-030", "12-020"],
    successor_activity_ids: ["99-010"],
    notes:
      "Final finishes are the point where the C-Hold for finish-phase uncertainty should be gardened and then released.",
  },
  {
    activity_id: "32-010",
    name: "Exterior hardscape and pool coordination",
    division: "32 - Exterior Improvements",
    start_date: "2026-06-17",
    finish_date: "2026-08-07",
    percent_complete: 30,
    predecessor_activity_ids: ["07-010"],
    successor_activity_ids: ["99-010"],
    notes:
      "Pool equipment relocation and outdoor kitchen change orders are shown here as schedule-adjacent scope exposure.",
  },
  {
    activity_id: "99-010",
    name: "Final punch, owner walk, and substantial completion",
    division: "99 - Closeout",
    start_date: "2026-08-10",
    finish_date: "2026-08-21",
    percent_complete: 0,
    predecessor_activity_ids: ["22-020", "26-020", "09-040", "32-010"],
    successor_activity_ids: [],
    notes:
      "Closeout milestone. This rolls the CPM story into the IOR: current schedule is later than baseline, and risk decisions decide how much margin is protected.",
  },
] as const;

const safeErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";

const roundWeeks = (baseline: string | null, forecast: string | null) =>
  computeScheduleVarianceWeeks(baseline, forecast) ?? 0;

const isScheduleActivitiesSchemaError = (error: DynamicSupabaseError | null) => {
  const message = (error?.message ?? "").toLowerCase();
  return message.includes("schedule_activities") || message.includes("schema cache");
};

const normalizeDemoText = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export const isHarborDemoProjectName = (name: unknown) => {
  const normalizedName = normalizeDemoText(name);
  return (
    normalizedName === HARBOR_DEMO_NAME.toLowerCase() ||
    normalizedName.includes(HARBOR_DEMO_NAME.toLowerCase())
  );
};

export const isHarborDemoProject = (project: Record<string, unknown> | null | undefined) => {
  if (!project) return false;
  const jobNumber = normalizeDemoText(project.job_number);
  const client = normalizeDemoText(project.client);

  return (
    isHarborDemoProjectName(project.name) ||
    jobNumber === HARBOR_DEMO_JOB_NUMBER.toLowerCase() ||
    jobNumber.includes("harbor") ||
    client === HARBOR_DEMO_CLIENT.toLowerCase()
  );
};

const seedHarborDemoCpmActivities = async (
  supabase: unknown,
  projectId: string,
  seedWarnings: string[],
) => {
  const { data: existingRows, error: lookupError } = await dynamicTable(
    supabase,
    "schedule_activities",
  )
    .select("id,activity_id,division")
    .eq("project_id", projectId)
    .limit(50);

  if (lookupError) {
    if (isScheduleActivitiesSchemaError(lookupError)) {
      seedWarnings.push(`CPM demo skipped: ${lookupError.message}`);
      return;
    }
    throw new Error(lookupError.message);
  }

  const rows = Array.isArray(existingRows)
    ? (existingRows as Array<{ activity_id?: string | null; division?: string | null }>)
    : [];
  const existingActivityIds = new Set(
    rows.map((row) => row.activity_id).filter((id): id is string => Boolean(id)),
  );
  const alreadySeeded = existingActivityIds.has(HARBOR_DEMO_FIRST_CPM_ACTIVITY_ID);
  if (alreadySeeded) return { insertedCount: 0, refreshedPlaceholders: false };

  const onlyGeneratedMilestonePlaceholders =
    rows.length > 0 &&
    rows.every(
      (row) =>
        (row.activity_id ?? "").startsWith("A-") &&
        ((row.division ?? "").toLowerCase() === "milestones" || !row.division),
    );

  if (onlyGeneratedMilestonePlaceholders) {
    const { error: deleteError } = await dynamicTable(supabase, "schedule_activities")
      .delete()
      .eq("project_id", projectId);
    if (deleteError) {
      if (isScheduleActivitiesSchemaError(deleteError)) {
        seedWarnings.push(`CPM demo refresh skipped: ${deleteError.message}`);
        return { insertedCount: 0, refreshedPlaceholders: false };
      }
      throw new Error(deleteError.message);
    }
    existingActivityIds.clear();
  }

  const rowsToInsert = HARBOR_DEMO_CPM_ACTIVITIES.filter(
    (activity) => !existingActivityIds.has(activity.activity_id),
  );
  if (rowsToInsert.length === 0) {
    return { insertedCount: 0, refreshedPlaceholders: onlyGeneratedMilestonePlaceholders };
  }

  const { error: insertError } = await dynamicTable(supabase, "schedule_activities").insert(
    rowsToInsert.map((activity) => ({
      project_id: projectId,
      ...activity,
      sort_order:
        HARBOR_DEMO_CPM_ACTIVITIES.findIndex((demo) => demo.activity_id === activity.activity_id) +
        1,
    })),
  );

  if (insertError) {
    if (isScheduleActivitiesSchemaError(insertError)) {
      seedWarnings.push(`CPM demo insert skipped: ${insertError.message}`);
      return { insertedCount: 0, refreshedPlaceholders: onlyGeneratedMilestonePlaceholders };
    }
    throw new Error(insertError.message);
  }

  return {
    insertedCount: rowsToInsert.length,
    refreshedPlaceholders: onlyGeneratedMilestonePlaceholders,
  };
};

export const getHarborDemoCpmActivityRows = (projectId: string) =>
  HARBOR_DEMO_CPM_ACTIVITIES.map((activity, index) => ({
    id: `harbor-demo-${activity.activity_id}`,
    project_id: projectId,
    ...activity,
    sort_order: index + 1,
  }));

export const ensureHarborDemoCpmActivitiesForProject = async (
  supabase: unknown,
  projectId: string,
  seedWarnings: string[] = [],
) => {
  const { data: projectRow, error: projectError } = await dynamicTable(supabase, "projects")
    .select("name,job_number,client")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError) {
    seedWarnings.push(`CPM demo project check skipped: ${projectError.message}`);
    return { ensured: false, insertedCount: 0, seedWarnings };
  }

  if (!isHarborDemoProject(projectRow as Record<string, unknown> | null)) {
    return { ensured: false, insertedCount: 0, seedWarnings };
  }

  const result = await seedHarborDemoCpmActivities(supabase, projectId, seedWarnings);
  return {
    ensured: true,
    insertedCount: result?.insertedCount ?? 0,
    refreshedPlaceholders: result?.refreshedPlaceholders ?? false,
    seedWarnings,
  };
};

const ensureHarborDemoProjectManager = async (
  supabase: unknown,
  projectId: string,
  seedWarnings: string[],
) => {
  const { error: projectError } = await dynamicTable(supabase, "projects")
    .update({ project_manager: HARBOR_DEMO_PROJECT_MANAGER })
    .eq("id", projectId);
  if (projectError) seedWarnings.push(`Harbor PM update skipped: ${projectError.message}`);

  const { error: reportError } = await dynamicTable(supabase, "daily_reports")
    .update({ author: HARBOR_DEMO_PROJECT_MANAGER })
    .eq("project_id", projectId)
    .eq("author", "Overwatch Demo PM");
  if (reportError)
    seedWarnings.push(`Harbor daily report author update skipped: ${reportError.message}`);

  const { error: reviewError } = await dynamicTable(supabase, "reviews")
    .update({ reviewer: HARBOR_DEMO_PROJECT_MANAGER })
    .eq("project_id", projectId)
    .eq("reviewer", "Overwatch Demo PM");
  if (reviewError) seedWarnings.push(`Harbor review author update skipped: ${reviewError.message}`);
};

export const seedDemoIfEmpty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: ensuredOrganizationId, error: accountError } = await context.supabase.rpc(
      "ensure_current_user_account",
    );
    if (accountError) throw new Error(accountError.message);
    if (!ensuredOrganizationId)
      throw new Error("No Overwatch company workspace is available for this user.");

    let organizationId = ensuredOrganizationId as string;
    const { data: memberships, error: membershipsError } = await context.supabase
      .from("organization_memberships")
      .select("organization_id,created_at")
      .eq("user_id", context.userId)
      .eq("status", "active")
      .order("created_at", { ascending: true });
    if (membershipsError) throw new Error(membershipsError.message);
    const activeOrganizationId = memberships?.find((m) => m.organization_id)?.organization_id;
    if (activeOrganizationId) organizationId = activeOrganizationId as string;

    const seedWarnings: string[] = [];

    const { data: existingDemo, error: demoLookupError } = await context.supabase
      .from("projects")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("job_number", HARBOR_DEMO_JOB_NUMBER)
      .maybeSingle();
    if (demoLookupError) throw new Error(demoLookupError.message);
    if (existingDemo?.id) {
      await ensureHarborDemoProjectManager(
        context.supabase,
        existingDemo.id as string,
        seedWarnings,
      );
      await seedHarborDemoCpmActivities(context.supabase, existingDemo.id as string, seedWarnings);
      return {
        seeded: false as const,
        exists: true,
        demoProjectId: existingDemo.id as string,
        seedWarnings,
      };
    }

    const { data: existingHarbor, error: harborLookupError } = await context.supabase
      .from("projects")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("name", HARBOR_DEMO_NAME)
      .eq("client", HARBOR_DEMO_CLIENT)
      .limit(1)
      .maybeSingle();
    if (harborLookupError) throw new Error(harborLookupError.message);
    if (existingHarbor?.id) {
      await ensureHarborDemoProjectManager(
        context.supabase,
        existingHarbor.id as string,
        seedWarnings,
      );
      await seedHarborDemoCpmActivities(
        context.supabase,
        existingHarbor.id as string,
        seedWarnings,
      );
      return {
        seeded: false as const,
        exists: true,
        demoProjectId: existingHarbor.id as string,
        seedWarnings,
      };
    }

    const projectInsert = {
      owner_id: context.userId,
      organization_id: organizationId,
      job_number: HARBOR_DEMO_JOB_NUMBER,
      name: HARBOR_DEMO_NAME,
      client: HARBOR_DEMO_CLIENT,
      project_manager: HARBOR_DEMO_PROJECT_MANAGER,
      original_contract: 3200000,
      original_cost_budget: 2720000,
      phase: "Middle" as const,
      percent_complete: 60,
      baseline_completion_date: "2026-05-16",
      forecast_completion_date: "2026-06-30",
      schedule_variance_weeks: 6,
      hold_variance_note:
        "Demo note: E-Hold and C-Hold levels are carried so the IOR shows how active risk protects gross profit.",
      last_reviewed_at: "2026-06-11T17:48:00.000Z",
      next_review_at: "2026-06-25T17:00:00.000Z",
      last_review_summary:
        "Project remains on budget before holds, but a six-week schedule slip and open exposure ledger are actively eroding indicated gross profit.",
    };

    const { data: projectRow, error: projectError } = await context.supabase
      .from("projects")
      .insert(projectInsert)
      .select("id")
      .single();
    if (projectError?.code === "23505") {
      const { data: retryDemo, error: retryError } = await context.supabase
        .from("projects")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("job_number", HARBOR_DEMO_JOB_NUMBER)
        .maybeSingle();
      if (retryError) throw new Error(retryError.message);
      if (retryDemo?.id) {
        await seedHarborDemoCpmActivities(context.supabase, retryDemo.id as string, seedWarnings);
        return {
          seeded: false as const,
          exists: true,
          demoProjectId: retryDemo.id as string,
          seedWarnings,
        };
      }
    }
    throwIfProjectSchemaError(projectError);
    if (projectError) throw new Error(projectError.message);
    if (!projectRow?.id) throw new Error("Harbor demo project did not save.");

    const projectId = projectRow.id as string;

    const { error: bucketError } = await context.supabase.from("cost_buckets").insert(
      harborDemoBuckets.map((bucket, index) => ({
        project_id: projectId,
        ...bucket,
        source_type: "original_sov" as const,
        source_date: "2026-06-01",
        source_note: "Seeded Harbor Residence demo SOV.",
        sort_order: index + 1,
      })),
    );
    if (bucketError) throw new Error(bucketError.message);

    const { data: exposureRows, error: exposureError } = await context.supabase
      .from("exposures")
      .insert(
        harborDemoExposures.map((exposure) => ({
          project_id: projectId,
          ...exposure,
        })),
      )
      .select("id,title");
    if (exposureError) throw new Error(exposureError.message);
    const exposureIdByTitle = new Map(
      (exposureRows ?? []).map((row) => [row.title as string, row.id as string]),
    );

    const { data: changeOrderRows, error: changeOrderError } = await context.supabase
      .from("change_orders")
      .insert(harborDemoChangeOrders.map((co) => ({ project_id: projectId, ...co })))
      .select("id,number");
    if (changeOrderError) throw new Error(changeOrderError.message);
    const changeOrderIdByNumber = new Map(
      (changeOrderRows ?? []).map((row) => [row.number as string, row.id as string]),
    );

    const { error: decisionError } = await context.supabase.from("decisions").insert([
      {
        project_id: projectId,
        decision: "Recover cabinet replacement credit",
        impact: "Protects $20,000 E-Hold and two weeks of schedule exposure.",
        owner: "PM",
        due_date: "2026-06-28",
        status: "open",
        linked_exposure_id:
          exposureIdByTitle.get("Cabinets misassembled and damaged on delivery") ?? null,
        notes: "Send vendor letter, attach photos, and confirm replacement delivery date.",
      },
      {
        project_id: projectId,
        decision: "Escalate appliance selection to owner",
        impact: "Unblocks MEP rough-in and protects $12,000 in likely exposure.",
        owner: "K. Alvarez",
        due_date: "2026-06-24",
        status: "overdue",
        linked_exposure_id: exposureIdByTitle.get("Late appliance selection") ?? null,
        notes:
          "Decision is intentionally overdue in the demo so the To-Dos tab has a clear teaching example.",
      },
      {
        project_id: projectId,
        decision: "Decide whether to supplement drywall manpower",
        impact: "Mitigates $15,000 trade performance exposure.",
        owner: "R. Singh",
        due_date: "2026-06-26",
        status: "in_progress",
        linked_exposure_id: exposureIdByTitle.get("Weak drywall subcontractor") ?? null,
        notes: "Review daily production and quality before Friday.",
      },
      {
        project_id: projectId,
        decision: "Hold finish contingency until trim scope is stable",
        impact: "Preserves $65,000 C-Hold until closeout risk is known.",
        owner: "Executive",
        due_date: "2026-07-15",
        status: "open",
        linked_exposure_id: exposureIdByTitle.get("Remaining finish-phase uncertainty") ?? null,
        notes: "This explains why C-Holds are managed differently than known E-Holds.",
      },
    ]);
    if (decisionError) throw new Error(decisionError.message);

    const { data: billingApplication, error: billingError } = await context.supabase
      .from("billing_applications")
      .insert({
        project_id: projectId,
        application_number: "Pay App 1",
        invoice_number: "DEMO-2601-1",
        submitted_date: "2026-06-21",
        due_date: "2026-07-21",
        billing_period: "Current cycle",
        contract_amount: 3461250,
        change_order_amount: 65000,
        amount_billed: 2120250,
        paid_to_date: 1200000,
        retainage: 212025,
        status: "submitted",
        notes: "Demo pay application shared to show client-facing billing posture.",
        sort_order: 1,
      })
      .select("id")
      .single();
    if (billingError) throw new Error(billingError.message);
    await recordBillingApplicationEvent(context.supabase, {
      billing_application_id: billingApplication.id,
      project_id: projectId,
      event_type: "created",
      from_status: "",
      to_status: "submitted",
      amount: 2120250,
      notes: "Demo pay application opened for client-facing billing posture.",
    });

    const { data: milestoneRows, error: milestoneError } = await context.supabase
      .from("schedule_milestones")
      .insert([
        {
          project_id: projectId,
          name: "Cabinet install",
          baseline_date: "2026-06-22",
          forecast_date: "2026-07-06",
          status: "delayed",
          delay_reason: "Cabinets were misassembled and damaged by the manufacturer.",
          owner: "BMB",
          sort_order: 1,
        },
        {
          project_id: projectId,
          name: "MEP rough-in release",
          baseline_date: "2026-06-15",
          forecast_date: "2026-06-29",
          status: "at_risk",
          delay_reason: "Appliance package and window delivery are pushing the rough-in sequence.",
          owner: "K. Alvarez",
          sort_order: 2,
        },
        {
          project_id: projectId,
          name: "Substantial completion",
          baseline_date: "2026-05-16",
          forecast_date: "2026-06-30",
          status: "delayed",
          delay_reason: "Current completion forecast is six weeks past baseline.",
          owner: "PM",
          sort_order: 3,
        },
      ])
      .select("id,name,baseline_date,forecast_date,status,delay_reason");
    if (milestoneError) throw new Error(milestoneError.message);

    const { data: updateRow, error: scheduleUpdateError } = await context.supabase
      .from("schedule_updates")
      .insert({
        project_id: projectId,
        update_number: 1,
        update_date: "2026-06-11",
        baseline_completion_date: "2026-05-16",
        forecast_completion_date: "2026-06-30",
        variance_weeks: 6,
        movement_weeks: 0,
        notes:
          "Initial Harbor Residence demo schedule update. Forecast completion moved because window delivery and cabinet procurement are affecting the critical path.",
      })
      .select("id")
      .single();
    if (scheduleUpdateError) throw new Error(scheduleUpdateError.message);

    const { error: milestoneUpdateError } = await context.supabase
      .from("schedule_milestone_updates")
      .insert(
        (milestoneRows ?? []).map((milestone) => ({
          project_id: projectId,
          milestone_id: milestone.id as string,
          schedule_update_id: updateRow.id as string,
          update_number: 1,
          baseline_date: (milestone.baseline_date as string | null) ?? null,
          forecast_date: (milestone.forecast_date as string | null) ?? null,
          variance_weeks: roundWeeks(
            (milestone.baseline_date as string | null) ?? null,
            (milestone.forecast_date as string | null) ?? null,
          ),
          status: str(milestone.status, "on_track"),
          notes: str(milestone.delay_reason),
        })),
      );
    if (milestoneUpdateError) throw new Error(milestoneUpdateError.message);

    await seedHarborDemoCpmActivities(context.supabase, projectId, seedWarnings);

    const { error: scheduleRiskError } = await context.supabase.from("schedule_risks").insert([
      {
        project_id: projectId,
        kind: "procurement",
        title: "Cabinets misassembled and damaged on delivery",
        detail:
          "Cabinet replacement is driving two weeks of schedule exposure and a vendor recovery action.",
        dollar_exposure: 20000,
        probability: 100,
        schedule_impact_weeks: 2,
        owner: "PM",
        due_date: "2026-07-06",
        response_path: "recover",
        hold_class: "E-Hold",
        linked_exposure_id:
          exposureIdByTitle.get("Cabinets misassembled and damaged on delivery") ?? null,
        status: "active",
        sort_order: 1,
      },
      {
        project_id: projectId,
        kind: "critical_decision",
        title: "Late appliance selection",
        detail: "Owner decision is needed to release MEP rough-in sequence.",
        dollar_exposure: 12000,
        probability: 100,
        schedule_impact_weeks: 1,
        owner: "K. Alvarez",
        due_date: "2026-06-24",
        response_path: "accept",
        hold_class: "E-Hold",
        linked_exposure_id: exposureIdByTitle.get("Late appliance selection") ?? null,
        status: "active",
        sort_order: 2,
      },
      {
        project_id: projectId,
        kind: "trade_performance",
        title: "Weak drywall subcontractor",
        detail: "Quality misses may require supplemental crew or backcharge tracking.",
        dollar_exposure: 15000,
        probability: 100,
        schedule_impact_weeks: 1,
        owner: "R. Singh",
        due_date: "2026-06-26",
        response_path: "accept",
        hold_class: "E-Hold",
        linked_exposure_id: exposureIdByTitle.get("Weak drywall subcontractor") ?? null,
        status: "active",
        sort_order: 3,
      },
      {
        project_id: projectId,
        kind: "procurement",
        title: "Window delivery delay",
        detail: "Manufacturer pushed ship date five weeks; resequencing may prevent acceleration.",
        dollar_exposure: 18000,
        probability: 50,
        schedule_impact_weeks: 3,
        owner: "K. Alvarez",
        due_date: "2026-06-29",
        response_path: "offset",
        hold_class: "E-Hold",
        linked_exposure_id: exposureIdByTitle.get("Window delivery delay") ?? null,
        status: "active",
        sort_order: 4,
      },
    ]);
    if (scheduleRiskError) throw new Error(scheduleRiskError.message);

    const { error: reportError } = await context.supabase.from("daily_reports").insert([
      {
        project_id: projectId,
        report_date: "2026-06-10",
        author: HARBOR_DEMO_PROJECT_MANAGER,
        weather: "Clear, 84F",
        crew_count: 18,
        work_performed:
          "Drywall crew continued second-floor finish work. Cabinet delivery inspected and damage documented.",
        delays: "Cabinet replacement and appliance selection remain schedule constraints.",
        safety_notes: "No incidents. Reviewed material staging and housekeeping.",
        notes: "Client-visible demo log so the client portal has field-report context.",
        client_visible: true,
      },
      {
        project_id: projectId,
        report_date: "2026-06-11",
        author: HARBOR_DEMO_PROJECT_MANAGER,
        weather: "Humid, afternoon rain",
        crew_count: 16,
        work_performed:
          "MEP coordination walk completed. Drywall quality review found minor rework in two rooms.",
        delays: "Potential acceleration cost if window delivery date cannot be recovered.",
        safety_notes: "Reviewed ladder safety after rain.",
        notes: "Internal demo log showing that not every daily report has to be client visible.",
        client_visible: false,
      },
    ]);
    if (reportError) throw new Error(reportError.message);

    const { error: reviewError } = await context.supabase.from("reviews").insert({
      project_id: projectId,
      reviewed_at: "2026-06-11T17:48:00.000Z",
      reviewer: HARBOR_DEMO_PROJECT_MANAGER,
      forecast_completion_date_before: "2026-06-16",
      forecast_completion_date_after: "2026-06-30",
      summary_notes:
        "Project remains profitable before holds, but schedule movement and live exposures are reducing indicated gross profit. Owner decisions and vendor recovery actions need to close this cycle.",
      body_markdown:
        "## Executive IOR Narrative\n\nHarbor Residence began as a 15.0% gross-profit job. Current schedule movement, live E-Holds, and C-Hold contingency reduce indicated gross profit until the team recovers or releases the exposure ledger.\n\n### Management focus\n\n1. Recover cabinet vendor exposure.\n2. Resolve appliance decision before MEP rough-in slips further.\n3. Hold finish contingency until closeout risk is clearer.",
      status: "published",
      email_recipients: [],
      pdf_style: "executive",
      kpi_snapshot: {
        original_gp: 480000,
        gp_at_risk: 261750,
        indicated_gp: 218250,
        schedule_variance_weeks: 6,
      } as Json,
    });
    if (reviewError) throw new Error(reviewError.message);

    try {
      const demoClientEmail = "demo.client@overwatch.example";
      const { data: existingContact, error: existingContactError } = await context.supabase
        .from("client_contacts")
        .select("id")
        .eq("organization_id", organizationId)
        .ilike("email", demoClientEmail)
        .limit(1)
        .maybeSingle();
      if (existingContactError) throw existingContactError;

      let contactId = (existingContact?.id as string | undefined) ?? "";
      if (!contactId) {
        const { data: contact, error: contactError } = await context.supabase
          .from("client_contacts")
          .insert({
            organization_id: organizationId,
            created_by: context.userId,
            name: "Demo Client Rep",
            email: demoClientEmail,
            company: HARBOR_DEMO_CLIENT,
            title: "Owner Representative",
            notes: "Seeded client contact for the Harbor Residence demo portal.",
          })
          .select("id")
          .single();
        if (contactError) throw contactError;
        contactId = contact.id as string;
      }

      const { error: accessError } = await context.supabase.from("project_client_access").insert({
        project_id: projectId,
        contact_id: contactId,
        email: demoClientEmail,
        role: "client",
        status: "pending",
        can_view_change_orders: true,
        can_view_daily_reports: true,
        can_view_billing: true,
        invited_by: context.userId,
        last_sent_at: "2026-06-12T16:00:00.000Z",
      });
      if (accessError) throw accessError;

      const approvedCoId = changeOrderIdByNumber.get("CO-002");
      if (approvedCoId) {
        const { error: approvalError } = await context.supabase
          .from("change_order_approvals")
          .insert({
            project_id: projectId,
            change_order_id: approvedCoId,
            contact_id: contactId,
            client_email: demoClientEmail,
            decision: "approved",
            notes: "Demo approval record.",
            document_version: "demo-v1",
          });
        if (approvalError) throw approvalError;
      }
    } catch (error) {
      seedWarnings.push(`client portal demo skipped: ${safeErrorMessage(error)}`);
    }

    return { seeded: true as const, exists: true, demoProjectId: projectId, seedWarnings };
  });
