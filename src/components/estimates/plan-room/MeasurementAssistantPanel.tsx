import { Check, RefreshCcw, Ruler, ScanText, Sparkles, SquareDashed } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  MeasurementAssistantPlanResult,
  MeasurementAssistantSuggestion,
} from "@/lib/plan-room-measurement-assistant";

export function MeasurementAssistantPanel({
  plan,
  pending,
  canAnalyze,
  scaleVerified,
  preparedSuggestionId,
  completedSuggestionIds,
  onAnalyze,
  onPrepare,
  onClear,
}: {
  plan: MeasurementAssistantPlanResult | null;
  pending: boolean;
  canAnalyze: boolean;
  scaleVerified: boolean;
  preparedSuggestionId: string;
  completedSuggestionIds: string[];
  onAnalyze: () => void;
  onPrepare: (suggestion: MeasurementAssistantSuggestion) => void;
  onClear: () => void;
}) {
  const completed = new Set(completedSuggestionIds);
  return (
    <div className="border-b border-hairline pb-4" data-testid="measurement-assistant-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="eyebrow flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" /> AI measurement planning
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            AI reads selectable drawing notes and proposes what may need measuring. You place every
            line or area and approve every quantity.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5"
          onClick={onAnalyze}
          disabled={!canAnalyze || pending}
          data-testid="measurement-assistant-analyze"
        >
          {pending ? (
            <RefreshCcw className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
          ) : (
            <ScanText className="h-3.5 w-3.5" />
          )}
          {plan ? "Review Again · 1 credit" : "Review Notes · 1 credit"}
        </Button>
      </div>

      {!canAnalyze && (
        <p className="mt-3 rounded-md border border-dashed border-hairline px-3 py-2 text-xs text-muted-foreground">
          Note review needs an uploaded vector PDF. Scanned sheets remain available for manual
          takeoff.
        </p>
      )}

      {canAnalyze && !plan && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          One AI credit per sheet review. Platform-admin reviews are unmetered.
        </p>
      )}

      {plan && (
        <div className="mt-4 space-y-3" data-testid="measurement-assistant-results">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <Badge variant="secondary">{plan.suggestions.length} suggestions</Badge>
            <span>{plan.source_line_count} extracted lines reviewed</span>
            <span>
              {plan.credits_charged === 0
                ? "Admin review · no credits charged"
                : `${plan.credits_charged} AI credit charged`}
            </span>
          </div>
          <p className="text-xs text-foreground">{plan.summary}</p>

          {plan.suggestions.length === 0 ? (
            <div className="rounded-md border border-dashed border-hairline px-3 py-3 text-xs text-muted-foreground">
              No sufficiently cited linear or area scope was found. AI left the checklist empty
              instead of guessing.
            </div>
          ) : (
            <div className="space-y-2">
              {plan.suggestions.map((suggestion) => {
                const isPrepared = preparedSuggestionId === suggestion.id;
                const isCompleted = completed.has(suggestion.id);
                return (
                  <div
                    key={suggestion.id}
                    className="border-t border-hairline pt-3 first:border-t-0 first:pt-0"
                    data-testid={`measurement-suggestion-${suggestion.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {suggestion.tool === "linear" ? (
                            <Ruler className="h-3.5 w-3.5 text-clay" />
                          ) : (
                            <SquareDashed className="h-3.5 w-3.5 text-clay" />
                          )}
                          <span className="text-xs font-medium text-foreground">
                            {suggestion.label}
                          </span>
                          <Badge variant="outline">{suggestion.unit}</Badge>
                          <Badge
                            variant={
                              suggestion.evidence_strength === "direct" ? "secondary" : "outline"
                            }
                          >
                            {suggestion.evidence_strength === "direct"
                              ? "Direct note"
                              : "Estimator review"}
                          </Badge>
                        </div>
                        <p className="mt-1.5 text-[11px] text-muted-foreground">
                          {suggestion.rationale}
                        </p>
                        <blockquote className="mt-2 border-l-2 border-clay/40 pl-2 text-[11px] text-muted-foreground">
                          {suggestion.source_line} · “{suggestion.source_excerpt}”
                        </blockquote>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={isPrepared ? "secondary" : "outline"}
                        className="shrink-0 gap-1.5"
                        onClick={() => onPrepare(suggestion)}
                        disabled={isCompleted}
                        data-testid={`measurement-suggestion-start-${suggestion.id}`}
                      >
                        {isCompleted ? (
                          <>
                            <Check className="h-3.5 w-3.5" /> Measured
                          </>
                        ) : isPrepared ? (
                          scaleVerified ? (
                            "Drawing"
                          ) : (
                            "Prepared"
                          )
                        ) : (
                          "Start"
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {plan.warnings.length > 0 && (
            <ul className="space-y-1 text-[11px] text-warning" data-testid="measurement-warnings">
              {plan.warnings.map((warning) => (
                <li key={warning}>Review: {warning}</li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-hairline pt-2">
            <p className="text-[10px] text-muted-foreground">
              Cited suggestions are planning aids, never measured quantities.
            </p>
            <Button type="button" size="sm" variant="ghost" onClick={onClear}>
              Clear
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
