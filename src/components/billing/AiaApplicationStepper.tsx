// The pay-application builder stepper (GETTINGPAID3 Task 0/1).
//
// Every step is always visible; each action is actionable or disabled-with-
// reason, never absent. Out-of-sequence generate clicks route to the
// blocking step instead of no-oping, and generation with overbilled lines
// requires one explicit confirm.
import { useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Download,
  FileText,
  Mail,
  ReceiptText,
  Wand2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  aiaBuilderSteps,
  aiaGenerateGate,
  type AiaBuilderSnapshot,
  type AiaStepKey,
  type AiaStepView,
} from "@/lib/aia-builder-steps";
import { overbilledLineMessage, type OverbilledLine } from "@/lib/aia-math";
import type { BillingOutputFormat } from "@/lib/projects.functions";

interface AiaApplicationStepperProps {
  snapshot: AiaBuilderSnapshot;
  overbilled: OverbilledLine[];
  onSetOutputFormat: (format: BillingOutputFormat) => void;
  onImportSov: () => void;
  onGenerate: () => void;
  onEmail?: () => void;
  // Close the loop: turn this generated application into a controlled invoice
  // draft. The biller reviews and sends it from Invoices before A/R aging starts.
  onBillOwner?: () => void;
  onViewReceivables?: () => void;
  billableAmountLabel?: string; // e.g. "$23,858.27" — shown on the create-invoice button
  invoiceExists?: boolean; // an active invoice already exists for this application
  canImport: boolean;
  generating?: boolean;
  emailing?: boolean;
  savingInvoice?: boolean;
  savingFormat?: boolean;
}

