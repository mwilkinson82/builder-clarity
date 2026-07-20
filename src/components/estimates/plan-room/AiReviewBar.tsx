// Floating review bar for AI count proposals (AITAKEOFF1 Task 2; honest
// verdicts in AITAKEOFF10). Keyboard cadence: Enter accepts, X or Delete
// rejects as "wrong spot" (the safe default — a mistaken suppression costs
// less than a poisoned negative), Shift+X rejects as "not this symbol"
// (the only verdict that teaches the model a negative), Alt+arrows nudge
// the ghost onto the hub before accepting, plain arrows navigate, Esc ends
// the review. The viewport pans to each ghost so the human always sees the
// actual symbol before deciding.

import { useEffect } from "react";
import { Check, ChevronLeft, ChevronRight, Loader2, Move, Sparkles, X } from "lucide-react";
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

// One nudge step in normalized sheet units: ~4px on a 3800px detection
// raster — a few presses walk a ghost onto its hub.
const NUDGE_STEP_NORMALIZED = 0.001;

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
        // Shift = "not this symbol" (identity negative); plain = wrong spot.
        ai.rejectActiveProposal(event.shiftKey ? "wrong_symbol" : "wrong_spot");
      } else if (event.altKey && event.key.startsWith("Arrow")) {
        event.preventDefault();
        const step = NUDGE_STEP_NORMALIZED;
        if (event.key === "ArrowRight") ai.nudgeActiveProposal(step, 0);
        else if (event.key === "ArrowLeft") ai.nudgeActiveProposal(-step, 0);
        else if (event.key === "ArrowDown") ai.nudgeActiveProposal(0, step);
        else if (event.key === "ArrowUp") ai.nudgeActiveProposal(0, -step);
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
      className="w-[min(640px,calc(100vw-1rem))] max-w-full rounded-md border border-hairline bg-card/95 px-3 py-2 shadow-2xl backdrop-blur"
      data-testid="ai-review-bar"
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-1.5 text-xs font-medium leading-5 sm:text-sm">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span>
            {total} found · Reviewing {currentNumber} of {total} · {ai.acceptedCount} accepted
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 shrink-0 gap-1 px-2 text-xs text-muted-foreground"
          title="End review and discard all proposals that are still pending (Escape)"
          aria-label="End AI review and discard pending proposals"
          disabled={ai.isAccepting}
          onClick={() => ai.endReview()}
          data-testid="ai-review-end"
        >
          <X className="h-3.5 w-3.5" />
          End review
        </Button>
      </div>
      {lowConfidence && (
        <Badge
          variant="outline"
          className="mt-1 border-warning/30 bg-warning/10 text-warning"
          data-testid="ai-review-low-confidence"
        >
          Low confidence — look closely
        </Badge>
      )}
      <div className="mt-2 flex w-full max-w-full flex-wrap items-center gap-1">
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-8 w-8"
            title="Previous proposal (Left arrow)"
            aria-label="Previous AI proposal"
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
            aria-label="Next AI proposal"
            onClick={() => ai.navigateReview(1)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
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
          title="Right symbol, wrong spot (X or Delete) — never teaches the model a negative"
          disabled={ai.isAccepting || !ai.activeProposal}
          onClick={() => ai.rejectActiveProposal("wrong_spot")}
          data-testid="ai-review-reject"
        >
          <X className="h-3.5 w-3.5" />
          Wrong spot
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5 border-destructive/40 text-destructive"
          title="Not this symbol (Shift+X) — teaches the next scan what NOT to find"
          disabled={ai.isAccepting || !ai.activeProposal}
          onClick={() => ai.rejectActiveProposal("wrong_symbol")}
          data-testid="ai-review-reject-symbol"
        >
          <X className="h-3.5 w-3.5" />
          Not this symbol
        </Button>
        <div
          className="flex items-center gap-0.5 rounded-md border border-hairline px-1 py-0.5"
          title="Nudge the ghost onto the hub before accepting (Alt+arrows)"
          data-testid="ai-review-nudge"
        >
          <Move className="h-3 w-3 text-muted-foreground" />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            aria-label="Nudge AI proposal left"
            disabled={ai.isAccepting || !ai.activeProposal}
            onClick={() => ai.nudgeActiveProposal(-NUDGE_STEP_NORMALIZED, 0)}
          >
            <ChevronLeft className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            aria-label="Nudge AI proposal up"
            disabled={ai.isAccepting || !ai.activeProposal}
            onClick={() => ai.nudgeActiveProposal(0, -NUDGE_STEP_NORMALIZED)}
          >
            <ChevronLeft className="h-3 w-3 rotate-90" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            aria-label="Nudge AI proposal down"
            disabled={ai.isAccepting || !ai.activeProposal}
            onClick={() => ai.nudgeActiveProposal(0, NUDGE_STEP_NORMALIZED)}
          >
            <ChevronRight className="h-3 w-3 rotate-90" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            aria-label="Nudge AI proposal right"
            disabled={ai.isAccepting || !ai.activeProposal}
            onClick={() => ai.nudgeActiveProposal(NUDGE_STEP_NORMALIZED, 0)}
          >
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
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
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
