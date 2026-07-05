// Billing money surfaces always render exact cents. Whole-dollar rounding on
// billing displays hid a fractional-cent invoice defect during founder QA
// (invoice 2601-001); drift must never be able to hide behind rounding again.
// Whole-dollar style stays only on surfaces whose values are verified whole.
import type {
  BillingApplicationRow,
  BillingApplicationEventRow,
  BillingInvoiceRow,
} from "@/lib/projects.functions";

export const fmtUSDCents = (n: number, opts: { sign?: boolean } = {}) => {
  const formatted = Math.abs(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (opts.sign && n > 0) return `+${formatted}`;
  if (n < 0) return `−${formatted}`;
  return formatted;
};

// Billing presentation helpers (labels, date formatting, aging status) shared
// by the billing workspace and the row editors. Extracted verbatim from the
// project route during the PROJECTDECOMP1 split.
export function billingEventLabel(event: BillingApplicationEventRow) {
  if (event.event_type === "created") return `Created as ${event.to_status || "draft"}`;
  if (event.event_type === "payment_update") return `Payment updated ${fmtUSDCents(event.amount)}`;
  if (event.from_status && event.to_status) {
    return `${event.from_status} to ${event.to_status}`;
  }
  return event.to_status || event.event_type;
}

export function invoiceStatusLabel(status: BillingInvoiceRow["status"]) {
  if (status === "partially_paid") return "Partial";
  return status.replace("_", " ");
}

function parseBillingDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatBillingDate(value?: string | null) {
  const date = parseBillingDate(value);
  if (!date) return "Not set";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function daysBetween(start: Date, end: Date) {
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  return Math.round((endDay - startDay) / 86_400_000);
}

export function payAppAgingStatus(app: BillingApplicationRow, openReceivable: number) {
  const submittedDate = parseBillingDate(app.submitted_date);
  const dueDate = parseBillingDate(app.due_date);
  const today = new Date();
  const submittedAge = submittedDate ? Math.max(0, daysBetween(submittedDate, today)) : null;

  if (openReceivable <= 0) {
    return {
      label: "Clear",
      detail: "No open A/R",
      className: "border-success/30 bg-success/10 text-success",
    };
  }

  if (dueDate) {
    const dueDelta = daysBetween(dueDate, today);
    if (dueDelta > 0) {
      return {
        label:
          dueDelta >= 90
            ? "90+ days past due"
            : `${dueDelta} ${dueDelta === 1 ? "day" : "days"} past due`,
        detail:
          submittedAge === null
            ? "Aged from due date"
            : `Submitted ${submittedAge} ${submittedAge === 1 ? "day" : "days"} ago`,
        className:
          dueDelta >= 60
            ? "border-danger/30 bg-danger/10 text-danger"
            : "border-warning/30 bg-warning/10 text-warning",
      };
    }
    return {
      label:
        dueDelta === 0
          ? "Due today"
          : `Due in ${Math.abs(dueDelta)} ${Math.abs(dueDelta) === 1 ? "day" : "days"}`,
      detail:
        submittedAge === null
          ? "Not past due"
          : `Submitted ${submittedAge} ${submittedAge === 1 ? "day" : "days"} ago`,
      className: "border-hairline bg-card text-foreground",
    };
  }

  if (submittedAge !== null) {
    return {
      label: `Submitted ${submittedAge} ${submittedAge === 1 ? "day" : "days"} ago`,
      detail: "No due date set",
      className: "border-warning/30 bg-warning/10 text-warning",
    };
  }

  return {
    label: "No aging dates",
    detail: "Add submitted and due dates",
    className: "border-hairline bg-card text-muted-foreground",
  };
}

export function invoiceAgingStatus(invoice: BillingInvoiceRow, openBalance: number) {
  const issueDate = parseBillingDate(invoice.issue_date);
  const dueDate = parseBillingDate(invoice.due_date);
  const today = new Date();
  const issueAge = issueDate ? Math.max(0, daysBetween(issueDate, today)) : null;

  if (invoice.status === "void") {
    return {
      label: "Void",
      detail: "Not collectible",
      className: "border-hairline bg-card text-muted-foreground",
    };
  }

  if (openBalance <= 0 || invoice.status === "paid") {
    return {
      label: "Clear",
      detail: "No open balance",
      className: "border-success/30 bg-success/10 text-success",
    };
  }

  if (dueDate) {
    const dueDelta = daysBetween(dueDate, today);
    if (dueDelta > 0) {
      return {
        label:
          dueDelta >= 90
            ? "90+ days past due"
            : `${dueDelta} ${dueDelta === 1 ? "day" : "days"} past due`,
        detail:
          issueAge === null
            ? "Aged from due date"
            : `Issued ${issueAge} ${issueAge === 1 ? "day" : "days"} ago`,
        className:
          dueDelta >= 60
            ? "border-danger/30 bg-danger/10 text-danger"
            : "border-warning/30 bg-warning/10 text-warning",
      };
    }
    return {
      label:
        dueDelta === 0
          ? "Due today"
          : `Due in ${Math.abs(dueDelta)} ${Math.abs(dueDelta) === 1 ? "day" : "days"}`,
      detail:
        issueAge === null
          ? "Not past due"
          : `Issued ${issueAge} ${issueAge === 1 ? "day" : "days"} ago`,
      className: "border-hairline bg-card text-foreground",
    };
  }

  if (issueAge !== null) {
    return {
      label: `Issued ${issueAge} ${issueAge === 1 ? "day" : "days"} ago`,
      detail: "No due date set",
      className: "border-warning/30 bg-warning/10 text-warning",
    };
  }

  return {
    label: "No aging dates",
    detail: "Add issue and due dates",
    className: "border-hairline bg-card text-muted-foreground",
  };
}
