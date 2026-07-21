import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { normalizeBillingNumberLabel } from "@/lib/billing-labels";
import { centsToDollars, dollarsToCents, quantizeDollars } from "@/lib/payments-domain";
import { COMPANY_ASSET_BUCKET, companyLogoPath, versionAssetUrl } from "@/lib/company-assets";
import {
  HARBOR_DEMO_CLIENT,
  HARBOR_DEMO_COMMERCIAL_WORKFLOW,
  HARBOR_DEMO_CPM_WALKTHROUGH,
  HARBOR_DEMO_JOB_NUMBER,
  HARBOR_DEMO_MODULES,
  HARBOR_DEMO_NAME,
  harborDemoSeedAction,
  isHarborDemoProject,
  planHarborDemoModules,
  type HarborDemoModuleKey,
} from "@/lib/demo-seed";
import {
  HARBOR_DEMO_PRODUCTION_DAYS,
  HARBOR_DEMO_TOMORROW_PLAN_DATE,
  type HarborProductionDay,
  type HarborProductionLine,
} from "@/lib/harbor-production-demo";
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
import { summarizeSubCostByBucket } from "@/lib/subcontract-budget";
import {
  applySelfPerformToBuckets,
  commitmentBySubBucket,
  netSelfPerformByReconciled,
  selfPerformCostByBucket,
  subCommitmentKey,
  type DailyWipRowLike,
} from "@/lib/daily-wip";

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
  upsert(
    values: unknown,
    options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): DynamicSupabaseQuery;
  in(column: string, values: readonly string[]): Promise<DynamicSupabaseResult<unknown[]>>;
  eq(column: string, value: unknown): DynamicSupabaseQuery;
  is(column: string, value: unknown): DynamicSupabaseQuery;
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
type DynamicSupabaseRpcClient = {
  rpc(
    functionName: string,
    args?: Record<string, unknown>,
  ): PromiseLike<DynamicSupabaseResult<unknown>>;
};

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as DynamicSupabaseClient).from(relation);
const dynamicRpc = (supabase: unknown, functionName: string, args?: Record<string, unknown>) =>
  (supabase as DynamicSupabaseRpcClient).rpc(functionName, args);
const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;
const MAX_SAFE_DOLLARS = MAX_SAFE_CENTS / 100;

export type COStatus = "Approved" | "Pending" | "Denied";
export type DecisionStatus = "open" | "in_progress" | "resolved" | "overdue";
export type DecisionReminderChannel = "none" | "in_app" | "email";
export type ClientChangeOrderStatus = "not_sent" | "sent" | "approved" | "rejected";

export interface DecisionOwnerOption {
  user_id: string;
  label: string;
  email: string;
  role: string;
  scope: "project" | "company";
}

export interface ProjectRow {
  id: string;
  /** Optimistic-concurrency version for audited project-header commands. */
  updated_at: string;
  organization_id: string | null;
  organization_name: string;
  organization_logo_url: string;
  job_number: string;
  name: string;
  client: string;
  original_contract: number;
  original_cost_budget: number;
  default_retainage_pct: number;
  /** Default output document for new pay applications (GETTINGPAID3). */
  default_output_format: BillingOutputFormat;
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
  archived_at: string | null;
  /** Close-out: null = open/active; a timestamp = the job was closed out. */
  closed_at: string | null;
  /**
   * BUDGETLOCK1: when the cost-budget baseline was frozen. null = unlocked
   * (setup). Once locked, original_budget edits are refused — budget changes
   * flow only through approved change-order cost allocations.
   */
  budget_locked_at: string | null;
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
  /**
   * CO↔RISK link: the change order this exposure is tagged to (or that was
   * spun off from it), or null. Reference only — no rollup effect.
   */
  linked_change_order_id: string | null;
  /** CLAIM↔RISK link: the claim this risk is tracked as, or null. */
  linked_claim_id: string | null;
}

export type COType =
  | "owner_change"
  | "design_error"
  | "design_omission"
  | "unforeseen_condition"
  | "missed_scope"
  | "sub_issued"
  | "other";

export type COFinancialDirection = "addition" | "credit";

/** How a change order is priced. Ships in the structured-fields migration. */
export type COPricingMethod =
  "lump_sum" | "time_and_materials" | "unit_price" | "allowance" | "other";

export interface ChangeOrderRow {
  id: string;
  project_id: string;
  number: string;
  description: string;
  contract_amount: number;
  cost_amount: number;
  /** Addition increases the owner contract; credit is a deductive change. */
  financial_direction: COFinancialDirection;
  status: COStatus;
  probability: number;
  owner: string;
  notes: string;
  co_type: COType;
  /** How this CO is priced (lump sum, T&M, unit price, allowance). */
  pricing_method: COPricingMethod;
  /** Calendar days this CO adds to the schedule (0 = no time impact). */
  schedule_impact_days: number;
  /** Who requested / initiated this change. Free text. */
  requested_by: string;
  /** When the change was first initiated, or null. */
  date_initiated: string | null;
  client_visible: boolean;
  client_status: ClientChangeOrderStatus;
  client_notes: string;
  client_sent_at: string | null;
  client_decided_at: string | null;
  /**
   * CO↔RISK link: the risk-tally exposure this change order is tagged to (or
   * that was spun off from it), or null. Reference only — no rollup effect.
   */
  linked_exposure_id: string | null;
  /** CLAIM↔CO link: the claim this change order was promoted from, or null. */
  linked_claim_id: string | null;
  created_at: string;
  updated_at: string;
}

export type InspectionStatus =
  "planned" | "requested" | "scheduled" | "passed" | "failed" | "partial" | "cancelled";

export type InspectionResult = "pending" | "pass" | "fail" | "partial" | "cancelled";

export interface InspectionRow {
  id: string;
  project_id: string;
  parent_inspection_id: string | null;
  seed_key: string;
  inspection_type: string;
  authority: string;
  location: string;
  responsible_party: string;
  inspector: string;
  requested_date: string | null;
  scheduled_date: string | null;
  completed_date: string | null;
  status: InspectionStatus;
  result: InspectionResult;
  attempt_number: number;
  required_reinspection: boolean;
  cost_impact: number;
  schedule_impact_weeks: number | null;
  notes: string;
  corrective_action: string;
  risk_exposure_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ClaimType =
  "delay" | "extension_of_time" | "delay_damages" | "acceleration" | "disruption" | "other";

export type ClaimStatus =
  | "in_preparation"
  | "submitted"
  | "pending_review"
  | "under_review"
  | "reviewed"
  | "resolved"
  | "rejected"
  | "withdrawn";

export interface ClaimRow {
  id: string;
  project_id: string;
  seed_key: string;
  claim_number: string;
  title: string;
  description: string;
  claim_type: ClaimType;
  status: ClaimStatus;
  money_claimed: number;
  time_claimed_days: number;
  money_awarded: number;
  time_awarded_days: number;
  outcome: string;
  owner: string;
  submitted_at: string | null;
  resolved_at: string | null;
  /** The risk-tally exposure this claim came from / is tracked against. */
  risk_exposure_id: string | null;
  /** The change order this claim resolved into, if any. */
  change_order_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ClaimEventType =
  | "submitted"
  | "received"
  | "reviewed"
  | "meeting"
  | "returned_for_revision"
  | "resubmitted"
  | "resolved"
  | "other";

export interface ClaimEventRow {
  id: string;
  claim_id: string;
  project_id: string;
  seed_key: string;
  event_type: ClaimEventType;
  event_date: string | null;
  revision_number: number;
  note: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ClaimDocType = "claim" | "supporting" | "correspondence" | "other";

export interface ClaimDocumentRow {
  id: string;
  claim_id: string;
  project_id: string;
  storage_path: string;
  file_name: string;
  doc_type: ClaimDocType;
  note: string;
  uploaded_at: string;
  created_by: string | null;
}

export type CoDocType = "backup" | "quote" | "correspondence" | "other";

export interface ChangeOrderDocumentRow {
  id: string;
  change_order_id: string;
  project_id: string;
  storage_path: string;
  file_name: string;
  doc_type: CoDocType;
  note: string;
  uploaded_at: string;
  created_by: string | null;
}

export interface BucketRow {
  id: string;
  project_id: string;
  cost_code: string;
  bucket: string;
  /**
   * BUDGETVSCONTRACT1: the billable value of this SOV line — what the owner
   * pays for this scope. Distinct from original_budget (internal cost). 0 =
   * unpriced; the ledger shows a "needs contract value" state, never a fake
   * zero margin. Line margin = contract_value − original_budget.
   */
  contract_value: number;
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
  /**
   * What the application produces: a client invoice (default) or a formal
   * AIA G702/G703 package. Companies that never pick AIA never see AIA
   * affordances beyond this choice (GETTINGPAID1).
   */
  output_format: BillingOutputFormat;
  notes: string;
  sort_order: number;
  status_events: BillingApplicationEventRow[];
}

export type BillingOutputFormat = "invoice" | "aia_g702";

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
  "draft" | "sent" | "viewed" | "partially_paid" | "paid" | "overdue" | "void";

export type PaymentStatus = "pending" | "succeeded" | "failed" | "refunded" | "void";
export type OnlinePaymentStatus =
  "not_enabled" | "pending" | "paid" | "expired" | "failed" | "refunded";

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
  /** Emails the invoice was last sent to (send/view tracking, GETTINGPAID1). */
  sent_recipients: string[];
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  view_count: number;
  /** Append-only plain-text collections activity log. */
  collections_log: string;
  paid_at: string | null;
  notes: string;
  /**
   * Per-invoice payment method toggles (direct_bank/card/ach_debit/
   * allow_stripe_over_threshold). {} inherits the company defaults; resolve
   * with resolveEnabledMethods from payments-domain.
   */
  enabled_payment_methods: Record<string, boolean>;
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
  /** Check number, wire confirmation, or ACH trace the contractor recorded. */
  reference: string;
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
  owner_email: string;
  owner_user_id: string | null;
  due_date: string | null;
  status: DecisionStatus;
  linked_exposure_id: string | null;
  linked_co_id: string | null;
  reminder_enabled: boolean;
  reminder_at: string | null;
  reminder_channel: DecisionReminderChannel;
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
  /** Storage path of the last PDF sent to the client (empty until first send / pre-migration). */
  pdf_path: string;
  /** When the review PDF was last emailed to the client (null until first send / pre-migration). */
  last_sent_at: string | null;
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);

/**
 * Financial authority must never turn a missing, redacted, or malformed value
 * into a healthy-looking zero. Optional product metadata can keep using `num`,
 * but every value that contributes to Budget, SOV, Billing, or cash truth goes
 * through this fail-closed reader.
 */
export function financialNum(value: unknown, field: string): number {
  if (value === null || value === undefined || value === "") {
    throw new Error(`Financial data unavailable: ${field} is missing.`);
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Financial data unavailable: ${field} is not a valid number.`);
  }
  return parsed;
}

function requireFinancialRows<T>(
  data: T[] | null,
  error: { message?: string } | null,
  relation: string,
): T[] {
  if (error) {
    throw new Error(
      `Financial data unavailable: ${relation} could not be loaded (${error.message ?? "unknown database error"}). Do not rely on Budget, SOV, Billing, or cash totals until this is corrected.`,
    );
  }
  if (!Array.isArray(data)) {
    throw new Error(
      `Financial data unavailable: ${relation} returned no authoritative result. Do not rely on Budget, SOV, Billing, or cash totals until this is corrected.`,
    );
  }
  return data;
}

const exactCentMoney = z
  .number()
  .finite()
  .min(0)
  .refine((value) => Number.isSafeInteger(Math.round(value * 100)), {
    message: "Money exceeds the supported accounting range.",
  })
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7, {
    message: "Money must be exact to the cent.",
  })
  .transform((value) => Math.round(value * 100) / 100);

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

/**
 * Phase 3 capability split: the organizations base row is readable only by
 * holders of company.manage_settings / billing.manage / company.manage_team.
 * Every other member reads the SECURITY DEFINER organizations_directory
 * projection (identity + plan + quota fields; membership checked inside).
 * Returns undefined when the RPC is not deployed yet (pre-migration window)
 * so callers can keep the legacy direct read; null when the caller is not a
 * member of that organization.
 */
async function organizationDirectoryRow(
  context: { supabase: unknown },
  organizationId: string,
): Promise<Record<string, unknown> | null | undefined> {
  const res = await dynamicRpc(context.supabase, "organizations_directory", {
    p_org_id: organizationId,
  });
  if (res.error) {
    const message = (res.error.message ?? "").toLowerCase();
    const rpcMissing =
      res.error.code === "PGRST202" ||
      res.error.code === "42883" ||
      message.includes("function organizations_directory");
    if (rpcMissing) return undefined;
    throw new Error(res.error.message);
  }
  const rows = Array.isArray(res.data) ? res.data : [res.data].filter(Boolean);
  return (rows[0] as Record<string, unknown> | undefined) ?? null;
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

const INSPECTION_STATUSES = [
  "planned",
  "requested",
  "scheduled",
  "passed",
  "failed",
  "partial",
  "cancelled",
] as const;
const INSPECTION_RESULTS = ["pending", "pass", "fail", "partial", "cancelled"] as const;

const normalizeInspection = (row: Record<string, unknown>): InspectionRow => {
  const status = str(row.status, "planned");
  const result = str(row.result, "pending");
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    parent_inspection_id: (row.parent_inspection_id as string | null) ?? null,
    seed_key: str(row.seed_key),
    inspection_type: str(row.inspection_type),
    authority: str(row.authority),
    location: str(row.location),
    responsible_party: str(row.responsible_party),
    inspector: str(row.inspector),
    requested_date: (row.requested_date as string | null) ?? null,
    scheduled_date: (row.scheduled_date as string | null) ?? null,
    completed_date: (row.completed_date as string | null) ?? null,
    status: INSPECTION_STATUSES.includes(status as InspectionStatus)
      ? (status as InspectionStatus)
      : "planned",
    result: INSPECTION_RESULTS.includes(result as InspectionResult)
      ? (result as InspectionResult)
      : "pending",
    attempt_number: Math.max(1, num(row.attempt_number) || 1),
    required_reinspection: Boolean(row.required_reinspection ?? false),
    cost_impact: num(row.cost_impact),
    schedule_impact_weeks:
      row.schedule_impact_weeks == null ? null : Math.max(0, num(row.schedule_impact_weeks)),
    notes: str(row.notes),
    corrective_action: str(row.corrective_action),
    risk_exposure_id: (row.risk_exposure_id as string | null) ?? null,
    created_by: (row.created_by as string | null) ?? null,
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
  };
};

const CLAIM_TYPES = [
  "delay",
  "extension_of_time",
  "delay_damages",
  "acceleration",
  "disruption",
  "other",
] as const;

const CLAIM_STATUSES = [
  "in_preparation",
  "submitted",
  "pending_review",
  "under_review",
  "reviewed",
  "resolved",
  "rejected",
  "withdrawn",
] as const;

const normalizeClaim = (row: Record<string, unknown>): ClaimRow => {
  const claimType = str(row.claim_type, "delay");
  const status = str(row.status, "in_preparation");
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    seed_key: str(row.seed_key),
    claim_number: str(row.claim_number),
    title: str(row.title),
    description: str(row.description),
    claim_type: CLAIM_TYPES.includes(claimType as ClaimType) ? (claimType as ClaimType) : "delay",
    status: CLAIM_STATUSES.includes(status as ClaimStatus)
      ? (status as ClaimStatus)
      : "in_preparation",
    money_claimed: num(row.money_claimed),
    time_claimed_days: Math.trunc(num(row.time_claimed_days)),
    money_awarded: num(row.money_awarded),
    time_awarded_days: Math.trunc(num(row.time_awarded_days)),
    outcome: str(row.outcome),
    owner: str(row.owner),
    submitted_at: (row.submitted_at as string | null) ?? null,
    resolved_at: (row.resolved_at as string | null) ?? null,
    risk_exposure_id: (row.risk_exposure_id as string | null) ?? null,
    change_order_id: (row.change_order_id as string | null) ?? null,
    created_by: (row.created_by as string | null) ?? null,
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
  };
};

const CLAIM_EVENT_TYPES = [
  "submitted",
  "received",
  "reviewed",
  "meeting",
  "returned_for_revision",
  "resubmitted",
  "resolved",
  "other",
] as const;

const normalizeClaimEvent = (row: Record<string, unknown>): ClaimEventRow => {
  const eventType = str(row.event_type, "submitted");
  return {
    id: row.id as string,
    claim_id: row.claim_id as string,
    project_id: row.project_id as string,
    seed_key: str(row.seed_key),
    event_type: CLAIM_EVENT_TYPES.includes(eventType as ClaimEventType)
      ? (eventType as ClaimEventType)
      : "other",
    event_date: (row.event_date as string | null) ?? null,
    revision_number: Math.max(0, Math.trunc(num(row.revision_number))),
    note: str(row.note),
    created_by: (row.created_by as string | null) ?? null,
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
  };
};

const CLAIM_DOC_TYPES = ["claim", "supporting", "correspondence", "other"] as const;

const normalizeClaimDocument = (row: Record<string, unknown>): ClaimDocumentRow => {
  const docType = str(row.doc_type, "supporting");
  return {
    id: row.id as string,
    claim_id: row.claim_id as string,
    project_id: row.project_id as string,
    storage_path: str(row.storage_path),
    file_name: str(row.file_name),
    doc_type: CLAIM_DOC_TYPES.includes(docType as ClaimDocType)
      ? (docType as ClaimDocType)
      : "supporting",
    note: str(row.note),
    uploaded_at: str(row.uploaded_at),
    created_by: (row.created_by as string | null) ?? null,
  };
};

const CO_DOC_TYPES = ["backup", "quote", "correspondence", "other"] as const;

const normalizeChangeOrderDocument = (row: Record<string, unknown>): ChangeOrderDocumentRow => {
  const docType = str(row.doc_type, "backup");
  return {
    id: row.id as string,
    change_order_id: row.change_order_id as string,
    project_id: row.project_id as string,
    storage_path: str(row.storage_path),
    file_name: str(row.file_name),
    doc_type: CO_DOC_TYPES.includes(docType as CoDocType) ? (docType as CoDocType) : "backup",
    note: str(row.note),
    uploaded_at: str(row.uploaded_at),
    created_by: (row.created_by as string | null) ?? null,
  };
};

const INSPECTION_FALLBACK_MARKER = "[overwatch:inspection-fallback:v1]";

type InspectionFallbackPayload = {
  parent_inspection_id?: string | null;
  seed_key?: string;
  inspection_type?: string;
  authority?: string;
  location?: string;
  responsible_party?: string;
  inspector?: string;
  requested_date?: string | null;
  scheduled_date?: string | null;
  completed_date?: string | null;
  status?: InspectionStatus;
  result?: InspectionResult;
  attempt_number?: number;
  required_reinspection?: boolean;
  cost_impact?: number;
  schedule_impact_weeks?: number | null;
  notes?: string;
  corrective_action?: string;
  created_by?: string | null;
};

const fallbackInspectionPayloadFromNotes = (notes: string): InspectionFallbackPayload | null => {
  const markerIndex = notes.indexOf(INSPECTION_FALLBACK_MARKER);
  if (markerIndex === -1) return null;

  const jsonStart = notes.indexOf("{", markerIndex);
  if (jsonStart === -1) return null;

  const jsonEnd = notes.indexOf("\n\n", jsonStart);
  const rawJson = notes.slice(jsonStart, jsonEnd === -1 ? undefined : jsonEnd).trim();
  try {
    const parsed = JSON.parse(rawJson) as InspectionFallbackPayload;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

const fallbackInspectionFromExposure = (exposure: ExposureRow): InspectionRow | null => {
  const payload = fallbackInspectionPayloadFromNotes(exposure.notes);
  if (!payload?.inspection_type) return null;

  return normalizeInspection({
    id: exposure.id,
    project_id: exposure.project_id,
    parent_inspection_id: payload.parent_inspection_id ?? null,
    seed_key: payload.seed_key ?? "",
    inspection_type: payload.inspection_type,
    authority: payload.authority ?? "",
    location: payload.location ?? "",
    responsible_party: payload.responsible_party ?? exposure.owner,
    inspector: payload.inspector ?? "",
    requested_date: payload.requested_date ?? null,
    scheduled_date: payload.scheduled_date ?? exposure.due_date ?? null,
    completed_date: payload.completed_date ?? exposure.resolved_at ?? null,
    status: payload.status ?? (exposure.status === "recovered" ? "passed" : "planned"),
    result: payload.result ?? (exposure.status === "recovered" ? "pass" : "pending"),
    attempt_number: payload.attempt_number ?? 1,
    required_reinspection: payload.required_reinspection ?? false,
    cost_impact: payload.cost_impact ?? exposure.dollar_exposure,
    schedule_impact_weeks: payload.schedule_impact_weeks ?? exposure.schedule_impact_weeks,
    notes: payload.notes ?? exposure.description,
    corrective_action: payload.corrective_action ?? exposure.release_condition,
    risk_exposure_id: exposure.id,
    created_by: payload.created_by ?? null,
    created_at: exposure.opened_at,
    updated_at: exposure.release_updated_at ?? exposure.opened_at,
  });
};

const fallbackExposureStatusForInspection = (
  inspection: Pick<InspectionFallbackPayload, "status" | "result">,
): ExposureStatus => {
  if (inspection.status === "passed" || inspection.result === "pass") return "recovered";
  if (inspection.status === "cancelled" || inspection.result === "cancelled") return "accepted";
  return "active";
};

const fallbackExposurePayloadForInspection = (
  projectId: string,
  inspection: InspectionFallbackPayload,
) => {
  const scheduleImpact =
    inspection.schedule_impact_weeks == null
      ? null
      : Math.max(0, num(inspection.schedule_impact_weeks));
  const costImpact = Math.max(0, num(inspection.cost_impact));
  const status = fallbackExposureStatusForInspection(inspection);
  const inspectionType = str(inspection.inspection_type, "Inspection");
  const authority = str(inspection.authority);
  const responsibleParty = str(inspection.responsible_party);
  const correctiveAction = str(inspection.corrective_action);
  const inspectionNotes = str(inspection.notes);
  const payload: InspectionFallbackPayload = {
    parent_inspection_id: inspection.parent_inspection_id ?? null,
    seed_key: str(inspection.seed_key),
    inspection_type: inspectionType,
    authority,
    location: str(inspection.location),
    responsible_party: responsibleParty,
    inspector: str(inspection.inspector),
    requested_date: cleanOptionalDate(inspection.requested_date),
    scheduled_date: cleanOptionalDate(inspection.scheduled_date),
    completed_date: cleanOptionalDate(inspection.completed_date),
    status: INSPECTION_STATUSES.includes(inspection.status as InspectionStatus)
      ? inspection.status
      : "planned",
    result: INSPECTION_RESULTS.includes(inspection.result as InspectionResult)
      ? inspection.result
      : "pending",
    attempt_number: Math.max(1, Math.trunc(num(inspection.attempt_number) || 1)),
    required_reinspection: Boolean(inspection.required_reinspection ?? false),
    cost_impact: costImpact,
    schedule_impact_weeks: scheduleImpact,
    notes: inspectionNotes,
    corrective_action: correctiveAction,
    created_by: inspection.created_by ?? null,
  };
  const humanNotes = [
    "Inspection saved through the shared risk ledger because the dedicated inspection table is not available yet.",
    `Status: ${payload.status}. Result: ${payload.result}. Attempt: ${payload.attempt_number}.`,
    authority ? `Authority: ${authority}.` : "",
    payload.inspector ? `Inspector: ${payload.inspector}.` : "",
    payload.location ? `Location: ${payload.location}.` : "",
    `Cost impact: ${costImpact}.`,
    `Schedule impact: ${scheduleImpact ?? 0} week${scheduleImpact === 1 ? "" : "s"}.`,
    correctiveAction ? `Corrective action: ${correctiveAction}` : "",
    inspectionNotes ? `Inspection notes: ${inspectionNotes}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    project_id: projectId,
    title: `Inspection: ${inspectionType}`,
    description:
      correctiveAction ||
      inspectionNotes ||
      `${inspectionType} is being tracked from the project inspections workspace.`,
    category: scheduleImpact && scheduleImpact > 0 ? "schedule_compression" : "field_change",
    dollar_exposure: costImpact,
    probability: status === "active" ? 100 : 0,
    schedule_impact_weeks: scheduleImpact && scheduleImpact > 0 ? scheduleImpact : null,
    owner: responsibleParty || "PM",
    response_path: "recover",
    release_condition: `${inspectionType} passes and ${authority || "the inspection authority"} releases the affected work.`,
    hold_class: status === "active" ? "E-Hold" : "None",
    status,
    due_date: payload.scheduled_date ?? payload.completed_date ?? payload.requested_date ?? null,
    next_review_at: null,
    notes: `${INSPECTION_FALLBACK_MARKER}\n${JSON.stringify(payload)}\n\n${humanNotes}`,
  };
};

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

const DECISION_REMINDER_CHANNELS = ["none", "in_app", "email"] as const;
const DECISION_ENHANCEMENT_COLUMNS = [
  "owner_email",
  "owner_user_id",
  "reminder_enabled",
  "reminder_at",
  "reminder_channel",
] as const;

function isDecisionReminderChannel(value: unknown): value is DecisionReminderChannel {
  return (
    typeof value === "string" &&
    DECISION_REMINDER_CHANNELS.includes(value as DecisionReminderChannel)
  );
}

function isMissingDecisionEnhancementColumn(error: { code?: string; message?: string } | null) {
  return DECISION_ENHANCEMENT_COLUMNS.some((column) => isMissingRestColumn(error, column));
}

function normalizeDecision(row: Record<string, unknown>): DecisionRow {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    decision: str(row.decision),
    impact: str(row.impact),
    owner: str(row.owner),
    owner_email: str(row.owner_email),
    owner_user_id: (row.owner_user_id as string | null) ?? null,
    due_date: (row.due_date as string | null) ?? null,
    status: (row.status as DecisionStatus) ?? "open",
    linked_exposure_id: (row.linked_exposure_id as string | null) ?? null,
    linked_co_id: (row.linked_co_id as string | null) ?? null,
    reminder_enabled: Boolean(row.reminder_enabled ?? false),
    reminder_at: (row.reminder_at as string | null) ?? null,
    reminder_channel: isDecisionReminderChannel(row.reminder_channel)
      ? row.reminder_channel
      : "none",
    notes: str(row.notes),
  };
}

function stripDecisionEnhancementFields<T extends Record<string, unknown>>(input: T) {
  const next = { ...input };
  for (const column of DECISION_ENHANCEMENT_COLUMNS) {
    delete next[column];
  }
  return next;
}

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
  `Project metadata (${column}) isn't available yet. This workspace is still being set up.`;

const throwIfProjectSchemaError = (error: { code?: string; message?: string } | null) => {
  for (const column of PROJECT_METADATA_COLUMNS) {
    if (isMissingRestColumn(error, column)) throw new Error(projectSchemaError(column));
  }
};

function requireProjectBudgetLock(row: Record<string, unknown>): string | null {
  if (!Object.prototype.hasOwnProperty.call(row, "budget_locked_at")) {
    throw new Error("Financial data isn't available yet. This workspace is still being set up.");
  }
  const value = row.budget_locked_at;
  if (value === null) return null;
  if (typeof value === "string" && value.trim()) return value;
  throw new Error("Financial data unavailable: projects.budget_locked_at is malformed.");
}

const normalizeProject = (p: Record<string, unknown>): ProjectRow => ({
  id: p.id as string,
  updated_at: str(p.updated_at),
  organization_id: (p.organization_id as string | null) ?? null,
  organization_name: str(p.organization_name),
  organization_logo_url: str(p.organization_logo_url),
  job_number: str(p.job_number),
  name: p.name as string,
  client: str(p.client),
  original_contract: financialNum(p.original_contract, "projects.original_contract"),
  original_cost_budget: financialNum(p.original_cost_budget, "projects.original_cost_budget"),
  default_retainage_pct: num(p.default_retainage_pct ?? 10),
  default_output_format:
    str(p.default_output_format, "invoice") === "aia_g702" ? "aia_g702" : "invoice",
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
  archived_at: (p.archived_at as string | null) ?? null,
  // Missing column (migration not applied yet) reads as open/active.
  closed_at: (p.closed_at as string | null | undefined) ?? null,
  budget_locked_at: requireProjectBudgetLock(p),
});

async function loadDecisionOwnerOptions(
  context: { supabase: unknown },
  project: ProjectRow,
): Promise<DecisionOwnerOption[]> {
  // Phase 3: membership rosters (and, through the profiles RLS join,
  // co-member profiles) are company.manage_team data, but the decision-owner
  // picker is a plain collaboration surface — names/emails of the caller's own
  // teammates. The caller already passed project RLS to get here, so the
  // roster + profile reads run on the admin client scoped to this project's
  // organization. Falls back to the caller's client (self-only rows, a
  // degraded but safe picker) when admin credentials are not configured.
  let rosterClient: unknown = context.supabase;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    rosterClient = supabaseAdmin;
  } catch {
    // Local/dev without a service role key: keep the user's client.
  }
  const projectMembersQuery = dynamicTable(rosterClient, "project_memberships")
    .select("user_id,role,status")
    .eq("project_id", project.id);
  const organizationMembersQuery = project.organization_id
    ? dynamicTable(rosterClient, "organization_memberships")
        .select("user_id,role,status,invited_email")
        .eq("organization_id", project.organization_id)
    : Promise.resolve({ data: [], error: null });