function StepIcon({ status }: { status: AiaStepView["status"] }) {
  if (status === "done") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground">
        <Check className="h-3.5 w-3.5" />
      </span>
    );
  }
  const tone =
    status === "active"
      ? "border-accent bg-accent/15 text-accent-foreground"
      : "border-hairline bg-surface text-muted-foreground";
  return (
    <span
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${tone}`}
    >
      {status === "active" ? "→" : "•"}
    </span>
  );
}

export function AiaApplicationStepper({
  snapshot,
  overbilled,
  onSetOutputFormat,
  onImportSov,
  onGenerate,
  onEmail,
  onBillOwner,
  onViewReceivables,
  billableAmountLabel,
  invoiceExists,
  canImport,
  generating,
  emailing,
  savingInvoice,
  savingFormat,
}: AiaApplicationStepperProps) {
  const steps = aiaBuilderSteps(snapshot);
  const gate = aiaGenerateGate(snapshot);
  const isAia = snapshot.outputFormat === "aia_g702";
  const hasLines = snapshot.lineCount > 0;
  const stepRefs = useRef<Partial<Record<AiaStepKey, HTMLLIElement | null>>>({});
  const [routedStep, setRoutedStep] = useState<AiaStepKey | null>(null);
  // Download and Bill each carry their OWN overbilled acknowledgment. They are
  // co-located in the one bill step, so a single shared flag would let arming
  // one action (e.g. clicking Download) silently pre-confirm the other and
  // commit an overbilled receivable on a single Bill click. Keep them separate,
  // and the parent remounts this stepper per pay-app so neither flag bleeds
  // across applications.
  const [confirmDownloadOverbilled, setConfirmDownloadOverbilled] = useState(false);
  const [confirmBillOverbilled, setConfirmBillOverbilled] = useState(false);

  // An out-of-sequence generate click routes to the blocking step instead of
  // silently doing nothing.
  const routeToBlockingStep = () => {
    const key = gate.blockingStep;
    setRoutedStep(key);
    stepRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => setRoutedStep((current) => (current === key ? null : current)), 1600);
  };

  const handleGenerate = () => {
    if (!gate.ready) {
      routeToBlockingStep();
      return;
    }
    if (overbilled.length > 0 && !confirmDownloadOverbilled) {
      setConfirmDownloadOverbilled(true);
      return;
    }
    setConfirmDownloadOverbilled(false);
    onGenerate();
  };

  // Billing the owner is the one terminal action. It carries its own overbilled
  // guard (one explicit confirm on the bill button itself), since billing
  // commits the numbers to a client receivable.
  const handleBill = () => {
    if (!onBillOwner) return;
    if (!gate.ready) {
      routeToBlockingStep();
      return;
    }
    if (overbilled.length > 0 && !confirmBillOverbilled) {
      setConfirmBillOverbilled(true);
      return;
    }
    setConfirmBillOverbilled(false);
    onBillOwner();
  };

  const stepAction = (key: AiaStepKey) => {
    switch (key) {
      case "format":
        return (
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={isAia ? "outline" : "default"}
              className="gap-1.5"
              disabled={savingFormat || !isAia}
              onClick={() => onSetOutputFormat("invoice")}
            >
              <FileText className="h-3.5 w-3.5" /> Client invoice
            </Button>
            <Button
              type="button"
              size="sm"
              variant={isAia ? "default" : "outline"}
              className="gap-1.5"
              disabled={savingFormat || isAia}
              onClick={() => onSetOutputFormat("aia_g702")}
            >
              <FileText className="h-3.5 w-3.5" /> AIA G702/G703
            </Button>
          </div>
        );
      case "sov":
        return (
          <div className="flex flex-col items-start gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={!canImport || hasLines}
              onClick={onImportSov}
            >
              <Wand2 className="h-3.5 w-3.5" />
              {hasLines ? "Imported from SOV" : "Import from SOV"}
            </Button>
            {hasLines ? (
              <span className="text-[11px] text-muted-foreground">
                Re-import is locked once lines exist — edit lines below, or delete the application
                to start over.
              </span>
            ) : null}
            {/* BILLING P1c: the SOV is the contract schedule you bill from, not
                your cost budget — importing from the budget seeds it at cost, so
                cue the biller to bill contract amounts, not under-bill at cost. */}
            <span className="text-[11px] text-muted-foreground">
              This is what you bill the owner — set it to your{" "}
              <span className="font-medium text-foreground">contract schedule of values</span>, not
              your cost budget.
            </span>
          </div>
        );
      case "entries":
        return (
          <span className="text-xs text-muted-foreground">
            Enter percent complete or stored materials on the lines below.
          </span>
        );
      case "bill": {
        // The G702/G703 is the printed face of the owner's bill — download or
        // email it before or after billing. It no longer gates billing.
        const downloadLabel = generating
          ? "Preparing..."
          : confirmDownloadOverbilled
            ? "Confirm & download anyway"
            : snapshot.hasGenerated
              ? "Download G702/G703 again"
              : "Download AIA G702/G703";
        const printedCopy = (
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={`gap-1.5 ${gate.ready ? "" : "opacity-70"}`}
                aria-disabled={!gate.ready}
                disabled={generating}
                onClick={handleGenerate}
              >
                <Download className="h-3.5 w-3.5" />
                {downloadLabel}
              </Button>
              {onEmail ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  aria-disabled={!gate.ready}
                  disabled={!gate.ready || emailing}
                  onClick={onEmail}
                >
                  <Mail className="h-3.5 w-3.5" />
                  {emailing ? "Emailing..." : "Email to client"}
                </Button>
              ) : null}
            </div>
            {confirmDownloadOverbilled ? (
              <span className="text-[11px] text-warning">
                {overbilled.length} line{overbilled.length === 1 ? "" : "s"} over 100% — click
                Download again to download as-is.
              </span>
            ) : null}
          </div>
        );

        // An invoice exists → the owner has been billed. It may still be a
        // draft; sending it stays an explicit, recipient-confirmed command.
        if (invoiceExists) {
          return (
            <div className="flex flex-col items-start gap-1.5 sm:items-end">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                <Check className="h-3.5 w-3.5" /> Owner billed
              </span>
              {printedCopy}
              {onViewReceivables ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 text-[11px] font-medium text-accent-foreground underline"
                  onClick={onViewReceivables}
                >
                  View in Receivables <ArrowRight className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          );
        }

        // Not yet billed → one primary action turns this application into the
        // owner's bill. Available as soon as it's ready (AIA + lines); no
        // download-first dance. The printed G702/G703 sits right beside it.
        const canBill = Boolean(onBillOwner) && gate.ready;
        return (
          <div className="flex flex-col items-start gap-1.5 sm:items-end">
            <Button
              type="button"
              size="sm"
              variant={canBill ? "default" : "outline"}
              className={`gap-1.5 ${canBill ? "" : "opacity-70"}`}
              aria-disabled={!canBill}
              disabled={!canBill || savingInvoice}
              onClick={handleBill}
            >
              <ReceiptText className="h-3.5 w-3.5" />
              {savingInvoice
                ? "Billing..."
                : confirmBillOverbilled
                  ? `Confirm & bill anyway${billableAmountLabel ? ` — ${billableAmountLabel}` : ""}`
                  : `Bill the owner${billableAmountLabel ? ` — ${billableAmountLabel}` : ""}`}
            </Button>
            {printedCopy}
            {!gate.ready ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                {gate.reason}
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 font-medium text-accent-foreground underline"
                  onClick={routeToBlockingStep}
                >
                  Go to step <ArrowRight className="h-3 w-3" />
                </button>
              </span>
            ) : confirmBillOverbilled ? (
              <span className="text-[11px] text-warning">
                {overbilled.length} line{overbilled.length === 1 ? "" : "s"} over 100% — click Bill
                the owner again to bill as-is.
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                Review and send the invoice from Receivables to start A/R aging.
              </span>
            )}
          </div>
        );
      }
    }
  };

  return (
    <div className="rounded-md border border-hairline bg-surface p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Build this application
      </div>
      <ol className="mt-3 space-y-2.5">
        {steps.map((step, index) => (
          <li
            key={step.key}
            ref={(node) => {
              stepRefs.current[step.key] = node;
            }}
            className={`rounded-md border p-3 transition ${
              routedStep === step.key
                ? "border-accent bg-accent/10 ring-1 ring-accent/40"
                : "border-hairline bg-card"
            }`}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5">
                <StepIcon status={step.status} />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    {index + 1}. {step.title}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{step.detail}</div>
                </div>
              </div>
              <div className="sm:ml-3 sm:shrink-0">{stepAction(step.key)}</div>
            </div>
          </li>
        ))}
      </ol>

      {isAia && overbilled.length > 0 ? (
        <div className="mt-3 rounded-md border border-warning/30 bg-warning/10 p-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-warning">
            <AlertTriangle className="h-3.5 w-3.5" />
            Overbilled lines ({overbilled.length})
          </div>
          <ul className="mt-1.5 space-y-1 text-[11px] text-warning">
            {overbilled.map((line) => (
              <li key={line.item}>{overbilledLineMessage(line)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
