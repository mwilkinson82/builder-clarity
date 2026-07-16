import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Clock3, History, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { DialogHeaderV2 } from "@/components/ui/dialog-header-v2";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  estimateReviewActivityLabel,
  estimateReviewStatusLabel,
  type EstimateReviewActivityState,
} from "@/lib/estimate-review-activity";
import { recordEstimateReviewActivity } from "@/lib/estimate-review-activity.functions";
import { fmtUSD } from "@/lib/format";

const reviewedAt = (value: string | null) => {
  if (!value) return "Review time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Review time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

export function EstimateReviewActivity({
  estimateId,
  state,
  loading,
  onChanged,
}: {
  estimateId: string;
  state: EstimateReviewActivityState | undefined;
  loading: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const recordActivityFn = useServerFn(recordEstimateReviewActivity);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [note, setNote] = useState("");
  const status = state?.status ?? "unavailable";
  const blockers = state?.blocker_count ?? 0;
  const followUps = state?.follow_up_count ?? 0;
  const ready = state?.ready === true;

  const signoffMutation = useMutation({
    mutationFn: () =>
      recordActivityFn({
        data: {
          estimate_id: estimateId,
          activity_type: "signoff",
          note,
        },
      }),
    onSuccess: async () => {
      await onChanged();
      setDialogOpen(false);
      setNote("");
      toast.success("Estimator sign-off recorded for this estimate version.");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Estimator sign-off did not save"),
  });

  const statusTone =
    status === "current"
      ? "border-success/25 bg-success/5 text-success"
      : status === "stale"
        ? "border-warning/30 bg-warning/5 text-warning"
        : "border-hairline bg-muted/50 text-muted-foreground";

  return (
    <section
      className="border-b border-hairline bg-surface px-4 py-4"
      data-testid="estimate-review-activity"
      aria-labelledby="estimate-signoff-title"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <p className="eyebrow">Estimator accountability</p>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusTone}`}
            >
              {loading ? "Checking sign-off…" : estimateReviewStatusLabel(status)}
            </span>
          </div>
          <h3 id="estimate-signoff-title" className="mt-1 font-serif text-xl">
            Estimate Sign-off
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            A manager records the estimator’s decision against this exact worksheet, pricing,
            takeoff, scale, assembly, and drawing-review state. Any later change makes the sign-off
            stale. This is a human review record—not an AI certification.
          </p>

          {status === "current" && state?.latest_signoff_reviewed_at ? (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> Version {state.latest_signoff_sequence}{" "}
              signed by {state.latest_signoff_reviewed_by_name} ·{" "}
              {reviewedAt(state.latest_signoff_reviewed_at)}
            </p>
          ) : status === "stale" ? (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-warning">
              <AlertTriangle className="h-3.5 w-3.5" /> The estimate changed after version{" "}
              {state?.latest_signoff_sequence} was signed. Review and sign the current version.
            </p>
          ) : status === "unsigned" ? (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5" /> No estimator has signed this version yet.
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground">
              The sign-off ledger is waiting for its Lovable database migration.
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-start gap-2 xl:items-end">
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => setDialogOpen(true)}
            disabled={loading || !ready || blockers > 0 || status === "current"}
            data-testid="estimate-signoff-open"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {status === "stale" ? "Sign Current Version" : "Record Sign-off"}
          </Button>
          {blockers > 0 ? (
            <span className="max-w-[280px] text-right text-[10px] leading-4 text-danger">
              Resolve {blockers} blocking review {blockers === 1 ? "item" : "items"} first.
            </span>
          ) : followUps > 0 ? (
            <span className="max-w-[280px] text-right text-[10px] leading-4 text-muted-foreground">
              Your note acknowledges {followUps} visible follow-up{" "}
              {followUps === 1 ? "item" : "items"}.
            </span>
          ) : null}
        </div>
      </div>

      {state && state.activities.length > 0 ? (
        <div className="mt-4 border-t border-hairline pt-3">
          <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            <History className="h-3.5 w-3.5" /> Recent sign-off activity
          </p>
          <div className="mt-2 grid gap-2 xl:grid-cols-2">
            {state.activities.slice(0, 4).map((activity) => (
              <div
                key={activity.id}
                className="flex items-start justify-between gap-3 rounded-md border border-hairline bg-card px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-[11px] font-medium">
                    #{activity.sequence} · {estimateReviewActivityLabel(activity.activity_type)}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                    {activity.note}
                  </p>
                  <p className="mt-1 text-[9px] text-muted-foreground">
                    {activity.reviewed_by_name} · {reviewedAt(activity.reviewed_at)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-serif text-sm">{fmtUSD(activity.total_cents / 100)}</p>
                  <p className="text-[9px] text-muted-foreground">
                    {activity.blocker_count} block · {activity.follow_up_count} follow-up
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeaderV2
            eyebrow="Estimator accountability"
            title="Sign off this estimate version"
            description="Your name, timestamp, note, totals, review counts, worksheet, takeoffs, scale evidence, assemblies, and plan-review state will be retained together."
          />
          <div className="space-y-2 py-2">
            <Label htmlFor="estimate-signoff-note">Estimator review note</Label>
            <Textarea
              id="estimate-signoff-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={4}
              maxLength={2000}
              placeholder={
                followUps > 0
                  ? `Document your review and acknowledge the ${followUps} follow-up ${followUps === 1 ? "item" : "items"}.`
                  : "Summarize the estimator review completed for this version."
              }
              data-testid="estimate-signoff-note"
            />
            <p className="text-[10px] leading-4 text-muted-foreground">
              Sign-off records your professional review decision. It does not represent an AI
              guarantee of completeness, quantity, or price.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => signoffMutation.mutate()}
              disabled={note.trim().length < 3 || signoffMutation.isPending}
              data-testid="estimate-signoff-submit"
            >
              {signoffMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
              )}
              Record Sign-off
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