  const [projectMembersRes, organizationMembersRes] = await Promise.all([
    projectMembersQuery,
    organizationMembersQuery,
  ]);

  const projectMembersMissing =
    projectMembersRes.error &&
    isMissingRestRelation(projectMembersRes.error, "project_memberships");
  const organizationMembersMissing =
    organizationMembersRes.error &&
    isMissingRestRelation(organizationMembersRes.error, "organization_memberships");
  if (projectMembersRes.error && !projectMembersMissing) {
    throw new Error(projectMembersRes.error.message);
  }
  if (organizationMembersRes.error && !organizationMembersMissing) {
    throw new Error(organizationMembersRes.error.message);
  }

  const projectRows = projectMembersMissing
    ? []
    : ((projectMembersRes.data ?? []) as Record<string, unknown>[]).filter(
        (member) => str(member.status, "active") === "active",
      );
  const organizationRows = organizationMembersMissing
    ? []
    : ((organizationMembersRes.data ?? []) as Record<string, unknown>[]).filter(
        (member) => str(member.status, "active") === "active",
      );
  const userIds = Array.from(
    new Set(
      [...projectRows, ...organizationRows]
        .map((member) => member.user_id as string)
        .filter(Boolean),
    ),
  );
  const profilesRes =
    userIds.length === 0
      ? { data: [], error: null }
      : await dynamicTable(rosterClient, "profiles")
          .select("id,email,full_name,company_title")
          .in("id", userIds);
  if (profilesRes.error && !isMissingRestRelation(profilesRes.error, "profiles")) {
    throw new Error(profilesRes.error.message);
  }
  const profilesById = new Map(
    ((profilesRes.data ?? []) as Record<string, unknown>[]).map((profile) => [
      profile.id as string,
      profile,
    ]),
  );
  const byUser = new Map<string, DecisionOwnerOption>();

  for (const row of projectRows) {
    const userId = row.user_id as string;
    const profile = profilesById.get(userId);
    const label = str(profile?.full_name) || str(profile?.email) || "Project member";
    byUser.set(userId, {
      user_id: userId,
      label,
      email: str(profile?.email),
      role: str(row.role, "viewer"),
      scope: "project",
    });
  }

  for (const row of organizationRows) {
    const userId = row.user_id as string;
    if (byUser.has(userId)) continue;
    const profile = profilesById.get(userId);
    const invitedEmail = str(row.invited_email);
    const label = str(profile?.full_name) || str(profile?.email) || invitedEmail || "Team member";
    byUser.set(userId, {
      user_id: userId,
      label,
      email: str(profile?.email, invitedEmail),
      role: str(row.role, "member"),
      scope: "company",
    });
  }

  return Array.from(byUser.values()).sort(
    (a, b) =>
      (a.scope === "project" ? 0 : 1) - (b.scope === "project" ? 0 : 1) ||
      a.label.localeCompare(b.label),
  );
}

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
  output_format: str(b.output_format, "invoice") === "aia_g702" ? "aia_g702" : "invoice",
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
  reference: str(row.reference),
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
  sent_recipients: Array.isArray(row.sent_recipients)
    ? (row.sent_recipients as unknown[]).map((entry) => str(entry)).filter(Boolean)
    : [],
  first_viewed_at: (row.first_viewed_at as string | null) ?? null,
  last_viewed_at: (row.last_viewed_at as string | null) ?? null,
  view_count: num(row.view_count),
  collections_log: str(row.collections_log),
  paid_at: (row.paid_at as string | null) ?? null,
  notes: str(row.notes),
  enabled_payment_methods:
    row.enabled_payment_methods && typeof row.enabled_payment_methods === "object"
      ? (row.enabled_payment_methods as Record<string, boolean>)
      : {},
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
  linked_change_order_id: (e.linked_change_order_id as string | null) ?? null,
  linked_claim_id: (e.linked_claim_id as string | null) ?? null,
});

// ---------------- LIST + GET ----------------

// Self-perform daily WIP cost per cost-bucket, resolving each line's sub
// commitment (to exclude bought-out lines) from the raw subcontract rows. Shared
// by getProject and listProjects so the dashboard and the portfolio fold the same
// way. Tolerates the raw REST row shapes (num/str coerce).
//
// SINGLE CHOKEPOINT for the daily-WIP ↔ recorded-cost double-count fix: a
// self-perform lump is folded into a bucket's actual here, and the vendor invoice
// that covers it later posts as a cost_actual that a DB trigger also folds into
// the SAME bucket actual → counted twice. Each cost_actual line now carries a
// `daily_wip_offset` (the daily-WIP it settles); we sum those per bucket
// (RECOGNIZED rows only — mirror the void/draft filter used for the rollup amount)
// and NET them out of the gross self-perform map. Because all three fold sites
// (Budget tab, dashboard rollup, portfolio GP) consume THIS returned map, netting
// once here keeps them in lockstep. `costActualRows` defaults to [] so pre-column
// callers are unchanged; `daily_wip_offset` is read defensively (?? 0) so a
// pre-migration project (column absent) yields reconciled 0 → the map is identical
// to the old additive behavior.
function buildSelfPerformByBucket(
  wipRows: Record<string, unknown>[],
  subcontractRows: Record<string, unknown>[],
  subAllocationRows: Record<string, unknown>[],
  costActualRows: Record<string, unknown>[] = [],
): Map<string, number> {
  const commitmentLookup = commitmentBySubBucket(
    subcontractRows.map((r) => ({
      id: str(r.id),
      subcontractor_id: str(r.subcontractor_id),
      status: str(r.status),
    })),
    subAllocationRows.map((r) => ({
      subcontract_id: str(r.subcontract_id),
      cost_bucket_id: (r.cost_bucket_id as string | null) ?? null,
      amount: num(r.amount),
    })),
  );
  const rows: DailyWipRowLike[] = wipRows.map((r) => ({
    crew_count: num(r.crew_count),
    hours: num(r.hours),
    labor_rate: num(r.labor_rate),
    material_cost: num(r.material_cost),
    equipment_cost: num(r.equipment_cost),
    quantity: num(r.quantity),
    subcontractor_id: (r.subcontractor_id as string | null) ?? null,
    cost_bucket_id: (r.cost_bucket_id as string | null) ?? null,
    percent_complete: num(r.percent_complete),
  }));
  const commitmentFor = (row: DailyWipRowLike) => {
    const key = subCommitmentKey(row.subcontractor_id, row.cost_bucket_id);
    return key ? (commitmentLookup.get(key) ?? null) : null;
  };
  const grossSelfPerform = selfPerformCostByBucket(rows, commitmentFor);
  // Reconciled daily-WIP per bucket = sum of daily_wip_offset over RECOGNIZED
  // cost_actuals only. A void/draft invoice's offset must NOT displace WIP — it
  // isn't in the bucket actual (its amount is excluded from cost_actual_rollup_
  // amount by the SAME void/draft filter), so netting it would silently erase real
  // self-perform cost from the rollup. daily_wip_offset read defensively (?? 0).
  // Accumulate in integer cents (sum in cents, convert once per bucket) so a
  // bucket covered by several invoices can never drift a fractional cent.
  const reconciledCents = new Map<string, number>();
  for (const r of costActualRows) {
    const bucketId = r.cost_bucket_id as string | null;
    if (!bucketId) continue;
    const status = str(r.status);
    if (status === "void" || status === "draft") continue;
    const offset = num((r as { daily_wip_offset?: unknown }).daily_wip_offset ?? 0);
    if (offset <= 0) continue;
    reconciledCents.set(bucketId, (reconciledCents.get(bucketId) ?? 0) + dollarsToCents(offset));
  }
  const reconciledByBucket = new Map<string, number>();
  for (const [id, cents] of reconciledCents) reconciledByBucket.set(id, centsToDollars(cents));
  return netSelfPerformByReconciled(grossSelfPerform, reconciledByBucket);
}

// An invoice/cost entry as the Budget drawer's drill-through needs it.
// CROSS-MODULE READ: public.cost_actuals is owned by the Billing module (its
// job-costs form and importer write these rows, and a DB trigger folds each
// non-void row into cost_buckets.actual_to_date). This lean SELECT exists so
// the Budget line drawer can itemize WHICH invoices make up a line's actual
// (field request 2026-07-09: "see the invoices that comprise that actual
// number") — no writes, RLS still scopes to readable projects. The heavyweight
// billing workspace read stays the Billing module's.
export interface BudgetCostActualRow {
  id: string;
  cost_bucket_id: string | null;
  description: string;
  vendor: string;
  reference_number: string;
  amount: number;
  cost_date: string;
}

export async function readCostActualsForBudget(
  supabase: unknown,
  projectId: string,
): Promise<BudgetCostActualRow[]> {
  const { data: rows, error } = await dynamicTable(supabase, "cost_actuals")
    .select("id, cost_bucket_id, description, vendor, reference_number, amount, cost_date, status")
    .eq("project_id", projectId)
    .order("cost_date", { ascending: false });
  return requireFinancialRows(rows as Record<string, unknown>[] | null, error, "cost_actuals")
    .filter((row) => str(row.status) !== "void" && str(row.status) !== "draft")
    .map((row) => ({
      id: str(row.id),
      cost_bucket_id: (row.cost_bucket_id as string | null) ?? null,
      description: str(row.description),
      vendor: str(row.vendor),
      reference_number: str(row.reference_number),
      amount: financialNum(row.amount, "cost_actuals.amount"),
      cost_date: str(row.cost_date),
    }));
}

export const listCostActualsForBudget = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<BudgetCostActualRow[]> => {
    // Mirror cost_actual_rollup_amount exactly: void AND draft rows don't fold
    // into actual_to_date. A failed read is not equivalent to no invoices.
    return readCostActualsForBudget(context.supabase, data.projectId);
  });

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error: accountError } = await context.supabase.rpc("ensure_current_user_account");
    if (accountError) throw new Error(accountError.message);

    const { data: rawProjects, error } = await context.supabase
      .from("projects")
      .select("*")
      .is("archived_at", null)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const projects = (rawProjects ?? []).map(normalizeProject);
    const ids = projects.map((p) => p.id);
    if (ids.length === 0) return [];
    const organizationIds = Array.from(
      new Set(projects.map((p) => p.organization_id).filter((id): id is string => Boolean(id))),
    );

    const [
      expRes,
      cosRes,
      bucketsRes,
      decisionsRes,
      organizationsRes,
      subRes,
      subAllocRes,
      subPayRes,
      subCoRes,
      subSplitRes,
      wipRes,
      caRes,
    ] = await Promise.all([
      context.supabase.from("exposures").select("*").in("project_id", ids),
      context.supabase
        .from("change_orders")
        .select("project_id,contract_amount,cost_amount,status,probability")
        .in("project_id", ids),
      context.supabase
        .from("cost_buckets")
        .select("id,project_id,bucket,original_budget,actual_to_date,ftc")
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
      // Subcontractor layer so the portfolio GP matches each project's own
      // dashboard (a buyout that pops a code pulls GP down here too). These are
      // authoritative money inputs: a failed read must fail the rollup instead
      // of silently converting committed/paid cost to $0.
      dynamicTable(context.supabase, "subcontracts").select("*").in("project_id", ids),
      dynamicTable(context.supabase, "subcontract_allocations").select("*").in("project_id", ids),
      dynamicTable(context.supabase, "subcontract_payments").select("*").in("project_id", ids),
      dynamicTable(context.supabase, "subcontract_change_orders").select("*").in("project_id", ids),
      dynamicTable(context.supabase, "subcontract_payment_allocations")
        .select("*")
        .in("project_id", ids),
      // Self-perform daily WIP so the portfolio GP folds self-perform cost the
      // same way each project's dashboard does.
      dynamicTable(context.supabase, "daily_wip_entries").select("*").in("project_id", ids),
      // Recorded costs carry a per-line daily_wip_offset that settles the daily
      // WIP they cover → the portfolio nets out the double-count the same way the
      // project dashboard does. Only cost_bucket_id/status/daily_wip_offset are
      // needed. daily_wip_offset is read defensively for legacy rows, but a
      // failed table/RLS query is surfaced rather than represented as no cost.
      dynamicTable(context.supabase, "cost_actuals").select("*").in("project_id", ids),
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
    // Phase 3: plain members can no longer read the organizations base row, so
    // the read above returns fewer rows for them (RLS filters, no error). Fill
    // the gaps from the member-safe directory projection so portfolio rows
    // keep their company name/logo. Directory misses (pre-migration RPC or
    // non-member orgs) simply stay unlabeled, as before.
    {
      const foundOrganizationIds = new Set(organizationRows.map((row) => str(row.id)));
      const missingOrganizationIds = organizationIds.filter((id) => !foundOrganizationIds.has(id));
      if (missingOrganizationIds.length > 0) {
        const directoryRows = await Promise.all(
          missingOrganizationIds.map((id) =>
            organizationDirectoryRow(context, id).catch(() => null),
          ),
        );
        for (const row of directoryRows) {
          if (row) organizationRows.push(row);
        }
      }
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
    const financialRows = (res: { data: unknown; error: unknown }, relation: string) => {
      if (res.error) {
        const message = str((res.error as { message?: unknown }).message, "Unknown database error");
        throw new Error(`Financial rollup could not load ${relation}: ${message}`);
      }
      return (res.data ?? []) as ({ project_id: string } & Record<string, unknown>)[];
    };
    const scByP = groupBy<{ project_id: string } & Record<string, unknown>>(
      financialRows(subRes, "subcontracts"),
    );
    const saByP = groupBy<{ project_id: string } & Record<string, unknown>>(
      financialRows(subAllocRes, "subcontract_allocations"),
    );
    const spByP = groupBy<{ project_id: string } & Record<string, unknown>>(
      financialRows(subPayRes, "subcontract_payments"),
    );
    const scoByP = groupBy<{ project_id: string } & Record<string, unknown>>(
      financialRows(subCoRes, "subcontract_change_orders"),
    );
    const splitByP = groupBy<{ project_id: string } & Record<string, unknown>>(
      financialRows(subSplitRes, "subcontract_payment_allocations"),
    );
    const wipByP = groupBy<{ project_id: string } & Record<string, unknown>>(
      financialRows(wipRes, "daily_wip_entries"),
    );
    // Recorded costs are authoritative for the daily_wip_offset netting. A
    // missing relation, stale schema cache, or RLS failure blocks the summary;
    // otherwise GP can be overstated while looking healthy.
    const caByP = groupBy<{ project_id: string } & Record<string, unknown>>(
      financialRows(caRes, "cost_actuals"),
    );
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
        // id is needed to match the subcontractor layer to its cost code.
        id: str(b.id),
        cost_code: str(b.cost_code),
        bucket: str(b.bucket),
        original_budget: num(b.original_budget),
        actual_to_date: num(b.actual_to_date),
        ftc: num(b.ftc),
      }));
      // Sub cost per bucket → the rollup, so a buyout that pops a code pulls the
      // portfolio GP down exactly as it does on the project's own dashboard.
      // GP depends only on the committed displacement (split-independent), so the
      // payments-only summary is sufficient here — no daily-WIP % needed.
      const subCostByBucket = summarizeSubCostByBucket(
        (scByP[p.id] ?? []).map((row) => ({
          id: str(row.id),
          contract_value: num(row.contract_value),
          status: str(row.status),
        })),
        (saByP[p.id] ?? []).map((row) => ({
          subcontract_id: str(row.subcontract_id),
          cost_bucket_id: (row.cost_bucket_id as string | null) ?? null,
          amount: num(row.amount),
        })),
        (spByP[p.id] ?? []).map((row) => ({
          id: str(row.id),
          subcontract_id: str(row.subcontract_id),
          amount: num(row.amount),
          // Pre-lifecycle rows have no status column — they were paid facts.
          status: str(row.status, "paid"),
        })),
        undefined,
        // Coded sub COs fold into committed here too, so the portfolio matches
        // the project dashboard after a change order lands.
        (scoByP[p.id] ?? []).map((row) => ({
          id: str(row.id),
          subcontract_id: str(row.subcontract_id),
          cost_bucket_id: (row.cost_bucket_id as string | null) ?? null,
          amount: num(row.amount),
        })),
        // Explicit per-payment splits override the pro-rata paid distribution.
        (splitByP[p.id] ?? []).map((row) => ({
          payment_id: str(row.payment_id),
          cost_bucket_id: (row.cost_bucket_id as string | null) ?? null,
          amount: num(row.amount),
        })),
        (caByP[p.id] ?? []).map((row) => ({
          cost_bucket_id: (row.cost_bucket_id as string | null) ?? null,
          amount: num(row.amount),
          status: str(row.status),
          subcontract_change_order_id: (row.subcontract_change_order_id as string | null) ?? null,
          subcontract_payment_id: (row.subcontract_payment_id as string | null) ?? null,
        })),
      );
      // Self-perform daily WIP folds into actual + forecast the same way as on the
      // project dashboard, so the portfolio GP never drifts from it.
      const selfPerformByBucket = buildSelfPerformByBucket(
        wipByP[p.id] ?? [],
        scByP[p.id] ?? [],
        saByP[p.id] ?? [],
        caByP[p.id] ?? [],
      );
      const rollupBuckets = applySelfPerformToBuckets(buckets, selfPerformByBucket);
      const r = computeRollup(p, rollupBuckets, cos, exposures, subCostByBucket);
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
        // Close-out flag — the home buckets active vs closed on this. (archived
        // rows are already filtered out at the query above.)
        closed_at: p.closed_at,
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
    // Project reads must stay read-only. Harbor's versioned fixture maintenance
    // runs from seedDemoIfEmpty (portfolio bootstrap) and the explicit reset
    // actions below. Running the full engine here made opening Harbor wait for
    // eleven write-heavy module adapters, and it could overlap the portfolio
    // bootstrap that was already doing the same work.
    const inspectionRes = await dynamicTable(context.supabase, "project_inspections")
      .select("*")
      .eq("project_id", pid)
      .order("scheduled_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    const claimRes = await dynamicTable(context.supabase, "project_claims")
      .select("*")
      .eq("project_id", pid)
      .order("created_at", { ascending: false });
    const claimEventRes = await dynamicTable(context.supabase, "project_claim_events")
      .select("*")
      .eq("project_id", pid)
      .order("event_date", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true });
    const claimDocumentRes = await dynamicTable(context.supabase, "project_claim_documents")
      .select("*")
      .eq("project_id", pid)
      .order("uploaded_at", { ascending: false });
    const changeOrderDocumentRes = await dynamicTable(context.supabase, "change_order_documents")
      .select("*")
      .eq("project_id", pid)
      .order("uploaded_at", { ascending: false });
    if (eRes.error) throw new Error(eRes.error.message);
    if (cRes.error) throw new Error(cRes.error.message);
    const bucketRows = requireFinancialRows(
      bRes.data as Record<string, unknown>[] | null,
      bRes.error,
      "cost_buckets",
    );
    if (dRes.error) throw new Error(dRes.error.message);
    if (rRes.error) throw new Error(rRes.error.message);
    const sovImportRows = requireFinancialRows(
      siRes.data as Record<string, unknown>[] | null,
      siRes.error,
      "sov_imports",
    );
    const billingApplicationRows = requireFinancialRows(
      billRes.data as Record<string, unknown>[] | null,
      billRes.error,
      "billing_applications",
    );
    const billingInvoiceRows = requireFinancialRows(
      invoiceRes.data as Record<string, unknown>[] | null,
      invoiceRes.error,
      "billing_invoices",
    );
    const inspectionsTableMissing =
      inspectionRes.error &&
      (isMissingRestRelation(inspectionRes.error, "project_inspections") ||
        inspectionRes.error.message.includes("project_inspections") ||
        inspectionRes.error.message.includes("schema cache"));
    if (inspectionRes.error && !inspectionsTableMissing) {
      throw new Error(inspectionRes.error.message);
    }
    const claimsTableMissing =
      claimRes.error &&
      (isMissingRestRelation(claimRes.error, "project_claims") ||
        claimRes.error.message.includes("project_claims") ||
        claimRes.error.message.includes("schema cache"));
    if (claimRes.error && !claimsTableMissing) {
      throw new Error(claimRes.error.message);
    }
    const claimEventsTableMissing =
      claimEventRes.error &&
      (isMissingRestRelation(claimEventRes.error, "project_claim_events") ||
        claimEventRes.error.message.includes("project_claim_events") ||
        claimEventRes.error.message.includes("schema cache"));
    if (claimEventRes.error && !claimEventsTableMissing) {
      throw new Error(claimEventRes.error.message);
    }
    const claimDocumentsTableMissing =
      claimDocumentRes.error &&
      (isMissingRestRelation(claimDocumentRes.error, "project_claim_documents") ||
        claimDocumentRes.error.message.includes("project_claim_documents") ||
        claimDocumentRes.error.message.includes("schema cache"));
    if (claimDocumentRes.error && !claimDocumentsTableMissing) {
      throw new Error(claimDocumentRes.error.message);
    }
    // Pre-migration the change_order_documents table doesn't exist yet — swallow
    // that so the project still loads (mirrors the claim-documents catch above),
    // and rethrow anything that isn't a missing-relation error.
    const changeOrderDocumentsTableMissing =
      changeOrderDocumentRes.error &&
      (isMissingRestRelation(changeOrderDocumentRes.error, "change_order_documents") ||
        changeOrderDocumentRes.error.message.includes("change_order_documents") ||
        changeOrderDocumentRes.error.message.includes("schema cache"));
    if (changeOrderDocumentRes.error && !changeOrderDocumentsTableMissing) {
      throw new Error(changeOrderDocumentRes.error.message);
    }

    let billingEventRows: BillingApplicationEventRow[] = [];
    if (billingApplicationRows.length > 0) {
      const billingEventRes = await dynamicTable(context.supabase, "billing_application_events")
        .select("*")
        .eq("project_id", pid)
        .order("created_at", { ascending: false });
      billingEventRows = requireFinancialRows(
        billingEventRes.data as Record<string, unknown>[] | null,
        billingEventRes.error,
        "billing_application_events",
      ).map((row) => normalizeBillingApplicationEvent(row));
    }
    let paymentRows: PaymentLedgerRow[] = [];
    if (billingInvoiceRows.length > 0) {
      const paymentRes = await dynamicTable(context.supabase, "payment_ledger")
        .select("*")
        .eq("project_id", pid)
        .order("paid_at", { ascending: false });
      paymentRows = requireFinancialRows(
        paymentRes.data as Record<string, unknown>[] | null,
        paymentRes.error,
        "payment_ledger",
      ).map((row) => normalizePaymentLedger(row));
    }

    let project = normalizeProject(pRes.data as Record<string, unknown>);
    if (project.organization_id) {
      // Phase 3: the base organizations row is settings/billing/team data;
      // every member gets name + logo from the directory projection instead.
      const directoryOrganization = await organizationDirectoryRow(
        context,
        project.organization_id,
      );
      if (directoryOrganization) {
        project = {
          ...project,
          organization_name: str(directoryOrganization.name),
          organization_logo_url: organizationLogoUrl(context.supabase, directoryOrganization),
        };
      } else if (directoryOrganization === undefined) {
        // Pre-migration window: the old member-read policy still applies.
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
          const fallbackOrganization = fallbackOrganizationRes.data as Record<
            string,
            unknown
          > | null;
          project = {
            ...project,
            organization_name: str(fallbackOrganization?.name),
            organization_logo_url: organizationLogoUrl(
              context.supabase,
              fallbackOrganization ?? {},
            ),
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
    }
    const projectWithOrganization = project;
    const decisionOwnerOptions = await loadDecisionOwnerOptions(context, projectWithOrganization);
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
      const contractAmount =
        typeof o.contract_amount === "number" ||
        (typeof o.contract_amount === "string" && o.contract_amount.trim())
          ? Number(o.contract_amount)
          : Number.NaN;
      const costAmount =
        typeof o.cost_amount === "number" ||
        (typeof o.cost_amount === "string" && o.cost_amount.trim())
          ? Number(o.cost_amount)
          : Number.NaN;
      const probability =
        typeof o.probability === "number" ||
        (typeof o.probability === "string" && o.probability.trim())
          ? Number(o.probability)
          : Number.NaN;
      const financialDirection = o.financial_direction;
      const status = o.status;
      const updatedAt = str(o.updated_at);
      if (
        !Number.isFinite(contractAmount) ||
        !Number.isFinite(costAmount) ||
        !Number.isFinite(probability) ||
        probability < 0 ||
        probability > 100 ||
        Math.abs(contractAmount * 100 - Math.round(contractAmount * 100)) >= 1e-7 ||
        Math.abs(costAmount * 100 - Math.round(costAmount * 100)) >= 1e-7 ||
        (financialDirection !== "addition" && financialDirection !== "credit") ||
        (status !== "Approved" && status !== "Pending" && status !== "Denied") ||
        (financialDirection === "credit" && (contractAmount > 0 || costAmount > 0)) ||
        (financialDirection === "addition" && (contractAmount < 0 || costAmount < 0)) ||
        !updatedAt ||
        Number.isNaN(new Date(updatedAt).getTime())
      ) {
        throw new Error(
          `Change order ${str(o.number, str(o.id))} has invalid financial data. The project was not summarized.`,
        );
      }
      return {
        id: o.id as string,
        project_id: o.project_id as string,
        number: str(o.number),
        description: str(o.description),
        contract_amount: contractAmount,
        cost_amount: costAmount,
        financial_direction: financialDirection,
        status,
        probability,
        owner: str(o.owner),
        notes: str(o.notes),
        co_type: str(o.co_type, "other") as COType,
        // Structured fields read with SAFE DEFAULTS so a pre-migration row (no
        // such columns) still maps and the project loads.
        pricing_method: str(o.pricing_method, "lump_sum") as COPricingMethod,
        schedule_impact_days: num(o.schedule_impact_days ?? 0),
        requested_by: str(o.requested_by, ""),
        date_initiated: (o.date_initiated as string | null) ?? null,
        client_visible: Boolean(o.client_visible ?? false),
        client_status: str(o.client_status, "not_sent") as ClientChangeOrderStatus,
        client_notes: str(o.client_notes),
        client_sent_at: (o.client_sent_at as string | null) ?? null,
        client_decided_at: (o.client_decided_at as string | null) ?? null,
        linked_exposure_id: (o.linked_exposure_id as string | null) ?? null,
        linked_claim_id: (o.linked_claim_id as string | null) ?? null,
        created_at: str(o.created_at),
        updated_at: updatedAt,
      };
    });

    const buckets: BucketRow[] = bucketRows.map((o) => {
      return {
        id: o.id as string,
        project_id: o.project_id as string,
        cost_code: str(o.cost_code),
        bucket: str(o.bucket),
        contract_value: financialNum(o.contract_value, "cost_buckets.contract_value"),
        original_budget: financialNum(o.original_budget, "cost_buckets.original_budget"),
        actual_to_date: financialNum(o.actual_to_date, "cost_buckets.actual_to_date"),
        ftc: financialNum(o.ftc, "cost_buckets.ftc"),
        sort_order: financialNum(o.sort_order, "cost_buckets.sort_order"),
        source_type: str(o.source_type, "original_sov") as BucketRow["source_type"],
        source_date: (o.source_date as string | null) ?? null,
        source_note: str(o.source_note),
        retainage_pct: financialNum(o.retainage_pct, "cost_buckets.retainage_pct"),
        billing_method: str(o.billing_method, "percent") as BucketRow["billing_method"],
        contract_quantity: financialNum(o.contract_quantity, "cost_buckets.contract_quantity"),
        unit: str(o.unit),
        earned_percent_complete: financialNum(
          o.earned_percent_complete,
          "cost_buckets.earned_percent_complete",
        ),
      };
    });
    const billingEventsByApplication = new Map<string, BillingApplicationEventRow[]>();
    billingEventRows.forEach((event) => {
      const existing = billingEventsByApplication.get(event.billing_application_id) ?? [];
      existing.push(event);
      billingEventsByApplication.set(event.billing_application_id, existing);
    });
    const billingApplications: BillingApplicationRow[] = billingApplicationRows.map((b) => {
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
    const billingInvoices: BillingInvoiceRow[] = billingInvoiceRows.map((row) => {
      const invoice = normalizeBillingInvoice(row as Record<string, unknown>);
      return {
        ...invoice,
        payment_events: paymentsByInvoice.get(invoice.id) ?? [],
      };
    });
    const tableInspections: InspectionRow[] = inspectionsTableMissing
      ? []
      : ((inspectionRes.data ?? []) as unknown[]).map((row) =>
          normalizeInspection(row as Record<string, unknown>),
        );
    const fallbackInspections = exposures
      .map(fallbackInspectionFromExposure)
      .filter((inspection): inspection is InspectionRow => Boolean(inspection));
    const tableInspectionIds = new Set(tableInspections.map((inspection) => inspection.id));
    const tableInspectionRiskIds = new Set(
      tableInspections
        .map((inspection) => inspection.risk_exposure_id)
        .filter((id): id is string => Boolean(id)),
    );
    const inspections: InspectionRow[] = [
      ...tableInspections,
      ...fallbackInspections.filter(
        (inspection) =>
          !tableInspectionIds.has(inspection.id) &&
          !tableInspectionRiskIds.has(inspection.risk_exposure_id ?? ""),
      ),
    ];
    const claims: ClaimRow[] = claimsTableMissing
      ? []
      : ((claimRes.data ?? []) as unknown[]).map((row) =>
          normalizeClaim(row as Record<string, unknown>),
        );
    const claimEvents: ClaimEventRow[] = claimEventsTableMissing
      ? []
      : ((claimEventRes.data ?? []) as unknown[]).map((row) =>
          normalizeClaimEvent(row as Record<string, unknown>),
        );
    const claimDocuments: ClaimDocumentRow[] = claimDocumentsTableMissing
      ? []
      : ((claimDocumentRes.data ?? []) as unknown[]).map((row) =>
          normalizeClaimDocument(row as Record<string, unknown>),
        );
    const changeOrderDocuments: ChangeOrderDocumentRow[] = changeOrderDocumentsTableMissing
      ? []
      : ((changeOrderDocumentRes.data ?? []) as unknown[]).map((row) =>
          normalizeChangeOrderDocument(row as Record<string, unknown>),
        );
    const decisions: DecisionRow[] = (dRes.data ?? []).map((d) =>
      normalizeDecision(d as Record<string, unknown>),
    );
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
        // Tolerant of pre-migration rows where these columns don't exist yet.
        pdf_path: str(o.pdf_path),
        last_sent_at: (o.last_sent_at as string | null) ?? null,
      };
    });
    const sovImports: SovImportRow[] = sovImportRows.map((o) => {
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
        total_budget: financialNum(o.total_budget, "sov_imports.total_budget"),
        original_cost_budget: financialNum(
          o.original_cost_budget,
          "sov_imports.original_cost_budget",
        ),
        selected_budget_column:
          o.selected_budget_column == null ? null : num(o.selected_budget_column),
        selected_budget_label: str(o.selected_budget_label),
        column_map: (o.column_map ?? {}) as Json,
        amount_choices: (o.amount_choices ?? []) as Json,
        warnings: (o.warnings ?? []) as Json,
        created_at: str(o.created_at),
      };
    });

    // Subcontractor cost layer → the IOR rollup, so committed sub cost moves the
    // dashboard GP (not just the Budget tab). Every relation below contributes
    // authoritative cost. Query/RLS/schema failures must block the rollup rather
    // than turn real cost into a healthy-looking $0.
    const subRows = async (relation: string) => {
      const { data: rows, error } = await dynamicTable(context.supabase, relation)
        .select("*")
        .eq("project_id", pid);
      if (error) {
        throw new Error(`Financial rollup could not load ${relation}: ${error.message}`);
      }
      return (rows ?? []) as Record<string, unknown>[];
    };
    const [
      subcontractRows,
      subAllocationRows,
      subPaymentRows,
      subChangeOrderRows,
      subPaymentSplitRows,
      wipEntryRows,
      costActualRows,
    ] = await Promise.all([
      subRows("subcontracts"),
      subRows("subcontract_allocations"),
      subRows("subcontract_payments"),
      // Coded sub COs fold into committed → the dashboard GP moves when a
      // change order lands (field request 2026-07-09).
      subRows("subcontract_change_orders"),
      // Explicit per-payment splits override the pro-rata paid distribution.
      subRows("subcontract_payment_allocations"),
      // Self-perform daily WIP → the rollup, so work put in place by the GC's own
      // crew reflects on the dashboard GP (not just subcontractor progress).
      subRows("daily_wip_entries"),
      // Recorded costs carry a per-line daily_wip_offset that SETTLES the daily
      // WIP they cover, so buildSelfPerformByBucket can net out the double-count
      // daily_wip_offset is read defensively for legacy rows, but the table read
      // itself must succeed before any cost rollup is shown.
      subRows("cost_actuals"),
    ]);
    type SummarizeArgs = Parameters<typeof summarizeSubCostByBucket>;
    const subCostByBucket = summarizeSubCostByBucket(
      subcontractRows as unknown as SummarizeArgs[0],
      subAllocationRows as unknown as SummarizeArgs[1],
      subPaymentRows as unknown as SummarizeArgs[2],
      undefined,
      subChangeOrderRows as unknown as SummarizeArgs[4],
      subPaymentSplitRows as unknown as SummarizeArgs[5],
      costActualRows as unknown as SummarizeArgs[6],
    );

    // Self-perform WIP cost per code, folded into actual + forecast (displacement,
    // like a buyout). A bought-out sub line is excluded — its commitment resolves,
    // so it flows through the sub layer instead.
    const selfPerformByBucket = buildSelfPerformByBucket(
      wipEntryRows,
      subcontractRows,
      subAllocationRows,
      costActualRows,
    );
    const rollupBuckets = applySelfPerformToBuckets(buckets, selfPerformByBucket);

    const rollup: Rollup = computeRollup(
      project,
      rollupBuckets,
      changeOrders,
      exposures,
      subCostByBucket,
    );
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
      decisionOwnerOptions,
      reviews,
      sovImports,
      sovMappingProfiles,
      billingApplications,
      billingInvoices,
      inspections,
      claims,
      claimEvents,
      claimDocuments,
      changeOrderDocuments,
      rollup,
      guidance,
      warnings,
      byCategory,
      aging,
      // Self-perform WIP per cost-bucket (id → dollars), so the client ledger and
      // Budget cards fold it the SAME way the rollup above did. Raw `buckets` keep
      // their unadjusted actual_to_date/ftc — the budget-line drawer edits those.
      selfPerformByBucket: Object.fromEntries(selfPerformByBucket),
    };
  });

