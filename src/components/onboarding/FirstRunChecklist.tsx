import type { ReactNode } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// First-run guidance for a brand-new workspace (ONBOARDING1 / audit 1.4). The app seeds a
// demo project but never says what to do first; this names the intended path, self-checks
// each step from live data, and deep-links straight to the destination. Same complete /
// pending / blocked vocabulary as the billing stage rail.

export interface ChecklistStep {
  key: string;
  title: string;
  description: string;
  done: boolean;
  /** Prerequisite unmet: the step is muted and its action disabled until an earlier step lands. */
  blocked?: boolean;
  blockedReason?: string;
  /** The action control (a Link or Button) supplied by the parent so routing stays typed. */
  action: ReactNode;
}

export function FirstRunChecklist({
  steps,
  onDismiss,
}: {
  steps: ChecklistStep[];
  onDismiss: () => void;
}) {
  const doneCount = steps.filter((step) => step.done).length;
  const allDone = doneCount === steps.length;

  return (
    <section className="rounded-lg border border-accent/30 bg-accent/[0.05] p-5 shadow-card ring-1 ring-accent/10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Getting started · {doneCount} of {steps.length} done
          </div>
          <h2 className="mt-1 font-serif text-xl text-foreground">
            {allDone ? "You're set up — nice work." : "Set up Overwatch in four steps"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {allDone
              ? "Every step is done. Dismiss this to reclaim the space; your control room is below."
              : "Follow these in order. Each one checks itself off as you complete it."}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={onDismiss}
        >
          <X className="h-3.5 w-3.5" /> Dismiss
        </Button>
      </div>

      {!allDone ? (
        <ol className="mt-4 space-y-2">
          {steps.map((step, index) => (
            <li
              key={step.key}
              className={cn(
                "flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between",
                step.done
                  ? "border-success/30 bg-success/[0.06]"
                  : step.blocked
                    ? "border-hairline bg-card/60"
                    : "border-hairline bg-card",
              )}
            >
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                    step.done
                      ? "bg-success text-success-foreground"
                      : step.blocked
                        ? "bg-muted text-muted-foreground"
                        : "bg-accent/15 text-accent",
                  )}
                >
                  {step.done ? <Check className="h-3.5 w-3.5" /> : index + 1}
                </span>
                <div className="min-w-0">
                  <div
                    className={cn(
                      "text-sm font-semibold",
                      step.blocked && !step.done ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {step.title}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {step.blocked && !step.done && step.blockedReason
                      ? step.blockedReason
                      : step.description}
                  </div>
                </div>
              </div>
              <div className="shrink-0 pl-9 sm:pl-0">
                {step.done ? (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                    <Check className="h-3.5 w-3.5" /> Done
                  </span>
                ) : (
                  step.action
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
