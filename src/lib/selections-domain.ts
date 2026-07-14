export type SelectionDecisionStatus = "draft" | "sent" | "revision_requested" | "approved";
export type SelectionProcurementStatus =
  "not_released" | "ordered" | "shipped" | "received" | "installed" | "not_required";

export type SelectionRfiOutcome =
  "direct_release" | "requires_submittal" | "requires_client_selection" | "no_procurement";

export interface SelectionDateInputs {
  needOnSiteDate: string | null;
  procurementLeadDays: number;
  deliveryBufferDays: number;
  clientReviewDays: number;
  upstreamReviewDays?: number;
}

export interface SelectionDates {
  needOnSiteDate: string | null;
  orderByDate: string | null;
  clientDecisionDueDate: string | null;
  followOnApprovalDueDate: string | null;
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
    return {
      needOnSiteDate: null,
      orderByDate: null,
      clientDecisionDueDate: null,
      followOnApprovalDueDate: null,
    };
  }
  const orderBy = new Date(
    needOnSite.getTime() -
      (clampDays(input.procurementLeadDays) + clampDays(input.deliveryBufferDays)) * DAY_MS,
  );
  const followOnApprovalDue = new Date(
    orderBy.getTime() - clampDays(input.clientReviewDays) * DAY_MS,
  );
  const decisionDue = new Date(
    followOnApprovalDue.getTime() - clampDays(input.upstreamReviewDays ?? 0) * DAY_MS,
  );
  return {
    needOnSiteDate: formatDateOnly(needOnSite),
    orderByDate: formatDateOnly(orderBy),
    clientDecisionDueDate: formatDateOnly(decisionDue),
    followOnApprovalDueDate:
      clampDays(input.upstreamReviewDays ?? 0) > 0 ? formatDateOnly(followOnApprovalDue) : null,
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

export function procurementReleaseAllowed(
  decisionStatus: SelectionDecisionStatus,
  nextStatus: SelectionProcurementStatus,
) {
  return nextStatus === "not_released" || decisionStatus === "approved";
}

export function approvalGateDecisionStatus(status: string): SelectionDecisionStatus {
  if (status === "a" || status === "aan") return "approved";
  if (status === "rar") return "revision_requested";
  return "sent";
}

export function rfiProcurementDecisionStatus(input: {
  rfiStatus: string;
  outcome: SelectionRfiOutcome;
  followOnSubmittalStatus?: string | null;
  clientDecisionStatus?: SelectionDecisionStatus;
}): SelectionDecisionStatus {
  const rfiDecision = approvalGateDecisionStatus(input.rfiStatus);
  if (rfiDecision !== "approved") return rfiDecision;

  if (input.outcome === "requires_submittal") {
    return input.followOnSubmittalStatus
      ? approvalGateDecisionStatus(input.followOnSubmittalStatus)
      : "draft";
  }
  if (input.outcome === "requires_client_selection") {
    return input.clientDecisionStatus ?? "draft";
  }
  return "approved";
}
