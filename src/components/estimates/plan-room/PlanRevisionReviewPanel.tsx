import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Bot, CheckCircle2, Link2, Loader2, ShieldCheck, XCircle } from "lucide-react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  analyzePlanRevisionSet,
  getPlanRevisionMatches,
  savePlanRevisionDecisions,
  type PlanRevisionMatchRow,
} from "@/lib/plan-revision-match.functions";
import {
  revisionMatchCredits,
  type PlanRevisionMatchProposal,
  type PlanRevisionReviewAction,
} from "@/lib/plan-revision-match";
import type { PlanSetRow, PlanSheetRow } from "@/lib/plan-room.functions";
import type { RevisionScopeAssistantResult } from "@/lib/plan-revision-scope-assistant";
import { cn } from "@/lib/utils";
import { PlanRevisionImpactRegister } from "./PlanRevisionImpactRegister";

type PendingReviewAction = PlanRevisionReviewAction | "pending";

interface RevisionDecision extends PlanRevisionMatchProposal {
  review_action: PendingReviewAction;
  ai_operation_id: string | null;
}

const sheetLabel = (sheet: PlanSheetRow | undefined, planSet: PlanSetRow | undefined) => {
  if (!sheet) return "Sheet not found";
  const identity = [sheet.sheet_number, sheet.sheet_name].filter(Boolean).join(" · ");
  return `${identity || `Page ${sheet.page_number}`} — ${planSet?.name || "Drawing set"}`;
};

const methodLabel = (method: PlanRevisionMatchProposal["method"]) => {
  if (method === "deterministic") return "Exact identity";
  if (method === "ai") return "AI metadata suggestion";
  if (method === "manual") return "Estimator selected";
  return "No suggestion";
};

