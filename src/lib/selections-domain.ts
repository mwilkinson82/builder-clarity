export type SelectionDecisionStatus = "draft" | "sent" | "revision_requested" | "approved";
export type SelectionProcurementStatus =
  "not_released" | "ordered" | "shipped" | "received" | "installed";

export interface SelectionDateInputs {
  needOnSiteDate: string | null;
  procurementLeadDays: number;
  deliveryBufferDays: number;
  clientReviewDays: number;
}

export interface SelectionDates {
  needOnSiteDate: string | null;
  orderByDate: string | null;
  clientDecisionDueDate: string | null;
}

const DAY_MS = 86_400_000;

function parseDateOnly(value: string | null) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function clampDays(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

export function calculateSelectionDates(input: SelectionDateInputs): SelectionDates {
  const needOnSite = parseDateOnly(input.needOnSiteDate);
  if (!needOnSite) {
    return { needOnSiteDate: null, orderByDate: null, clientDecisionDueDate: null };
  }
  const orderBy = new Date(
    needOnSite.getTime() -
      (clampDays(input.procurementLeadDays) + clampDays(input.deliveryBufferDays)) * DAY_MS,
  );
  const decisionDue = new Date(orderBy.getTime() - clampDays(input.clientReviewDays) * DAY_MS);
  return {
    needOnSiteDate: formatDateOnly(needOnSite),
    orderByDate: formatDateOnly(orderBy),
    clientDecisionDueDate: formatDateOnly(decisionDue),
  };
}

export function selectionInstallDate(activity: {
  forecast_start_date: string | null;
  start_date: string | null;
  baseline_start_date: string | null;
}) {
  return (
    activity.forecast_start_date ?? activity.start_date ?? activity.baseline_start_date ?? null
  );
}

export function selectionDateHealth(dueDate: string | null, now = new Date()) {
  const due = parseDateOnly(dueDate);
  if (!due) return "unscheduled" as const;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.ceil((due.getTime() - today) / DAY_MS);
  if (days < 0) return "overdue" as const;
  if (days <= 7) return "due_soon" as const;
  return "on_track" as const;
}
