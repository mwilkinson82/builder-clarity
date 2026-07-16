import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  Clock3,
  FileSearch,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  getPlanScopeBriefReviews,
  savePlanScopeBriefReview,
} from "@/lib/plan-scope-brief-review.functions";
import {
  defaultScopeBriefNextAction,
  latestPlanScopeBriefReviews,
  PLAN_SCOPE_BRIEF_NEXT_ACTIONS,
  planScopeBriefNextActionLabel,
  planScopeBriefReviewDraftError,
  planScopeBriefReviewStatusLabel,
  type PlanScopeBriefNextAction,
  type PlanScopeBriefReview,
  type PlanScopeBriefReviewStatus,
} from "@/lib/plan-scope-brief-review";
import { getPlanScopeBrief } from "@/lib/plan-scope-brief.functions";
import {
  PLAN_SCOPE_BRIEF_REVIEW_KINDS,
  type PlanScopeBriefItem,
  type PlanScopeBriefReviewKind,
} from "@/lib/plan-scope-brief";
import type { PlanSetRow } from "@/lib/plan-room.functions";

type BriefFilter = "all" | PlanScopeBriefReviewKind;

const reviewedAt = (value: string) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Review time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const generatedDate = (value: string) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Brief recorded";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const reviewKindLabel = (value: PlanScopeBriefReviewKind) => {
  if (value === "count") return "Count review";
  if (value === "linear") return "Length review";
  if (value === "area") return "Area review";
  if (value === "assembly") return "Assembly review";
  if (value === "allowance") return "Pricing / allowance";
  return "Scope coordination";
};