// ---------------- PROJECT CRUD ----------------

const createProjectInput = z.object({
  operationKey: z.string().uuid(),
  name: z.string().min(1).max(200),
  job_number: z.string().max(100).default(""),
  client: z.string().max(200).default(""),
  project_manager: z.string().max(200).default(""),
  phase: z.enum(["Early", "Middle", "Late"]).default("Early"),
  original_contract: exactCentMoney,
  original_cost_budget: exactCentMoney,
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

    // Phase 3: project creators don't necessarily hold the settings/billing/
    // team capabilities that read the organizations base row; the member-safe
    // directory projection carries project_limit for every active member.
    let projectLimit = 0;
    const directoryRow = await organizationDirectoryRow(context, organizationId);
    if (directoryRow !== undefined) {
      if (!directoryRow) throw new Error("This company is not available for your account.");
      projectLimit = Number(directoryRow.project_limit ?? 0);
    } else {
      // Pre-migration window: the old member-read policy still applies.
      const { data: organization, error: orgError } = await context.supabase
        .from("organizations")
        .select("id,project_limit")
        .eq("id", organizationId)
        .single();
      if (orgError) throw new Error(orgError.message);
      projectLimit = Number(organization.project_limit ?? 0);
    }
    if (projectLimit > 0) {
      const { count: activeProjectCount, error: activeProjectError } = await context.supabase
        .from("projects")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .neq("job_number", HARBOR_DEMO_JOB_NUMBER);
      if (activeProjectError) throw new Error(activeProjectError.message);
      if ((activeProjectCount ?? 0) >= projectLimit) {
        throw new Error(
          `This OverWatch company is at its ${projectLimit}-active-project limit. Archive a project or upgrade to continue.`,
        );
      }
    }

    const baselineCompletion = cleanOptionalDate(data.baseline_completion_date);
    const forecastCompletion = cleanOptionalDate(data.forecast_completion_date);
    const projectHeader = {
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
    const result = await dynamicRpc(context.supabase, "create_project_financial_atomic", {
      p_organization_id: organizationId,
      p_header: projectHeader,
      p_operation_key: data.operationKey,
    });
    if (result.error) {
      if (/schema cache|could not find the function|does not exist/i.test(result.error.message)) {
        throw new Error(
          "Project financial commands are still being enabled. No project or budget line was created; try again in a few minutes.",
        );
      }
      throw new Error(result.error.message);
    }
    if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
      throw new Error("Project creation completed without an authoritative project result.");
    }
    const projectId = str((result.data as Record<string, unknown>).projectId);
    if (!projectId) throw new Error("Project creation did not return a project identifier.");
    return { id: projectId };
  });

const updateFinancialsInput = z.object({
  projectId: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  operationKey: z.string().uuid(),
  overrideReason: z.string().max(500).optional(),
  patch: z.object({
    name: z.string().min(1).max(200).optional(),
    job_number: z.string().max(100).optional(),
    client: z.string().max(200).optional(),
    original_contract: exactCentMoney.optional(),
    original_cost_budget: exactCentMoney.optional(),
    schedule_variance_weeks: z.number().int().optional(),
    phase: z.enum(["Early", "Middle", "Late"]).optional(),
    percent_complete: z.number().min(0).max(100).optional(),
    hold_variance_note: z.string().max(2000).optional(),
    forecast_completion_date: z.string().optional().nullable(),
    baseline_completion_date: z.string().optional().nullable(),
    last_review_summary: z.string().max(4000).optional(),
    project_manager: z.string().max(200).optional(),
    default_output_format: z.enum(["invoice", "aia_g702"]).optional(),
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

    const result = await dynamicRpc(context.supabase, "update_project_financial_header_atomic", {
      p_project_id: data.projectId,
      p_patch: patch,
      p_override_reason: data.overrideReason?.trim() || null,
      p_expected_updated_at: data.expectedUpdatedAt,
      p_operation_key: data.operationKey,
    });
    if (result.error) {
      if (/schema cache|could not find the function|does not exist/i.test(result.error.message)) {
        throw new Error(
          "Project financial commands are still being enabled. No project header was changed; try again in a few minutes.",
        );
      }
      throw new Error(result.error.message);
    }
    if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
      throw new Error("Project update completed without an authoritative result.");
    }
    const updated = (result.data as Record<string, unknown>).project;
    if (!updated || typeof updated !== "object" || Array.isArray(updated)) {
      throw new Error("Project update did not return the saved project header.");
    }
    return {
      ok: true,
      project: normalizeProject(updated as Record<string, unknown>),
    };
  });

const projectIdInput = z.object({ projectId: z.string().uuid() });

export const archiveProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => projectIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("projects")
      .update({ archived_at: new Date().toISOString() } as never)
      .eq("id", data.projectId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const unarchiveProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => projectIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("projects")
      .update({ archived_at: null } as never)
      .eq("id", data.projectId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Close-out lifecycle (separate from archive): a closed job is done but stays
// viewable in the collapsed "Closed jobs" section. RLS bounds the update to
// projects the caller can manage.
export const closeProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => projectIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("projects")
      .update({ closed_at: new Date().toISOString() } as never)
      .eq("id", data.projectId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reopenProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => projectIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("projects")
      .update({ closed_at: null } as never)
      .eq("id", data.projectId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => projectIdInput.parse(input))
  .handler(async ({ data, context }) => {
    // The Harbor demo hides instead of deleting: the demo seeders run
    // ensure-on-load, so a hard-deleted demo would simply come back. The
    // archived row is the durable opt-out signal every seeder checks.
    const { data: projectRow, error: lookupError } = await context.supabase
      .from("projects")
      .select("id,name,client,job_number,archived_at")
      .eq("id", data.projectId)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (!projectRow) throw new Error("Project was not found.");
    // Project financial journals are permanent evidence and intentionally
    // RESTRICT parent deletion. Archive is therefore the supported lifecycle
    // for every project; Harbor uses the same row as its durable opt-out flag.
    const { error } = await context.supabase
      .from("projects")
      .update({ archived_at: projectRow.archived_at ?? new Date().toISOString() } as never)
      .eq("id", data.projectId);
    if (error) throw new Error(error.message);
    return {
      ok: true,
      demoArchived: isHarborDemoProject(projectRow as Record<string, unknown>),
      archived: true,
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
const CO_FINANCIAL_DIRECTIONS = ["addition", "credit"] as const;
const exactCentSignedMoney = z
  .number()
  .min(-MAX_SAFE_DOLLARS)
  .max(MAX_SAFE_DOLLARS)
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7,
    "Enter an amount with no more than two decimal places.",
  );

const coInputFields = z.object({
  number: z.string().max(50).default(""),
  description: z.string().min(1).max(500),
  contract_amount: exactCentSignedMoney,
  cost_amount: exactCentSignedMoney,
  financial_direction: z.enum(CO_FINANCIAL_DIRECTIONS).default("addition"),
  status: z.enum(["Approved", "Pending", "Denied"]).default("Pending"),
  probability: z.number().min(0).max(100).default(100),
  owner: z.string().max(200).default(""),
  notes: z.string().max(2000).default(""),
  co_type: z.enum(CO_TYPES).default("other"),
  // Structured fields (ship in the structured-fields migration).
  pricing_method: z
    .enum(["lump_sum", "time_and_materials", "unit_price", "allowance", "other"])
    .default("lump_sum"),
  schedule_impact_days: z.number().int().min(0).max(36500).default(0),
  requested_by: z.string().max(200).default(""),
  date_initiated: z.string().nullable().optional(),
});

const refineChangeOrderDirection = (
  row: z.infer<typeof coInputFields>,
  context: z.RefinementCtx,
) => {
  const invalidAddition =
    row.financial_direction === "addition" && (row.contract_amount < 0 || row.cost_amount < 0);
  const invalidCredit =
    row.financial_direction === "credit" && (row.contract_amount > 0 || row.cost_amount > 0);
  if (invalidAddition || invalidCredit) {
    context.addIssue({
      code: "custom",
      path: ["financial_direction"],
      message:
        "Change-order direction and signed amounts disagree. Additions must be positive and credits must be negative.",
    });
  }
};

const coInput = coInputFields.superRefine(refineChangeOrderDirection);

const changeOrderOperationKey = z.string().min(1).max(200);

const changeOrderCommandArgs = (row: z.infer<typeof coInput>) => {
  const directionSign = row.financial_direction === "credit" ? -1 : 1;
  return {
    p_number: row.number,
    p_description: row.description,
    p_contract_amount_cents: dollarsToCents(row.contract_amount) * directionSign,
    p_cost_amount_cents: dollarsToCents(row.cost_amount) * directionSign,
    p_financial_direction: row.financial_direction,
    p_status: row.status,
    p_probability: row.probability,
    p_owner: row.owner,
    p_notes: row.notes,
    p_co_type: row.co_type,
    p_pricing_method: row.pricing_method,
    p_schedule_impact_days: row.schedule_impact_days,
    p_requested_by: row.requested_by,
    p_date_initiated: row.date_initiated ?? null,
  };
};

const requireChangeOrderCommandResult = (value: unknown) => {
  const result = (value ?? {}) as Record<string, unknown>;
  const changeOrderId = str(result.changeOrderId);
  if (!changeOrderId) throw new Error("The change-order command returned no record.");
  return {
    changeOrderId,
    updatedAt: str(result.updatedAt),
    deduplicated: Boolean(result.deduplicated),
  };
};

export const createChangeOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (
      input: {
        projectId: string;
        operationKey: string;
        requestedId?: string;
      } & z.input<typeof coInput>,
    ) =>
      z
        .object({
          projectId: z.string().uuid(),
          operationKey: changeOrderOperationKey,
          requestedId: z.string().uuid().optional(),
        })
        .merge(coInputFields)
        .superRefine(refineChangeOrderDirection)
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { projectId, operationKey, requestedId, ...rest } = data;
    const { data: command, error } = await dynamicRpc(
      context.supabase,
      "create_change_order_atomic",
      {
        p_project_id: projectId,
        ...changeOrderCommandArgs(rest),
        p_operation_key: operationKey,
        p_requested_id: requestedId ?? null,
      },
    );
    if (error) throw new Error(error.message);
    const result = requireChangeOrderCommandResult(command);
    return { ok: true, id: result.changeOrderId, ...result };
  });

export const updateChangeOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (
      input: {
        id: string;
        projectId: string;
        expectedUpdatedAt: string;
        operationKey: string;
      } & Partial<z.input<typeof coInput>>,
    ) =>
      z
        .object({
          id: z.string().uuid(),
          projectId: z.string().uuid(),
          expectedUpdatedAt: z.string().datetime({ offset: true }),
          operationKey: changeOrderOperationKey,
        })
        .merge(coInputFields.partial())
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { id, projectId, expectedUpdatedAt, operationKey, ...patch } = data;
    const { data: stored, error: loadError } = await context.supabase
      .from("change_orders")
      .select(
        "project_id,number,description,contract_amount,cost_amount,financial_direction,status,probability,owner,notes,co_type,pricing_method,schedule_impact_days,requested_by,date_initiated,updated_at",
      )
      .eq("id", id)
      .single();
    if (loadError) throw new Error(loadError.message);
    if (!stored) throw new Error("Change order not found.");
    const storedRow = stored as Record<string, unknown>;
    if (str(storedRow.project_id) !== projectId) {
      throw new Error("Change order not found on this project.");
    }
    const next = coInput.parse({
      number: str(storedRow.number),
      description: str(storedRow.description),
      contract_amount: num(storedRow.contract_amount),
      cost_amount: num(storedRow.cost_amount),
      financial_direction: storedRow.financial_direction,
      status: storedRow.status,
      probability: num(storedRow.probability),
      owner: str(storedRow.owner),
      notes: str(storedRow.notes),
      co_type: storedRow.co_type,
      pricing_method: storedRow.pricing_method,
      schedule_impact_days: num(storedRow.schedule_impact_days),
      requested_by: str(storedRow.requested_by),
      date_initiated: (storedRow.date_initiated as string | null) ?? null,
      ...patch,
    });
    const { data: command, error } = await dynamicRpc(
      context.supabase,
      "update_change_order_atomic",
      {
        p_project_id: projectId,
        p_change_order_id: id,
        p_expected_updated_at: expectedUpdatedAt,
        ...changeOrderCommandArgs(next),
        p_operation_key: operationKey,
      },
    );
    if (error) throw new Error(error.message);
    const result = requireChangeOrderCommandResult(command);
    return { ok: true, id: result.changeOrderId, ...result };
  });

const deleteChangeOrderInput = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  operationKey: changeOrderOperationKey,
});

export const deleteChangeOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof deleteChangeOrderInput>) =>
    deleteChangeOrderInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: command, error } = await dynamicRpc(
      context.supabase,
      "delete_change_order_atomic",
      {
        p_project_id: data.projectId,
        p_change_order_id: data.id,
        p_expected_updated_at: data.expectedUpdatedAt,
        p_operation_key: data.operationKey,
      },
    );
    if (error) throw new Error(error.message);
    const result = requireChangeOrderCommandResult(command);
    if (!(command as Record<string, unknown> | null)?.deleted) {
      throw new Error("Change order did not delete. Refresh and try again.");
    }
    return { ok: true, id: result.changeOrderId, ...result };
  });

// ---------------- CO ↔ RISK LINK ----------------
// Cross-reference a change order and a risk-tally exposure both ways. Money is
// untouched, but both pointers must commit together through the project-scoped
// database command so a failed second write can never leave a half-link.

const coExposureLinkInput = z.object({
  changeOrderId: z.string().uuid(),
  exposureId: z.string().uuid(),
});

export const linkChangeOrderExposure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof coExposureLinkInput>) => coExposureLinkInput.parse(input))
  .handler(async ({ data, context }) => {
    const { changeOrderId, exposureId } = data;
    const { data: command, error } = await dynamicRpc(
      context.supabase,
      "link_change_order_exposure_atomic",
      {
        p_change_order_id: changeOrderId,
        p_exposure_id: exposureId,
      },
    );
    if (error) throw new Error(error.message);
    const result = requireChangeOrderCommandResult(command);
    return { ok: true, linked: true, ...result };
  });

export const unlinkChangeOrderExposure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof coExposureLinkInput>) => coExposureLinkInput.parse(input))
  .handler(async ({ data, context }) => {
    const { changeOrderId, exposureId } = data;
    const { data: command, error } = await dynamicRpc(
      context.supabase,
      "unlink_change_order_exposure_atomic",
      {
        p_change_order_id: changeOrderId,
        p_exposure_id: exposureId,
      },
    );
    if (error) throw new Error(error.message);
    const result = requireChangeOrderCommandResult(command);
    return { ok: true, linked: false, ...result };
  });

// ---------------- CLAIM ↔ RISK / CO LINKS ----------------
// Cross-reference a claim with the risk it's tracked as, and the CO it was
// promoted into. Pure pointer wiring — the claim keeps its outgoing pointer
// (project_claims.risk_exposure_id / change_order_id, added in slice 2), and
// these set the REVERSE pointer on exposures/change_orders (added in slice 5).
// Claim ↔ CO uses the atomic database command below; claim ↔ risk remains the
// older reference-only workflow until its own command migration lands.

export const linkClaimExposure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { claimId: string; exposureId: string }) =>
    z.object({ claimId: z.string().uuid(), exposureId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { claimId, exposureId } = data;
    const { error: claimErr } = await dynamicTable(context.supabase, "project_claims")
      .update({ risk_exposure_id: exposureId })
      .eq("id", claimId);
    if (claimErr && !isMissingRestColumn(claimErr, "risk_exposure_id")) {
      throw new Error(claimErr.message);
    }
    const { error: expErr } = await context.supabase
      .from("exposures")
      .update({ linked_claim_id: claimId } as never)
      .eq("id", exposureId);
    if (expErr && !isMissingRestColumn(expErr, "linked_claim_id")) throw new Error(expErr.message);
    return { ok: true, linked: !claimErr && !expErr };
  });

export const linkClaimChangeOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { claimId: string; changeOrderId: string }) =>
    z.object({ claimId: z.string().uuid(), changeOrderId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { claimId, changeOrderId } = data;
    const { data: command, error } = await dynamicRpc(
      context.supabase,
      "link_claim_change_order_atomic",
      {
        p_claim_id: claimId,
        p_change_order_id: changeOrderId,
      },
    );
    if (error) throw new Error(error.message);
    const result = requireChangeOrderCommandResult(command);
    return { ok: true, linked: true, ...result };
  });

// ---------------- CHANGE ORDER ALLOCATIONS ----------------
// Assign an approved change order's value to an SOV cost code so it becomes
// billable (rolls into that line's change_order_value_cents = G702 line 2 on
// the next application). Before this, the app nudged "allocate to a cost
// code" with nowhere to do it; this is that missing control.

const changeOrderAllocationInput = z
  .object({
    projectId: z.string().uuid(),
    changeOrderId: z.string().uuid(),
    costBucketId: z.string().uuid(),
    contractAmount: exactCentSignedMoney,
    costAmount: exactCentSignedMoney.default(0),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .refine(
    (input) =>
      Math.abs(dollarsToCents(input.contractAmount)) > 0 ||
      Math.abs(dollarsToCents(input.costAmount)) > 0,
    {
      message: "An allocation must include contract or cost value.",
    },
  );

export const allocateChangeOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof changeOrderAllocationInput>) =>
    changeOrderAllocationInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    // The RPC and its table trigger lock the parent CO, re-check Approved state,
    // and enforce cumulative contract/cost caps in one transaction. This cannot
    // be safely composed from browser-side reads followed by a REST insert.
    const { data: result, error } = await dynamicRpc(
      context.supabase,
      "allocate_change_order_atomic",
      {
        p_project_id: data.projectId,
        p_change_order_id: data.changeOrderId,
        p_cost_bucket_id: data.costBucketId,
        // The current credit UI passes signed negatives; the RPC derives the
        // authoritative sign from the locked change order itself.
        p_contract_amount_cents: Math.abs(dollarsToCents(data.contractAmount)),
        p_cost_amount_cents: Math.abs(dollarsToCents(data.costAmount)),
        p_idempotency_key: data.idempotencyKey,
      },
    );
    if (error) {
      if (
        error.code === "PGRST202" ||
        /allocate_change_order_atomic|schema cache|function/i.test(error.message)
      ) {
        throw new Error("Change-order allocation isn't available on this workspace yet.");
      }
      throw new Error(error.message);
    }
    const allocation = (result ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      allocationId: str(allocation.allocationId),
      contractAmount: num(allocation.contractAmount),
      costAmount: num(allocation.costAmount),
    };
  });

export const deleteChangeOrderAllocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await dynamicRpc(context.supabase, "delete_change_order_allocation_atomic", {
      p_allocation_id: data.id,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// BUDGETLOCK1: the budget ledger on the project Budget tab layers approved
// change-order cost onto the frozen baseline, so it needs the project's CO
// allocations at route level (BillingWorkspace loads its own copy separately).
export interface ChangeOrderAllocationListRow {
  id: string;
  project_id: string;
  change_order_id: string;
  cost_bucket_id: string | null;
  cost_code: string;
  contract_amount: number;
  cost_amount: number;
}

export async function readChangeOrderAllocations(
  supabase: unknown,
  projectId: string,
): Promise<ChangeOrderAllocationListRow[]> {
  const { data: rows, error } = await dynamicTable(supabase, "change_order_allocations")
    .select("id,project_id,change_order_id,cost_bucket_id,cost_code,contract_amount,cost_amount")
    .eq("project_id", projectId);
  return requireFinancialRows(
    rows as Record<string, unknown>[] | null,
    error,
    "change_order_allocations",
  ).map((row) => ({
    id: str(row.id),
    project_id: str(row.project_id),
    change_order_id: str(row.change_order_id),
    cost_bucket_id: (row.cost_bucket_id as string | null) ?? null,
    cost_code: str(row.cost_code),
    contract_amount: financialNum(row.contract_amount, "change_order_allocations.contract_amount"),
    cost_amount: financialNum(row.cost_amount, "change_order_allocations.cost_amount"),
  }));
}

export const listChangeOrderAllocations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<ChangeOrderAllocationListRow[]> => {
    return readChangeOrderAllocations(context.supabase, data.projectId);
  });

// BUDGETLOCK1: explicit lock. Idempotent — locking an already-locked budget is
// a no-op. There is no unlock in the product; unwinding a lock is a desk
// operation by design.
export const lockProjectBudget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string; operationKey: string }) =>
    z.object({ projectId: z.string().uuid(), operationKey: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const result = await dynamicRpc(context.supabase, "lock_project_budget_atomic", {
      p_project_id: data.projectId,
      p_operation_key: data.operationKey,
    });
    if (result.error) {
      if (
        /budget_locked_at|schema cache|could not find the function|does not exist/i.test(
          result.error.message,
        )
      ) {
        throw new Error(
          "Budget locking is still being enabled. No lock state changed; try again in a few minutes.",
        );
      }
      throw new Error(result.error.message);
    }
    if (!(await readProjectBudgetLock(context.supabase, data.projectId))) {
      throw new Error(
        "Budget lock did not commit. No baseline mutation is permitted until the locked state is confirmed.",
      );
    }
    return { ok: true, locked: true };
  });

// ---------------- EXPOSURE → COST-CODE ALLOCATION (BUDGETENGINE Phase 1) ----------------

export interface ExposureAllocationRow {
  id: string;
  project_id: string;
  exposure_id: string;
  cost_bucket_id: string | null;
  cost_code: string;
  amount: number;
  created_at: string;
  updated_at: string;
}

// The exposure_allocations table ships in a migration the desk applies. Until
// then, reads must degrade to empty so the live app never crashes.
function isMissingExposureAllocationsTable(error: { message?: string } | null) {
  const message = error?.message ?? "";
  return /exposure_allocations|does not exist|schema cache|relation/i.test(message);
}

