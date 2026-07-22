// Pay-application builder progression (GETTINGPAID3 Task 0).
//
// The AIA path guides instead of hides: every step is always present, and
// each affordance is either actionable or disabled-with-reason — never
// absent. This pure module is the single source of truth for what blocks
// what, so the UI and the tests agree on the gate. (The GETTINGPAID1 gap:
// the Download AIA action only appeared after Import-from-SOV, with nothing
// to explain the invisible prerequisite.)

export type AiaStepKey = "format" | "sov" | "entries" | "bill";
export type AiaStepStatus = "done" | "active" | "todo";

export interface AiaBuilderSnapshot {
  outputFormat: "invoice" | "aia_g702";
  lineCount: number; // SOV lines imported onto the application
  linesWithActivity: number; // lines carrying this-period work or stored material
  overbilledCount: number; // lines over 100% (soft warning, not a gate)
  // The G702/G703 was downloaded/emailed this session — ephemeral. It no longer
  // gates billing (the owner's bill and its printed copy are one step now); it
  // only lets the download affordance read "downloaded" once the biller has one.
  hasGenerated?: boolean;
  // An active invoice already exists for this application (persisted via
  // billing_invoices.billing_application_id). It may still require review and
  // the explicit Send action before it becomes a client receivable.
  hasInvoice?: boolean;
}

export interface AiaGenerateGate {
  ready: boolean;
  // Where an out-of-sequence generate click should route instead of no-oping.
  blockingStep: AiaStepKey;
  // Inline reason shown on the disabled action; "" when ready.
  reason: string;
}

// Billing the owner requires AIA output and at least one imported line. A
// zero-period application is explicitly valid (a $0 this-period certificate
// is a real filing), so this-period entries are NOT a prerequisite. The gate
// is shared by the "Bill the owner" action and its G702/G703 download.
export function aiaGenerateGate(snapshot: AiaBuilderSnapshot): AiaGenerateGate {
  if (snapshot.outputFormat !== "aia_g702") {
    return {
      ready: false,
      blockingStep: "format",
      reason:
        "Set this application's output to AIA G702/G703 to bill from the formal package. Plain invoices are sent from Invoices & Payments.",
    };
  }
  if (snapshot.lineCount <= 0) {
    return {
      ready: false,
      blockingStep: "sov",
      reason:
        "Import your schedule of values first — the G703 continuation sheet is built from these lines.",
    };
  }
  return { ready: true, blockingStep: "bill", reason: "" };
}

export interface AiaStepView {
  key: AiaStepKey;
  title: string;
  status: AiaStepStatus;
  detail: string;
}

// Step statuses for the always-visible checklist. "active" marks the step
// the biller should act on next; earlier satisfied steps read "done".
export function aiaBuilderSteps(snapshot: AiaBuilderSnapshot): AiaStepView[] {
  const isAia = snapshot.outputFormat === "aia_g702";
  const hasLines = snapshot.lineCount > 0;
  const gate = aiaGenerateGate(snapshot);

  const formatStep: AiaStepView = {
    key: "format",
    title: "Output format",
    status: "done", // a format is always selected
    detail: isAia ? "AIA G702/G703 selected" : "Client invoice selected",
  };
  const sovStep: AiaStepView = {
    key: "sov",
    title: "Schedule of values",
    status: hasLines ? "done" : gate.blockingStep === "sov" ? "active" : "todo",
    detail: hasLines
      ? `${snapshot.lineCount} line${snapshot.lineCount === 1 ? "" : "s"} imported`
      : "Import from SOV to build the continuation sheet",
  };
  const entriesStep: AiaStepView = {
    key: "entries",
    title: "This-period entries",
    status: !hasLines ? "todo" : snapshot.linesWithActivity > 0 ? "done" : "active",
    detail: !hasLines
      ? "Available after the schedule of values is imported"
      : snapshot.linesWithActivity > 0
        ? `${snapshot.linesWithActivity} of ${snapshot.lineCount} line${
            snapshot.lineCount === 1 ? "" : "s"
          } with activity this period`
        : "No activity yet — a zero-period application is allowed",
  };
  // The one terminal step: bill the owner. The pay application IS the owner's
  // bill (the G702 is literally the "Application and Certificate for Payment"),
  // so there is no separate "certify" or "create invoice" step — you bill from
  // the application in one action, and download/email the G702/G703 as its
  // printed copy before or after. "done" once the invoice exists (persisted),
  // "active" as soon as the application is ready to bill. Sending the invoice to
  // the client stays a separate, recipient-confirmed step in Receivables.
  const invoiced = Boolean(snapshot.hasInvoice);
  const billStep: AiaStepView = {
    key: "bill",
    title: "Bill the owner",
    status: invoiced ? "done" : gate.ready ? "active" : "todo",
    detail: invoiced
      ? "Owner billed — the invoice is in Receivables to review and send"
      : gate.ready
        ? snapshot.overbilledCount > 0
          ? `Ready to bill — ${snapshot.overbilledCount} line${
              snapshot.overbilledCount === 1 ? "" : "s"
            } over 100%, confirm on billing`
          : "Bill the owner from this application; the G702/G703 is its printed copy"
        : gate.reason,
  };

  return [formatStep, sovStep, entriesStep, billStep];
}