export function PlanRevisionReviewPanel({
  estimateId,
  currentPlanSet,
  currentSheet,
  planSets,
  sheets,
  processingIdentity = false,
  onUseOverlay,
  onReviewRevisionNotes,
}: {
  estimateId: string;
  currentPlanSet: PlanSetRow | null;
  currentSheet: PlanSheetRow | null;
  planSets: PlanSetRow[];
  sheets: PlanSheetRow[];
  processingIdentity?: boolean;
  onUseOverlay: (sheetId: string) => void;
  onReviewRevisionNotes: (match: PlanRevisionMatchRow) => Promise<RevisionScopeAssistantResult>;
}) {
  const qc = useQueryClient();
  const getMatchesFn = useServerFn(getPlanRevisionMatches);
  const analyzeFn = useServerFn(analyzePlanRevisionSet);
  const saveDecisionsFn = useServerFn(savePlanRevisionDecisions);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [decisions, setDecisions] = useState<RevisionDecision[]>([]);

  const matchesQuery = useQuery({
    queryKey: ["plan-revision-matches", estimateId],
    queryFn: () => getMatchesFn({ data: { estimate_id: estimateId } }),
  });

  const planSetById = useMemo(
    () => new Map(planSets.map((planSet) => [planSet.id, planSet])),
    [planSets],
  );
  const sheetById = useMemo(() => new Map(sheets.map((sheet) => [sheet.id, sheet])), [sheets]);
  const priorPlanSets = useMemo(() => {
    if (!currentPlanSet) return [];
    return planSets
      .filter(
        (planSet) =>
          planSet.id !== currentPlanSet.id &&
          planSet.created_at < currentPlanSet.created_at &&
          (planSet.status === "current" || planSet.status === "superseded"),
      )
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
  }, [currentPlanSet, planSets]);
  const priorSetIds = useMemo(
    () => new Set(priorPlanSets.map((planSet) => planSet.id)),
    [priorPlanSets],
  );
  const priorSheets = useMemo(
    () =>
      sheets
        .filter((sheet) => priorSetIds.has(sheet.plan_set_id))
        .sort((left, right) => {
          const setOrder = (planSetById.get(right.plan_set_id)?.created_at ?? "").localeCompare(
            planSetById.get(left.plan_set_id)?.created_at ?? "",
          );
          return setOrder || left.sort_order - right.sort_order;
        }),
    [planSetById, priorSetIds, sheets],
  );

  const currentAcceptedMatch = useMemo(() => {
    if (!currentSheet) return null;
    return (
      matchesQuery.data?.matches.find(
        (match) =>
          match.review_action === "accepted" &&
          (match.revision_sheet_id === currentSheet.id || match.base_sheet_id === currentSheet.id),
      ) ?? null
    );
  }, [currentSheet, matchesQuery.data?.matches]);
  const acceptedCounterpartId = !currentAcceptedMatch
    ? null
    : currentAcceptedMatch.revision_sheet_id === currentSheet?.id
      ? currentAcceptedMatch.base_sheet_id
      : currentAcceptedMatch.revision_sheet_id;
  const acceptedCounterpart = acceptedCounterpartId
    ? sheetById.get(acceptedCounterpartId)
    : undefined;
  const acceptedCounterpartSet = acceptedCounterpart
    ? planSetById.get(acceptedCounterpart.plan_set_id)
    : undefined;

  const reviewedCurrentSet = currentPlanSet
    ? (matchesQuery.data?.matches.filter(
        (match) => match.revision_plan_set_id === currentPlanSet.id,
      ).length ?? 0)
    : 0;
  const currentSetSheetCount = currentPlanSet
    ? sheets.filter((sheet) => sheet.plan_set_id === currentPlanSet.id).length
    : 0;
  const credits = revisionMatchCredits(currentSetSheetCount || currentPlanSet?.page_count || 0);
  const schemaReady = matchesQuery.data?.ready !== false;

  const analyzeMutation = useMutation({
    mutationFn: () => {
      if (!currentPlanSet) throw new Error("Choose a revision drawing set first.");
      return analyzeFn({
        data: { estimate_id: estimateId, revision_plan_set_id: currentPlanSet.id },
      });
    },
    onSuccess: (result) => {
      setDecisions(
        result.proposals.map((proposal) => ({
          ...proposal,
          review_action: "pending",
          ai_operation_id:
            proposal.method === "deterministic" ? null : (result.operation_id ?? null),
        })),
      );
      setReviewOpen(true);
      toast.success(
        `${result.proposals.length} revision page${result.proposals.length === 1 ? "" : "s"} ready for estimator review.`,
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Revision matching did not complete"),
  });

  const allReviewed =
    decisions.length > 0 && decisions.every((decision) => decision.review_action !== "pending");
  const reviewedCount = decisions.filter((decision) => decision.review_action !== "pending").length;

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!currentPlanSet || !allReviewed) {
        throw new Error("Review every revision page before saving decisions.");
      }
      return saveDecisionsFn({
        data: {
          estimate_id: estimateId,
          revision_plan_set_id: currentPlanSet.id,
          decisions: decisions.map((decision) => ({
            revision_sheet_id: decision.revision_sheet_id,
            base_sheet_id: decision.base_sheet_id,
            method: decision.method,
            confidence: decision.confidence,
            evidence: decision.evidence,
            reason: decision.reason,
            review_action: decision.review_action as PlanRevisionReviewAction,
            ai_operation_id:
              decision.method === "ai" || decision.method === "unmatched"
                ? decision.ai_operation_id
                : null,
          })),
        },
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["plan-revision-matches", estimateId] });
      setReviewOpen(false);
      setDecisions([]);
      toast.success("Revision decisions saved. No takeoffs, scales, or estimate values changed.");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Revision decisions did not save"),
  });

  const updateDecision = (
    revisionSheetId: string,
    update: (decision: RevisionDecision) => RevisionDecision,
  ) => {
    setDecisions((current) =>
      current.map((decision) =>
        decision.revision_sheet_id === revisionSheetId ? update(decision) : decision,
      ),
    );
  };

  return (
    <div
      className="rounded-md border border-primary/20 bg-primary/5 p-3"
      data-testid="plan-revision-review-panel"
    >
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground">Estimator-controlled sheet matching</p>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            Exact identity rules run first. AI only ranks ambiguous sheet metadata; it never
            compares geometry or changes project data.
          </p>
        </div>
      </div>

      {currentAcceptedMatch && acceptedCounterpart ? (
        <div className="mt-3">
          <div className="rounded-md border border-success/30 bg-success/10 p-2.5 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 font-medium text-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" /> Accepted counterpart
                </p>
                <p className="mt-1 truncate text-muted-foreground">
                  {sheetLabel(acceptedCounterpart, acceptedCounterpartSet)}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 shrink-0 px-2 text-[11px]"
                onClick={() => onUseOverlay(acceptedCounterpart.id)}
              >
                <Link2 className="mr-1 h-3 w-3" /> Use overlay
              </Button>
            </div>
          </div>

          <PlanRevisionImpactRegister
            estimateId={estimateId}
            match={currentAcceptedMatch}
            revisionSheetLabel={sheetLabel(
              sheetById.get(currentAcceptedMatch.revision_sheet_id),
              planSetById.get(
                sheetById.get(currentAcceptedMatch.revision_sheet_id)?.plan_set_id ?? "",
              ),
            )}
            baseSheetLabel={sheetLabel(
              sheetById.get(currentAcceptedMatch.base_sheet_id ?? ""),
              planSetById.get(
                sheetById.get(currentAcceptedMatch.base_sheet_id ?? "")?.plan_set_id ?? "",
              ),
            )}
            onReviewRevisionNotes={() => onReviewRevisionNotes(currentAcceptedMatch)}
          />
        </div>
      ) : null}

      {!schemaReady ? (
        <p className="mt-3 rounded-md border border-dashed border-hairline p-2 text-[11px] text-muted-foreground">
          Revision matching isn't available yet.
        </p>
      ) : null}

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="mt-3 w-full"
        onClick={() => analyzeMutation.mutate()}
        disabled={
          !schemaReady ||
          !currentPlanSet ||
          priorSheets.length === 0 ||
          processingIdentity ||
          analyzeMutation.isPending
        }
        data-testid="plan-revision-analyze"
      >
        {analyzeMutation.isPending || processingIdentity ? (
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Bot className="mr-2 h-3.5 w-3.5" />
        )}
        {processingIdentity
          ? "Reading title blocks before matching"
          : analyzeMutation.isPending
            ? "Matching sheet identity"
            : `Match this set · up to ${credits} AI credit${credits === 1 ? "" : "s"}`}
      </Button>

      {decisions.length > 0 && !reviewOpen ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="mt-1 w-full text-xs"
          onClick={() => setReviewOpen(true)}
        >
          Resume unsaved review · {reviewedCount}/{decisions.length} pages reviewed
        </Button>
      ) : null}

      <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
        {priorSheets.length === 0
          ? "Select a sheet from a newer uploaded set to compare it with retained prior drawings."
          : reviewedCurrentSet > 0
            ? `${reviewedCurrentSet} of ${currentSetSheetCount} pages have saved decisions. Re-running creates a new review, not an automatic change.`
            : "You will accept, reject, correct, or mark every proposed pairing as no match before anything is saved."}
      </p>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>Review revision sheet matches</DialogTitle>
            <DialogDescription>
              Evidence is sheet metadata only. Review every page; accepting a pair only makes it
              available to the existing visual overlay.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between rounded-md border border-hairline bg-surface px-3 py-2 text-xs">
            <span className="flex items-center gap-2 text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" /> No geometry comparison · no
              takeoff transfer · no estimate change
            </span>
            <Badge variant="outline">
              {reviewedCount}/{decisions.length} reviewed
            </Badge>
          </div>

          <ScrollArea className="max-h-[58vh] pr-3">
            <div className="space-y-3 py-1">
              {decisions.map((decision) => {
                const revisionSheet = sheetById.get(decision.revision_sheet_id);
                const revisionSet = revisionSheet
                  ? planSetById.get(revisionSheet.plan_set_id)
                  : undefined;
                return (
                  <div
                    key={decision.revision_sheet_id}
                    className={cn(
                      "rounded-lg border p-3",
                      decision.review_action === "accepted" && "border-success/40 bg-success/5",
                      decision.review_action === "rejected" &&
                        "border-destructive/30 bg-destructive/5",
                      decision.review_action === "unmatched" && "border-hairline bg-surface",
                    )}
                    data-testid={`plan-revision-decision-${decision.revision_sheet_id}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground">Revision page</p>
                        <p className="mt-0.5 truncate text-sm text-foreground">
                          {sheetLabel(revisionSheet, revisionSet)}
                        </p>
                      </div>
                      <Badge variant="outline">{methodLabel(decision.method)}</Badge>
                    </div>

                    <div className="mt-3">
                      <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                        Proposed prior sheet
                      </p>
                      <Select
                        value={decision.base_sheet_id ?? "none"}
                        onValueChange={(baseSheetId) =>
                          updateDecision(decision.revision_sheet_id, (current) => ({
                            ...current,
                            base_sheet_id: baseSheetId === "none" ? null : baseSheetId,
                            method: baseSheetId === "none" ? "unmatched" : "manual",
                            confidence: 0,
                            evidence:
                              baseSheetId === "none"
                                ? current.evidence
                                : ["Estimator selected a different retained prior sheet."],
                            reason:
                              baseSheetId === "none"
                                ? "Estimator is reviewing this page as having no prior match."
                                : "Estimator selected the prior sheet manually.",
                            review_action: "pending",
                            ai_operation_id: null,
                          }))
                        }
                      >
                        <SelectTrigger data-testid="plan-revision-prior-sheet-select">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No prior sheet selected</SelectItem>
                          {priorSheets.map((sheet) => (
                            <SelectItem key={sheet.id} value={sheet.id}>
                              {sheetLabel(sheet, planSetById.get(sheet.plan_set_id)).slice(0, 110)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {decision.reason ? (
                      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                        {decision.reason}
                      </p>
                    ) : null}
                    {decision.evidence.length > 0 ? (
                      <ul className="mt-2 space-y-0.5 text-[10px] text-muted-foreground">
                        {decision.evidence.map((evidence) => (
                          <li key={evidence}>• {evidence}</li>
                        ))}
                      </ul>
                    ) : null}
                    {decision.method !== "manual" && decision.method !== "unmatched" ? (
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        Proposal confidence: {Math.round(decision.confidence * 100)}%
                      </p>
                    ) : null}

                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <Button
                        type="button"
                        size="sm"
                        variant={decision.review_action === "accepted" ? "default" : "outline"}
                        disabled={!decision.base_sheet_id}
                        onClick={() =>
                          updateDecision(decision.revision_sheet_id, (current) => ({
                            ...current,
                            review_action: "accepted",
                          }))
                        }
                      >
                        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Accept pair
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={decision.review_action === "rejected" ? "destructive" : "outline"}
                        disabled={!decision.base_sheet_id}
                        onClick={() =>
                          updateDecision(decision.revision_sheet_id, (current) => ({
                            ...current,
                            review_action: "rejected",
                          }))
                        }
                      >
                        <XCircle className="mr-1.5 h-3.5 w-3.5" /> Reject suggestion
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={decision.review_action === "unmatched" ? "secondary" : "outline"}
                        onClick={() =>
                          updateDecision(decision.revision_sheet_id, (current) => ({
                            ...current,
                            base_sheet_id: null,
                            method: "unmatched",
                            confidence: 0,
                            reason:
                              "Estimator marked no retained prior sheet as the correct match.",
                            review_action: "unmatched",
                          }))
                        }
                      >
                        No prior match
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReviewOpen(false)}>
              Keep reviewing later
            </Button>
            <Button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={!allReviewed || saveMutation.isPending}
              data-testid="plan-revision-save-decisions"
            >
              {saveMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="mr-2 h-4 w-4" />
              )}
              Save reviewed decisions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
