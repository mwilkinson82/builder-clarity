import { LocateFixed, PencilRuler, Route, SquareDashed, X } from "lucide-react";
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
      className="w-[min(760px,calc(100vw-2rem))] rounded-lg border border-hairline bg-card/95 p-3 shadow-nav backdrop-blur"
      aria-label={`Review AI-drawn scope markup for ${suggestion.label}`}
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
            <span className="eyebrow">AI-drawn scope markup</span>
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
            AI traced this dashed {suggestion.tool === "linear" ? "route" : "region"} as a visual
            proposal from the cited note and drawing image. It cannot feed the estimate. Confirm
            what it represents, then create the trusted quantity with your snapped trace and
            verified sheet scale. The spotlight stays visible while magnetic ink snap aligns your
            clicks to nearby drawing linework.
          </p>
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

      <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-hairline pt-3">
        {!completed && !accepted && queueStatus !== "rejected" && (
          <Button type="button" size="sm" variant="ghost" onClick={onReject} disabled={pending}>
            Reject markup
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
            Accept markup
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