const exposureAllocationInput = z.object({
  projectId: z.string().uuid(),
  exposureId: z.string().uuid(),
  costBucketId: z.string().uuid(),
  amount: z.number().min(0),
});

export const allocateExposure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof exposureAllocationInput>) =>
    exposureAllocationInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    // RLS-scoped reads gate access: the bucket and the exposure must both live
    // in a project the caller can manage. The bucket supplies the cost code;
    // the exposure's hold_class (E/C) decides At Risk vs Contingency at rollup.
    const bucketRes = await dynamicTable(context.supabase, "cost_buckets")
      .select("id,project_id,cost_code")
      .eq("id", data.costBucketId)
      .maybeSingle();
    if (bucketRes.error) throw new Error(bucketRes.error.message);
    const bucket = bucketRes.data as Record<string, unknown> | null;
    if (!bucket || (bucket.project_id as string) !== data.projectId) {
      throw new Error("Cost code not found on this project.");
    }
    const exposureRes = await dynamicTable(context.supabase, "exposures")
      .select("id,project_id")
      .eq("id", data.exposureId)
      .maybeSingle();
    if (exposureRes.error) throw new Error(exposureRes.error.message);
    const exposure = exposureRes.data as Record<string, unknown> | null;
    if (!exposure || (exposure.project_id as string) !== data.projectId) {
      throw new Error("Exposure not found on this project.");
    }

    const { error } = await dynamicTable(context.supabase, "exposure_allocations").insert({
      project_id: data.projectId,
      exposure_id: data.exposureId,
      cost_bucket_id: data.costBucketId,
      cost_code: str(bucket.cost_code),
      amount: data.amount,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteExposureAllocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await dynamicTable(context.supabase, "exposure_allocations")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const listExposureAllocationsInput = z.object({ projectId: z.string().uuid() });

export const listExposureAllocations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof listExposureAllocationsInput>) =>
    listExposureAllocationsInput.parse(input),
  )
  .handler(async ({ data, context }): Promise<ExposureAllocationRow[]> => {
    const { data: rows, error } = await dynamicTable(context.supabase, "exposure_allocations")
      .select("id,project_id,exposure_id,cost_bucket_id,cost_code,amount,created_at,updated_at")
      .eq("project_id", data.projectId);
    if (error) {
      if (isMissingExposureAllocationsTable(error)) return [];
      throw new Error(error.message);
    }
    return (rows ?? []).map((row) => {
      const record = row as Record<string, unknown>;
      return {
        id: str(record.id),
        project_id: str(record.project_id),
        exposure_id: str(record.exposure_id),
        cost_bucket_id: (record.cost_bucket_id as string | null) ?? null,
        cost_code: str(record.cost_code),
        amount: num(record.amount),
        created_at: str(record.created_at),
        updated_at: str(record.updated_at),
      };
    });
  });

// ---------------- ESTIMATE → BUDGET CARRY (BUDGETENGINE Phase 3) ----------------

// Turn the project's Overwatch estimate into its budget: aggregate the estimate
// line COSTS (material + labor) by cost code and write them onto the cost
// buckets. The estimate's markups are the margin, not the budget. Matching
// cost codes update in place; new codes create a bucket. RLS scopes every read
// and write to a project the caller can manage.
export const buildBudgetFromEstimate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { projectId: string; pricing?: "unpriced" | "auto"; operation_key: string }) =>
      z
        .object({
          projectId: z.string().uuid(),
          // BUDGETVSCONTRACT2: "auto" pre-fills each line's contract value by
          // distributing the estimate's markup pro-rata by cost (an editable
          // starting point); "unpriced" (default) leaves contract values 0 so
          // the user enters the contract SOV themselves.
          pricing: z.enum(["unpriced", "auto"]).default("unpriced"),
          operation_key: z.string().trim().min(1).max(200),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await dynamicRpc(
      context.supabase,
      "build_budget_from_estimate_atomic",
      {
        p_project_id: data.projectId,
        p_pricing: data.pricing,
        p_operation_key: data.operation_key,
      },
    );
    if (error) {
      throw new Error(`Budget build did not commit: ${error.message}. Try again in a few minutes.`);
    }
    if (!result || typeof result !== "object") {
      throw new Error("Budget build did not return a committed operation result.");
    }
    return result as Json;
  });

// ---------------- INSPECTIONS ----------------

const inspectionInput = z.object({
  parent_inspection_id: z.string().uuid().nullable().optional(),
  seed_key: z.string().max(120).default(""),
  inspection_type: z.string().min(1).max(200),
  authority: z.string().max(200).default(""),
  location: z.string().max(200).default(""),
  responsible_party: z.string().max(200).default(""),
  inspector: z.string().max(200).default(""),
  requested_date: z.string().nullable().optional(),
  scheduled_date: z.string().nullable().optional(),
  completed_date: z.string().nullable().optional(),
  status: z.enum(INSPECTION_STATUSES).default("planned"),
  result: z.enum(INSPECTION_RESULTS).default("pending"),
  attempt_number: z.number().int().min(1).default(1),
  required_reinspection: z.boolean().default(false),
  cost_impact: z.number().min(0).default(0),
  schedule_impact_weeks: z.number().min(0).nullable().optional(),
  notes: z.string().max(2000).default(""),
  corrective_action: z.string().max(2000).default(""),
  risk_exposure_id: z.string().uuid().nullable().optional(),
});

type InspectionInput = z.infer<typeof inspectionInput>;

async function createFallbackInspectionExposure(
  supabase: unknown,
  projectId: string,
  userId: string | null | undefined,
  input: InspectionInput,
) {
  const payload = fallbackExposurePayloadForInspection(projectId, {
    ...input,
    created_by: userId ?? null,
  });
  const { data: inserted, error } = await dynamicTable(supabase, "exposures")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { ok: true, id: (inserted as { id?: string } | null)?.id ?? "", fallback: true };
}

async function updateFallbackInspectionExposure(
  supabase: unknown,
  id: string,
  patch: Partial<InspectionInput>,
) {
  const { data: existing, error: loadError } = await dynamicTable(supabase, "exposures")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (loadError) throw new Error(loadError.message);
  if (!existing) throw new Error("Inspection was not found or is not accessible.");

  const exposure = normalizeExposure(existing as Record<string, unknown>);
  const current = fallbackInspectionFromExposure(exposure);
  if (!current) throw new Error("Inspection fallback record was not found.");

  const payload = fallbackExposurePayloadForInspection(exposure.project_id, {
    parent_inspection_id: current.parent_inspection_id,
    seed_key: current.seed_key,
    inspection_type: current.inspection_type,
    authority: current.authority,
    location: current.location,
    responsible_party: current.responsible_party,
    inspector: current.inspector,
    requested_date: current.requested_date,
    scheduled_date: current.scheduled_date,
    completed_date: current.completed_date,
    status: current.status,
    result: current.result,
    attempt_number: current.attempt_number,
    required_reinspection: current.required_reinspection,
    cost_impact: current.cost_impact,
    schedule_impact_weeks: current.schedule_impact_weeks,
    notes: current.notes,
    corrective_action: current.corrective_action,
    created_by: current.created_by,
    ...patch,
  });
  const { error } = await dynamicTable(supabase, "exposures").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true, fallback: true };
}

async function deleteFallbackInspectionExposure(supabase: unknown, id: string) {
  const { data: existing, error: loadError } = await dynamicTable(supabase, "exposures")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (loadError) throw new Error(loadError.message);
  if (!existing) throw new Error("Inspection was not found or is not accessible.");

  const exposure = normalizeExposure(existing as Record<string, unknown>);
  if (!fallbackInspectionFromExposure(exposure)) {
    throw new Error("Inspection fallback record was not found.");
  }

  const { error } = await dynamicTable(supabase, "exposures").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true, id, fallback: true };
}

export const createInspection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string } & z.input<typeof inspectionInput>) =>
    z.object({ projectId: z.string().uuid() }).merge(inspectionInput).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { projectId, ...rest } = data;
    const { data: inserted, error } = await dynamicTable(context.supabase, "project_inspections")
      .insert({
        project_id: projectId,
        ...rest,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) {
      if (isProjectInspectionsSchemaError(error)) {
        return createFallbackInspectionExposure(context.supabase, projectId, context.userId, rest);
      }
      throw new Error(error.message);
    }
    return { ok: true, id: (inserted as { id?: string } | null)?.id ?? "" };
  });

export const updateInspection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string } & Partial<z.input<typeof inspectionInput>>) =>
    z.object({ id: z.string().uuid() }).merge(inspectionInput.partial()).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { data: updated, error } = await dynamicTable(context.supabase, "project_inspections")
      .update(patch)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) {
      if (isProjectInspectionsSchemaError(error)) {
        return updateFallbackInspectionExposure(context.supabase, id, patch);
      }
      throw new Error(error.message);
    }
    if (!updated) return updateFallbackInspectionExposure(context.supabase, id, patch);
    return { ok: true };
  });

export const deleteInspection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: deleted, error } = await dynamicTable(context.supabase, "project_inspections")
      .delete()
      .eq("id", data.id)
      .select("id")
      .maybeSingle();
    if (error) {
      if (isProjectInspectionsSchemaError(error)) {
        return deleteFallbackInspectionExposure(context.supabase, data.id);
      }
      throw new Error(error.message);
    }
    if (!deleted) return deleteFallbackInspectionExposure(context.supabase, data.id);
    return { ok: true, id: data.id };
  });

// ---------------- CLAIMS ----------------
// A claim is the formal dispute-resolution record (extension of time / delay
// damages / etc.). CRUD mirrors inspections; money is numeric whole-dollars to
// match exposures/change_orders. No fallback shim — if the table is a migration
// behind, getProject already returns [] and these fns surface the error.

const claimInput = z.object({
  seed_key: z.string().max(120).default(""),
  claim_number: z.string().max(50).default(""),
  title: z.string().min(1).max(200),
  description: z.string().max(4000).default(""),
  claim_type: z.enum(CLAIM_TYPES).default("delay"),
  status: z.enum(CLAIM_STATUSES).default("in_preparation"),
  money_claimed: z.number().min(0).default(0),
  time_claimed_days: z.number().int().min(0).default(0),
  money_awarded: z.number().min(0).default(0),
  time_awarded_days: z.number().int().min(0).default(0),
  outcome: z.string().max(4000).default(""),
  owner: z.string().max(200).default(""),
  submitted_at: z.string().nullable().optional(),
  resolved_at: z.string().nullable().optional(),
  risk_exposure_id: z.string().uuid().nullable().optional(),
  change_order_id: z.string().uuid().nullable().optional(),
});

export const createClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string } & z.input<typeof claimInput>) =>
    z.object({ projectId: z.string().uuid() }).merge(claimInput).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { projectId, ...rest } = data;
    const { data: inserted, error } = await dynamicTable(context.supabase, "project_claims")
      .insert({ project_id: projectId, ...rest, created_by: context.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: (inserted as { id?: string } | null)?.id ?? "" };
  });

export const updateClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string } & Partial<z.input<typeof claimInput>>) =>
    z.object({ id: z.string().uuid() }).merge(claimInput.partial()).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await dynamicTable(context.supabase, "project_claims")
      .update(patch)
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await dynamicTable(context.supabase, "project_claims")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, id: data.id };
  });

// ---------------- CLAIM CYCLE LOG ----------------
// The dated back-and-forth on a claim (sent → received → reviewed → meeting →
// kicked back → resubmitted → resolved). project_id rides on the row so RLS +
// getProject can filter by project; claim_id ties it to its claim.

const claimEventInput = z.object({
  claimId: z.string().uuid(),
  event_type: z
    .enum([
      "submitted",
      "received",
      "reviewed",
      "meeting",
      "returned_for_revision",
      "resubmitted",
      "resolved",
      "other",
    ])
    .default("submitted"),
  event_date: z.string().nullable().optional(),
  revision_number: z.number().int().min(0).default(0),
  note: z.string().max(2000).default(""),
  seed_key: z.string().max(120).default(""),
});

export const createClaimEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string } & z.input<typeof claimEventInput>) =>
    z.object({ projectId: z.string().uuid() }).merge(claimEventInput).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { projectId, claimId, ...rest } = data;
    const { data: inserted, error } = await dynamicTable(context.supabase, "project_claim_events")
      .insert({ project_id: projectId, claim_id: claimId, ...rest, created_by: context.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: (inserted as { id?: string } | null)?.id ?? "" };
  });

export const updateClaimEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { id: string } & Partial<Omit<z.input<typeof claimEventInput>, "claimId">>) =>
      z
        .object({ id: z.string().uuid() })
        .merge(claimEventInput.omit({ claimId: true }).partial())
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await dynamicTable(context.supabase, "project_claim_events")
      .update(patch)
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteClaimEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await dynamicTable(context.supabase, "project_claim_events")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, id: data.id };
  });

// ---------------- CLAIM DOCUMENTS ----------------
// Attachments on a claim (the claim package + supporting docs). Bytes are
// uploaded to the private 'claim-docs' bucket client-side (path
// <projectId>/<claimId>/<file>, team storage RLS); this records the path + name.

export const addClaimDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        claimId: z.string().uuid(),
        projectId: z.string().uuid(),
        path: z.string().min(1).max(500),
        name: z.string().min(1).max(300),
        doc_type: z.enum(["claim", "supporting", "correspondence", "other"]).default("supporting"),
        note: z.string().max(300).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ClaimDocumentRow> => {
    const { data: row, error } = await dynamicTable(context.supabase, "project_claim_documents")
      .insert({
        claim_id: data.claimId,
        project_id: data.projectId,
        storage_path: data.path,
        file_name: data.name,
        doc_type: data.doc_type,
        note: data.note,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return normalizeClaimDocument(row as Record<string, unknown>);
  });

export const deleteClaimDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await dynamicTable(context.supabase, "project_claim_documents")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, id: data.id };
  });

// ---------------- CHANGE ORDER DOCUMENTS ----------------
// Attachments on a change order (the CO proposal/quote + cost backup +
// correspondence). Bytes are uploaded to the private 'co-docs' bucket
// client-side (path <projectId>/<changeOrderId>/<file>, team storage RLS); this
// records the path + name.

export const addChangeOrderDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        changeOrderId: z.string().uuid(),
        projectId: z.string().uuid(),
        path: z.string().min(1).max(500),
        name: z.string().min(1).max(300),
        doc_type: z.enum(["backup", "quote", "correspondence", "other"]).default("backup"),
        note: z.string().max(300).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ChangeOrderDocumentRow> => {
    const { data: row, error } = await dynamicTable(context.supabase, "change_order_documents")
      .insert({
        change_order_id: data.changeOrderId,
        project_id: data.projectId,
        storage_path: data.path,
        file_name: data.name,
        doc_type: data.doc_type,
        note: data.note,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return normalizeChangeOrderDocument(row as Record<string, unknown>);
  });

export const deleteChangeOrderDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await dynamicTable(context.supabase, "change_order_documents")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, id: data.id };
  });

// ---------------- COST BUCKETS ----------------

// BUDGETLOCK1 (founder decision 2026-07-06): the budget is a locked baseline.
// Once projects.budget_locked_at is set, original_budget never changes — the
// only budget movement is an approved change order's budgeted cost (priced on
// the CO, allocated to cost codes). Lock authority always fails closed.
export async function readProjectBudgetLock(
  supabase: unknown,
  projectId: string,
): Promise<boolean> {
  const { data, error } = await dynamicTable(supabase, "projects")
    .select("budget_locked_at")
    .eq("id", projectId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `Budget lock state is unavailable: ${error.message}. No budget mutation is permitted until projects.budget_locked_at can be read.`,
    );
  }
  if (!data || typeof data !== "object") {
    throw new Error("Budget lock state is unavailable: the project was not returned.");
  }
  return requireProjectBudgetLock(data as Record<string, unknown>) !== null;
}

const bucketInput = z.object({
  id: z.string().uuid(),
  operation_key: z.string().trim().min(1).max(200),
  note: z.string().max(500).default(""),
  patch: z.object({
    cost_code: z.string().max(80).optional(),
    bucket: z.string().min(1).max(100).optional(),
    contract_value: exactCentMoney.optional(),
    original_budget: exactCentMoney.optional(),
    actual_to_date: exactCentMoney.optional(),
    ftc: exactCentMoney.optional(),
    source_type: z.enum(["original_sov", "change_order", "added_cost"]).optional(),
    source_date: z.string().nullable().optional(),
    source_note: z.string().max(500).optional(),
  }),
});

export const updateBucket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => bucketInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await dynamicRpc(
      context.supabase,
      "update_cost_bucket_atomic",
      {
        p_bucket_id: data.id,
        p_patch: data.patch,
        p_operation_key: data.operation_key,
        p_note: data.note,
      },
    );
    if (error) {
      throw new Error(`Budget line did not commit: ${error.message}. Try again in a few minutes.`);
    }
    if (!result || typeof result !== "object") {
      throw new Error("Budget line did not return a committed operation result.");
    }
    return result as Json;
  });

const createBucketInput = z.object({
  projectId: z.string().uuid(),
  cost_code: z.string().max(80).default(""),
  bucket: z.string().min(1).max(100),
  contract_value: exactCentMoney.default(0),
  original_budget: exactCentMoney.default(0),
  actual_to_date: exactCentMoney.default(0),
  ftc: exactCentMoney.default(0),
  source_type: z.enum(["original_sov", "change_order", "added_cost"]).default("added_cost"),
  source_date: z.string().nullable().optional(),
  source_note: z.string().max(500).default(""),
  operation_key: z.string().trim().min(1).max(200),
});

export const createBucket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof createBucketInput>) => createBucketInput.parse(input))
  .handler(async ({ data, context }) => {
    const { projectId, operation_key, ...bucket } = data;
    const { data: result, error } = await dynamicRpc(
      context.supabase,
      "create_cost_bucket_atomic",
      {
        p_project_id: projectId,
        p_payload: bucket,
        p_operation_key: operation_key,
      },
    );
    if (error) {
      throw new Error(`Budget line was not created: ${error.message}. Try again in a few minutes.`);
    }
    if (!result || typeof result !== "object") {
      throw new Error("Budget line creation did not return a committed operation result.");
    }
    return result as Json;
  });

export const deleteBucket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string; id: string; operation_key: string }) =>
    z
      .object({
        projectId: z.string().uuid(),
        id: z.string().uuid(),
        operation_key: z.string().trim().min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await dynamicRpc(
      context.supabase,
      "delete_cost_bucket_atomic",
      {
        p_project_id: data.projectId,
        p_bucket_id: data.id,
        p_operation_key: data.operation_key,
      },
    );
    if (error) {
      throw new Error(`Budget line was not deleted: ${error.message}. Try again in a few minutes.`);
    }
    if (!result || typeof result !== "object") {
      throw new Error("Budget line deletion did not return a committed operation result.");
    }
    return result as Json;
  });

/*
 * Bucket writes and override history intentionally share the same database
 * transaction in update_cost_bucket_atomic. There is no standalone audit write:
 * returning success without durable history would misstate financial truth.
 */

// -------- BUDGETCONSOLIDATE1: budget line override audit log --------
// The Budget tab is one ledger you open a line to edit. A line's cost figures
// are normally derived (actuals from the daily log, forecast/commitment from the
// sub buyout, budget from change orders), so a manual edit in the line editor is
// an OVERRIDE — recorded here so it's never invisible.

export interface BudgetOverrideRow {
  id: string;
  project_id: string;
  cost_bucket_id: string | null;
  field: string;
  old_value: number;
  new_value: number;
  note: string | null;
  changed_by: string | null;
  created_at: string;
}

export const listBudgetOverrides = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<BudgetOverrideRow[]> => {
    const { data: rows, error } = await dynamicTable(context.supabase, "budget_line_overrides")
      .select("id,project_id,cost_bucket_id,field,old_value,new_value,note,changed_by,created_at")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false })
      .limit(200);
    return requireFinancialRows(
      rows as Record<string, unknown>[] | null,
      error,
      "budget_line_overrides",
    ).map((row) => ({
      id: str(row.id),
      project_id: str(row.project_id),
      cost_bucket_id: (row.cost_bucket_id as string | null) ?? null,
      field: str(row.field),
      old_value: financialNum(row.old_value, "budget_line_overrides.old_value"),
      new_value: financialNum(row.new_value, "budget_line_overrides.new_value"),
      note: (row.note as string | null) ?? null,
      changed_by: (row.changed_by as string | null) ?? null,
      created_at: str(row.created_at),
    }));
  });

// ---------------- DECISIONS ----------------

const DECISION_STATUSES = ["open", "in_progress", "resolved", "overdue"] as const;

const decisionInput = z.object({
  decision: z.string().min(1).max(500),
  impact: z.string().max(5000).default(""),
  owner: z.string().max(200).default(""),
  owner_email: z.string().email().or(z.literal("")).default(""),
  owner_user_id: z.string().uuid().nullable().optional(),
  due_date: z.string().nullable().optional(),
  status: z.enum(DECISION_STATUSES).default("open"),
  linked_exposure_id: z.string().uuid().nullable().optional(),
  linked_co_id: z.string().uuid().nullable().optional(),
  reminder_enabled: z.boolean().default(false),
  reminder_at: z.string().nullable().optional(),
  reminder_channel: z.enum(DECISION_REMINDER_CHANNELS).default("none"),
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
      .insert({ project_id: projectId, ...rest } as never);
    if (error) {
      if (isMissingDecisionEnhancementColumn(error)) {
        const { error: fallbackError } = await context.supabase.from("decisions").insert({
          project_id: projectId,
          ...stripDecisionEnhancementFields(rest),
        } as never);
        if (fallbackError) throw new Error(fallbackError.message);
        return { ok: true, reminderFieldsPersisted: false };
      }
      throw new Error(error.message);
    }
    return { ok: true };
  });

export const updateDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string } & Partial<z.input<typeof decisionInput>>) =>
    z.object({ id: z.string().uuid() }).merge(decisionInput.partial()).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase
      .from("decisions")
      .update(patch as never)
      .eq("id", id);
    if (error) {
      if (isMissingDecisionEnhancementColumn(error)) {
        const { error: fallbackError } = await context.supabase
          .from("decisions")
          .update(stripDecisionEnhancementFields(patch) as never)
          .eq("id", id);
        if (fallbackError) throw new Error(fallbackError.message);
        return { ok: true, reminderFieldsPersisted: false };
      }
      throw new Error(error.message);
    }
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
  contract_amount: z.number().min(0).max(MAX_SAFE_DOLLARS).default(0),
  // Owner credits are signed. The database command rejects a negative revised
  // contract, so a legitimate deductive CO does not have to be falsified as a
  // positive value here.
  change_order_amount: z.number().min(-MAX_SAFE_DOLLARS).max(MAX_SAFE_DOLLARS).default(0),
  amount_billed: z.number().min(0).max(MAX_SAFE_DOLLARS).default(0),
  paid_to_date: z.number().min(0).max(MAX_SAFE_DOLLARS).default(0),
  retainage: z.number().min(0).max(MAX_SAFE_DOLLARS).default(0),
  status: z.enum(BILLING_STATUSES).default("draft"),
  output_format: z.enum(["invoice", "aia_g702"]).default("invoice"),
  notes: z.string().max(2000).default(""),
  sort_order: z.number().int().optional(),
});

const billingCommandIdempotencyKey = z.string().trim().min(1).max(200);

export const createBillingApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (
      input: { projectId: string; idempotency_key: string } & z.input<
        typeof billingApplicationInput
      >,
    ) =>
      z
        .object({ projectId: z.string().uuid(), idempotency_key: billingCommandIdempotencyKey })
        .merge(billingApplicationInput)
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { projectId, idempotency_key, sort_order: _ignoredSortOrder, ...rest } = data;
    if (rest.paid_to_date !== 0 || rest.status !== "draft") {
      throw new Error(
        "A pay application must be created as a cash-free draft. Submit or reject it through its lifecycle control after creation.",
      );
    }
    const billingPayload = {
      ...rest,
      application_number: normalizeBillingNumberLabel(rest.application_number),
      invoice_number: normalizeBillingNumberLabel(rest.invoice_number),
      contract_amount: quantizeDollars(rest.contract_amount),
      change_order_amount: quantizeDollars(rest.change_order_amount),
      amount_billed: quantizeDollars(rest.amount_billed),
      paid_to_date: 0,
      retainage: quantizeDollars(rest.retainage),
    };
    if (billingPayload.contract_amount + billingPayload.change_order_amount < 0) {
      throw new Error("The revised contract cannot be negative after owner credits.");
    }

    const { data: result, error } = await dynamicRpc(
      context.supabase,
      "create_billing_application_atomic",
      {
        p_project_id: projectId,
        p_payload: billingPayload,
        p_idempotency_key: idempotency_key,
      },
    );
    if (error) throw new Error(error.message);
    const command = (result ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      id: str(command.billingApplicationId),
      deduplicated: Boolean(command.deduplicated),
    };
  });

export const updateBillingApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      id: string;
      patch: Partial<z.input<typeof billingApplicationInput>>;
      idempotency_key: string;
    }) =>
      z
        .object({
          id: z.string().uuid(),
          patch: billingApplicationInput.partial(),
          idempotency_key: billingCommandIdempotencyKey,
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const normalizedPatch = { ...data.patch };
    if (
      "paid_to_date" in normalizedPatch ||
      normalizedPatch.status === "partial" ||
      normalizedPatch.status === "paid"
    ) {
      throw new Error(
        "Payments received and paid status are ledger-controlled. Record or reconcile the linked invoice payment instead.",
      );
    }
    if ("sort_order" in normalizedPatch) {
      throw new Error("Pay-application order is assigned by the financial ledger.");
    }
    if (typeof normalizedPatch.application_number === "string") {
      normalizedPatch.application_number = normalizeBillingNumberLabel(
        normalizedPatch.application_number,
      );
    }
    if (typeof normalizedPatch.invoice_number === "string") {
      normalizedPatch.invoice_number = normalizeBillingNumberLabel(normalizedPatch.invoice_number);
    }
    for (const moneyKey of [
      "contract_amount",
      "change_order_amount",
      "amount_billed",
      "retainage",
    ] as const) {
      if (typeof normalizedPatch[moneyKey] === "number") {
        normalizedPatch[moneyKey] = quantizeDollars(normalizedPatch[moneyKey] as number);
      }
    }

    if (normalizedPatch.status) {
      if (Object.keys(normalizedPatch).length !== 1) {
        throw new Error("Change pay-application status separately from draft field edits.");
      }
      const { data: result, error } = await dynamicRpc(
        context.supabase,
        "transition_billing_application_atomic",
        {
          p_billing_application_id: data.id,
          p_to_status: normalizedPatch.status,
          p_reason: "",
          p_idempotency_key: data.idempotency_key,
        },
      );
      if (error) throw new Error(error.message);
      const command = (result ?? {}) as Record<string, unknown>;
      return {
        ok: true,
        status: str(command.toStatus),
        deduplicated: Boolean(command.deduplicated),
      };
    }

    const { data: result, error } = await dynamicRpc(
      context.supabase,
      "update_billing_application_atomic",
      {
        p_billing_application_id: data.id,
        p_patch: normalizedPatch,
        p_idempotency_key: data.idempotency_key,
      },
    );
    if (error) throw new Error(error.message);
    const command = (result ?? {}) as Record<string, unknown>;
    return { ok: true, deduplicated: Boolean(command.deduplicated) };
  });

export const deleteBillingApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; idempotency_key: string }) =>
    z.object({ id: z.string().uuid(), idempotency_key: billingCommandIdempotencyKey }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await dynamicRpc(
      context.supabase,
      "delete_billing_application_draft_atomic",
      {
        p_billing_application_id: data.id,
        p_idempotency_key: data.idempotency_key,
      },
    );
    if (error) throw new Error(error.message);
    const command = (result ?? {}) as Record<string, unknown>;
    return { ok: true, deduplicated: Boolean(command.deduplicated) };
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
  subtotal: z.number().min(0).max(MAX_SAFE_DOLLARS).default(0),
  retainage: z.number().min(0).max(MAX_SAFE_DOLLARS).default(0),
  total_due: z.number().min(0).max(MAX_SAFE_DOLLARS).default(0),
  paid_amount: z.number().min(0).max(MAX_SAFE_DOLLARS).default(0),
  status: z.enum(INVOICE_STATUSES).default("draft"),
  client_visible: z.boolean().default(false),
  sent_recipients: z.array(z.string().max(254)).max(50).optional(),
  notes: z.string().max(4000).default(""),
  enabled_payment_methods: z
    .object({
      direct_bank: z.boolean(),
      card: z.boolean(),
      ach_debit: z.boolean(),
      allow_stripe_over_threshold: z.boolean(),
    })
    .partial()
    .optional(),
});

