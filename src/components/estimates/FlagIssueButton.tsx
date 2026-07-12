import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Flag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { DialogHeaderV2 } from "@/components/ui/dialog-header-v2";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitBetaFeedback } from "@/lib/beta-feedback.functions";

// "Flag an issue": one text field plus an automatic context blob (route,
// estimate, sheet, active tool, app commit sha). No screenshots, no extra
// steps — founders read the rows straight from the database.
export function FlagIssueButton({
  getContext,
  compact = false,
  className,
}: {
  // Called at submit time so the blob reflects the state when flagged.
  getContext: () => Record<string, unknown>;
  // Icon-only for tight command bars; labeled everywhere else.
  compact?: boolean;
  className?: string;
}) {
  const submitFn = useServerFn(submitBetaFeedback);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");

  const submitMutation = useMutation({
    mutationFn: () =>
      submitFn({
        data: {
          message,
          route: typeof window === "undefined" ? "" : window.location.pathname,
          context: {
            app_commit_sha: (import.meta.env.VITE_COMMIT_SHA as string | undefined) ?? "",
            ...getContext(),
          },
        },
      }),
    onSuccess: () => {
      toast.success("Issue flagged. Thank you — we read every one.");
      setOpen(false);
      setMessage("");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The issue did not send"),
  });

  return (
    <>
      {compact ? (
        <Button
          type="button"
          size="icon"
          variant="outline"
          className={className ?? "h-8 w-8"}
          title="Flag an issue"
          aria-label="Flag an issue"
          onClick={() => setOpen(true)}
          data-testid="flag-issue-button"
        >
          <Flag className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={className ?? "gap-1.5"}
          title="Flag an issue"
          onClick={() => setOpen(true)}
          data-testid="flag-issue-button"
        >
          <Flag className="h-3.5 w-3.5" />
          Flag an issue
        </Button>
      )}
      {open && (
        <Dialog open onOpenChange={(next) => !next && setOpen(false)}>
          <DialogContent data-testid="flag-issue-dialog">
            <DialogHeaderV2
              eyebrow="Feedback"
              title="Flag an issue"
              description="Tell us what went wrong or what got in your way. The screen and sheet you are on are attached automatically."
            />
            <div className="space-y-1.5">
              <Label htmlFor="flag-issue-message">What happened?</Label>
              <Textarea
                id="flag-issue-message"
                rows={4}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="e.g. The takeoff I drew disappeared after I switched sheets."
                autoFocus
                data-testid="flag-issue-message"
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={submitMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending || !message.trim()}
                data-testid="flag-issue-submit"
              >
                {submitMutation.isPending ? "Sending..." : "Send"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
