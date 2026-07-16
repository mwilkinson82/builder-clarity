import { Layers, Sparkles, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { DialogHeaderV2 } from "@/components/ui/dialog-header-v2";

export function EstimatorActivationDialog({
  open,
  hasDrawings,
  onGuidedExample,
  onStartTakeoff,
  onCompareRevisions,
  onSkip,
}: {
  open: boolean;
  hasDrawings: boolean;
  onGuidedExample: () => void;
  onStartTakeoff: () => void;
  onCompareRevisions: () => void;
  onSkip: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onSkip()}>
      <DialogContent className="max-w-3xl" data-testid="estimator-activation-dialog">
        <DialogHeaderV2
          eyebrow="Plan Room"
          title="What do you want to accomplish first?"
          description="Choose one job. Overwatch will arrange the Command Center around that workflow, and you can change tools at any time."
        />
        <div className="grid gap-3 md:grid-cols-3">
          <button
            type="button"
            className="rounded-lg border border-clay bg-accent/40 p-4 text-left transition hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onGuidedExample}
            data-testid="estimator-activation-guided"
          >
            <Sparkles className="h-5 w-5 text-clay" />
            <p className="mt-3 font-serif text-lg">Try the guided workflow</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {hasDrawings
                ? "Open the best prepared sheet and complete one trusted takeoff."
                : "Upload plans, then follow the four-step takeoff checklist."}
            </p>
          </button>
          <button
            type="button"
            className="rounded-lg border border-hairline bg-surface p-4 text-left transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onStartTakeoff}
            data-testid="estimator-activation-takeoff"
          >
            <Target className="h-5 w-5 text-clay" />
            <p className="mt-3 font-serif text-lg">Start a takeoff</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Open the measurement workspace with scale, labels, and drawing tools ready.
            </p>
          </button>
          <button
            type="button"
            className="rounded-lg border border-hairline bg-surface p-4 text-left transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onCompareRevisions}
            data-testid="estimator-activation-revisions"
          >
            <Layers className="h-5 w-5 text-clay" />
            <p className="mt-3 font-serif text-lg">Compare revisions</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Open Drawing Controls full screen to pair sheets and use the red/green overlay.
            </p>
          </button>
        </div>
        <div className="rounded-md border border-hairline bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          AI proposals remain suggestions. You identify the scope, approve the marks, and control
          every quantity sent to the estimate.
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onSkip}>
            Skip for now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