const paymentLedgerInput = z.object({
  invoiceId: z.string().uuid(),
  amount: z.number().positive().max(MAX_SAFE_DOLLARS),
  processor_fee: z.number().min(0).max(MAX_SAFE_DOLLARS).default(0),
  overwatch_fee: z.number().min(0).max(MAX_SAFE_DOLLARS).default(0),
  paid_at: z.string().optional(),
  payment_method: z.string().max(100).default("manual"),
  processor: z.string().max(100).default("manual"),
  processor_payment_id: z.string().max(200).default(""),
  reference: z.string().max(200).default(""),
  notes: z.string().max(4000).default(""),
  // The caller owns operation identity: keep this key stable across retries,
  // and mint a fresh key for each genuinely new payment.
  idempotency_key: z.string().trim().min(1).max(200),
});

const billingInvoiceCommandKey = z.string().trim().min(1).max(200);
const billingInvoiceExpectedVersion = z.string().datetime({ offset: true });

export const createBillingInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { projectId: string; idempotency_key: string } & z.input<typeof billingInvoiceInput>) =>
      z
        .object({ projectId: z.string().uuid(), idempotency_key: billingInvoiceCommandKey })
        .merge(billingInvoiceInput)
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { projectId, idempotency_key, ...rest } = data;
    if (rest.paid_amount !== 0 || rest.status !== "draft" || rest.client_visible) {
      throw new Error(
        "Invoices are created as hidden, cash-free drafts. Send the saved invoice through the audited send command.",
      );
    }
    const invoiceNumber = normalizeBillingNumberLabel(rest.invoice_number);
    const payload = {
      billing_application_id: rest.billing_application_id ?? null,
      invoice_number: invoiceNumber,
      title: normalizeBillingNumberLabel(rest.title),
      issue_date: rest.issue_date ?? null,
      due_date: rest.due_date ?? null,
      subtotal: quantizeDollars(rest.subtotal),
      retainage: quantizeDollars(rest.retainage),
      total_due: quantizeDollars(rest.total_due),
      paid_amount: 0,
      status: "draft",
      client_visible: false,
      sent_recipients: [],
      notes: rest.notes,
      enabled_payment_methods: rest.enabled_payment_methods ?? {},
    };
    const { data: command, error } = await dynamicRpc(
      context.supabase,
      "create_billing_invoice_atomic",
      {
        p_project_id: projectId,
        p_payload: payload,
        p_idempotency_key: idempotency_key,
      },
    );
    if (error) throw new Error(error.message);
    return { ok: true, ...(command as Record<string, unknown>) };
  });

export const updateBillingInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      id: string;
      patch: Partial<z.input<typeof billingInvoiceInput>>;
      expected_updated_at: string;
      idempotency_key: string;
      reason?: string;
    }) =>
      z
        .object({
          id: z.string().uuid(),
          patch: billingInvoiceInput.partial(),
          expected_updated_at: billingInvoiceExpectedVersion,
          idempotency_key: billingInvoiceCommandKey,
          reason: z.string().trim().max(2000).optional(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (
      "paid_amount" in data.patch ||
      data.patch.status === "partially_paid" ||
      data.patch.status === "paid"
    ) {
      throw new Error(
        "Paid amount and paid status are ledger-controlled. Record or reconcile a payment instead.",
      );
    }
    const patch: Record<string, unknown> = { ...data.patch };
    for (const moneyKey of ["subtotal", "retainage", "total_due", "paid_amount"] as const) {
      if (typeof patch[moneyKey] === "number") {
        patch[moneyKey] = quantizeDollars(patch[moneyKey] as number);
      }
    }
    if (typeof patch.invoice_number === "string") {
      patch.invoice_number = normalizeBillingNumberLabel(patch.invoice_number);
    }
    if (typeof patch.title === "string") {
      patch.title = normalizeBillingNumberLabel(patch.title);
    }
    const nextStatus = data.patch.status as InvoiceStatus | undefined;
    let command: unknown;
    let error: { message: string } | null;
    if (nextStatus) {
      const unsupportedTransitionFields = Object.keys(patch).filter(
        (key) => !["status", "client_visible", "sent_recipients"].includes(key),
      );
      if (unsupportedTransitionFields.length > 0) {
        throw new Error("Save invoice edits before changing its lifecycle.");
      }
      if (!["sent", "overdue", "void"].includes(nextStatus)) {
        throw new Error(
          "Invoice status can move to sent, overdue, or void. Viewed and paid status come from client/payment evidence.",
        );
      }
      ({ data: command, error } = await dynamicRpc(
        context.supabase,
        "transition_billing_invoice_atomic",
        {
          p_billing_invoice_id: data.id,
          p_to_status: nextStatus,
          p_sent_recipients: data.patch.sent_recipients ?? [],
          p_reason:
            data.reason ??
            (nextStatus === "void"
              ? "Voided from the invoice workspace."
              : "Invoice lifecycle updated from the billing workspace."),
          p_expected_updated_at: data.expected_updated_at,
          p_idempotency_key: data.idempotency_key,
        },
      ));
    } else {
      ({ data: command, error } = await dynamicRpc(
        context.supabase,
        "update_billing_invoice_atomic",
        {
          p_billing_invoice_id: data.id,
          p_patch: patch,
          p_expected_updated_at: data.expected_updated_at,
          p_idempotency_key: data.idempotency_key,
        },
      ));
    }
    if (error) throw new Error(error.message);
    return { ok: true, ...(command as Record<string, unknown>) };
  });

export const deleteBillingInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; idempotency_key: string }) =>
    z.object({ id: z.string().uuid(), idempotency_key: billingInvoiceCommandKey }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: command, error } = await dynamicRpc(
      context.supabase,
      "delete_billing_invoice_draft_atomic",
      {
        p_billing_invoice_id: data.id,
        p_idempotency_key: data.idempotency_key,
      },
    );
    if (error) throw new Error(error.message);
    return { ok: true, ...(command as Record<string, unknown>) };
  });

export const correctBillingInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      id: string;
      replacement: z.input<typeof billingInvoiceInput>;
      reason: string;
      expected_updated_at: string;
      idempotency_key: string;
    }) =>
      z
        .object({
          id: z.string().uuid(),
          replacement: billingInvoiceInput,
          reason: z.string().trim().min(3).max(2000),
          expected_updated_at: billingInvoiceExpectedVersion,
          idempotency_key: billingInvoiceCommandKey,
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const replacement = {
      ...data.replacement,
      invoice_number: normalizeBillingNumberLabel(data.replacement.invoice_number),
      title: normalizeBillingNumberLabel(data.replacement.title),
      subtotal: quantizeDollars(data.replacement.subtotal),
      retainage: quantizeDollars(data.replacement.retainage),
      total_due: quantizeDollars(data.replacement.total_due),
      paid_amount: 0,
      status: "draft",
      client_visible: false,
      sent_recipients: [],
    };
    const { data: command, error } = await dynamicRpc(
      context.supabase,
      "correct_billing_invoice_atomic",
      {
        p_billing_invoice_id: data.id,
        p_replacement_payload: replacement,
        p_reason: data.reason,
        p_expected_updated_at: data.expected_updated_at,
        p_idempotency_key: data.idempotency_key,
      },
    );
    if (error) throw new Error(error.message);
    return { ok: true, ...(command as Record<string, unknown>) };
  });

export const recordInvoicePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof paymentLedgerInput>) => paymentLedgerInput.parse(input))
  .handler(async ({ data, context }) => {
    // When the user omits a timestamp, let the database mint it once. The
    // command wrapper reuses the committed receipt's timestamp on a retry;
    // generating a new browser/server timestamp here would change otherwise
    // identical idempotent details after a lost response.
    const paidAt = data.paid_at ? new Date(data.paid_at).toISOString() : null;

    // One database transaction now owns the payment insert, exact-cents ledger
    // sum, invoice/pay-app state, and lifecycle event. A unique invoice/key pair
    // makes a lost-response retry return the committed result without adding a
    // second cash row.
    const { data: result, error } = await dynamicRpc(
      context.supabase,
      "record_invoice_payment_atomic",
      {
        p_invoice_id: data.invoiceId,
        p_amount_cents: dollarsToCents(data.amount),
        p_processor_fee_cents: dollarsToCents(data.processor_fee),
        p_overwatch_fee_cents: dollarsToCents(data.overwatch_fee),
        p_paid_at: paidAt,
        p_payment_method: data.payment_method,
        p_processor: data.processor,
        p_processor_payment_id: data.processor_payment_id,
        p_reference: data.reference,
        p_notes: data.notes,
        p_idempotency_key: data.idempotency_key,
      },
    );
    if (error) {
      if (
        error.code === "PGRST202" ||
        /record_invoice_payment_atomic|schema cache|function/i.test(error.message)
      ) {
        throw new Error("Payment recording isn't available on this workspace yet.");
      }
      throw new Error(error.message);
    }

    const payment = (result ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      paymentId: str(payment.paymentId),
      paidAmount: num(payment.paidAmount),
      status: str(payment.status, "sent") as InvoiceStatus,
      deduplicated: Boolean(payment.deduplicated),
    };
  });

/**
 * Recompute an invoice's paid_amount/status from the payment ledger
 * (succeeded rows minus refunds are the truth). The honest correction path
 * for invoices whose stored money drifted from the ledger — e.g. a refund
 * processed before refund reversal shipped (live case: invoice 2601-3).
 * Same code path the refund webhook uses; never manual SQL.
 */
export const reconcileInvoicePayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { invoiceId: string }) =>
    z.object({ invoiceId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await dynamicRpc(
      context.supabase,
      "reconcile_invoice_payment_rollup",
      { p_invoice_id: data.invoiceId },
    );
    if (error) {
      if (
        error.code === "PGRST202" ||
        /reconcile_invoice_payment_rollup|schema cache|function/i.test(error.message)
      ) {
        throw new Error("Payment reconciliation isn't available on this workspace yet.");
      }
      throw new Error(error.message);
    }
    const summary = (result ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      invoiceCount: Math.max(0, Math.round(num(summary.invoiceCount))),
      applicationCount: Math.max(0, Math.round(num(summary.applicationCount))),
    };
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
    // PDF-delivery stamp (Option A). Best-effort — tolerated if columns are absent (pre-migration).
    pdf_path: z.string().max(1024).optional(),
    last_sent_at: z.string().datetime({ offset: true }).optional(),
  }),
});

export const updateReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof updateReviewInput>) => updateReviewInput.parse(input))
  .handler(async ({ data, context }) => {
    // Split the PDF-delivery stamp fields off from the core patch. Those columns
    // (pdf_path / last_sent_at) may not exist yet on pre-migration databases, and
    // an unknown-column error must NEVER break the normal review update flow.
    const { pdf_path, last_sent_at, ...core } = data.patch;

    if (Object.keys(core).length > 0) {
      const { error } = await context.supabase.from("reviews").update(core).eq("id", data.id);
      if (error) throw new Error(error.message);
    }

    if (pdf_path !== undefined || last_sent_at !== undefined) {
      const stamp: Record<string, unknown> = {};
      if (pdf_path !== undefined) stamp.pdf_path = pdf_path;
      if (last_sent_at !== undefined) stamp.last_sent_at = last_sent_at;
      try {
        // dynamicTable = untyped builder (same pattern this file uses for columns
        // not yet in the generated schema), so pre-migration replays don't fail tsc.
        const { error: stampErr } = await dynamicTable(context.supabase, "reviews")
          .update(stamp)
          .eq("id", data.id);
        // Column may be missing pre-migration — swallow, never surface to the caller.
        if (stampErr) console.warn("[updateReview] pdf-delivery stamp skipped:", stampErr.message);
      } catch (stampCaught) {
        console.warn("[updateReview] pdf-delivery stamp threw:", stampCaught);
      }
    }

    return { ok: true };
  });

// Delete a saved IOR report. The archived PDF in the ior-reports bucket is cleared
// client-side (best-effort) before this runs. RLS (reviews_owner_via_project) gates
// deletion to the project owner. After deleting, re-sync the project's
// last_reviewed_at / last_review_summary to the most recent REMAINING review (or
// clear them when none remain) — otherwise deleting the latest report leaves
// "Last reviewed" showing a stale date. The re-sync is best-effort: the delete has
// already succeeded, so a project-update hiccup must not report the delete as failed.
export const deleteReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; projectId: string }) =>
    z.object({ id: z.string().uuid(), projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("reviews").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    try {
      const { data: remaining } = await context.supabase
        .from("reviews")
        .select("reviewed_at, summary_notes")
        .eq("project_id", data.projectId)
        .order("reviewed_at", { ascending: false })
        .limit(1);
      const latest = (remaining ?? [])[0] as
        { reviewed_at: string; summary_notes: string | null } | undefined;
      const { error: pErr } = await context.supabase
        .from("projects")
        .update({
          last_reviewed_at: latest ? latest.reviewed_at : null,
          last_review_summary: latest ? (latest.summary_notes ?? "") : "",
        })
        .eq("id", data.projectId);
      if (pErr) console.warn("[deleteReview] could not re-sync last_reviewed_at:", pErr.message);
    } catch (syncErr) {
      console.warn("[deleteReview] last_reviewed_at re-sync threw:", syncErr);
    }
    return { ok: true };
  });

// ---------------- SOV IMPORT ----------------

const importBucketRow = z.object({
  cost_code: z.string().max(80).default(""),
  bucket: z.string().min(1).max(200),
  original_budget: exactCentMoney,
  actual_to_date: exactCentMoney,
  ftc: exactCentMoney,
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
    total_budget: exactCentMoney.default(0),
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
  operation_key: z.string().trim().min(1).max(200),
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

    existing.original_budget = centsToDollars(
      dollarsToCents(existing.original_budget) + dollarsToCents(row.original_budget),
    );
    existing.actual_to_date = centsToDollars(
      dollarsToCents(existing.actual_to_date) + dollarsToCents(row.actual_to_date),
    );
    existing.ftc = centsToDollars(dollarsToCents(existing.ftc) + dollarsToCents(row.ftc));
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

    const { data: result, error } = await dynamicRpc(
      context.supabase,
      "import_cost_buckets_atomic",
      {
        p_project_id: data.projectId,
        p_mode: data.mode,
        p_rows: importRows,
        p_metadata: data.metadata,
        p_operation_key: data.operation_key,
      },
    );
    if (error) {
      throw new Error(
        `SOV import did not commit and the prior budget was preserved: ${error.message}. Try again in a few minutes.`,
      );
    }
    if (!result || typeof result !== "object") {
      throw new Error("SOV import did not return a committed operation result.");
    }
    return result as Json;
  });

// ---------------- DEMO SEED ----------------
// Every company workspace should have one fully built Harbor Residence project
// so new users can learn the IOR workflow before loading their own job.
// Identity constants and the opt-out decision live in @/lib/demo-seed (pure,
// unit-tested); an ARCHIVED demo project means the company opted out and
// every seeder here must leave all demo artifacts alone.

const HARBOR_DEMO_PROJECT_MANAGER = "Marshall Wilkinson";

