// The pay-application builder stepper (GETTINGPAID3 Task 0/1).
//
// Every step is always visible; each action is actionable or disabled-with-
// reason, never absent. Out-of-sequence generate clicks route to the
// blocking step instead of no-oping, and generation with overbilled lines
// requires one explicit confirm.
import { useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Check, Download, FileText, Mail, Wand2 } from "lucide-react";

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
  canImport: boolean;
  generating?: boolean;
  emailing?: boolean;
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
  canImport,
  generating,
  emailing,
  savingFormat,
}: AiaApplicationStepperProps) {
  const steps = aiaBuilderSteps(snapshot);
  const gate = aiaGenerateGate(snapshot);
  const isAia = snapshot.outputFormat === "aia_g702";
  const hasLines = snapshot.lineCount > 0;
  const stepRefs = useRef<Partial<Record<AiaStepKey, HTMLLIElement | null>>>({});
  const [routedStep, setRoutedStep] = useState<AiaStepKey | null>(null);
  const [confirmOverbilled, setConfirmOverbilled] = useState(false);

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
    if (overbilled.length > 0 && !confirmOverbilled) {
      setConfirmOverbilled(true);
      return;
    }
    setConfirmOverbilled(false);
    onGenerate();
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
      case "generate":
        return (
          <div className="flex flex-col items-start gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant={gate.ready ? "default" : "outline"}
                className={`gap-1.5 ${gate.ready ? "" : "opacity-70"}`}
                aria-disabled={!gate.ready}
                disabled={generating}
                onClick={handleGenerate}
              >
                <Download className="h-3.5 w-3.5" />
                {generating
                  ? "Generating..."
                  : confirmOverbilled
                    ? "Confirm & download anyway"
                    : "Download AIA G702/G703"}
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
            ) : confirmOverbilled ? (
              <span className="text-[11px] text-warning">
                {overbilled.length} line{overbilled.length === 1 ? "" : "s"} over 100% — click again
                to generate the package as-is.
              </span>
            ) : null}
          </div>
        );
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
