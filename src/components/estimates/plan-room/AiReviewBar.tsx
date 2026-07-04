// Floating review bar for AI count proposals (AITAKEOFF1 Task 2).
// Keyboard cadence: Enter accepts, X or Delete rejects, arrows navigate, Esc
// ends the review. The viewport pans to each ghost so the human always sees
// the actual symbol before deciding. "Accept all remaining" exists but sits
// behind the per-item flow, never first.

import { useEffect } from "react";
import { Check, ChevronLeft, ChevronRight, Loader2, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/ai-takeoff/ai-takeoff-domain";
import type { AiAssistController } from "./useAiAssist";

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function AiReviewBar({ ai }: { ai: AiAssistController }) {
  const active = ai.phase === "review";

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.key === "Enter") {
        event.preventDefault();
        void ai.acceptActiveProposal();
      } else if (event.key === "x" || event.key === "X" || event.key === "Delete") {
        event.preventDefault();
        ai.rejectActiveProposal();
      } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        ai.navigateReview(1);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        ai.navigateReview(-1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        ai.endReview();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, ai]);

  if (!active) return null;

  const total = ai.proposals.length;
  const decided = total - ai.pendingCount;
  const currentNumber = Math.min(decided + 1, total);
  const lowConfidence = (ai.activeProposal?.confidence ?? 1) < LOW_CONFIDENCE_THRESHOLD;

  return (
    <div
      className="flex max-w-[min(640px,calc(100vw-2rem))] flex-wrap items-center gap-2 rounded-md border border-hairline bg-card/95 px-3 py-2 shadow-2xl backdrop-blur"
      data-testid="ai-review-bar"
    >
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <Sparkles className="h-3.5 w-3.5 text-amber-600" />
        {total} found · Reviewing {currentNumber} of {total} · {ai.acceptedCount} accepted
      </div>
      {lowConfidence && (
        <Badge
          variant="outline"
          className="border-amber-300 bg-amber-50 text-amber-900"
          data-testid="ai-review-low-confidence"
        >
          Low confidence — look closely
        </Badge>
      )}
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8"
          title="Previous proposal (Left arrow)"
          onClick={() => ai.navigateReview(-1)}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8"
          title="Next proposal (Right arrow)"
          onClick={() => ai.navigateReview(1)}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          className="gap-1.5"
          title="Accept this count (Enter)"
          disabled={ai.isAccepting || !ai.activeProposal}
          onClick={() => void ai.acceptActiveProposal()}
          data-testid="ai-review-accept"
        >
          {ai.isAccepting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          Accept
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          title="Reject this proposal (X or Delete)"
          disabled={ai.isAccepting || !ai.activeProposal}
          onClick={ai.rejectActiveProposal}
          data-testid="ai-review-reject"
        >
          <X className="h-3.5 w-3.5" />
          Reject
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-xs text-muted-foreground"
              disabled={ai.isAccepting}
              data-testid="ai-review-more"
            >
              More
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => void ai.acceptAllRemaining()}
              data-testid="ai-review-accept-all"
            >
              Accept all remaining ({ai.pendingCount})
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => ai.endReview()}>
              End review (discard remaining)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