const harborDemoBuckets = [
  {
    cost_code: "0100",
    bucket: "Sitework",
    original_budget: 220000,
    actual_to_date: 215000,
    ftc: 8000,
    contract_value: 260000,
    contract_quantity: 1,
    unit: "LS",
    billing_method: "percent",
    retainage_pct: 10,
    earned_percent_complete: 83,
  },
  {
    cost_code: "0300",
    bucket: "Structure",
    original_budget: 540000,
    actual_to_date: 520000,
    ftc: 35000,
    contract_value: 635000,
    contract_quantity: 1800,
    unit: "CY",
    billing_method: "percent",
    retainage_pct: 10,
    earned_percent_complete: 60,
  },
  {
    cost_code: "0700",
    bucket: "Envelope",
    original_budget: 430000,
    actual_to_date: 300000,
    ftc: 160000,
    contract_value: 505000,
    contract_quantity: 1,
    unit: "LS",
    billing_method: "percent",
    retainage_pct: 10,
    earned_percent_complete: 45,
  },
  {
    cost_code: "1500",
    bucket: "MEP",
    original_budget: 480000,
    actual_to_date: 260000,
    ftc: 240000,
    contract_value: 565000,
    contract_quantity: 25000,
    unit: "LF",
    billing_method: "percent",
    retainage_pct: 10,
    earned_percent_complete: 12,
  },
  {
    cost_code: "0900",
    bucket: "Finishes",
    original_budget: 780000,
    actual_to_date: 180000,
    ftc: 690000,
    contract_value: 950000,
    contract_quantity: 12000,
    unit: "SF",
    billing_method: "percent",
    retainage_pct: 10,
    earned_percent_complete: 20,
  },
  {
    cost_code: "0130",
    bucket: "GC/OH",
    original_budget: 270000,
    actual_to_date: 150000,
    ftc: 142000,
    contract_value: 285000,
    contract_quantity: 1,
    unit: "LS",
    billing_method: "percent",
    retainage_pct: 10,
    earned_percent_complete: 55,
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

const harborDemoInspections = [
  {
    seed_key: "harbor-demo:inspection:plumbing-rough-pass",
    inspection_type: "Rough plumbing inspection",
    authority: "City Building Department",
    location: "Level 1 bath groups and equipment room",
    responsible_party: "J. Patel",
    inspector: "M. Ortiz",
    requested_date: "2026-05-22",
    scheduled_date: "2026-05-27",
    completed_date: "2026-05-27",
    status: "passed",
    result: "pass",
    attempt_number: 1,
    required_reinspection: false,
    cost_impact: 0,
    schedule_impact_weeks: null,
    notes:
      "Passed first inspection. Photos and pressure test record are retained in the project file.",
    corrective_action: "",
  },
  {
    seed_key: "harbor-demo:inspection:electrical-rough-fail",
    inspection_type: "Electrical rough-in inspection",
    authority: "City Building Department",
    location: "Kitchen, service entry, and pool equipment feeders",
    responsible_party: "BMB Electric",
    inspector: "T. Reeves",
    requested_date: "2026-05-29",
    scheduled_date: "2026-06-03",
    completed_date: "2026-06-03",
    status: "failed",
    result: "fail",
    attempt_number: 1,
    required_reinspection: true,
    cost_impact: 9500,
    schedule_impact_weeks: 1,
    notes:
      "Failed for missing panel directory, unsupported low-voltage runs, and pool equipment bonding corrections.",
    corrective_action:
      "Electrical subcontractor must correct bonding, support low-voltage runs, update panel directory, and request reinspection.",
  },
  {
    seed_key: "harbor-demo:inspection:electrical-rough-reinspection-pass",
    inspection_type: "Electrical rough-in reinspection",
    authority: "City Building Department",
    location: "Kitchen, service entry, and pool equipment feeders",
    responsible_party: "BMB Electric",
    inspector: "T. Reeves",
    requested_date: "2026-06-04",
    scheduled_date: "2026-06-07",
    completed_date: "2026-06-07",
    status: "passed",
    result: "pass",
    attempt_number: 2,
    required_reinspection: false,
    cost_impact: 0,
    schedule_impact_weeks: null,
    notes:
      "Reinspection passed after corrective work. Keep original failure in the log because it drove the schedule and cost risk discussion.",
    corrective_action: "Corrections accepted by inspector.",
  },
  {
    seed_key: "harbor-demo:inspection:framing-partial",
    inspection_type: "Framing and shear inspection",
    authority: "County Structural Inspector",
    location: "Main residence structural shell",
    responsible_party: "R. Singh",
    inspector: "A. Keller",
    requested_date: "2026-06-10",
    scheduled_date: "2026-06-14",
    completed_date: null,
    status: "scheduled",
    result: "pending",
    attempt_number: 1,
    required_reinspection: false,
    cost_impact: 0,
    schedule_impact_weeks: 0.5,
    notes:
      "Scheduled before drywall release. Any failed item should become an IOR exposure and a schedule recovery action.",
    corrective_action: "",
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

const SCHEDULE_ACTIVITY_STATUS_COLUMNS = [
  "baseline_start_date",
  "baseline_finish_date",
  "forecast_start_date",
  "forecast_finish_date",
  "actual_start_date",
  "actual_finish_date",
  "remaining_duration_days",
] as const;

const isScheduleActivityStatusColumnError = (error: DynamicSupabaseError | null) =>
  SCHEDULE_ACTIVITY_STATUS_COLUMNS.some((column) => isMissingRestColumn(error, column));

const isProjectInspectionsSchemaError = (error: DynamicSupabaseError | null) => {
  const message = (error?.message ?? "").toLowerCase();
  return (
    isMissingRestRelation(error, "project_inspections") ||
    message.includes("project_inspections") ||
    message.includes("schema cache")
  );
};

const seedHarborDemoInspections = async (
  supabase: unknown,
  projectId: string,
  seedWarnings: string[],
) => {
  const { data: existingRows, error: lookupError } = await dynamicTable(
    supabase,
    "project_inspections",
  )
    .select("id,seed_key")
    .eq("project_id", projectId)
    .limit(50);

  if (lookupError) {
    if (isProjectInspectionsSchemaError(lookupError)) {
      seedWarnings.push(`Inspection demo skipped: ${lookupError.message}`);
      return { insertedCount: 0 };
    }
    throw new Error(lookupError.message);
  }

  const rows = Array.isArray(existingRows)
    ? (existingRows as Array<{ seed_key?: string | null }>)
    : [];
  const existingSeedKeys = new Set(
    rows.map((row) => row.seed_key).filter((key): key is string => Boolean(key)),
  );
  const rowsToInsert = harborDemoInspections.filter(
    (inspection) => !existingSeedKeys.has(inspection.seed_key),
  );

  if (rowsToInsert.length === 0) return { insertedCount: 0 };

  const { error: insertError } = await dynamicTable(supabase, "project_inspections").insert(
    rowsToInsert.map((inspection) => ({
      project_id: projectId,
      ...inspection,
    })),
  );

  if (insertError) {
    if (isProjectInspectionsSchemaError(insertError)) {
      seedWarnings.push(`Inspection demo insert skipped: ${insertError.message}`);
      return { insertedCount: 0 };
    }
    throw new Error(insertError.message);
  }

  return { insertedCount: rowsToInsert.length };
};

// Runtime Harbor demo claims — the counterpart to harborDemoInspections. The
// project_claims migration seeds STATIC harbor rows; demo projects are created
// per-org at runtime, so getProject seeds these the same way it seeds
// inspections. Keep in sync with the migration's demo_claims.
const harborDemoClaims = [
  {
    seed_key: "harbor-demo:claim:electrical-delay",
    claim_number: "CLM-001",
    title: "Electrical rework — extension of time & delay damages",
    description:
      "Failed electrical rough-in and the corrective reinspection cycle held drywall release. Seeking an extension of time plus the extended general-conditions cost the delay caused.",
    claim_type: "extension_of_time",
    status: "submitted",
    money_claimed: 48200,
    time_claimed_days: 12,
    money_awarded: 0,
    time_awarded_days: 0,
    outcome: "",
    owner: "PM",
    submitted_at: "2026-06-18",
    resolved_at: null,
  },
  {
    seed_key: "harbor-demo:claim:weather-delay",
    claim_number: "CLM-002",
    title: "Weather delay — extension of time",
    description:
      "A run of storms stopped exterior work. Documenting the lost days now; likely a time-only extension request once the weather logs are compiled.",
    claim_type: "delay",
    status: "in_preparation",
    money_claimed: 0,
    time_claimed_days: 6,
    money_awarded: 0,
    time_awarded_days: 0,
    outcome: "",
    owner: "PM",
    submitted_at: null,
    resolved_at: null,
  },
] as const;

const isProjectClaimsSchemaError = (error: DynamicSupabaseError | null) => {
  const message = (error?.message ?? "").toLowerCase();
  return (
    isMissingRestRelation(error, "project_claims") ||
    message.includes("project_claims") ||
    message.includes("schema cache")
  );
};

const isProjectClaimEventsSchemaError = (error: DynamicSupabaseError | null) => {
  const message = (error?.message ?? "").toLowerCase();
  return (
    isMissingRestRelation(error, "project_claim_events") ||
    message.includes("project_claim_events") ||
    message.includes("schema cache")
  );
};

// A full cycle on the electrical extension-of-time claim (CLM-001): sent →
// received → meeting → kicked back → resubmitted revised. Shows the cycle log
// end to end in the demo.
const harborDemoClaimEvents = [
  {
    seed_key: "harbor-demo:claim-event:electrical-submitted",
    event_type: "submitted",
    event_date: "2026-06-18",
    revision_number: 0,
    note: "Claim package submitted to the owner's rep with the delay analysis and cost backup.",
  },
  {
    seed_key: "harbor-demo:claim-event:electrical-received",
    event_type: "received",
    event_date: "2026-06-20",
    revision_number: 0,
    note: "Owner's rep acknowledged receipt and opened review.",
  },
  {
    seed_key: "harbor-demo:claim-event:electrical-meeting",
    event_type: "meeting",
    event_date: "2026-06-27",
    revision_number: 0,
    note: "Review meeting — owner questioned the extended GC rate and the critical-path tie.",
  },
  {
    seed_key: "harbor-demo:claim-event:electrical-returned",
    event_type: "returned_for_revision",
    event_date: "2026-07-01",
    revision_number: 0,
    note: "Kicked back: tighten the critical-path narrative and itemize the extended general conditions.",
  },
  {
    seed_key: "harbor-demo:claim-event:electrical-resubmitted",
    event_type: "resubmitted",
    event_date: "2026-07-08",
    revision_number: 1,
    note: "Revised claim resubmitted with the reworked schedule analysis and itemized GCs.",
  },
] as const;

// Seed the electrical claim's cycle log. Separate from the claims seed because a
// second open may find the claims already there but the events table freshly
// migrated in — so this always runs and dedupes on its own seed keys.
const seedHarborDemoClaimEvents = async (
  supabase: unknown,
  projectId: string,
  seedWarnings: string[],
) => {
  const { data: claimRows, error: claimLookupError } = await dynamicTable(
    supabase,
    "project_claims",
  )
    .select("id")
    .eq("project_id", projectId)
    .eq("seed_key", "harbor-demo:claim:electrical-delay")
    .limit(1);
  if (claimLookupError) {
    if (isProjectClaimsSchemaError(claimLookupError)) return { insertedCount: 0 };
    throw new Error(claimLookupError.message);
  }
  const claimId =
    Array.isArray(claimRows) && claimRows[0] ? (claimRows[0] as { id?: string }).id : undefined;
  if (!claimId) return { insertedCount: 0 };

  const { data: existingEventRows, error: eventLookupError } = await dynamicTable(
    supabase,
    "project_claim_events",
  )
    .select("seed_key")
    .eq("project_id", projectId)
    .limit(100);
  if (eventLookupError) {
    if (isProjectClaimEventsSchemaError(eventLookupError)) {
      seedWarnings.push(`Claim cycle demo skipped: ${eventLookupError.message}`);
      return { insertedCount: 0 };
    }
    throw new Error(eventLookupError.message);
  }
  const existingSeedKeys = new Set(
    (Array.isArray(existingEventRows) ? existingEventRows : [])
      .map((row) => (row as { seed_key?: string | null }).seed_key)
      .filter((key): key is string => Boolean(key)),
  );
  const rowsToInsert = harborDemoClaimEvents.filter(
    (event) => !existingSeedKeys.has(event.seed_key),
  );
  if (rowsToInsert.length === 0) return { insertedCount: 0 };

  const { error: insertError } = await dynamicTable(supabase, "project_claim_events").insert(
    rowsToInsert.map((event) => ({ project_id: projectId, claim_id: claimId, ...event })),
  );
  if (insertError) {
    if (isProjectClaimEventsSchemaError(insertError)) {
      seedWarnings.push(`Claim cycle demo insert skipped: ${insertError.message}`);
      return { insertedCount: 0 };
    }
    throw new Error(insertError.message);
  }
  return { insertedCount: rowsToInsert.length };
};

const seedHarborDemoClaims = async (
  supabase: unknown,
  projectId: string,
  seedWarnings: string[],
) => {
  const { data: existingRows, error: lookupError } = await dynamicTable(supabase, "project_claims")
    .select("id,seed_key")
    .eq("project_id", projectId)
    .limit(50);

  if (lookupError) {
    if (isProjectClaimsSchemaError(lookupError)) {
      seedWarnings.push(`Claim demo skipped: ${lookupError.message}`);
      return { insertedCount: 0 };
    }
    throw new Error(lookupError.message);
  }

  const rows = Array.isArray(existingRows)
    ? (existingRows as Array<{ seed_key?: string | null }>)
    : [];
  const existingSeedKeys = new Set(
    rows.map((row) => row.seed_key).filter((key): key is string => Boolean(key)),
  );
  const rowsToInsert = harborDemoClaims.filter((claim) => !existingSeedKeys.has(claim.seed_key));

  if (rowsToInsert.length > 0) {
    const { error: insertError } = await dynamicTable(supabase, "project_claims").insert(
      rowsToInsert.map((claim) => ({ project_id: projectId, ...claim })),
    );

    if (insertError) {
      if (isProjectClaimsSchemaError(insertError)) {
        seedWarnings.push(`Claim demo insert skipped: ${insertError.message}`);
        return { insertedCount: 0 };
      }
      throw new Error(insertError.message);
    }
  }

  // Always attempt the cycle log — the events table may have landed after the
  // claims did, and this dedupes on its own seed keys.
  await seedHarborDemoClaimEvents(supabase, projectId, seedWarnings);

  return { insertedCount: rowsToInsert.length };
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
  const onlyGeneratedMilestonePlaceholders =
    rows.length > 0 &&
    existingActivityIds.size === 0 &&
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

  const buildInsertRows = (includeStatusFields: boolean) =>
    rowsToInsert.map((activity) => ({
      project_id: projectId,
      ...activity,
      ...(includeStatusFields
        ? {
            baseline_start_date: activity.start_date,
            baseline_finish_date: activity.finish_date,
            forecast_start_date: activity.start_date,
            forecast_finish_date: activity.finish_date,
            actual_start_date: activity.percent_complete > 0 ? activity.start_date : null,
            actual_finish_date: activity.percent_complete >= 100 ? activity.finish_date : null,
            remaining_duration_days: activity.percent_complete >= 100 ? 0 : null,
          }
        : {}),
      sort_order:
        HARBOR_DEMO_CPM_ACTIVITIES.findIndex((demo) => demo.activity_id === activity.activity_id) +
        1,
    }));

  let { error: insertError } = await dynamicTable(supabase, "schedule_activities").insert(
    buildInsertRows(true),
  );

  if (insertError && isScheduleActivityStatusColumnError(insertError)) {
    ({ error: insertError } = await dynamicTable(supabase, "schedule_activities").insert(
      buildInsertRows(false),
    ));
  }

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

const HARBOR_DEMO_CPM_EVIDENCE_COLUMNS = [
  "schedule_activity_id",
  "people_per_crew",
  "target_production_rate",
  "quantity_items",
  "percent_basis",
  "field_percent_complete",
  "percent_overridden_at",
  "wip_reviewed_at",
  "wip_reviewed_by",
  "unmatched_vendor_name",
] as const;

const isHarborDemoCpmEvidenceSchemaError = (error: DynamicSupabaseError | null) =>
  isMissingRestRelation(error, "daily_wip_entries") ||
  HARBOR_DEMO_CPM_EVIDENCE_COLUMNS.some((column) => isMissingRestColumn(error, column));

const buildHarborDemoCpmEvidencePayload = (
  projectId: string,
  reviewerUserId: string,
  scheduleActivityId: string,
  costBucketId: string,
) => {
  const fixture = HARBOR_DEMO_CPM_WALKTHROUGH;
  return {
    id: projectId,
    project_id: projectId,
    cost_bucket_id: costBucketId,
    schedule_activity_id: scheduleActivityId,
    subcontractor_id: null,
    unmatched_vendor_name: "Summit Drywall & Finishes",
    entry_date: fixture.entryDate,
    activity: fixture.activity,
    crew_count: fixture.crewCount,
    people_per_crew: fixture.peoplePerCrew,
    hours: fixture.hoursPerPerson,
    labor_rate: fixture.blendedLaborRate,
    material_cost: 0,
    equipment_cost: 0,
    material_items: [],
    equipment_items: [],
    quantity: fixture.quantity,
    unit: fixture.unit,
    quantity_items: [
      {
        quantity: fixture.quantity,
        unit: fixture.unit,
        description: "Second-floor drywall installed",
      },
    ],
    target_production_rate: fixture.targetProductionRate,
    percent_basis: "cpm",
    field_percent_complete: fixture.fieldPercent,
    percent_complete: fixture.reviewedPercent,
    percent_overridden_at: fixture.reviewedAt,
    wip_reviewed_at: fixture.reviewedAt,
    wip_reviewed_by: reviewerUserId,
    notes: fixture.note,
    created_by: reviewerUserId,
  };
};

// Complete the Harbor walkthrough with real reviewed evidence. The application
// rules remain untouched: the CPM decision controls become available because
// the demo has the same linked + PM-reviewed work line a live project needs.
//
// The Harbor project id is also the stable id for this one demo-only WIP row.
// UUID uniqueness is table-local, so this gives every company's Harbor project
// an idempotent backfill without adding a schema constraint or overwriting a
// row after somebody edits it during onboarding.
const seedHarborDemoCpmEvidence = async (
  supabase: unknown,
  projectId: string,
  reviewerUserId: string,
  seedWarnings: string[],
) => {
  const { data: existingRow, error: existingError } = await dynamicTable(
    supabase,
    "daily_wip_entries",
  )
    .select("id,project_id")
    .eq("id", projectId)
    .maybeSingle();

  if (existingError) {
    if (isHarborDemoCpmEvidenceSchemaError(existingError)) {
      seedWarnings.push(`CPM evidence demo skipped: ${existingError.message}`);
      return { insertedCount: 0 };
    }
    throw new Error(existingError.message);
  }
  if (existingRow) return { insertedCount: 0 };

  const [activityResult, bucketResult] = await Promise.all([
    dynamicTable(supabase, "schedule_activities")
      .select("id")
      .eq("project_id", projectId)
      .eq("activity_id", HARBOR_DEMO_CPM_WALKTHROUGH.scheduleActivityCode)
      .maybeSingle(),
    dynamicTable(supabase, "cost_buckets")
      .select("id")
      .eq("project_id", projectId)
      .eq("cost_code", HARBOR_DEMO_CPM_WALKTHROUGH.costCode)
      .maybeSingle(),
  ]);

  if (activityResult.error) {
    if (isScheduleActivitiesSchemaError(activityResult.error)) {
      seedWarnings.push(`CPM evidence activity skipped: ${activityResult.error.message}`);
      return { insertedCount: 0 };
    }
    throw new Error(activityResult.error.message);
  }
  if (bucketResult.error) throw new Error(bucketResult.error.message);

  const scheduleActivityId = (activityResult.data as { id?: string } | null)?.id;
  const costBucketId = (bucketResult.data as { id?: string } | null)?.id;
  if (!scheduleActivityId || !costBucketId) {
    seedWarnings.push(
      "CPM evidence demo skipped: Harbor drywall schedule activity or Finishes cost code is missing.",
    );
    return { insertedCount: 0 };
  }

  const { error: insertError } = await dynamicTable(supabase, "daily_wip_entries").insert(
    buildHarborDemoCpmEvidencePayload(projectId, reviewerUserId, scheduleActivityId, costBucketId),
  );

  if (insertError) {
    if (insertError.code === "23505") return { insertedCount: 0 };
    if (isHarborDemoCpmEvidenceSchemaError(insertError)) {
      seedWarnings.push(`CPM evidence demo insert skipped: ${insertError.message}`);
      return { insertedCount: 0 };
    }
    throw new Error(insertError.message);
  }

  return { insertedCount: 1 };
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
  userId?: string,
) => {
  const { data: projectRow, error: projectError } = await dynamicTable(supabase, "projects")
    .select("name,job_number,client,archived_at")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError) {
    seedWarnings.push(`CPM demo project check skipped: ${projectError.message}`);
    return { ensured: false, insertedCount: 0, seedWarnings };
  }

  if (!isHarborDemoProject(projectRow as Record<string, unknown> | null)) {
    return { ensured: false, insertedCount: 0, seedWarnings };
  }

  // Archived demo = the company opted out; leave the schedule alone too.
  if (harborDemoSeedAction(projectRow as { archived_at?: unknown }) === "skip") {
    return { ensured: false, insertedCount: 0, seedWarnings };
  }

  if (userId) {
    const demoEngine = await ensureVersionedHarborDemoModules(
      supabase,
      projectId,
      userId,
      seedWarnings,
    );
    return {
      ensured: true,
      insertedCount: 0,
      refreshedPlaceholders: false,
      seedWarnings,
      demoEngine,
    };
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
  // Legacy placeholder identities are safe to repair. A real onboarding edit
  // is preserved; opening Harbor must never silently reset the chosen PM.
  const { data: project, error: projectError } = await dynamicTable(supabase, "projects")
    .select("project_manager,updated_at")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) {
    seedWarnings.push(`Harbor PM check skipped: ${projectError.message}`);
  } else if (
    project &&
    ["", "Overwatch Demo PM"].includes(str((project as Record<string, unknown>).project_manager))
  ) {
    const expectedUpdatedAt = str((project as Record<string, unknown>).updated_at);
    if (!expectedUpdatedAt) {
      seedWarnings.push("Harbor PM update skipped: the project version was unavailable.");
    } else {
      const { error } = await dynamicRpc(supabase, "update_project_financial_header_atomic", {
        p_project_id: projectId,
        p_patch: { project_manager: HARBOR_DEMO_PROJECT_MANAGER },
        p_override_reason: "Repairing the legacy Harbor onboarding project-manager placeholder.",
        p_expected_updated_at: expectedUpdatedAt,
        p_operation_key: `harbor-demo:${projectId}:project-manager:ensure:v2`,
      });
      if (error) seedWarnings.push(`Harbor PM update skipped: ${error.message}`);
    }
  }

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

const harborDemoStableId = (projectId: string, discriminator: string) => {
  const projectHex = projectId.replace(/-/g, "").toLowerCase();
  let hash = 2166136261;
  for (const character of discriminator) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const suffix = (hash >>> 0).toString(16).padStart(8, "0");
  const hex = `${projectHex.slice(0, 24)}${suffix}`.padEnd(32, "0").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = "8";
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
};

const harborDemoSourceNote = "Harbor onboarding fixture — safe to reset from Start Here.";

const harborDemoOperationGeneration = (purpose: "ensure" | "reset") => {
  const nonce =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${purpose}:${nonce}`;
};

const createHarborDemoChangeOrder = async (
  supabase: unknown,
  projectId: string,
  changeOrder: (typeof harborDemoChangeOrders)[number],
  index: number,
  operationGeneration = "initial",
) => {
  const requestedId = harborDemoStableId(projectId, `change-order-${index}`);
  const parsed = coInput.parse(changeOrder);
  const baseOperationKey = `harbor-demo:${projectId}:change-order:${index}:create`;
  const { data: command, error } = await dynamicRpc(supabase, "create_change_order_atomic", {
    p_project_id: projectId,
    ...changeOrderCommandArgs(parsed),
    p_operation_key:
      operationGeneration === "initial"
        ? baseOperationKey
        : `${baseOperationKey}:${operationGeneration}`,
    p_requested_id: requestedId,
  });
  if (error) throw new Error(error.message);
  const result = requireChangeOrderCommandResult(command);
  const { data: metadataRow, error: metadataError } = await dynamicTable(supabase, "change_orders")
    .update({
      client_visible: changeOrder.client_visible,
      client_status: changeOrder.client_status,
      client_sent_at: changeOrder.client_sent_at,
      client_decided_at: "client_decided_at" in changeOrder ? changeOrder.client_decided_at : null,
    })
    .eq("id", result.changeOrderId)
    .select("id")
    .maybeSingle();
  if (metadataError) throw new Error(metadataError.message);
  if (!metadataRow) {
    throw new Error("Harbor demo change-order metadata did not update the restored fixture.");
  }
  return result.changeOrderId;
};

const ensureHarborDemoBudgetSov = async (
  supabase: unknown,
  projectId: string,
  upgradeExistingPlaceholders = false,
  operationGeneration = `ensure:v${HARBOR_DEMO_MODULES.find((module) => module.key === "budget-sov")?.version ?? 1}`,
) => {
  const { data: rows, error } = await dynamicTable(supabase, "cost_buckets")
    .select(
      "id,cost_code,bucket,contract_value,original_budget,actual_to_date,ftc,contract_quantity,unit,billing_method,retainage_pct,earned_percent_complete",
    )
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);

  const currentRows = (rows ?? []) as Array<Record<string, unknown>>;
  const bucketByCode = new Map(
    currentRows.filter((row) => str(row.cost_code)).map((row) => [str(row.cost_code), row]),
  );
  const unassignedByName = new Map(
    currentRows
      .filter((row) => !str(row.cost_code).trim())
      .map((row) => [str(row.bucket).trim().toLowerCase(), row]),
  );

  for (const [index, bucket] of harborDemoBuckets.entries()) {
    const placeholder = unassignedByName.get(bucket.bucket.toLowerCase());
    const existing = bucketByCode.get(bucket.cost_code) ?? placeholder;
    const usingPlaceholder = !bucketByCode.has(bucket.cost_code) && Boolean(placeholder);
    const financialPayload = {
      cost_code: bucket.cost_code,
      bucket: bucket.bucket,
      contract_value: bucket.contract_value,
      original_budget: bucket.original_budget,
      actual_to_date: bucket.actual_to_date,
      ftc: bucket.ftc,
      source_type: "original_sov",
      source_date: "2026-06-01",
      source_note: harborDemoSourceNote,
    };
    let bucketId = str(existing?.id);

    if (!existing) {
      const { data: command, error: createError } = await dynamicRpc(
        supabase,
        "create_cost_bucket_atomic",
        {
          p_project_id: projectId,
          p_payload: financialPayload,
          p_operation_key: `harbor-demo:${projectId}:budget:${bucket.cost_code}:create:${operationGeneration}`,
        },
      );
      if (createError) throw new Error(createError.message);
      bucketId = str((command as Record<string, unknown> | null)?.bucketId);
      if (!bucketId) {
        throw new Error(`Harbor ${bucket.cost_code} budget command returned no bucket identifier.`);
      }
    } else if (usingPlaceholder) {
      const { error: updateError } = await dynamicRpc(supabase, "update_cost_bucket_atomic", {
        p_bucket_id: bucketId,
        p_patch: financialPayload,
        p_note:
          "Converting the generated Harbor placeholder into its canonical onboarding SOV line.",
        p_operation_key: `harbor-demo:${projectId}:budget:${bucket.cost_code}:placeholder:${operationGeneration}`,
      });
      if (updateError) throw new Error(updateError.message);
    }

    // Older Harbor copies predate the SOV fields. Fill their empty placeholders
    // exactly once, while this module is being version-upgraded. Ordinary ensure
    // runs preserve later onboarding edits, including a deliberate zero value.
    if (
      existing &&
      !usingPlaceholder &&
      upgradeExistingPlaceholders &&
      num(existing.contract_value) <= 0
    ) {
      const { error: updateError } = await dynamicRpc(supabase, "update_cost_bucket_atomic", {
        p_bucket_id: bucketId,
        p_patch: { contract_value: bucket.contract_value },
        p_note: "Upgrading the legacy Harbor onboarding SOV contract placeholder.",
        p_operation_key: `harbor-demo:${projectId}:budget:${bucket.cost_code}:upgrade:${operationGeneration}`,
      });
      if (updateError) throw new Error(updateError.message);
    }

    const presentationPatch: Record<string, unknown> =
      usingPlaceholder || !existing
        ? {
            contract_quantity: bucket.contract_quantity,
            unit: bucket.unit,
            billing_method: bucket.billing_method,
            retainage_pct: bucket.retainage_pct,
            earned_percent_complete: bucket.earned_percent_complete,
            sort_order: index + 1,
          }
        : {};
    if (existing && !usingPlaceholder && upgradeExistingPlaceholders) {
      if (num(existing.contract_quantity) <= 0)
        presentationPatch.contract_quantity = bucket.contract_quantity;
      if (!str(existing.unit).trim()) presentationPatch.unit = bucket.unit;
      if (!str(existing.billing_method).trim())
        presentationPatch.billing_method = bucket.billing_method;
      if (num(existing.earned_percent_complete) <= 0)
        presentationPatch.earned_percent_complete = bucket.earned_percent_complete;
    }
    if (Object.keys(presentationPatch).length > 0) {
      const { error: presentationError } = await dynamicTable(supabase, "cost_buckets")
        .update(presentationPatch)
        .eq("id", bucketId);
      if (presentationError) throw new Error(presentationError.message);
    }
  }
};

const resetHarborDemoBudgetSov = async (
  supabase: unknown,
  projectId: string,
  operationGeneration: string,
) => {
  await ensureHarborDemoBudgetSov(
    supabase,
    projectId,
    false,
    `reset-create:${operationGeneration}`,
  );
  for (const [index, bucket] of harborDemoBuckets.entries()) {
    const { data: current, error: loadError } = await dynamicTable(supabase, "cost_buckets")
      .select("id")
      .eq("project_id", projectId)
      .eq("cost_code", bucket.cost_code)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    const bucketId = str((current as Record<string, unknown> | null)?.id);
    if (!bucketId) throw new Error(`Harbor ${bucket.cost_code} budget line was not found.`);

    const { error: commandError } = await dynamicRpc(supabase, "update_cost_bucket_atomic", {
      p_bucket_id: bucketId,
      p_patch: {
        cost_code: bucket.cost_code,
        bucket: bucket.bucket,
        contract_value: bucket.contract_value,
        original_budget: bucket.original_budget,
        actual_to_date: bucket.actual_to_date,
        ftc: bucket.ftc,
        source_type: "original_sov",
        source_date: "2026-06-01",
        source_note: harborDemoSourceNote,
      },
      p_note: "Resetting the Harbor onboarding SOV to its published fixture values.",
      p_operation_key: `harbor-demo:${projectId}:budget:${bucket.cost_code}:reset:${operationGeneration}`,
    });
    if (commandError) throw new Error(commandError.message);

    const { error: presentationError } = await dynamicTable(supabase, "cost_buckets")
      .update({
        contract_quantity: bucket.contract_quantity,
        unit: bucket.unit,
        billing_method: bucket.billing_method,
        retainage_pct: bucket.retainage_pct,
        earned_percent_complete: bucket.earned_percent_complete,
        sort_order: index + 1,
      })
      .eq("id", bucketId);
    if (presentationError) throw new Error(presentationError.message);
  }
};

const ensureHarborDemoIorCommercialPosition = async (
  supabase: unknown,
  projectId: string,
  operationGeneration = harborDemoOperationGeneration("ensure"),
) => {
  const [exposureResult, changeOrderResult] = await Promise.all([
    dynamicTable(supabase, "exposures").select("id,title").eq("project_id", projectId),
    dynamicTable(supabase, "change_orders").select("id,number").eq("project_id", projectId),
  ]);
  if (exposureResult.error) throw new Error(exposureResult.error.message);
  if (changeOrderResult.error) throw new Error(changeOrderResult.error.message);

  const exposureTitles = new Set(
    ((exposureResult.data ?? []) as Array<Record<string, unknown>>).map((row) => str(row.title)),
  );
  for (const [index, exposure] of harborDemoExposures.entries()) {
    if (exposureTitles.has(exposure.title)) continue;
    const { error } = await dynamicTable(supabase, "exposures").insert({
      id: harborDemoStableId(projectId, `exposure-${index}`),
      project_id: projectId,
      ...exposure,
    });
    if (error?.code !== "23505" && error) throw new Error(error.message);
  }

  const changeOrderNumbers = new Set(
    ((changeOrderResult.data ?? []) as Array<Record<string, unknown>>).map((row) =>
      str(row.number),
    ),
  );
  for (const [index, changeOrder] of harborDemoChangeOrders.entries()) {
    if (changeOrderNumbers.has(changeOrder.number)) continue;
    await createHarborDemoChangeOrder(supabase, projectId, changeOrder, index, operationGeneration);
  }

  const [approvedCoResult, finishesBucketResult] = await Promise.all([
    dynamicTable(supabase, "change_orders")
      .select("id")
      .eq("project_id", projectId)
      .eq("number", "CO-002")
      .maybeSingle(),
    dynamicTable(supabase, "cost_buckets")
      .select("id")
      .eq("project_id", projectId)
      .eq("cost_code", "0900")
      .maybeSingle(),
  ]);
  if (approvedCoResult.error) throw new Error(approvedCoResult.error.message);
  if (finishesBucketResult.error) throw new Error(finishesBucketResult.error.message);
  const approvedCoId = str((approvedCoResult.data as Record<string, unknown> | null)?.id);
  const finishesBucketId = str((finishesBucketResult.data as Record<string, unknown> | null)?.id);
  if (approvedCoId && finishesBucketId) {
    const allocationResult = await dynamicTable(supabase, "change_order_allocations")
      .select("id")
      .eq("project_id", projectId)
      .eq("change_order_id", approvedCoId)
      .eq("cost_code", "0900")
      .maybeSingle();
    if (allocationResult.error) throw new Error(allocationResult.error.message);
    if (!allocationResult.data) {
      const { error } = await dynamicRpc(supabase, "allocate_change_order_atomic", {
        p_project_id: projectId,
        p_change_order_id: approvedCoId,
        p_cost_bucket_id: finishesBucketId,
        p_contract_amount_cents: 6_500_000,
        p_cost_amount_cents: 5_800_000,
        p_idempotency_key: `harbor-demo:${projectId}:co-002:0900`,
      });
      if (error) throw new Error(error.message);
    }
  }
};

const resetHarborDemoIorCommercialPosition = async (supabase: unknown, projectId: string) => {
  const operationGeneration = harborDemoOperationGeneration("reset");
  await ensureHarborDemoIorCommercialPosition(supabase, projectId, operationGeneration);
  for (const exposure of harborDemoExposures) {
    const { error } = await dynamicTable(supabase, "exposures")
      .update(exposure)
      .eq("project_id", projectId)
      .eq("title", exposure.title);
    if (error) throw new Error(error.message);
  }
  for (const [index, changeOrder] of harborDemoChangeOrders.entries()) {
    const { data: current, error: currentError } = await dynamicTable(supabase, "change_orders")
      .select("*")
      .eq("project_id", projectId)
      .eq("number", changeOrder.number)
      .maybeSingle();
    if (currentError) throw new Error(currentError.message);
    if (!current) {
      await createHarborDemoChangeOrder(
        supabase,
        projectId,
        changeOrder,
        index,
        operationGeneration,
      );
      continue;
    }
    const currentRow = current as Record<string, unknown>;
    if (str(currentRow.status) === "Pending") {
      const parsed = coInput.parse(changeOrder);
      const expectedUpdatedAt = str(currentRow.updated_at);
      const { error: updateError } = await dynamicRpc(supabase, "update_change_order_atomic", {
        p_project_id: projectId,
        p_change_order_id: str(currentRow.id),
        p_expected_updated_at: expectedUpdatedAt,
        ...changeOrderCommandArgs(parsed),
        p_operation_key: `harbor-demo:${projectId}:change-order:${index}:reset:${expectedUpdatedAt}`,
      });
      if (updateError) throw new Error(updateError.message);
    }
    const { data: metadataRow, error: metadataError } = await dynamicTable(
      supabase,
      "change_orders",
    )
      .update({
        client_visible: changeOrder.client_visible,
        client_status: changeOrder.client_status,
        client_sent_at: changeOrder.client_sent_at,
        client_decided_at:
          "client_decided_at" in changeOrder ? changeOrder.client_decided_at : null,
      })
      .eq("id", str(currentRow.id))
      .select("id")
      .maybeSingle();
    if (metadataError) throw new Error(metadataError.message);
    if (!metadataRow) {
      throw new Error("Harbor demo change-order metadata did not update the reset fixture.");
    }
  }
  const [
    { data: approvedCo, error: approvedCoError },
    { data: finishesBucket, error: bucketError },
  ] = await Promise.all([
    dynamicTable(supabase, "change_orders")
      .select("id")
      .eq("project_id", projectId)
      .eq("number", "CO-002")
      .maybeSingle(),
    dynamicTable(supabase, "cost_buckets")
      .select("id")
      .eq("project_id", projectId)
      .eq("cost_code", "0900")
      .maybeSingle(),
  ]);
  if (approvedCoError) throw new Error(approvedCoError.message);
  if (bucketError) throw new Error(bucketError.message);
  const approvedCoId = str((approvedCo as Record<string, unknown> | null)?.id);
  const finishesBucketId = str((finishesBucket as Record<string, unknown> | null)?.id);
  if (approvedCoId && finishesBucketId) {
    const { data: allocation, error: allocationError } = await dynamicTable(
      supabase,
      "change_order_allocations",
    )
      .select("id,contract_amount,cost_amount")
      .eq("project_id", projectId)
      .eq("change_order_id", approvedCoId)
      .eq("cost_bucket_id", finishesBucketId)
      .maybeSingle();
    if (allocationError) throw new Error(allocationError.message);
    const allocationRow = allocation as Record<string, unknown> | null;
    if (
      allocationRow &&
      (dollarsToCents(num(allocationRow.contract_amount)) !== 6_500_000 ||
        dollarsToCents(num(allocationRow.cost_amount)) !== 5_800_000)
    ) {
      const { error: deleteError } = await dynamicRpc(
        supabase,
        "delete_change_order_allocation_atomic",
        { p_allocation_id: str(allocationRow.id) },
      );
      if (deleteError) throw new Error(deleteError.message);
      const { error: allocateError } = await dynamicRpc(supabase, "allocate_change_order_atomic", {
        p_project_id: projectId,
        p_change_order_id: approvedCoId,
        p_cost_bucket_id: finishesBucketId,
        p_contract_amount_cents: 6_500_000,
        p_cost_amount_cents: 5_800_000,
        p_idempotency_key: `harbor-demo:${projectId}:co-002:0900:reset`,
      });
      if (allocateError) throw new Error(allocateError.message);
    }
  }
};

const harborDemoSubcontractDetails = {
  electrical: {
    title: "Electrical Scope on Harbor Residence",
    scope:
      "Electrical rough-in, branch wiring, devices, fixtures, testing, and closeout per plans.",
    contactName: "Northeast Electric Demo Desk",
  },
  concrete: {
    title: "Concrete — foundations & structure",
    scope: "Foundations, footings, and structural concrete per plans and executed proposal.",
    contactName: "Ray Delgado",
  },
  drywall: {
    title: "Drywall — hang, finish & punch",
    scope: "Drywall hanging, finishing, sanding, touch-up, and punch-list completion.",
    contactName: "Jamie Torres",
  },
} as const;

type HarborDemoCommercialIds = {
  organizationId: string;
  bucketByCode: Map<string, string>;
  subcontractorByKey: Map<string, string>;
  subcontractByKey: Map<string, string>;
  allocationByKey: Map<string, string>;
};

const ensureHarborDemoSubcontractBuyout = async (
  supabase: unknown,
  projectId: string,
  userId: string,
  upgradeExistingPlaceholders = false,
): Promise<HarborDemoCommercialIds> => {
  // Payment override provenance is now stamped inside the authenticated atomic
  // RPC. Keep this argument for the shared demo-module call signature.
  void userId;
  const projectResult = await dynamicTable(supabase, "projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle();
  if (projectResult.error) throw new Error(projectResult.error.message);
  const organizationId = str(
    (projectResult.data as Record<string, unknown> | null)?.organization_id,
  );
  if (!organizationId) throw new Error("Harbor needs a company workspace before buyouts can load.");

  const [bucketResult, directoryResult, subcontractResult, exposureResult] = await Promise.all([
    dynamicTable(supabase, "cost_buckets").select("id,cost_code").eq("project_id", projectId),
    dynamicTable(supabase, "subcontractors")
      .select("id,name")
      .eq("organization_id", organizationId),
    dynamicTable(supabase, "subcontracts")
      .select("id,subcontractor_id,title")
      .eq("project_id", projectId),
    dynamicTable(supabase, "exposures").select("id,title").eq("project_id", projectId),
  ]);
  if (bucketResult.error) throw new Error(bucketResult.error.message);
  if (directoryResult.error) throw new Error(directoryResult.error.message);
  if (subcontractResult.error) throw new Error(subcontractResult.error.message);
  if (exposureResult.error) throw new Error(exposureResult.error.message);

  const bucketByCode = new Map(
    ((bucketResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      str(row.cost_code),
      str(row.id),
    ]),
  );
  const directoryByName = new Map(
    ((directoryResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      str(row.name).toLowerCase(),
      str(row.id),
    ]),
  );
  const existingSubcontracts = (subcontractResult.data ?? []) as Array<Record<string, unknown>>;
  const subcontractorByKey = new Map<string, string>();
  const subcontractByKey = new Map<string, string>();
  const allocationByKey = new Map<string, string>();

  for (const fixture of HARBOR_DEMO_COMMERCIAL_WORKFLOW.subcontractors) {
    const detail = harborDemoSubcontractDetails[fixture.key];
    let subcontractorId = directoryByName.get(fixture.name.toLowerCase()) ?? "";
    if (!subcontractorId) {
      subcontractorId = harborDemoStableId(projectId, `subcontractor-${fixture.key}`);
      const { error } = await dynamicTable(supabase, "subcontractors").insert({
        id: subcontractorId,
        organization_id: organizationId,
        name: fixture.name,
        trade: fixture.trade,
        contact_name: detail.contactName,
        notes: harborDemoSourceNote,
        source: "user",
      });
      if (error?.code !== "23505" && error) throw new Error(error.message);
    }
    subcontractorByKey.set(fixture.key, subcontractorId);

    const existingSubcontract = existingSubcontracts.find(
      (row) =>
        str(row.subcontractor_id) === subcontractorId &&
        str(row.title).trim().toLowerCase() === detail.title.toLowerCase(),
    );
    let subcontractId = str(existingSubcontract?.id);
    if (!subcontractId) {
      subcontractId = harborDemoStableId(projectId, `subcontract-${fixture.key}`);
      const { error } = await dynamicTable(supabase, "subcontracts").insert({
        id: subcontractId,
        project_id: projectId,
        subcontractor_id: subcontractorId,
        title: detail.title,
        scope: detail.scope,
        contract_value: fixture.buyout,
        retainage_pct: 10,
        status: "executed",
        executed_at: "2026-06-05",
      });
      if (error?.code !== "23505" && error) throw new Error(error.message);
    }
    subcontractByKey.set(fixture.key, subcontractId);

    const costBucketId = bucketByCode.get(fixture.costCode);
    if (!costBucketId) throw new Error(`Harbor cost code ${fixture.costCode} is missing.`);
    const allocationResult = await dynamicTable(supabase, "subcontract_allocations")
      .select("id,planned_quantity,unit,benchmark_labor_rate")
      .eq("project_id", projectId)
      .eq("subcontract_id", subcontractId)
      .eq("cost_code", fixture.costCode)
      .maybeSingle();
    if (allocationResult.error) throw new Error(allocationResult.error.message);
    let allocationId = str((allocationResult.data as Record<string, unknown> | null)?.id);
    if (!allocationResult.data) {
      allocationId = harborDemoStableId(projectId, `subcontract-allocation-${fixture.key}`);
      const { error } = await dynamicTable(supabase, "subcontract_allocations").insert({
        id: allocationId,
        project_id: projectId,
        subcontract_id: subcontractId,
        cost_bucket_id: costBucketId,
        cost_code: fixture.costCode,
        description: `${fixture.trade} buyout and production benchmark`,
        amount: fixture.buyout,
        planned_quantity: fixture.plannedQuantity,
        unit: fixture.unit,
        benchmark_labor_rate: fixture.benchmarkLaborRate,
      });
      if (error?.code !== "23505" && error) throw new Error(error.message);
    } else if (upgradeExistingPlaceholders) {
      const allocation = allocationResult.data as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      if (num(allocation.planned_quantity) <= 0) patch.planned_quantity = fixture.plannedQuantity;
      if (!str(allocation.unit).trim()) patch.unit = fixture.unit;
      if (num(allocation.benchmark_labor_rate) <= 0)
        patch.benchmark_labor_rate = fixture.benchmarkLaborRate;
      if (Object.keys(patch).length > 0) {
        const { error } = await dynamicTable(supabase, "subcontract_allocations")
          .update(patch)
          .eq("id", str(allocation.id));
        if (error) throw new Error(error.message);
      }
    }
    allocationByKey.set(fixture.key, allocationId);
  }

  const concreteSubcontractId = subcontractByKey.get("concrete");
  const structureBucketId = bucketByCode.get("0300");
  if (concreteSubcontractId && structureBucketId) {
    const paymentResult = await dynamicTable(supabase, "subcontract_payments")
      .select("id,status")
      .eq("project_id", projectId)
      .eq("subcontract_id", concreteSubcontractId)
      .eq("reference", "Progress payment #1")
      .maybeSingle();
    if (paymentResult.error) throw new Error(paymentResult.error.message);
    const existingPayment = paymentResult.data as Record<string, unknown> | null;
    let existingPaymentId = str(existingPayment?.id);
    let existingPaymentStatus = str(existingPayment?.status);
    const overrideReason = "Demo payment predates the onboarding compliance lesson.";
    if (!paymentResult.data) {
      const { data: recordedPayment, error: recordPaymentError } = await dynamicRpc(
        supabase,
        "record_subcontract_payment_atomic",
        {
          p_project_id: projectId,
          p_subcontract_id: concreteSubcontractId,
          p_amount_cents: 2_000_000,
          p_retainage_held_cents: 200_000,
          p_payment_date: "2026-07-08",
          p_reference: "Progress payment #1",
          p_notes: "Harbor demo: approved concrete progress payment with explicit cost-code split.",
          p_status: "draft",
          p_exposure_id: null,
          p_override_reason: overrideReason,
          p_idempotency_key: `harbor-demo:${projectId}:subcontract-payment-concrete-1`,
        },
      );
      if (recordPaymentError) throw new Error(recordPaymentError.message);
      existingPaymentId = str((recordedPayment as Record<string, unknown> | null)?.id);
      existingPaymentStatus = str((recordedPayment as Record<string, unknown> | null)?.status);
      if (!existingPaymentId) {
        throw new Error("Harbor subcontract payment was recorded without a payment id.");
      }
    }

    // Financial attribution is editable only while draft. Seed the split first,
    // then advance through each audited lifecycle stage. A retry resumes from
    // whichever committed stage it finds.
    if (existingPaymentStatus === "draft") {
      const { error: splitError } = await dynamicRpc(
        supabase,
        "replace_subcontract_payment_allocations_atomic",
        {
          p_payment_id: existingPaymentId,
          p_rows: [
            {
              cost_bucket_id: structureBucketId,
              cost_code: "0300",
              description: "Concrete progress payment #1",
              amount_cents: 2_000_000,
            },
          ],
        },
      );
      if (splitError) throw new Error(splitError.message);

      const { error: approveError } = await dynamicRpc(
        supabase,
        "transition_subcontract_payment_atomic",
        {
          p_payment_id: existingPaymentId,
          p_status: "approved",
          p_override_reason: overrideReason,
          p_payment_method: null,
          p_payment_reference: null,
          p_paid_date: null,
        },
      );
      if (approveError) throw new Error(approveError.message);
      existingPaymentStatus = "approved";
    }

    if (existingPaymentStatus === "approved") {
      const { error: markPaidError } = await dynamicRpc(
        supabase,
        "transition_subcontract_payment_atomic",
        {
          p_payment_id: existingPaymentId,
          p_status: "paid",
          p_override_reason: overrideReason,
          p_payment_method: "ach",
          p_payment_reference: "Progress payment #1",
          p_paid_date: "2026-07-08",
        },
      );
      if (markPaidError) throw new Error(markPaidError.message);
      existingPaymentStatus = "paid";
    }
    if (existingPaymentStatus !== "paid") {
      throw new Error(
        `Harbor subcontract payment is in an unsupported ${existingPaymentStatus} state.`,
      );
    }
  }

  const drywallSubcontractId = subcontractByKey.get("drywall");
  const finishesBucketId = bucketByCode.get("0900");
  const weakDrywallExposure = ((exposureResult.data ?? []) as Array<Record<string, unknown>>).find(
    (row) => str(row.title) === "Weak drywall subcontractor",
  );
  if (drywallSubcontractId && finishesBucketId) {
    const coResult = await dynamicTable(supabase, "subcontract_change_orders")
      .select("id")
      .eq("project_id", projectId)
      .eq("subcontract_id", drywallSubcontractId)
      .eq("description", "Supplemental finishing crew")
      .maybeSingle();
    if (coResult.error) throw new Error(coResult.error.message);
    if (!coResult.data) {
      const { error } = await dynamicTable(supabase, "subcontract_change_orders").insert({
        id: harborDemoStableId(projectId, "subcontract-change-order-drywall-1"),
        project_id: projectId,
        subcontract_id: drywallSubcontractId,
        cost_bucket_id: finishesBucketId,
        cost_code: "0900",
        description: "Supplemental finishing crew",
        amount: 8000,
        co_date: "2026-07-10",
        exposure_id: str(weakDrywallExposure?.id) || null,
      });
      if (error?.code !== "23505" && error) throw new Error(error.message);
    }
  }

  return {
    organizationId,
    bucketByCode,
    subcontractorByKey,
    subcontractByKey,
    allocationByKey,
  };
};

const resetHarborDemoSubcontractBuyout = async (
  supabase: unknown,
  projectId: string,
  userId: string,
) => {
  const ids = await ensureHarborDemoSubcontractBuyout(supabase, projectId, userId);
  for (const fixture of HARBOR_DEMO_COMMERCIAL_WORKFLOW.subcontractors) {
    const subcontractId = ids.subcontractByKey.get(fixture.key);
    const subcontractorId = ids.subcontractorByKey.get(fixture.key);
    const bucketId = ids.bucketByCode.get(fixture.costCode);
    if (!subcontractId || !subcontractorId || !bucketId) continue;
    const detail = harborDemoSubcontractDetails[fixture.key];
    const { error: subcontractError } = await dynamicTable(supabase, "subcontracts")
      .update({
        title: detail.title,
        scope: detail.scope,
        contract_value: fixture.buyout,
        retainage_pct: 10,
        status: "executed",
        executed_at: "2026-06-05",
      })
      .eq("id", subcontractId);
    if (subcontractError) throw new Error(subcontractError.message);
    const { error: allocationError } = await dynamicTable(supabase, "subcontract_allocations")
      .update({
        cost_bucket_id: bucketId,
        description: `${fixture.trade} buyout and production benchmark`,
        amount: fixture.buyout,
        planned_quantity: fixture.plannedQuantity,
        unit: fixture.unit,
        benchmark_labor_rate: fixture.benchmarkLaborRate,
      })
      .eq("project_id", projectId)
      .eq("subcontract_id", subcontractId)
      .eq("cost_code", fixture.costCode);
    if (allocationError) throw new Error(allocationError.message);
  }
};

const buildHarborDemoFieldReportPayload = (
  projectId: string,
  userId: string,
  day: HarborProductionDay,
) => ({
  id: harborDemoStableId(projectId, `daily-report-${day.date}`),
  project_id: projectId,
  report_date: day.date,
  author: HARBOR_DEMO_PROJECT_MANAGER,
  created_by: userId,
  weather: day.weather,
  crew_count: day.lines.reduce((sum, line) => sum + line.crews, 0),
  manpower: day.lines
    .map(
      (line) =>
        `${line.crews} ${line.key} crew${line.crews === 1 ? "" : "s"}; ${line.peoplePerCrew} people per crew; ${line.hours} hours per person`,
    )
    .join(". "),
  work_performed: day.lines.map((line) => `${line.activity}: ${line.note}`).join(" "),
  delays: day.lines.some((line) => /slowed|fell below/i.test(line.note))
    ? "Field constraint affected production; see the linked WIP line and Tomorrow Plan."
    : "No material impact to the planned sequence.",
  safety_notes: "Pre-task planning complete; no incidents.",
  quality_notes: "Foremen verified installed quantities and released work before close-in.",
  visitors: "Project manager and trade foremen.",
  notes: harborDemoSourceNote,
  client_visible: false,
});

const buildHarborDemoFieldWipPayload = (
  projectId: string,
  userId: string,
  day: HarborProductionDay,
  line: HarborProductionLine,
  costBucketId: string,
  subcontractorId: string,
  scheduleActivityId: string | null,
) => ({
  id: harborDemoStableId(projectId, `daily-wip-${day.date}-${line.key}`),
  project_id: projectId,
  cost_bucket_id: costBucketId,
  schedule_activity_id: scheduleActivityId,
  subcontractor_id: subcontractorId,
  unmatched_vendor_name: "",
  entry_date: day.date,
  activity: line.activity,
  crew_count: line.crews,
  people_per_crew: line.peoplePerCrew,
  hours: line.hours,
  labor_rate: 110,
  material_cost: line.materialCost,
  equipment_cost: line.equipmentCost,
  material_items:
    line.materialCost > 0
      ? [{ description: `${line.key} material release`, amount: line.materialCost }]
      : [],
  equipment_items:
    line.equipmentCost > 0
      ? [{ description: `${line.key} access equipment`, amount: line.equipmentCost }]
      : [],
  quantity: line.quantity,
  unit: line.unit,
  quantity_items: [{ quantity: line.quantity, unit: line.unit, description: line.activity }],
  target_production_rate: line.targetRate,
  percent_basis: "sov",
  field_percent_complete: line.percent,
  percent_complete: line.percent,
  percent_overridden_at: null,
  wip_reviewed_at: `${day.date}T20:00:00.000Z`,
  wip_reviewed_by: userId,
  notes: `${harborDemoSourceNote} ${line.note} Production measure: ${line.unit} installed per labor-hour.`,
  created_by: userId,
});

const ensureHarborDemoDailyReportsWip = async (
  supabase: unknown,
  projectId: string,
  userId: string,
  upgradeExistingFixtures = false,
) => {
  const ids = await ensureHarborDemoSubcontractBuyout(supabase, projectId, userId);
  for (const key of ["electrical", "concrete", "drywall"] as const) {
    if (!ids.subcontractorByKey.get(key))
      throw new Error(`Harbor ${key} production prerequisites are missing.`);
  }

  if (upgradeExistingFixtures) {
    const legacyWipDelete = await dynamicTable(supabase, "daily_wip_entries")
      .delete()
      .in(
        "id",
        ["2026-07-11", "2026-07-12", "2026-07-13"].map((date) =>
          harborDemoStableId(projectId, `daily-wip-${date}`),
        ),
      );
    if (legacyWipDelete.error) throw new Error(legacyWipDelete.error.message);
    const legacyReportDelete = await dynamicTable(supabase, "daily_reports")
      .delete()
      .in(
        "id",
        ["2026-07-11", "2026-07-12"].map((date) =>
          harborDemoStableId(projectId, `daily-report-${date}`),
        ),
      );
    if (legacyReportDelete.error) throw new Error(legacyReportDelete.error.message);
  }

  const [reportResult, wipResult, activityResult] = await Promise.all([
    dynamicTable(supabase, "daily_reports")
      .select("id,report_date,notes")
      .eq("project_id", projectId),
    dynamicTable(supabase, "daily_wip_entries")
      .select("id,entry_date,cost_bucket_id,subcontractor_id,notes")
      .eq("project_id", projectId),
    dynamicTable(supabase, "schedule_activities")
      .select("id,activity_id")
      .eq("project_id", projectId),
  ]);
  if (reportResult.error) throw new Error(reportResult.error.message);
  if (wipResult.error) throw new Error(wipResult.error.message);
  if (activityResult.error && !isScheduleActivitiesSchemaError(activityResult.error))
    throw new Error(activityResult.error.message);

  if (upgradeExistingFixtures) {
    const canonicalDates = new Set(HARBOR_DEMO_PRODUCTION_DAYS.map((day) => day.date));
    const staleReportIds = ((reportResult.data ?? []) as Array<Record<string, unknown>>)
      .filter(
        (row) =>
          str(row.notes).startsWith(harborDemoSourceNote) &&
          !canonicalDates.has(str(row.report_date)),
      )
      .map((row) => str(row.id))
      .filter(Boolean);
    const staleWipIds = ((wipResult.data ?? []) as Array<Record<string, unknown>>)
      .filter(
        (row) =>
          str(row.notes).startsWith(harborDemoSourceNote) &&
          !canonicalDates.has(str(row.entry_date)),
      )
      .map((row) => str(row.id))
      .filter(Boolean);
    if (staleWipIds.length) {
      const staleWipDelete = await dynamicTable(supabase, "daily_wip_entries")
        .delete()
        .in("id", staleWipIds);
      if (staleWipDelete.error) throw new Error(staleWipDelete.error.message);
    }
    if (staleReportIds.length) {
      const staleReportDelete = await dynamicTable(supabase, "daily_reports")
        .delete()
        .in("id", staleReportIds);
      if (staleReportDelete.error) throw new Error(staleReportDelete.error.message);
    }
  }

  const reportByDate = new Map(
    ((reportResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      str(row.report_date),
      str(row.id),
    ]),
  );
  const wipIds = new Set(
    ((wipResult.data ?? []) as Array<Record<string, unknown>>).map((row) => str(row.id)),
  );
  const activityIdByCode = new Map(
    ((activityResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      str(row.activity_id),
      str(row.id),
    ]),
  );

  const reportRows: Array<Record<string, unknown>> = [];
  const wipRows: Array<Record<string, unknown>> = [];

  for (const day of HARBOR_DEMO_PRODUCTION_DAYS) {
    const reportPayload = buildHarborDemoFieldReportPayload(projectId, userId, day);
    const existingReportId = reportByDate.get(day.date);
    if (!existingReportId || upgradeExistingFixtures)
      reportRows.push({ ...reportPayload, id: existingReportId || reportPayload.id });

    for (const line of day.lines) {
      const costBucketId = ids.bucketByCode.get(line.costCode);
      const subcontractorId = ids.subcontractorByKey.get(line.key);
      if (!costBucketId || !subcontractorId) continue;
      const payload = buildHarborDemoFieldWipPayload(
        projectId,
        userId,
        day,
        line,
        costBucketId,
        subcontractorId,
        activityIdByCode.get(line.scheduleActivityCode) || null,
      );
      if (!wipIds.has(payload.id) || upgradeExistingFixtures) wipRows.push(payload);
    }
  }

  // A full Harbor production story is 30 reports and 53 measured work lines.
  // Writing them one at a time made the version adapter exceed the server
  // request window, leaving the registry on v1 and every later visit repeating
  // the same partial upgrade. Keep the canonical reset atomic at the table
  // level so every company receives the whole teaching dataset in a handful of
  // requests.
  if (reportRows.length > 0) {
    const reportWrite = await dynamicTable(supabase, "daily_reports").upsert(reportRows, {
      onConflict: "project_id,report_date",
      ignoreDuplicates: !upgradeExistingFixtures,
    });
    if (reportWrite.error) throw new Error(reportWrite.error.message);
  }

  if (wipRows.length > 0) {
    const wipWrite = await dynamicTable(supabase, "daily_wip_entries").upsert(wipRows, {
      onConflict: "id",
      ignoreDuplicates: !upgradeExistingFixtures,
    });
    if (wipWrite.error) throw new Error(wipWrite.error.message);
  }
};

const resetHarborDemoDailyReportsWip = async (
  supabase: unknown,
  projectId: string,
  userId: string,
) => {
  await ensureHarborDemoDailyReportsWip(supabase, projectId, userId, true);
};

const ensureHarborDemoTomorrowPlan = async (
  supabase: unknown,
  projectId: string,
  userId: string,
  overwrite = false,
) => {
  const ids = await ensureHarborDemoSubcontractBuyout(supabase, projectId, userId);
  const [activityResult, existingResult] = await Promise.all([
    dynamicTable(supabase, "schedule_activities")
      .select("id,activity_id")
      .eq("project_id", projectId),
    dynamicTable(supabase, "tomorrow_plan_items").select("id,notes").eq("project_id", projectId),
  ]);
  if (activityResult.error) throw new Error(activityResult.error.message);
  if (existingResult.error) throw new Error(existingResult.error.message);

  const activityIdByCode = new Map(
    ((activityResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      str(row.activity_id),
      str(row.id),
    ]),
  );
  const existingIds = new Set(
    ((existingResult.data ?? []) as Array<Record<string, unknown>>).map((row) => str(row.id)),
  );
  const fixtures = [
    {
      seedKey: "actual-comparison-electrical-2026-07-17",
      plan_date: "2026-07-17",
      scheduleCode: "26-010",
      costCode: "1500",
      performerKey: "electrical",
      activity: "Branch wiring and device rough-in",
      work_area: "Second floor and service corridor",
      performer_type: "subcontractor",
      performer_name: "ALP Electric",
      crew_count: 2,
      people_per_crew: 3,
      hours_per_person: 8,
      planned_quantity: 1056,
      unit: "LF",
      target_rate: 22,
      materials: "Branch wire, conduit, boxes, and fittings staged by area",
      materials_ready: true,
      equipment: "Scissor lift and gang boxes",
      equipment_ready: true,
      information: "Released reflected ceiling and lighting-control drawings",
      information_ready: true,
      inspection: "Rough-in inspection walk scheduled after lunch",
      inspection_ready: true,
      work_area_ready: true,
      status: "ready",
      constraint_summary: "",
      constraint_owner: "",
      confirmation_status: "confirmed",
      notes:
        "Teaching comparison: the next Daily WIP line closes this promise against actual output.",
    },
    {
      seedKey: "electrical-2026-07-20",
      plan_date: HARBOR_DEMO_TOMORROW_PLAN_DATE,
      scheduleCode: "26-010",
      costCode: "1500",
      performerKey: "electrical",
      activity: "Complete east-wing branch wiring",
      work_area: "East wing bedrooms and corridor",
      performer_type: "subcontractor",
      performer_name: "ALP Electric",
      crew_count: 2,
      people_per_crew: 3,
      hours_per_person: 8,
      planned_quantity: 1056,
      unit: "LF",
      target_rate: 22,
      materials: "Wire, conduit, boxes, and fittings staged in the east wing",
      materials_ready: true,
      equipment: "Scissor lift charged and released",
      equipment_ready: true,
      information: "Released lighting and device layout",
      information_ready: true,
      inspection: "Foreman quality walk before rough inspection",
      inspection_ready: true,
      work_area_ready: true,
      status: "ready",
      constraint_summary: "",
      constraint_owner: "",
      confirmation_status: "confirmed",
      notes: "Ready means the work can start without waiting when the crew arrives.",
    },
    {
      seedKey: "drywall-2026-07-20",
      plan_date: HARBOR_DEMO_TOMORROW_PLAN_DATE,
      scheduleCode: "09-020",
      costCode: "0900",
      performerKey: "drywall",
      activity: "Finish and sand main-level drywall",
      work_area: "Main level and stair hall",
      performer_type: "subcontractor",
      performer_name: "Summit Drywall & Finishes",
      crew_count: 1,
      people_per_crew: 4,
      hours_per_person: 8,
      planned_quantity: 270.77,
      unit: "SF",
      target_rate: (12_000 * 110) / 156_000,
      materials: "Compound, corner bead, and sanding media staged",
      materials_ready: true,
      equipment: "Rolling scaffold and dust-control equipment",
      equipment_ready: true,
      information: "Final MEP penetration closeout list is due before 7 AM",
      information_ready: false,
      inspection: "PM finish-quality mockup review at 10 AM",
      inspection_ready: true,
      work_area_ready: true,
      status: "at_risk",
      constraint_summary:
        "MEP must close the remaining penetrations before the finish crew reaches the stair hall.",
      constraint_owner: "MEP coordinator",
      confirmation_status: "planned",
      notes:
        "Treat the constraint tonight; do not discover it with four finishers standing idle tomorrow.",
    },
    {
      seedKey: "cabinet-delivery-2026-07-20",
      plan_date: HARBOR_DEMO_TOMORROW_PLAN_DATE,
      scheduleCode: "12-020",
      costCode: "0130",
      performerKey: null,
      activity: "Receive and inspect replacement cabinet package",
      work_area: "Loading area and kitchen",
      performer_type: "vendor",
      performer_name: "Millwork manufacturer",
      crew_count: 1,
      people_per_crew: 2,
      hours_per_person: 4,
      planned_quantity: 1,
      unit: "delivery",
      target_rate: null,
      materials: "Replacement cabinet package has not been released from the manufacturer",
      materials_ready: false,
      equipment: "Protected laydown area and pallet jack",
      equipment_ready: true,
      information: "Approved shop drawings and damage checklist",
      information_ready: true,
      inspection: "PM and superintendent receiving inspection",
      inspection_ready: true,
      work_area_ready: true,
      status: "blocked",
      constraint_summary:
        "Do not mobilize the receiving crew until the manufacturer confirms the replacement shipment.",
      constraint_owner: "Procurement lead",
      confirmation_status: "planned",
      notes:
        "This blocked commitment is the bridge to procurement, schedule exposure, contract notice, and Risk Tally treatment.",
    },
  ] as const;

  if (overwrite) {
    const canonicalIds = new Set(
      fixtures.map((fixture) => harborDemoStableId(projectId, `tomorrow-plan-${fixture.seedKey}`)),
    );
    const staleIds = ((existingResult.data ?? []) as Array<Record<string, unknown>>)
      .filter(
        (row) => str(row.notes).startsWith(harborDemoSourceNote) && !canonicalIds.has(str(row.id)),
      )
      .map((row) => str(row.id))
      .filter(Boolean);
    if (staleIds.length) {
      const staleDelete = await dynamicTable(supabase, "tomorrow_plan_items")
        .delete()
        .in("id", staleIds);
      if (staleDelete.error) throw new Error(staleDelete.error.message);
      for (const id of staleIds) existingIds.delete(id);
    }
  }

  for (const fixture of fixtures) {
    const id = harborDemoStableId(projectId, `tomorrow-plan-${fixture.seedKey}`);
    const payload = {
      id,
      project_id: projectId,
      plan_date: fixture.plan_date,
      schedule_activity_id: activityIdByCode.get(fixture.scheduleCode) || null,
      cost_bucket_id: ids.bucketByCode.get(fixture.costCode) || null,
      subcontractor_id: fixture.performerKey
        ? ids.subcontractorByKey.get(fixture.performerKey) || null
        : null,
      activity: fixture.activity,
      work_area: fixture.work_area,
      performer_type: fixture.performer_type,
      performer_name: fixture.performer_name,
      crew_count: fixture.crew_count,
      people_per_crew: fixture.people_per_crew,
      hours_per_person: fixture.hours_per_person,
      planned_quantity: fixture.planned_quantity,
      unit: fixture.unit,
      target_rate: fixture.target_rate,
      benchmark_rate: fixture.performerKey ? fixture.target_rate : null,
      benchmark_source: fixture.performerKey ? "subcontract_buyout" : "",
      benchmark_source_id: fixture.performerKey
        ? ids.allocationByKey.get(fixture.performerKey) || null
        : null,
      materials: fixture.materials,
      materials_ready: fixture.materials_ready,
      equipment: fixture.equipment,
      equipment_ready: fixture.equipment_ready,
      information: fixture.information,
      information_ready: fixture.information_ready,
      inspection: fixture.inspection,
      inspection_ready: fixture.inspection_ready,
      work_area_ready: fixture.work_area_ready,
      status: fixture.status,
      constraint_summary: fixture.constraint_summary,
      constraint_owner: fixture.constraint_owner,
      confirmation_status: fixture.confirmation_status,
      confirmed_by: fixture.confirmation_status === "confirmed" ? userId : null,
      confirmed_at:
        fixture.confirmation_status === "confirmed" ? `${fixture.plan_date}T20:00:00.000Z` : null,
      notes: `${harborDemoSourceNote} ${fixture.notes}`,
      created_by: userId,
    };
    if (!existingIds.has(id)) {
      const { error } = await dynamicTable(supabase, "tomorrow_plan_items").insert(payload);
      if (error?.code !== "23505" && error) throw new Error(error.message);
    } else if (overwrite) {
      const { id: _id, ...patch } = payload;
      const { error } = await dynamicTable(supabase, "tomorrow_plan_items")
        .update(patch)
        .eq("id", id);
      if (error) throw new Error(error.message);
    }
  }
};

const harborDemoPriorBillingPercentByCode: Record<string, number> = {
  "0100": 80,
  "0300": 60,
  "0700": 45,
  "1500": 10,
  "0900": 20,
  "0130": 55,
};

const buildHarborDemoBillingApplicationPayload = (projectId: string) => ({
  id: harborDemoStableId(projectId, "billing-application-draft-2"),
  project_id: projectId,
  application_number: HARBOR_DEMO_COMMERCIAL_WORKFLOW.billingApplicationNumber,
  invoice_number: "DEMO-2607-2",
  submitted_date: null,
  due_date: "2026-08-31",
  billing_period: "July 2026",
  contract_amount: 3200000,
  change_order_amount: 65000,
  amount_billed: 0,
  paid_to_date: 0,
  retainage: 0,
  total_retainage_held: 0,
  retainage_released_this_period: 0,
  has_line_detail: false,
  output_format: "aia_g702",
  status: "draft",
  notes:
    "Harbor onboarding: the PM certifies production in Daily WIP; accounting chooses whether to apply it to this draft.",
  sort_order: 2,
});

const seedHarborDemoBillingProgress = async (supabase: unknown, billingApplicationId: string) => {
  // The atomic billing command requires a per-line concurrency token, so the
  // seed reads each line's current updated_at alongside its money.
  const { data, error } = await dynamicTable(supabase, "billing_line_items")
    .select(
      "id,cost_code,scheduled_value_cents,work_completed_previous_cents,materials_stored_previous_cents,updated_at",
    )
    .eq("billing_application_id", billingApplicationId);
  if (error) throw new Error(error.message);

  const items = ((data ?? []) as Array<Record<string, unknown>>).map((line) => {
    const targetPercent = harborDemoPriorBillingPercentByCode[str(line.cost_code)] ?? 0;
    const targetCompletedCents = Math.round(
      (num(line.scheduled_value_cents) * targetPercent) / 100,
    );
    const priorCompletedCents =
      num(line.work_completed_previous_cents) + num(line.materials_stored_previous_cents);
    return {
      id: str(line.id),
      expected_updated_at: str(line.updated_at),
      work_completed_this_period_cents: Math.max(0, targetCompletedCents - priorCompletedCents),
      materials_stored_this_period_cents: 0,
      retainage_pct:
        harborDemoBuckets.find((bucket) => bucket.cost_code === str(line.cost_code))
          ?.retainage_pct ?? 10,
      retainage_released_cents: 0,
    };
  });
  if (items.length === 0) {
    throw new Error("Harbor demo billing generation returned no SOV lines.");
  }
  // Each seed invocation is its own keyed operation (mirrors
  // harborDemoOperationGeneration): re-running the ensure recomputes deltas
  // from server truth, so a fresh key with a matching fingerprint is correct.
  const { error: mutationError } = await dynamicRpc(
    supabase,
    "apply_billing_line_item_mutations_atomic",
    {
      p_items: items,
      p_operation_key: `harbor-billing-progress:${billingApplicationId}:${harborDemoOperationGeneration("ensure")}`,
    },
  );
  if (mutationError) throw new Error(mutationError.message);
};

const ensureHarborDemoBillingWorkspace = async (supabase: unknown, projectId: string) => {
  await ensureHarborDemoBudgetSov(supabase, projectId);
  const appResult = await dynamicTable(supabase, "billing_applications")
    .select("id,application_number")
    .eq("project_id", projectId)
    .eq("application_number", HARBOR_DEMO_COMMERCIAL_WORKFLOW.billingApplicationNumber)
    .maybeSingle();
  if (appResult.error) throw new Error(appResult.error.message);

  let billingApplicationId = str((appResult.data as Record<string, unknown> | null)?.id);
  if (!billingApplicationId) {
    const {
      id: _id,
      project_id: _projectId,
      total_retainage_held: _totalRetainageHeld,
      retainage_released_this_period: _retainageReleased,
      has_line_detail: _hasLineDetail,
      sort_order: _sortOrder,
      ...payload
    } = buildHarborDemoBillingApplicationPayload(projectId);
    const { data: command, error } = await dynamicRpc(
      supabase,
      "create_billing_application_atomic",
      {
        p_project_id: projectId,
        p_payload: payload,
        p_idempotency_key: `harbor-demo:${projectId}:billing-application-draft-2:create`,
      },
    );
    if (error) throw new Error(error.message);
    billingApplicationId = str((command as Record<string, unknown>)?.billingApplicationId);
    if (!billingApplicationId)
      throw new Error("Harbor demo billing application did not return an id.");
  }

  const { error: generationError } = await dynamicRpc(
    supabase,
    "generate_billing_line_items_atomic",
    {
      p_project_id: projectId,
      p_billing_application_id: billingApplicationId,
    },
  );
  if (generationError) throw new Error(generationError.message);
  await seedHarborDemoBillingProgress(supabase, billingApplicationId);
};

const resetHarborDemoBillingWorkspace = async (supabase: unknown, projectId: string) => {
  await ensureHarborDemoBillingWorkspace(supabase, projectId);
  const appResult = await dynamicTable(supabase, "billing_applications")
    .select("id,updated_at")
    .eq("project_id", projectId)
    .eq("application_number", HARBOR_DEMO_COMMERCIAL_WORKFLOW.billingApplicationNumber)
    .maybeSingle();
  if (appResult.error) throw new Error(appResult.error.message);
  const billingApplicationId = str((appResult.data as Record<string, unknown> | null)?.id);
  const billingApplicationUpdatedAt = str(
    (appResult.data as Record<string, unknown> | null)?.updated_at,
    "unknown",
  );
  if (!billingApplicationId) return;
  const {
    id: _appId,
    project_id: _projectId,
    amount_billed: _amountBilled,
    paid_to_date: _paidToDate,
    retainage: _retainage,
    total_retainage_held: _totalRetainageHeld,
    retainage_released_this_period: _retainageReleased,
    has_line_detail: _hasLineDetail,
    status: _status,
    sort_order: _sortOrder,
    ...appPatch
  } = buildHarborDemoBillingApplicationPayload(projectId);
  const { error: appError } = await dynamicRpc(supabase, "update_billing_application_atomic", {
    p_billing_application_id: billingApplicationId,
    p_patch: appPatch,
    p_idempotency_key: `harbor-demo:${projectId}:billing-application-draft-2:reset:${billingApplicationUpdatedAt}`,
  });
  if (appError) throw new Error(appError.message);

  await seedHarborDemoBillingProgress(supabase, billingApplicationId);
};

type HarborDemoModuleRun = {
  key: HarborDemoModuleKey;
  targetVersion: number;
  status: "ready" | "failed";
  warnings: string[];
};

const isDemoSeedModuleVersionsSchemaError = (error: DynamicSupabaseError | null) =>
  isMissingRestRelation(error, "demo_seed_module_versions") ||
  (error?.message ?? "").toLowerCase().includes("demo_seed_module_versions");

const ensureVersionedHarborDemoModules = async (
  supabase: unknown,
  projectId: string,
  userId: string,
  seedWarnings: string[],
) => {
  let registryAvailable = true;
  let registryWarningAdded = false;
  const appliedVersions = new Map<string, number>();
  const appliedStatuses = new Map<string, "ready" | "failed">();
  const moduleRuns: HarborDemoModuleRun[] = [];

  const registryResult = await dynamicTable(supabase, "demo_seed_module_versions")
    .select("module_key,applied_version,status")
    .eq("project_id", projectId);
  if (registryResult.error) {
    if (isDemoSeedModuleVersionsSchemaError(registryResult.error)) {
      registryAvailable = false;
    } else {
      seedWarnings.push(
        `Harbor demo version registry read skipped: ${registryResult.error.message}`,
      );
      registryAvailable = false;
    }
  } else {
    for (const row of (registryResult.data ?? []) as Array<Record<string, unknown>>) {
      appliedVersions.set(str(row.module_key), num(row.applied_version));
      appliedStatuses.set(str(row.module_key), str(row.status) === "ready" ? "ready" : "failed");
    }
  }

  const addRegistryWarning = (message: string) => {
    if (registryWarningAdded) return;
    seedWarnings.push(message);
    registryWarningAdded = true;
  };

  const recordModuleRun = async (run: HarborDemoModuleRun) => {
    if (!registryAvailable) {
      addRegistryWarning(
        "Harbor demo version registry isn't available yet; canonical module data was still ensured.",
      );
      return;
    }

    const now = new Date().toISOString();
    const appliedVersion =
      run.status === "ready" ? run.targetVersion : Math.max(0, appliedVersions.get(run.key) ?? 0);
    const { error } = await dynamicTable(supabase, "demo_seed_module_versions").upsert(
      {
        project_id: projectId,
        module_key: run.key,
        applied_version: appliedVersion,
        status: run.status,
        last_operation: "ensure",
        last_error: run.warnings.join("\n"),
        last_seeded_by: userId,
        last_seeded_at: now,
        metadata: {
          canonical_source: "application-code",
          target_version: run.targetVersion,
        } as Json,
      },
      { onConflict: "project_id,module_key" },
    );
    if (!error) {
      appliedVersions.set(run.key, appliedVersion);
      return;
    }
    if (isDemoSeedModuleVersionsSchemaError(error)) registryAvailable = false;
    addRegistryWarning(`Harbor demo version registry write skipped: ${error.message}`);
  };

  const moduleNeedsUpgrade = (key: HarborDemoModuleKey) => {
    const targetVersion = HARBOR_DEMO_MODULES.find((module) => module.key === key)?.version ?? 0;
    return (appliedVersions.get(key) ?? 0) < targetVersion || appliedStatuses.get(key) !== "ready";
  };

  const adapters = {
    "project-foundation": () => ensureHarborDemoProjectManager(supabase, projectId, seedWarnings),
    "budget-sov": () =>
      ensureHarborDemoBudgetSov(supabase, projectId, moduleNeedsUpgrade("budget-sov")),
    "ior-commercial-position": () => ensureHarborDemoIorCommercialPosition(supabase, projectId),
    "subcontract-buyout": () =>
      ensureHarborDemoSubcontractBuyout(
        supabase,
        projectId,
        userId,
        moduleNeedsUpgrade("subcontract-buyout"),
      ),
    "cpm-schedule": () => seedHarborDemoCpmActivities(supabase, projectId, seedWarnings),
    "daily-reports-wip": () =>
      ensureHarborDemoDailyReportsWip(
        supabase,
        projectId,
        userId,
        moduleNeedsUpgrade("daily-reports-wip"),
      ),
    "daily-wip-cpm-evidence": () =>
      seedHarborDemoCpmEvidence(supabase, projectId, userId, seedWarnings),
    "production-control": () =>
      ensureHarborDemoDailyReportsWip(
        supabase,
        projectId,
        userId,
        moduleNeedsUpgrade("production-control"),
      ),
    "tomorrow-plan": () =>
      ensureHarborDemoTomorrowPlan(
        supabase,
        projectId,
        userId,
        moduleNeedsUpgrade("tomorrow-plan"),
      ),
    "billing-workspace": () => ensureHarborDemoBillingWorkspace(supabase, projectId),
    inspections: () => seedHarborDemoInspections(supabase, projectId, seedWarnings),
    claims: () => seedHarborDemoClaims(supabase, projectId, seedWarnings),
  } satisfies Record<HarborDemoModuleKey, () => Promise<unknown>>;

  for (const module of HARBOR_DEMO_MODULES) {
    // A version registry only has value if a current, successful module is not
    // rewritten on every visit. Preserve the user's demo state until a newer
    // canonical version is shipped or they explicitly choose Reset.
    if (registryAvailable && !moduleNeedsUpgrade(module.key)) {
      moduleRuns.push({
        key: module.key,
        targetVersion: module.version,
        status: "ready",
        warnings: [],
      });
      continue;
    }

    const warningStart = seedWarnings.length;
    try {
      await adapters[module.key]();
    } catch (error) {
      seedWarnings.push(
        `Harbor ${module.key} demo module failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const warnings = seedWarnings.slice(warningStart);
    const run: HarborDemoModuleRun = {
      key: module.key,
      targetVersion: module.version,
      status: warnings.length === 0 ? "ready" : "failed",
      warnings,
    };
    moduleRuns.push(run);
    await recordModuleRun(run);
  }

  return {
    registryAvailable,
    modules: moduleRuns,
  };
};

const resetHarborDemoModuleFixtures = async (
  supabase: unknown,
  projectId: string,
  userId: string,
  moduleKey: HarborDemoModuleKey,
  seedWarnings: string[],
  operationGeneration: string,
) => {
  if (moduleKey === "project-foundation") {
    const { data: projectVersion, error: versionError } = await dynamicTable(supabase, "projects")
      .select("updated_at")
      .eq("id", projectId)
      .maybeSingle();
    if (versionError) throw new Error(versionError.message);
    const expectedUpdatedAt = str((projectVersion as Record<string, unknown> | null)?.updated_at);
    if (!expectedUpdatedAt) throw new Error("The Harbor project version was unavailable.");
    const { error } = await dynamicRpc(supabase, "update_project_financial_header_atomic", {
      p_project_id: projectId,
      p_patch: {
        job_number: HARBOR_DEMO_JOB_NUMBER,
        name: HARBOR_DEMO_NAME,
        client: HARBOR_DEMO_CLIENT,
        project_manager: HARBOR_DEMO_PROJECT_MANAGER,
      },
      p_override_reason:
        "Resetting the Harbor onboarding project header to its published fixture values.",
      p_expected_updated_at: expectedUpdatedAt,
      p_operation_key: `harbor-demo:${projectId}:project-foundation:reset:${operationGeneration}`,
    });
    if (error) throw new Error(error.message);
    return;
  }

  if (moduleKey === "budget-sov") {
    await resetHarborDemoBudgetSov(supabase, projectId, operationGeneration);
    return;
  }

  if (moduleKey === "ior-commercial-position") {
    await resetHarborDemoIorCommercialPosition(supabase, projectId);
    return;
  }

  if (moduleKey === "subcontract-buyout") {
    await resetHarborDemoSubcontractBuyout(supabase, projectId, userId);
    return;
  }

  if (moduleKey === "cpm-schedule") {
    const { data: rows, error: loadError } = await dynamicTable(supabase, "schedule_activities")
      .select("id,activity_id")
      .eq("project_id", projectId);
    if (loadError) throw new Error(loadError.message);
    const idByActivity = new Map(
      ((rows ?? []) as Array<Record<string, unknown>>).map((row) => [
        str(row.activity_id),
        str(row.id),
      ]),
    );
    for (const [index, activity] of HARBOR_DEMO_CPM_ACTIVITIES.entries()) {
      const id = idByActivity.get(activity.activity_id);
      if (!id) continue;
      const { error } = await dynamicTable(supabase, "schedule_activities")
        .update({ ...activity, sort_order: index + 1 })
        .eq("id", id);
      if (error) throw new Error(error.message);
    }
    await seedHarborDemoCpmActivities(supabase, projectId, seedWarnings);
    return;
  }

  if (moduleKey === "daily-wip-cpm-evidence") {
    await seedHarborDemoCpmActivities(supabase, projectId, seedWarnings);
    await seedHarborDemoCpmEvidence(supabase, projectId, userId, seedWarnings);
    const [activityResult, bucketResult] = await Promise.all([
      dynamicTable(supabase, "schedule_activities")
        .select("id")
        .eq("project_id", projectId)
        .eq("activity_id", HARBOR_DEMO_CPM_WALKTHROUGH.scheduleActivityCode)
        .maybeSingle(),
      dynamicTable(supabase, "cost_buckets")
        .select("id")
        .eq("project_id", projectId)
        .eq("cost_code", HARBOR_DEMO_CPM_WALKTHROUGH.costCode)
        .maybeSingle(),
    ]);
    if (activityResult.error) throw new Error(activityResult.error.message);
    if (bucketResult.error) throw new Error(bucketResult.error.message);
    const activityId = (activityResult.data as { id?: string } | null)?.id;
    const bucketId = (bucketResult.data as { id?: string } | null)?.id;
    if (!activityId || !bucketId) {
      throw new Error("Harbor CPM evidence prerequisites are missing.");
    }
    const { id: _stableId, ...payload } = buildHarborDemoCpmEvidencePayload(
      projectId,
      userId,
      activityId,
      bucketId,
    );
    const { error } = await dynamicTable(supabase, "daily_wip_entries")
      .update(payload)
      .eq("id", projectId);
    if (error) throw new Error(error.message);
    return;
  }

  if (moduleKey === "daily-reports-wip") {
    await resetHarborDemoDailyReportsWip(supabase, projectId, userId);
    return;
  }

  if (moduleKey === "production-control") {
    await resetHarborDemoSubcontractBuyout(supabase, projectId, userId);
    await resetHarborDemoDailyReportsWip(supabase, projectId, userId);
    return;
  }

  if (moduleKey === "tomorrow-plan") {
    await ensureHarborDemoTomorrowPlan(supabase, projectId, userId, true);
    return;
  }

  if (moduleKey === "billing-workspace") {
    await resetHarborDemoBillingWorkspace(supabase, projectId);
    return;
  }

  if (moduleKey === "inspections") {
    for (const inspection of harborDemoInspections) {
      const { error } = await dynamicTable(supabase, "project_inspections")
        .update(inspection)
        .eq("project_id", projectId)
        .eq("seed_key", inspection.seed_key);
      if (error) throw new Error(error.message);
    }
    await seedHarborDemoInspections(supabase, projectId, seedWarnings);
    return;
  }

  for (const claim of harborDemoClaims) {
    const { error } = await dynamicTable(supabase, "project_claims")
      .update(claim)
      .eq("project_id", projectId)
      .eq("seed_key", claim.seed_key);
    if (error) throw new Error(error.message);
  }
  await seedHarborDemoClaims(supabase, projectId, seedWarnings);
  for (const event of harborDemoClaimEvents) {
    const { error } = await dynamicTable(supabase, "project_claim_events")
      .update(event)
      .eq("project_id", projectId)
      .eq("seed_key", event.seed_key);
    if (error) throw new Error(error.message);
  }
};

const resetHarborDemoModuleInput = z.object({
  projectId: z.string().uuid(),
  operationKey: z.string().uuid(),
  moduleKey: z.enum([
    "project-foundation",
    "budget-sov",
    "ior-commercial-position",
    "subcontract-buyout",
    "cpm-schedule",
    "daily-reports-wip",
    "daily-wip-cpm-evidence",
    "production-control",
    "tomorrow-plan",
    "billing-workspace",
    "inspections",
    "claims",
  ]),
});

export const resetHarborDemoModule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof resetHarborDemoModuleInput>) =>
    resetHarborDemoModuleInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: projectRow, error: projectError } = await context.supabase
      .from("projects")
      .select("id,name,client,job_number,archived_at")
      .eq("id", data.projectId)
      .maybeSingle();
    if (projectError) throw new Error(projectError.message);
    if (!projectRow || !isHarborDemoProject(projectRow as Record<string, unknown>)) {
      throw new Error("Only Harbor Residence demo modules can be reset.");
    }
    if (projectRow.archived_at) throw new Error("Unarchive Harbor Residence before resetting it.");

    const { data: canManage, error: manageError } = await context.supabase.rpc(
      "can_manage_project",
      { p_project_id: data.projectId },
    );
    if (manageError) throw new Error(manageError.message);
    if (!canManage) throw new Error("You need project management access to reset Harbor lessons.");

    const seedWarnings: string[] = [];
    const engine = await ensureVersionedHarborDemoModules(
      context.supabase,
      data.projectId,
      context.userId,
      seedWarnings,
    );
    if (!engine.registryAvailable) {
      throw new Error("Harbor demo reset isn't available yet.");
    }

    const resetWarningStart = seedWarnings.length;
    let resetError: Error | null = null;
    try {
      await resetHarborDemoModuleFixtures(
        context.supabase,
        data.projectId,
        context.userId,
        data.moduleKey,
        seedWarnings,
        data.operationKey,
      );
      if (seedWarnings.length > resetWarningStart) {
        resetError = new Error(seedWarnings.slice(resetWarningStart).join("\n"));
      }
    } catch (error) {
      resetError = error instanceof Error ? error : new Error(String(error));
    }

    const module = HARBOR_DEMO_MODULES.find((item) => item.key === data.moduleKey);
    if (!module) throw new Error("Unknown Harbor demo module.");
    const now = new Date().toISOString();
    const { error: versionError } = await dynamicTable(
      context.supabase,
      "demo_seed_module_versions",
    ).upsert(
      {
        project_id: data.projectId,
        module_key: data.moduleKey,
        applied_version: module.version,
        status: resetError ? "failed" : "ready",
        last_operation: "reset",
        last_error: resetError?.message ?? "",
        last_seeded_by: context.userId,
        last_seeded_at: now,
        ...(resetError ? {} : { last_reset_at: now }),
        metadata: {
          canonical_source: "application-code",
          target_version: module.version,
        } as Json,
      },
      { onConflict: "project_id,module_key" },
    );
    if (versionError) throw new Error(versionError.message);
    if (resetError) throw resetError;

    return {
      ok: true as const,
      projectId: data.projectId,
      moduleKey: data.moduleKey,
      appliedVersion: module.version,
      resetAt: now,
    };
  });