export function PlanScopeBriefPanel({
  estimateId,
  planSet,
  pending,
  progress,
  evidencePending,
  onGenerate,
  onOpenEvidence,
}: {
  estimateId: string;
  planSet: PlanSetRow | null;
  pending: boolean;
  progress: string;
  evidencePending: boolean;
  onGenerate: () => void;
  onOpenEvidence: (item: PlanScopeBriefItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<BriefFilter>("all");
  const [reviewItem, setReviewItem] = useState<PlanScopeBriefItem | null>(null);
  const [reviewStatus, setReviewStatus] = useState<PlanScopeBriefReviewStatus>("accepted");
  const [nextAction, setNextAction] = useState<PlanScopeBriefNextAction>("scope_coordination");
  const [reviewNotes, setReviewNotes] = useState("");
  const qc = useQueryClient();
  const getBriefFn = useServerFn(getPlanScopeBrief);
  const getReviewsFn = useServerFn(getPlanScopeBriefReviews);
  const saveReviewFn = useServerFn(savePlanScopeBriefReview);
  const briefQuery = useQuery({
    queryKey: ["plan-scope-brief", estimateId, planSet?.id],
    queryFn: () =>
      getBriefFn({ data: { estimate_id: estimateId, plan_set_id: planSet?.id ?? "" } }),
    enabled: Boolean(planSet?.id),
  });
  const brief = briefQuery.data?.brief ?? null;
  const reviewsQuery = useQuery({
    queryKey: ["plan-scope-brief-reviews", estimateId, planSet?.id],
    queryFn: () =>
      getReviewsFn({ data: { estimate_id: estimateId, plan_set_id: planSet?.id ?? "" } }),
    enabled: Boolean(planSet?.id),
  });
  const latestReviews = useMemo(
    () => latestPlanScopeBriefReviews(reviewsQuery.data?.reviews ?? []),
    [reviewsQuery.data?.reviews],
  );
  const currentReviews = useMemo(
    () => (brief?.items ?? []).flatMap((item) => latestReviews.get(item.id) ?? []),
    [brief?.items, latestReviews],
  );
  const reviewedCount = currentReviews.length;
  const filteredItems = useMemo(
    () => (brief?.items ?? []).filter((item) => filter === "all" || item.review_kind === filter),
    [brief?.items, filter],
  );
  const groupedItems = useMemo(() => {
    const groups = new Map<string, PlanScopeBriefItem[]>();
    for (const item of filteredItems) {
      const current = groups.get(item.trade) ?? [];
      current.push(item);
      groups.set(item.trade, current);
    }
    return [...groups.entries()];
  }, [filteredItems]);
  const selectedExistingReview = reviewItem ? (latestReviews.get(reviewItem.id) ?? null) : null;
  const selectedDefaultAction = reviewItem
    ? defaultScopeBriefNextAction(reviewItem.review_kind)
    : "scope_coordination";
  const reviewError = reviewItem
    ? planScopeBriefReviewDraftError({
        status: reviewStatus,
        nextAction,
        defaultAction: selectedDefaultAction,
        notes: reviewNotes,
      })
    : null;
  const saveReviewMutation = useMutation({
    mutationFn: () => {
      if (!brief || !reviewItem) throw new Error("Choose a cited prompt first.");
      return saveReviewFn({
        data: {
          ai_operation_id: brief.operation_id,
          item_id: reviewItem.id,
          status: reviewStatus,
          next_action: reviewStatus === "excluded" ? "none" : nextAction,
          review_notes: reviewNotes,
        },
      });
    },
    onSuccess: ({ review }) => {
      qc.setQueryData(
        ["plan-scope-brief-reviews", estimateId, planSet?.id],
        (current: { reviews: PlanScopeBriefReview[]; ready: boolean } | undefined) => ({
          reviews: [review, ...(current?.reviews ?? [])],
          ready: true,
        }),
      );
      setReviewItem(null);
      toast.success(
        review.status === "accepted"
          ? "Scope kept in the estimator action register."
          : review.status === "deferred"
            ? "Scope deferred with its cited evidence retained."
            : "Scope excluded with the estimator's reason retained.",
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The Scope Brief decision did not save"),
  });

  const beginReview = (item: PlanScopeBriefItem) => {
    const existing = latestReviews.get(item.id);
    const defaultAction = defaultScopeBriefNextAction(item.review_kind);
    setReviewItem(item);
    setReviewStatus(existing?.status ?? "accepted");
    setNextAction(
      existing?.next_action === "none" ? defaultAction : (existing?.next_action ?? defaultAction),
    );
    setReviewNotes(existing?.review_notes ?? "");
  };

  const selectStatus = (status: PlanScopeBriefReviewStatus) => {
    setReviewStatus(status);
    if (status === "excluded") setNextAction("none");
    else if (nextAction === "none") setNextAction(selectedDefaultAction);
  };

  return (
    <>
      <section
        className="rounded-lg border border-hairline bg-card p-4 shadow-card"
        data-testid="plan-scope-brief-launcher"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="eyebrow flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> AI estimator briefing
            </div>
            <h2 className="mt-1 font-serif text-xl">Estimator Scope Brief</h2>
          </div>
          <Badge variant="outline">
            {brief
              ? `${brief.items.length} cited · ${reviewedCount} decided`
              : briefQuery.isLoading
                ? "Loading"
                : "Not built"}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Reads selectable plan notes across this set and organizes cited scope for estimator
          review. It does not take off, measure, price, or certify completeness.
        </p>

        {brief ? (
          <div className="mt-3 grid grid-cols-3 gap-2 border-y border-hairline py-2 text-center">
            <div className="border-r border-hairline px-1">
              <p className="font-serif text-lg text-foreground">{brief.items.length}</p>
              <p className="text-[10px] text-muted-foreground">scope prompts</p>
            </div>
            <div className="border-r border-hairline px-1">
              <p className="font-serif text-lg text-foreground">{brief.cited_sheet_count}</p>
              <p className="text-[10px] text-muted-foreground">cited sheets</p>
            </div>
            <div className="px-1">
              <p className="font-serif text-lg text-foreground">
                {brief.source_sheet_count}/{brief.total_sheet_count}
              </p>
              <p className="text-[10px] text-muted-foreground">note evidence</p>
            </div>
          </div>
        ) : null}

        {briefQuery.data?.ready === false ? (
          <p className="mt-3 text-xs text-warning">
            Scope Brief audit history is waiting for its Lovable migration.
          </p>
        ) : null}
        {reviewsQuery.data?.ready === false ? (
          <p className="mt-3 text-xs text-warning">
            Scope Brief decisions are waiting for their Lovable migration.
          </p>
        ) : null}
        {pending && progress ? (
          <p className="mt-3 text-xs text-muted-foreground">{progress}</p>
        ) : null}

        <div className="mt-3 grid gap-2">
          {brief ? (
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              onClick={() => setOpen(true)}
            >
              <BookOpenCheck className="h-4 w-4" /> Open cited brief
            </Button>
          ) : null}
          <Button
            type="button"
            variant={brief ? "ghost" : "outline"}
            className="gap-1.5"
            disabled={!planSet || pending}
            onClick={onGenerate}
          >
            <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
            {pending
              ? "Building cited brief…"
              : brief
                ? "Refresh brief · 2 credits"
                : "Build brief · 2 credits"}
          </Button>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          One plan-set brief = 2 credits. Platform admins are unmetered.
        </p>
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88vh] max-w-6xl overflow-hidden p-0">
          <DialogHeader className="border-b border-hairline px-6 py-5">
            <div className="eyebrow flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> Estimator-controlled cited brief
            </div>
            <DialogTitle className="font-serif text-2xl">Estimator Scope Brief</DialogTitle>
            <DialogDescription>
              {planSet?.name || planSet?.source_file_name || "Current drawing set"}. AI organized
              cited review prompts; it did not measure, count, infer assemblies, price, or verify
              that the set is complete.
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-y-auto px-6 py-5">
            {brief ? (
              <>
                <div className="grid gap-px overflow-hidden rounded-lg border border-hairline bg-hairline sm:grid-cols-5">
                  {[
                    ["Cited prompts", String(brief.items.length)],
                    ["Estimator decisions", `${reviewedCount} / ${brief.items.length}`],
                    ["Cited sheets", String(brief.cited_sheet_count)],
                    ["Note evidence", `${brief.source_sheet_count} / ${brief.total_sheet_count}`],
                    ["Generated", generatedDate(brief.generated_at)],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-card px-4 py-3">
                      <p className="eyebrow">{label}</p>
                      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Scope brief filters">
                  <Button
                    type="button"
                    size="sm"
                    variant={filter === "all" ? "secondary" : "ghost"}
                    className="h-8 text-xs"
                    onClick={() => setFilter("all")}
                  >
                    All {brief.items.length}
                  </Button>
                  {PLAN_SCOPE_BRIEF_REVIEW_KINDS.map((kind) => {
                    const count = brief.items.filter((item) => item.review_kind === kind).length;
                    if (count === 0) return null;
                    return (
                      <Button
                        key={kind}
                        type="button"
                        size="sm"
                        variant={filter === kind ? "secondary" : "ghost"}
                        className="h-8 text-xs"
                        onClick={() => setFilter(kind)}
                      >
                        {reviewKindLabel(kind)} {count}
                      </Button>
                    );
                  })}
                </div>

                {brief.warnings.length > 0 ? (
                  <div className="mt-4 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-warning">
                    {brief.warnings.map((warning) => (
                      <p key={warning}>{warning}</p>
                    ))}
                  </div>
                ) : null}

                {groupedItems.length === 0 ? (
                  <div className="mt-4 rounded-md border border-dashed border-hairline p-4 text-sm text-muted-foreground">
                    No cited prompts match this filter.
                  </div>
                ) : (
                  <div className="mt-5 space-y-5" data-testid="plan-scope-brief-items">
                    {groupedItems.map(([trade, items]) => (
                      <section key={trade}>
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <h3 className="font-serif text-lg">{trade}</h3>
                          <Badge variant="outline">{items.length} prompts</Badge>
                        </div>
                        <div className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline">
                          {items.map((item) => (
                            <div key={item.id} className="bg-card px-4 py-3">
                              {(() => {
                                const decision = latestReviews.get(item.id);
                                return (
                                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_190px] lg:items-start">
                                    <div>
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="text-sm font-medium text-foreground">
                                          {item.scope_label}
                                        </span>
                                        <Badge variant="secondary">
                                          {reviewKindLabel(item.review_kind)}
                                        </Badge>
                                        {decision ? (
                                          <Badge
                                            variant="outline"
                                            data-testid={`scope-brief-decision-${item.id}`}
                                          >
                                            {planScopeBriefReviewStatusLabel(decision.status)}
                                          </Badge>
                                        ) : (
                                          <Badge variant="outline">Awaiting estimator</Badge>
                                        )}
                                      </div>
                                      <p className="mt-1 text-[11px] text-muted-foreground">
                                        {item.sheet_number || "Unnumbered"} · {item.source_line} · “
                                        {item.source_excerpt}”
                                      </p>
                                      <p className="mt-2 text-xs text-foreground">
                                        {item.estimator_prompt}
                                      </p>
                                      {decision ? (
                                        <div className="mt-2 text-[10px] text-muted-foreground">
                                          <p>
                                            {decision.reviewed_by_name} ·{" "}
                                            {reviewedAt(decision.reviewed_at)} · v{decision.version}
                                          </p>
                                          <p className="mt-0.5 text-foreground">
                                            {planScopeBriefNextActionLabel(decision.next_action)}
                                          </p>
                                          {decision.review_notes ? (
                                            <p className="mt-1">{decision.review_notes}</p>
                                          ) : null}
                                        </div>
                                      ) : null}
                                    </div>
                                    <div className="grid gap-1.5">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="gap-1.5"
                                        disabled={evidencePending}
                                        onClick={() => onOpenEvidence(item)}
                                      >
                                        <FileSearch className="h-3.5 w-3.5" /> Open cited sheet
                                        <ArrowRight className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant={decision ? "ghost" : "default"}
                                        className="gap-1.5"
                                        disabled={reviewsQuery.data?.ready === false}
                                        onClick={() => beginReview(item)}
                                      >
                                        {decision ? (
                                          <Clock3 className="h-3.5 w-3.5" />
                                        ) : (
                                          <CheckCircle2 className="h-3.5 w-3.5" />
                                        )}
                                        {decision ? "Update decision" : "Record decision"}
                                      </Button>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-md border border-dashed border-hairline p-4 text-sm text-muted-foreground">
                Build the brief from the Plan Room to create a cited estimator checklist.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(reviewItem)} onOpenChange={(value) => !value && setReviewItem(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <div className="eyebrow flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> Human estimator decision
            </div>
            <DialogTitle className="font-serif text-2xl">
              {reviewItem?.scope_label || "Review cited scope"}
            </DialogTitle>
            <DialogDescription>
              This records a review route only. It does not measure, count, price, link, or change
              the estimate.
            </DialogDescription>
          </DialogHeader>

          {reviewItem ? (
            <div className="space-y-5">
              <div className="rounded-md border border-hairline bg-muted/40 px-4 py-3">
                <p className="text-xs font-medium text-foreground">
                  {reviewItem.sheet_number || "Unnumbered"} · {reviewItem.source_line}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">“{reviewItem.source_excerpt}”</p>
              </div>

              <div>
                <Label>Estimator disposition</Label>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {(
                    [
                      ["accepted", "Keep", "Retain this in the action register."],
                      ["deferred", "Later", "Retain the evidence for later review."],
                      ["excluded", "Exclude", "Do not route this prompt into review work."],
                    ] as Array<[PlanScopeBriefReviewStatus, string, string]>
                  ).map(([status, label, description]) => (
                    <Button
                      key={status}
                      type="button"
                      variant={reviewStatus === status ? "secondary" : "outline"}
                      className="h-auto items-start justify-start px-3 py-3 text-left"
                      onClick={() => selectStatus(status)}
                    >
                      <span>
                        <span className="block text-xs font-medium">{label}</span>
                        <span className="mt-1 block whitespace-normal text-[10px] font-normal text-muted-foreground">
                          {description}
                        </span>
                      </span>
                    </Button>
                  ))}
                </div>
              </div>

              {reviewStatus !== "excluded" ? (
                <div>
                  <Label htmlFor="scope-brief-next-action">Next estimator action</Label>
                  <Select
                    value={nextAction}
                    onValueChange={(value) => setNextAction(value as PlanScopeBriefNextAction)}
                  >
                    <SelectTrigger id="scope-brief-next-action" className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PLAN_SCOPE_BRIEF_NEXT_ACTIONS.filter((action) => action !== "none").map(
                        (action) => (
                          <SelectItem key={action} value={action}>
                            {planScopeBriefNextActionLabel(action)}
                            {action === selectedDefaultAction ? " · suggested" : ""}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    The cited review type suggests a route; the estimator may change it with a note.
                  </p>
                </div>
              ) : null}

              <div>
                <Label htmlFor="scope-brief-review-notes">
                  {reviewStatus === "excluded" ? "Exclusion reason" : "Review note"}
                </Label>
                <Textarea
                  id="scope-brief-review-notes"
                  className="mt-2 min-h-24"
                  value={reviewNotes}
                  maxLength={1000}
                  placeholder={
                    reviewStatus === "excluded"
                      ? "Why does this cited prompt not belong in the estimate review?"
                      : "Optional unless you change the suggested next action."
                  }
                  onChange={(event) => setReviewNotes(event.target.value)}
                />
                <p className="mt-1 text-right text-[10px] text-muted-foreground">
                  {reviewNotes.length}/1000
                </p>
              </div>

              {selectedExistingReview ? (
                <p className="text-[10px] text-muted-foreground">
                  Saving creates version {selectedExistingReview.version + 1}; version{" "}
                  {selectedExistingReview.version}
                  remains in the audit history.
                </p>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReviewItem(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={Boolean(reviewError) || saveReviewMutation.isPending}
              onClick={() => saveReviewMutation.mutate()}
            >
              {saveReviewMutation.isPending ? "Saving decision…" : "Save decision"}
            </Button>
          </DialogFooter>
          {reviewError ? <p className="text-xs text-warning">{reviewError}</p> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
