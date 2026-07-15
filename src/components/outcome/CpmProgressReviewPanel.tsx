import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, ClipboardCheck, History, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  applyCpmProgressReview,
  loadCpmProgressReviewContext,
  saveCpmProgressControl,
} from "@/lib/cpm-progress.functions";
import type { CpmProgressBasis, CpmProgressRecommendation } from "@/lib/cpm-progress";

function percent(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}

function signedPercent(value: number | null): string {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} pts`;
}

function decisionCopy(row: CpmProgressRecommendation): string {
  const review = row.latestReview;
  if (!review) return "No CPM decision recorded yet";
  const actor = review.reviewedByName ?? "Project manager";
  const date = new Date(review.reviewedAt);
  const dateCopy = Number.isNaN(date.getTime()) ? review.reviewedAt : date.toLocaleString();
  const action =
    review.decision === "overridden"
      ? `set CPM to ${review.acceptedPercent.toFixed(1)}%`
      : review.decision === "kept"
        ? `kept CPM at ${review.acceptedPercent.toFixed(1)}%`
        : `accepted ${review.acceptedPercent.toFixed(1)}%`;
  return `${actor} ${action} · ${dateCopy}`;
}

function ActivityProgressReview({
  projectId,
  row,
}: {
  projectId: string;
  row: CpmProgressRecommendation;
}) {
  const queryClient = useQueryClient();
  const saveControl = useServerFn(saveCpmProgressControl);
  const applyReview = useServerFn(applyCpmProgressReview);
  const [basis, setBasis] = useState<CpmProgressBasis>(row.basis);
  const [plannedQuantity, setPlannedQuantity] = useState(
    row.plannedQuantity == null ? "" : String(row.plannedQuantity),
  );
  const [unit, setUnit] = useState(row.unit);
  const [acceptedPercent, setAcceptedPercent] = useState(
    row.recommendedPercent == null ? "" : row.recommendedPercent.toFixed(1),
  );
  const [note, setNote] = useState("");

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["cpm-progress-review", projectId] });
  const controlMutation = useMutation({
    mutationFn: () =>
      saveControl({
        data: {
          projectId,
          scheduleActivityId: row.id,
          basis,
          plannedQuantity:
            basis === "installed_quantity" && plannedQuantity ? Number(plannedQuantity) : null,
          unit: basis === "installed_quantity" ? unit : "",
        },
      }),
    onSuccess: async () => {
      toast.success("CPM evidence basis saved");
      await invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to save"),
  });
  const reviewMutation = useMutation({
    mutationFn: ({
      decision,
      value,
      reviewNote,
    }: {
      decision: "accepted" | "kept" | "overridden";
      value: number;
      reviewNote: string;
    }) =>
      applyReview({
        data: {
          projectId,
          scheduleActivityId: row.id,
          decision,
          acceptedPercent: value,
          note: reviewNote,
        },
      }),
    onSuccess: async (review) => {
      toast.success(
        review.decision === "overridden"
          ? `CPM progress set to ${review.acceptedPercent.toFixed(1)}% with override recorded`
          : review.decision === "kept"
            ? `CPM remains at ${review.acceptedPercent.toFixed(1)}%`
            : `CPM progress updated to ${review.acceptedPercent.toFixed(1)}%`,
      );
      setNote("");
      await invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Unable to update CPM progress"),
  });

  const accepted = Number(acceptedPercent);
  const canApply =
    row.recommendedPercent != null && Number.isFinite(accepted) && accepted >= 0 && accepted <= 100;
  const isDifferentCpm =
    canApply &&
    Math.abs(accepted - (row.recommendedPercent ?? accepted)) > 0.01 &&
    Math.abs(accepted - row.currentPercent) > 0.01;

  return (
    <article className="border-t border-hairline px-5 py-5 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            {row.activityId || "CPM activity"} · {row.division || "General"}
          </div>
          <h3 className="mt-1 font-serif text-[20px] font-normal text-foreground">{row.name}</h3>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <History className="h-3.5 w-3.5" />
          {decisionCopy(row)}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-muted/45 px-4 py-3">
          <div className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
            CPM now
          </div>
          <div className="mt-1 font-serif text-[24px] tabular-nums text-foreground">
            {percent(row.currentPercent)}
          </div>
        </div>
        <div className="rounded-lg bg-muted/45 px-4 py-3">
          <div className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
            Daily WIP recommends
          </div>
          <div className="mt-1 font-serif text-[24px] tabular-nums text-foreground">
            {percent(row.recommendedPercent)}
          </div>
        </div>
        <div className="rounded-lg bg-muted/45 px-4 py-3">
          <div className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
            Difference
          </div>
          <div
            className={`mt-1 font-serif text-[24px] tabular-nums ${
              row.variancePercent != null && row.variancePercent < -0.01
                ? "text-danger"
                : row.variancePercent != null && row.variancePercent > 0.01
                  ? "text-success"
                  : "text-foreground"
            }`}
          >
            {signedPercent(row.variancePercent)}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.05fr_1fr]">
        <div className="rounded-xl border border-hairline p-4">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-clay" />
            <div className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              Evidence basis
            </div>
          </div>
          <label className="mt-3 grid gap-1">
            <span className="text-xs font-medium text-foreground">
              What controls this activity?
            </span>
            <select
              value={basis}
              onChange={(event) => setBasis(event.target.value as CpmProgressBasis)}
              className="h-9 rounded-md border border-input bg-surface px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="reviewed_percent">Latest PM-reviewed CPM percent</option>
              <option value="installed_quantity">Installed quantity ÷ planned quantity</option>
            </select>
          </label>
          {basis === "installed_quantity" ? (
            <div className="mt-3 grid grid-cols-[1fr_0.8fr] gap-3">
              <label className="grid gap-1">
                <span className="text-xs text-muted-foreground">Planned quantity</span>
                <Input
                  type="number"
                  min="0.01"
                  step="any"
                  value={plannedQuantity}
                  onChange={(event) => setPlannedQuantity(event.target.value)}
                  placeholder="e.g. 12,000"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-muted-foreground">Unit</span>
                <Input
                  value={unit}
                  onChange={(event) => setUnit(event.target.value)}
                  placeholder="SF, LF, EA"
                />
              </label>
            </div>
          ) : null}
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {basis === "installed_quantity"
              ? "OverWatch totals reviewed, linked Daily WIP quantities with the same unit and divides by the planned activity quantity."
              : "OverWatch uses the latest linked work line that the PM reviewed with its percent basis set to CPM."}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3"
            disabled={
              controlMutation.isPending ||
              (basis === "installed_quantity" && (!plannedQuantity || !unit.trim()))
            }
            onClick={() => controlMutation.mutate()}
          >
            Save evidence basis
          </Button>
        </div>

        <div className="rounded-xl border border-hairline p-4">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-clay" />
            <div className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              PM schedule decision
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {row.explanation}. {row.evidenceCount} reviewed work line
            {row.evidenceCount === 1 ? "" : "s"} supports this recommendation.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[0.55fr_1fr]">
            <label className="grid gap-1">
              <span className="text-xs font-medium text-foreground">Apply to CPM</span>
              <div className="relative">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={acceptedPercent}
                  onChange={(event) => setAcceptedPercent(event.target.value)}
                  disabled={row.recommendedPercent == null}
                  className="pr-7"
                />
                <span className="pointer-events-none absolute right-2.5 top-2 text-xs text-muted-foreground">
                  %
                </span>
              </div>
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-foreground">
                {isDifferentCpm ? "Reason for different CPM value" : "Review note (optional)"}
              </span>
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={
                  isDifferentCpm ? "Why is CPM different from Daily WIP?" : "Add context"
                }
              />
            </label>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Keep CPM as-is records that the recommendation was reviewed without changing the
            schedule or asking for an explanation.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canApply || reviewMutation.isPending}
              onClick={() =>
                reviewMutation.mutate({
                  decision: "kept",
                  value: row.currentPercent,
                  reviewNote: "",
                })
              }
            >
              Keep CPM as-is
            </Button>
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              disabled={!canApply || reviewMutation.isPending}
              onClick={() =>
                reviewMutation.mutate({
                  decision: "accepted",
                  value: row.recommendedPercent ?? row.currentPercent,
                  reviewNote: note,
                })
              }
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Accept recommendation
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!isDifferentCpm || reviewMutation.isPending || !note.trim()}
              onClick={() =>
                reviewMutation.mutate({
                  decision: "overridden",
                  value: accepted,
                  reviewNote: note,
                })
              }
            >
              Apply different CPM %
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

export function CpmProgressReviewPanel({ projectId }: { projectId: string }) {
  const loadContext = useServerFn(loadCpmProgressReviewContext);
  const query = useQuery({
    queryKey: ["cpm-progress-review", projectId],
    queryFn: () => loadContext({ data: { projectId } }),
  });

  return (
    <section className="rounded-xl border border-hairline bg-surface">
      <div className="border-b border-hairline px-5 py-4">
        <div className="eyebrow">Daily WIP → CPM</div>
        <h2 className="mt-1 font-serif text-[22px] font-normal text-foreground">
          Review field progress before it reaches the schedule
        </h2>
        <p className="mt-1 max-w-4xl text-sm leading-relaxed text-muted-foreground">
          OverWatch recommends activity progress from PM-reviewed Daily WIP. A project manager can
          accept it, keep CPM as-is with no explanation, or apply a different CPM value here.
        </p>
      </div>

      {query.isLoading ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          Building CPM progress recommendations…
        </div>
      ) : query.isError ? (
        <div className="px-5 py-8 text-center text-sm text-danger">
          {query.error instanceof Error
            ? query.error.message
            : "Unable to load CPM progress review."}
        </div>
      ) : !query.data?.enabled ? (
        <div className="px-5 py-8 text-center text-sm text-muted-foreground">
          CPM progress review will appear after Lovable applies the Slice 3 database migration.
        </div>
      ) : query.data.recommendations.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <ClipboardCheck className="mx-auto h-5 w-5 text-muted-foreground" />
          <div className="mt-2 font-medium text-foreground">No reviewed CPM evidence yet</div>
          <p className="mx-auto mt-1 max-w-2xl text-sm text-muted-foreground">
            Link a Daily Report work line to a schedule activity, set the percent basis to CPM or
            record an installed quantity, then review that line in Daily WIP.
          </p>
        </div>
      ) : (
        query.data.recommendations.map((row) => (
          <ActivityProgressReview
            key={`${row.id}:${row.basis}:${row.plannedQuantity ?? ""}:${row.unit}:${row.recommendedPercent ?? ""}:${row.currentPercent}`}
            projectId={projectId}
            row={row}
          />
        ))
      )}
    </section>
  );
}
