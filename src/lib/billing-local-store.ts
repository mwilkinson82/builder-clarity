// Local (pre-persistence) billing-application store and normalizers.
//
// Before the billing_applications table existed — and still, as a fallback on
// environments where that table is missing — pay applications live in
// localStorage. These pure helpers create, normalize, sort, read, and write
// those local records. Extracted verbatim from the project route during the
// PROJECTDECOMP1 mechanical split; no behavior change.
import { normalizeBillingNumberLabel } from "@/lib/billing-labels";
import type {
  BillingApplicationRow,
  BillingApplicationEventRow,
  BillingInvoiceRow,
} from "@/lib/projects.functions";

export type BillingDraft = Omit<BillingApplicationRow, "id" | "project_id" | "status_events">;

export type InvoiceDraft = Omit<
  BillingInvoiceRow,
  | "id"
  | "project_id"
  | "payment_events"
  | "created_at"
  | "updated_at"
  | "sent_at"
  | "paid_at"
  | "payment_enabled"
  | "payment_url"
  | "stripe_checkout_session_id"
  | "stripe_payment_intent_id"
  | "online_payment_status"
  | "payment_link_sent_at"
>;

export const LOCAL_BILLING_ID_PREFIX = "local-pay-app-";
export const BILLING_STATUS_VALUES = ["draft", "submitted", "paid", "partial", "rejected"] as const;

export function isBillingStatus(value: unknown): value is BillingApplicationRow["status"] {
  return typeof value === "string" && BILLING_STATUS_VALUES.includes(value as never);
}

export function isMissingBillingApplicationsTableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /billing_applications|schema cache/i.test(message);
}

export function makeLocalBillingId() {
  const randomId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${LOCAL_BILLING_ID_PREFIX}${randomId}`;
}

export function makeLocalBillingEvent(
  projectId: string,
  billingApplicationId: string,
  input: {
    event_type: string;
    from_status?: string;
    to_status?: string;
    amount?: number;
    notes?: string;
  },
): BillingApplicationEventRow {
  const randomId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id: `local-billing-event-${randomId}`,
    billing_application_id: billingApplicationId,
    project_id: projectId,
    event_type: input.event_type,
    from_status: input.from_status ?? "",
    to_status: input.to_status ?? "",
    amount: input.amount ?? 0,
    notes: input.notes ?? "",
    created_by: null,
    created_at: new Date().toISOString(),
  };
}

export function billingString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function billingNumber(value: unknown) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

export function billingDate(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function sortBillingApplications(apps: BillingApplicationRow[]) {
  return [...apps].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
}

export function makeLocalBillingApplication(
  projectId: string,
  input: BillingDraft,
): BillingApplicationRow {
  const id = makeLocalBillingId();
  return {
    id,
    project_id: projectId,
    application_number: normalizeBillingNumberLabel(input.application_number),
    invoice_number: normalizeBillingNumberLabel(input.invoice_number),
    submitted_date: input.submitted_date || null,
    due_date: input.due_date || null,
    billing_period: input.billing_period,
    contract_amount: input.contract_amount,
    change_order_amount: input.change_order_amount,
    amount_billed: input.amount_billed,
    paid_to_date: input.paid_to_date,
    retainage: input.retainage,
    has_line_detail: input.has_line_detail,
    total_retainage_held: input.total_retainage_held,
    retainage_released_this_period: input.retainage_released_this_period,
    status: input.status,
    output_format: input.output_format,
    notes: input.notes,
    sort_order: input.sort_order,
    status_events: [
      makeLocalBillingEvent(projectId, id, {
        event_type: "created",
        from_status: "",
        to_status: input.status,
        amount: input.amount_billed,
        notes: input.notes || "Application created locally.",
      }),
    ],
  };
}

export function normalizeStoredBillingEvent(
  projectId: string,
  billingApplicationId: string,
  raw: unknown,
): BillingApplicationEventRow | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = billingString(record.id);
  return {
    id: id || `local-billing-event-${Date.now()}`,
    billing_application_id: billingString(record.billing_application_id, billingApplicationId),
    project_id: billingString(record.project_id, projectId),
    event_type: billingString(record.event_type, "status_change"),
    from_status: billingString(record.from_status),
    to_status: billingString(record.to_status),
    amount: billingNumber(record.amount),
    notes: billingString(record.notes),
    created_by: typeof record.created_by === "string" ? record.created_by : null,
    created_at: billingString(record.created_at, new Date().toISOString()),
  };
}

export function normalizeStoredBillingApplication(
  projectId: string,
  raw: unknown,
): BillingApplicationRow | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = billingString(record.id);
  const normalizedId = id.startsWith(LOCAL_BILLING_ID_PREFIX) ? id : makeLocalBillingId();
  return {
    id: normalizedId,
    project_id: projectId,
    application_number: normalizeBillingNumberLabel(
      billingString(record.application_number, "Application"),
    ),
    invoice_number: normalizeBillingNumberLabel(billingString(record.invoice_number)),
    submitted_date: billingDate(record.submitted_date),
    due_date: billingDate(record.due_date),
    billing_period: billingString(record.billing_period),
    contract_amount: billingNumber(record.contract_amount),
    change_order_amount: billingNumber(record.change_order_amount),
    amount_billed: billingNumber(record.amount_billed),
    paid_to_date: billingNumber(record.paid_to_date),
    retainage: billingNumber(record.retainage),
    has_line_detail: Boolean(record.has_line_detail ?? false),
    total_retainage_held: billingNumber(record.total_retainage_held),
    retainage_released_this_period: billingNumber(record.retainage_released_this_period),
    status: isBillingStatus(record.status) ? record.status : "draft",
    output_format: billingString(record.output_format) === "aia_g702" ? "aia_g702" : "invoice",
    notes: billingString(record.notes),
    sort_order: billingNumber(record.sort_order),
    status_events: Array.isArray(record.status_events)
      ? record.status_events
          .map((event) => normalizeStoredBillingEvent(projectId, normalizedId, event))
          .filter((event): event is BillingApplicationEventRow => Boolean(event))
      : [],
  };
}

export function localBillingStorageKey(projectId: string) {
  return `ior:billing-applications:${projectId}`;
}

export function readLocalBillingApplications(projectId: string) {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(localBillingStorageKey(projectId)) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return sortBillingApplications(
      parsed
        .map((app) => normalizeStoredBillingApplication(projectId, app))
        .filter((app): app is BillingApplicationRow => Boolean(app)),
    );
  } catch {
    return [];
  }
}

export function writeLocalBillingApplications(projectId: string, apps: BillingApplicationRow[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(localBillingStorageKey(projectId), JSON.stringify(apps));
}
