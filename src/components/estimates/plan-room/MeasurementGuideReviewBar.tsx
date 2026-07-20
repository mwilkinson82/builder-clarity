import { AlertTriangle, LocateFixed, PencilRuler, Route, SquareDashed, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MeasurementAssistantSuggestion } from "@/lib/plan-room-measurement-assistant";
import type { MeasurementScopeDecisionStatus } from "@/lib/plan-room-measurement-scope";

export function MeasurementGuideReviewBar({
  suggestion,
  label,
  queueStatus,
  scaleVerified,
  structuralSheet,
  pending,
  onLabelChange,
  onShowEvidence,
  onAccept,
  onReject,
  onStartTrace,
  onClose,
}: {
  suggestion: MeasurementAssistantSuggestion;
  label: string;
  queueStatus: MeasurementScopeDecisionStatus | "completed" | null;
  scaleVerified: boolean;
  structuralSheet?: boolean;
  pending: boolean;
  onLabelChange: (label: string) => void;
  onShowEvidence: () => void;
  onAccept: () => void;
  onReject: () => void;
  onStartTrace: () => void;
  onClose: () => void;
}) {
  const accepted = queueStatus === "accepted";
  const completed = queueStatus === "completed";
  return (
    <section
      className="w-[min(760px,calc(100vw-2rem))] max-w-full rounded-lg border border-hairline bg-card/95 p-3 shadow-nav backdrop-blur"
      aria-label={`Review AI visual hypothesis for ${suggestion.label}`}
      data-testid="measurement-guide-review"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md border border-clay/30 bg-clay/10 p-2 text-clay">
          {suggestion.tool === "linear" ? (
            <Route className="h-4 w-4" />
          ) : (
            <SquareDashed className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow">AI visual hypothesis</span>
            <Badge variant="outline">{suggestion.unit}</Badge>
            <Badge variant="outline">Not measured</Badge>
            {queueStatus && (
              <Badge variant={accepted || completed ? "secondary" : "outline"}>
                {completed
                  ? "Measured"
                  : accepted
                    ? "Estimator accepted"
                    : queueStatus === "rejected"
                      ? "Rejected"
                      : "Saved for later"}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            This dashed {suggestion.tool === "linear" ? "route" : "region"} is a location hint, not
            a quantity. Accept only when it points to the right scope; your snapped trace and
            verified scale remain the source of truth.
          </p>
          {structuralSheet && (
            <p className="mt-2 flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px] text-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              Structural sheets contain dense grids, schedules, and typical details. Reject or exit
              when the callout is not clearly tied to the cited scope.
            </p>
          )}
          <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Input
              value={label}
              onChange={(event) => onLabelChange(event.target.value)}
              maxLength={120}
              aria-label="Estimator label for this markup"
              placeholder="Name the scope you will trace"
              disabled={completed || accepted}
              data-testid="measurement-guide-label"
            />
            <Button type="button" size="sm" variant="ghost" onClick={onShowEvidence}>
              <LocateFixed className="h-3.5 w-3.5" /> Cited note
            </Button>
          </div>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          onClick={onClose}
          aria-label="Close measurement location review"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-hairline pt-3">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onClose}
          data-testid="measurement-guide-close"
        >
          Exit review
        </Button>
        {!completed && !accepted && queueStatus !== "rejected" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onReject}
            disabled={pending}
            data-testid="measurement-guide-reject"
          >
            {pending ? "Saving…" : "Reject & next"}
          </Button>
        )}
        {!completed && !accepted && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onAccept}
            disabled={pending || label.trim().length === 0}
            data-testid="measurement-guide-accept"
          >
            {pending ? "Saving…" : "Accept & next"}
          </Button>
        )}
        {accepted && (
          <Button
            type="button"
            size="sm"
            onClick={onStartTrace}
            disabled={pending || label.trim().length === 0}
            data-testid="measurement-guide-start"
          >
            <PencilRuler className="h-3.5 w-3.5" />
            {scaleVerified ? "Start trusted trace" : "Prepare trace · verify scale first"}
          </Button>
        )}
      </div>
    </section>
  );
}
