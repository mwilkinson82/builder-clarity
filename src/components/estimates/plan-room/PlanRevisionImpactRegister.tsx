import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ClipboardCheck, History, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  getPlanRevisionImpactReviews,
  savePlanRevisionImpactReview,
} from "@/lib/plan-revision-impact.functions";
import {
  revisionImpactActionLabel,
  revisionImpactActions,
  revisionImpactCategories,
  revisionImpactCategoryLabel,
  revisionImpactDispositionLabel,
  revisionImpactDispositions,
  revisionImpactDraftError,
  revisionImpactStatuses,
  type RevisionImpactAction,
  type RevisionImpactCategory,
  type RevisionImpactDisposition,
  type RevisionImpactItem,
  type RevisionImpactStatus,
} from "@/lib/plan-revision-impact";
import type { PlanRevisionMatchRow } from "@/lib/plan-revision-match.functions";

const reviewedAt = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Review time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const newImpact = (): RevisionImpactItem => ({
  id: crypto.randomUUID(),
  category: "modified",
  title: "",
  required_action: "scope_review",
  status: "open",
  notes: "",
});

export function PlanRevisionImpactRegister({
  estimateId,
  match,
  revisionSheetLabel,
  baseSheetLabel,
}: {
  estimateId: string;
  match: PlanRevisionMatchRow;
  revisionSheetLabel: string;
  baseSheetLabel: string;
}) {
  const qc = useQueryClient();
  const getReviewsFn = useServerFn(getPlanRevisionImpactReviews);
  const saveReviewFn = useServerFn(savePlanRevisionImpactReview);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [disposition, setDisposition] = useState<RevisionImpactDisposition>("needs_follow_up");
  const [summaryNotes, setSummaryNotes] = useState("");
  const [impacts, setImpacts] = useState<RevisionImpactItem[]>([]);

  const reviewsQuery = useQuery({
    queryKey: ["plan-revision-impact-reviews", estimateId],
    queryFn: () => getReviewsFn({ data: { estimate_id: estimateId } }),
  });

  const newestMatchReview = useMemo(
    () =>
      reviewsQuery.data?.reviews.find((review) => review.revision_match_id === match.id) ?? null,
    [match.id, reviewsQuery.data?.reviews],
  );
  const latestReview =
    newestMatchReview?.revision_sheet_id === match.revision_sheet_id &&
    newestMatchReview.base_sheet_id === match.base_sheet_id
      ? newestMatchReview
      : null;
  const schemaReady = reviewsQuery.data?.ready !== false;
  const openImpactCount =
    latestReview?.impacts.filter((impact) => impact.status === "open").length ?? 0;

  const openReview = () => {
    setDisposition(latestReview?.disposition ?? "needs_follow_up");
    setSummaryNotes(latestReview?.summary_notes ?? "");
    setImpacts(latestReview?.impacts.map((impact) => ({ ...impact })) ?? []);
    setReviewOpen(true);
  };

  const draftError = revisionImpactDraftError({ disposition, impacts });

  const saveMutation = useMutation({
    mutationFn: () =>
      saveReviewFn({
        data: {
          estimate_id: estimateId,
          revision_match_id: match.id,
          disposition,
          summary_notes: summaryNotes,
          impacts,
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["plan-revision-impact-reviews", estimateId] });
      setReviewOpen(false);
      toast.success("Revision impact review saved. No quantities or estimate values changed.");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Revision impact review did not save"),
  });

  const updateImpact = (id: string, patch: Partial<RevisionImpactItem>) => {
    setImpacts((current) =>
      current.map((impact) => (impact.id === id ? { ...impact, ...patch } : impact)),
    );
  };

  return (
    <div
      className="mt-3 rounded-md border border-hairline bg-surface p-2.5 text-xs"
      data-testid="plan-revision-impact-register"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            <ClipboardCheck className="h-3.5 w-3.5 text-primary" /> Revision impact register
          </p>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            The estimator records what the overlay proves. This review never edits geometry,
            takeoffs, or the estimate.
          </p>
        </div>
        {latestReview ? (
          <Badge variant={openImpactCount > 0 ? "secondary" : "outline"}>
            {revisionImpactDispositionLabel(latestReview.disposition)}
          </Badge>
        ) : (
          <Badge variant="outline">Not reviewed</Badge>
        )}
      </div>

      {!schemaReady ? (
        <p className="mt-2 rounded border border-dashed border-hairline p-2 text-[10px] text-muted-foreground">
          The revision impact register is waiting for its Lovable database migration.
        </p>
      ) : latestReview ? (
        <div className="mt-2 space-y-1 text-[10px] text-muted-foreground">
          <p>
            Version {latestReview.version} · {latestReview.reviewed_by_name} ·{" "}
            {reviewedAt(latestReview.reviewed_at)}
          </p>
          <p>
            {latestReview.impacts.length} logged · {openImpactCount} still open
          </p>
        </div>
      ) : newestMatchReview ? (
        <p className="mt-2 rounded border border-warning/30 bg-warning/10 p-2 text-[10px] text-muted-foreground">
          The accepted pair changed after version {newestMatchReview.version}. Review this pairing
          again before relying on the prior conclusion.
        </p>
      ) : null}

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="mt-2 h-7 w-full text-[11px]"
        onClick={openReview}
        disabled={!schemaReady || reviewsQuery.isPending}
        data-testid="plan-revision-impact-review-open"
      >
        {latestReview ? (
          <History className="mr-1.5 h-3 w-3" />
        ) : (
          <ClipboardCheck className="mr-1.5 h-3 w-3" />
        )}
        {latestReview ? "Update impact review" : "Review estimating impact"}
      </Button>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>Review revision estimating impact</DialogTitle>
            <DialogDescription>
              Compare the accepted pair, then record only the changes you personally verified.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
            <p className="flex items-center gap-2 font-medium text-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Estimator-controlled conclusion
            </p>
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
              AI did not determine the delta. Saving creates an append-only review version; it does
              not transfer takeoffs, retain scale, or change the estimate.
            </p>
          </div>

          <div className="grid gap-2 rounded-md border border-hairline bg-surface p-3 text-[11px] sm:grid-cols-2">
            <div>
              <p className="font-medium text-muted-foreground">Prior sheet</p>
              <p className="mt-0.5 text-foreground">{baseSheetLabel}</p>
            </div>
            <div>
              <p className="font-medium text-muted-foreground">Revision sheet</p>
              <p className="mt-0.5 text-foreground">{revisionSheetLabel}</p>
            </div>
          </div>

          <ScrollArea className="max-h-[56vh] pr-3">
            <div className="space-y-4 py-1">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Sheet disposition</Label>
                  <Select
                    value={disposition}
                    onValueChange={(value) => {
                      const next = value as RevisionImpactDisposition;
                      setDisposition(next);
                      if (next === "no_estimate_impact") setImpacts([]);
                    }}
                  >
                    <SelectTrigger
                      aria-label="Sheet impact disposition"
                      data-testid="plan-revision-impact-disposition"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {revisionImpactDispositions.map((value) => (
                        <SelectItem key={value} value={value}>
                          {revisionImpactDispositionLabel(value)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="revision-impact-summary" className="text-xs">
                    Review notes
                  </Label>
                  <Textarea
                    id="revision-impact-summary"
                    value={summaryNotes}
                    onChange={(event) => setSummaryNotes(event.target.value)}
                    maxLength={1500}
                    placeholder="What was compared, what remains uncertain, or why no estimating impact exists."
                    className="min-h-20"
                  />
                </div>
              </div>

              {disposition !== "no_estimate_impact" ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">Verified impacts</p>
                      <p className="text-[11px] text-muted-foreground">
                        Each item is a work queue, not an automatic quantity adjustment.
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => setImpacts((current) => [...current, newImpact()])}
                    >
                      <Plus className="mr-1.5 h-3.5 w-3.5" /> Add impact
                    </Button>
                  </div>

                  {impacts.length === 0 ? (
                    <p className="rounded-md border border-dashed border-hairline p-3 text-xs text-muted-foreground">
                      No impacts logged. Add one, or leave this sheet as Needs follow-up.
                    </p>
                  ) : (
                    impacts.map((impact, index) => (
                      <div
                        key={impact.id}
                        className="rounded-lg border border-hairline bg-surface p-3"
                        data-testid={`plan-revision-impact-${impact.id}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium text-foreground">Impact {index + 1}</p>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            aria-label={`Remove impact ${index + 1}`}
                            onClick={() =>
                              setImpacts((current) =>
                                current.filter((candidate) => candidate.id !== impact.id),
                              )
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <div className="mt-2 space-y-1.5">
                          <Label htmlFor={`revision-impact-title-${impact.id}`} className="text-xs">
                            Specific change
                          </Label>
                          <Input
                            id={`revision-impact-title-${impact.id}`}
                            value={impact.title}
                            onChange={(event) =>
                              updateImpact(impact.id, { title: event.target.value })
                            }
                            maxLength={160}
                            placeholder="Example: East wall increased 4 ft"
                          />
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs">Change type</Label>
                            <Select
                              value={impact.category}
                              onValueChange={(value) =>
                                updateImpact(impact.id, {
                                  category: value as RevisionImpactCategory,
                                })
                              }
                            >
                              <SelectTrigger aria-label={`Impact ${index + 1} change type`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {revisionImpactCategories.map((value) => (
                                  <SelectItem key={value} value={value}>
                                    {revisionImpactCategoryLabel(value)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Estimator action</Label>
                            <Select
                              value={impact.required_action}
                              onValueChange={(value) =>
                                updateImpact(impact.id, {
                                  required_action: value as RevisionImpactAction,
                                })
                              }
                            >
                              <SelectTrigger aria-label={`Impact ${index + 1} estimator action`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {revisionImpactActions.map((value) => (
                                  <SelectItem key={value} value={value}>
                                    {revisionImpactActionLabel(value)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Status</Label>
                            <Select
                              value={impact.status}
                              onValueChange={(value) =>
                                updateImpact(impact.id, { status: value as RevisionImpactStatus })
                              }
                            >
                              <SelectTrigger aria-label={`Impact ${index + 1} status`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {revisionImpactStatuses.map((value) => (
                                  <SelectItem key={value} value={value}>
                                    {value === "open" ? "Open" : "Resolved"}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="mt-3 space-y-1.5">
                          <Label htmlFor={`revision-impact-notes-${impact.id}`} className="text-xs">
                            Evidence and follow-up
                          </Label>
                          <Textarea
                            id={`revision-impact-notes-${impact.id}`}
                            value={impact.notes}
                            onChange={(event) =>
                              updateImpact(impact.id, { notes: event.target.value })
                            }
                            maxLength={1000}
                            placeholder="Describe what you saw in the overlay and what must be checked."
                            className="min-h-16"
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </ScrollArea>

          <DialogFooter className="items-center sm:justify-between">
            <p className="text-[10px] text-muted-foreground">
              {draftError ?? "A new immutable review version will be added to the audit history."}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setReviewOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => saveMutation.mutate()}
                disabled={Boolean(draftError) || saveMutation.isPending}
                data-testid="plan-revision-impact-save"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-2 h-4 w-4" />
                )}
                Save review version
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
