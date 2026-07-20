import { CheckCircle2, Circle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ActivationStep = {
  id: "drawings" | "scale" | "takeoff" | "worksheet";
  label: string;
  detail: string;
  complete: boolean;
  actionLabel: string;
  onAction: () => void;
};

export function EstimatorActivationChecklist({
  hasDrawings,
  hasScale,
  scaleVerified,
  scaleCheckCount,
  hasTakeoff,
  hasLinkedTakeoff,
  onOpenDrawings,
  onVerifyScale,
  onOpenAiMarkups,
  onOpenWorksheet,
  onHide,
}: {
  hasDrawings: boolean;
  hasScale: boolean;
  scaleVerified: boolean;
  scaleCheckCount: number;
  hasTakeoff: boolean;
  hasLinkedTakeoff: boolean;
  onOpenDrawings: () => void;
  onVerifyScale: () => void;
  onOpenAiMarkups: () => void;
  onOpenWorksheet: () => void;
  onHide: () => void;
}) {
  const steps: ActivationStep[] = [
    {
      id: "drawings",
      label: "Open a drawing",
      detail: "Choose the sheet where you want a trusted quantity.",
      complete: hasDrawings,
      actionLabel: hasDrawings ? "Drawings" : "Upload or open",
      onAction: onOpenDrawings,
    },
    {
      id: "scale",
      label: "Confirm this sheet's scale",
      detail: scaleVerified
        ? "Two independent dimensions agree on this sheet."
        : hasScale
          ? `${Math.min(scaleCheckCount, 1)} of 2 dimension checks recorded. Use a different printed dimension for each check.`
          : "Set the drawing scale, then confirm it with two printed dimensions.",
      complete: scaleVerified,
      actionLabel: scaleVerified
        ? "Review scale"
        : !hasScale
          ? "Set scale"
          : scaleCheckCount === 1
            ? "Record check 2"
            : "Start check 1",
      onAction: onVerifyScale,
    },
    {
      id: "takeoff",
      label: "Create a trusted takeoff",
      detail: "Draw it yourself or use AI & Scope to identify where you should measure.",
      complete: hasTakeoff,
      actionLabel: "AI & Scope",
      onAction: onOpenAiMarkups,
    },
    {
      id: "worksheet",
      label: "Link the quantity",
      detail: "Name the work and connect it to the estimate worksheet.",
      complete: hasLinkedTakeoff,
      actionLabel: "Worksheet",
      onAction: onOpenWorksheet,
    },
  ];
  const completed = steps.filter((step) => step.complete).length;

  return (
    <section
      className="mb-2 rounded-lg border border-clay/40 bg-accent/20 p-3"
      data-testid="estimator-activation-checklist"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">First trusted takeoff</p>
          <p className="mt-1 text-sm font-medium">{completed} of 4 steps complete</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Finish one defensible quantity before exploring advanced tools.
          </p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          title="Hide getting-started checklist"
          aria-label="Hide getting-started checklist"
          onClick={onHide}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="mt-3 grid gap-2 xl:grid-cols-2">
        {steps.map((step) => (
          <div
            key={step.label}
            className={cn(
              "flex items-start gap-2 rounded-md border px-2.5 py-2",
              step.complete ? "border-success/30 bg-success/5" : "border-hairline bg-surface",
            )}
          >
            {step.complete ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            ) : (
              <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">{step.label}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{step.detail}</p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="mt-1 h-6 px-0 text-[11px] text-clay"
                onClick={step.onAction}
                data-testid={`estimator-activation-${step.id}`}
              >
                {step.actionLabel}
              </Button>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Something does not make sense? Use the flag in the top command bar. The current sheet and
        tool are attached automatically.
      </p>
    </section>
  );
}