export const getHarborDemoModuleStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) => projectIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: projectRow, error: projectError } = await context.supabase
      .from("projects")
      .select("id,name,client,job_number,archived_at")
      .eq("id", data.projectId)
      .maybeSingle();
    if (projectError) throw new Error(projectError.message);
    if (!projectRow || !isHarborDemoProject(projectRow as Record<string, unknown>)) {
      throw new Error("Demo module status is only available for Harbor Residence.");
    }

    const { data: rows, error } = await dynamicTable(context.supabase, "demo_seed_module_versions")
      .select("module_key,applied_version,status")
      .eq("project_id", data.projectId);
    if (error) {
      if (isDemoSeedModuleVersionsSchemaError(error)) {
        return {
          projectId: data.projectId,
          registryAvailable: false,
          optedOut: Boolean(projectRow.archived_at),
          modules: planHarborDemoModules([]),
        };
      }
      throw new Error(error.message);
    }

    return {
      projectId: data.projectId,
      registryAvailable: true,
      optedOut: Boolean(projectRow.archived_at),
      modules: planHarborDemoModules(
        (rows ?? []) as Array<{
          module_key: string;
          applied_version: number;
          status: "ready" | "failed";
        }>,
      ),
    };
  });

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

    // Both lookups deliberately INCLUDE archived rows: an archived demo
    // project is the "this company opted out" signal — seed and top up
    // nothing, for any of the demo artifacts.
    const { data: existingDemo, error: demoLookupError } = await context.supabase
      .from("projects")
      .select("id,archived_at")
      .eq("organization_id", organizationId)
      .eq("job_number", HARBOR_DEMO_JOB_NUMBER)
      .maybeSingle();
    if (demoLookupError) throw new Error(demoLookupError.message);
    if (existingDemo?.id) {
      if (harborDemoSeedAction(existingDemo) === "skip") {
        return {
          seeded: false as const,
          exists: true,
          optedOut: true,
          demoProjectId: existingDemo.id as string,
          seedWarnings,
        };
      }
      const demoEngine = await ensureVersionedHarborDemoModules(
        context.supabase,
        existingDemo.id as string,
        context.userId,
        seedWarnings,
      );
      return {
        seeded: false as const,
        exists: true,
        demoProjectId: existingDemo.id as string,
        seedWarnings,
        demoEngine,
      };
    }

    const { data: existingHarbor, error: harborLookupError } = await context.supabase
      .from("projects")
      .select("id,archived_at")
      .eq("organization_id", organizationId)
      .eq("name", HARBOR_DEMO_NAME)
      .eq("client", HARBOR_DEMO_CLIENT)
      .limit(1)
      .maybeSingle();
    if (harborLookupError) throw new Error(harborLookupError.message);
    if (existingHarbor?.id) {
      if (harborDemoSeedAction(existingHarbor) === "skip") {
        return {
          seeded: false as const,
          exists: true,
          optedOut: true,
          demoProjectId: existingHarbor.id as string,
          seedWarnings,
        };
      }
      const demoEngine = await ensureVersionedHarborDemoModules(
        context.supabase,
        existingHarbor.id as string,
        context.userId,
        seedWarnings,
      );
      return {
        seeded: false as const,
        exists: true,
        demoProjectId: existingHarbor.id as string,
        seedWarnings,
        demoEngine,
      };
    }

    const projectHeader = {
      job_number: HARBOR_DEMO_JOB_NUMBER,
      name: HARBOR_DEMO_NAME,
      client: HARBOR_DEMO_CLIENT,
      project_manager: HARBOR_DEMO_PROJECT_MANAGER,
      original_contract: 3200000,
      original_cost_budget: 2720000,
      phase: "Middle" as const,
      baseline_completion_date: "2026-05-16",
      forecast_completion_date: "2026-06-30",
      schedule_variance_weeks: 6,
    };

    const { data: projectCommand, error: projectError } = await dynamicRpc(
      context.supabase,
      "create_project_financial_atomic",
      {
        p_organization_id: organizationId,
        p_header: projectHeader,
        p_operation_key: `harbor-demo:${organizationId}:project:create:v1`,
      },
    );
    if (projectError?.code === "23505") {
      const { data: retryDemo, error: retryError } = await context.supabase
        .from("projects")
        .select("id,archived_at")
        .eq("organization_id", organizationId)
        .eq("job_number", HARBOR_DEMO_JOB_NUMBER)
        .maybeSingle();
      if (retryError) throw new Error(retryError.message);
      if (retryDemo?.id) {
        let demoEngine;
        if (harborDemoSeedAction(retryDemo) !== "skip") {
          demoEngine = await ensureVersionedHarborDemoModules(
            context.supabase,
            retryDemo.id as string,
            context.userId,
            seedWarnings,
          );
        }
        return {
          seeded: false as const,
          exists: true,
          optedOut: harborDemoSeedAction(retryDemo) === "skip",
          demoProjectId: retryDemo.id as string,
          seedWarnings,
          demoEngine,
        };
      }
    }
    throwIfProjectSchemaError(projectError);
    if (projectError) {
      if (/schema cache|could not find the function|does not exist/i.test(projectError.message)) {
        throw new Error(
          "Harbor project financial commands are still being enabled. No demo project was created; try again in a few minutes.",
        );
      }
      throw new Error(projectError.message);
    }
    const projectId = str((projectCommand as Record<string, unknown> | null)?.projectId);
    if (!projectId) throw new Error("Harbor demo project command returned no project identifier.");

    const { error: projectMetadataError } = await context.supabase
      .from("projects")
      .update({
        percent_complete: 60,
        hold_variance_note:
          "Demo note: E-Hold and C-Hold levels are carried so the IOR shows how active risk protects gross profit.",
        last_reviewed_at: "2026-06-11T17:48:00.000Z",
        next_review_at: "2026-06-25T17:00:00.000Z",
        last_review_summary:
          "Project remains on budget before holds, but a six-week schedule slip and open exposure ledger are actively eroding indicated gross profit.",
      })
      .eq("id", projectId);
    if (projectMetadataError) throw new Error(projectMetadataError.message);

    // create_project_financial_atomic establishes six cent-balanced defaults.
    // Convert those placeholders through audited budget commands rather than
    // bypassing authority with raw project/bucket inserts.
    await ensureHarborDemoBudgetSov(context.supabase, projectId, true, "seed:v1");

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

    const changeOrderIdByNumber = new Map<string, string>();
    for (const [index, changeOrder] of harborDemoChangeOrders.entries()) {
      const changeOrderId = await createHarborDemoChangeOrder(
        context.supabase,
        projectId,
        changeOrder,
        index,
      );
      changeOrderIdByNumber.set(changeOrder.number, changeOrderId);
    }

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

    const { data: billingApplicationCommand, error: billingError } = await dynamicRpc(
      context.supabase,
      "create_billing_application_atomic",
      {
        p_project_id: projectId,
        p_idempotency_key: `harbor-demo:${projectId}:legacy-pay-app-1:create`,
        p_payload: {
          application_number: "Pay App 1",
          invoice_number: "DEMO-2601-1",
          submitted_date: "2026-06-21",
          due_date: "2026-07-21",
          billing_period: "Current cycle",
          contract_amount: 3461250,
          change_order_amount: 65000,
          amount_billed: 2120250,
          paid_to_date: 0,
          retainage: 212025,
          status: "draft",
          output_format: "invoice",
          notes: "Demo pay application shared to show client-facing billing posture.",
        },
      },
    );
    if (billingError) throw new Error(billingError.message);
    const billingApplicationId = str(
      (billingApplicationCommand as Record<string, unknown>)?.billingApplicationId,
    );
    if (!billingApplicationId) throw new Error("Demo pay application did not return an id.");
    const { error: billingSubmitError } = await dynamicRpc(
      context.supabase,
      "transition_billing_application_atomic",
      {
        p_billing_application_id: billingApplicationId,
        p_to_status: "submitted",
        p_reason: "Demo pay application opened for client-facing billing posture.",
        p_idempotency_key: `harbor-demo:${projectId}:legacy-pay-app-1:submit`,
      },
    );
    if (billingSubmitError) throw new Error(billingSubmitError.message);

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

    const demoEngine = await ensureVersionedHarborDemoModules(
      context.supabase,
      projectId,
      context.userId,
      seedWarnings,
    );

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

    return {
      seeded: true as const,
      exists: true,
      demoProjectId: projectId,
      seedWarnings,
      demoEngine,
    };
  });
