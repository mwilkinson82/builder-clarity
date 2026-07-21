import { useState, useEffect, useMemo } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Trash2, AlertTriangle, Diamond } from "lucide-react";
import { cn } from "@/lib/utils";
import { type ScheduleActivityRow, type ScheduleDelayFragmentRow } from "@/lib/schedule.functions";
import {
  isConstructLineMilestoneActivity,
  parseConstructLineDependencyToken,
} from "@/lib/constructline-cpm";
import {
  type DelayFragmentCreateInput,
  type DelayFragmentPatchInput,
  type ScheduleUpdateQueueDialogContext,
  parsePercent,
  parseRemainingDuration,
  shortDate,
} from "./scheduleShared";
import {
  buildDelayFragmentSummary,
  getDelayFragmentsForActivity,
  groupDelayFragmentsByActivity,
} from "./scheduleUpdateDraft";
import {
  hasScheduleActivityActualStartBasis,
  shouldFlagMissingActualStart,
  shouldFlagMissingExpectedFinish,
  shouldFlagMissingRemainingDuration,
} from "./scheduleUpdateReadiness";
import {
  type ActivityDraft,
  activityDraftFromRow,
  applyOpenDelayToDraftForecast,
  buildActivityUpdateImpact,
  getMilestoneDraftDate,
  parseActivityIds,
  parseActivityTokens,
  serializeActivityLinksToArray,
  toggleMilestoneDraft,
  updateDraftActualFinishDate,
  updateDraftActualStartDate,
  updateDraftBaselineFinishDate,
  updateDraftBaselineStartDate,
  updateDraftForecastFinishDate,
  updateDraftForecastStartDate,
  updateDraftPercentComplete,
  updateDraftRemainingDuration,
  validateActivityDraft,
} from "./scheduleActivityDraft";
import { getDateDurationDays } from "./ScheduleSnapshotTimeline";
import { ScheduleWorkbenchStat } from "./CpmWorkbenchPanels";
import { ActivityDivisionInput, LabeledField } from "./WbsManager";
import { ActivityDependencyPicker } from "./ScheduleActivityRegister";
import { ActivityDelayFragmentPanel } from "./ScheduleDelayFragments";

// One relationship per line: type, target, lag — scannable at a glance.
function ActivityRelationshipRows({
  tokens,
  activities,
  emptyLabel,
}: {
  tokens: string[];
  activities: ScheduleActivityRow[];
  emptyLabel: string;
}) {
  if (tokens.length === 0) {
    return <div className="mt-1 text-sm font-semibold text-muted-foreground">{emptyLabel}</div>;
  }
  return (
    <div className="mt-1 grid min-w-0 gap-1">
      {tokens.map((token) => {
        const link = parseConstructLineDependencyToken(token);
        const target = activities.find(
          (candidate) => candidate.activity_id.trim() === link.activityId,
        );
        return (
          <div
            key={token}
            className="flex min-w-0 items-center gap-2 rounded border border-hairline bg-surface px-2 py-1 text-xs"
          >
            <span className="w-8 shrink-0 font-semibold tabular text-foreground">
              {link.relationshipType}
            </span>
            <span className="min-w-0 flex-1 truncate">
              <span className="font-semibold tabular text-foreground">{link.activityId}</span>
              {target ? <span className="text-muted-foreground"> · {target.name}</span> : null}
            </span>
            <span className="shrink-0 tabular text-muted-foreground">
              {link.lagDays === 0 ? "0d lag" : `${link.lagDays > 0 ? "+" : ""}${link.lagDays}d lag`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ActivityDetailDialog({
  activity,
  activities,
  dataDate,
  isCriticalPath = false,
  updateQueueContext,
  divisionOptions,
  delayFragments,
  isSaving,
  isSavingDelayFragment,
  onClose,
  onSave,
  onSaveAndContinue,
  onDelete,
  onAddDelayFragment,
  onPatchDelayFragment,
  onDeleteDelayFragment,
  isSendingToRiskTally,
  onSendToRiskTally,
}: {
  activity: ScheduleActivityRow;
  activities: ScheduleActivityRow[];
  dataDate: string | null;
  isCriticalPath?: boolean;
  updateQueueContext: ScheduleUpdateQueueDialogContext | null;
  divisionOptions: string[];
  delayFragments: ScheduleDelayFragmentRow[];
  isSaving: boolean;
  isSavingDelayFragment: boolean;
  onClose: () => void;
  onSave: (patch: Partial<ScheduleActivityRow>) => Promise<void>;
  onSaveAndContinue: (nextActivity: ScheduleActivityRow | null) => void;
  onDelete: () => void;
  onAddDelayFragment: (fragment: DelayFragmentCreateInput) => Promise<void>;
  onPatchDelayFragment: (id: string, patch: DelayFragmentPatchInput) => Promise<void>;
  onDeleteDelayFragment: (id: string) => Promise<void>;
  isSendingToRiskTally: boolean;
  onSendToRiskTally: (activity: ScheduleActivityRow) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<ActivityDraft>(() => activityDraftFromRow(activity));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const plannedDuration = getDateDurationDays(
    activity.baseline_start_date ?? activity.start_date,
    activity.baseline_finish_date ?? activity.finish_date,
  );
  const isMilestone = isConstructLineMilestoneActivity(activity);
  const hasActualStartBasis = hasScheduleActivityActualStartBasis(activity);
  const draftPercentComplete = parsePercent(draft.percent_complete);
  const draftHasActualStartBasis =
    Boolean(draft.actual_start_date) || Boolean(draft.actual_finish_date);
  const enteredRemainingDuration =
    isMilestone || activity.percent_complete >= 100 || !hasActualStartBasis
      ? null
      : activity.remaining_duration_days;
  const inferredRemainingDuration =
    isMilestone || activity.percent_complete >= 100 || !hasActualStartBasis
      ? null
      : getDateDurationDays(
          dataDate ?? activity.forecast_start_date ?? activity.start_date,
          activity.forecast_finish_date ?? activity.finish_date,
        );
  const remainingDuration =
    isMilestone || activity.percent_complete >= 100
      ? 0
      : (enteredRemainingDuration ?? inferredRemainingDuration);
  const needsRemainingDuration = shouldFlagMissingRemainingDuration(activity);
  const needsExpectedFinish = shouldFlagMissingExpectedFinish(activity);
  const needsActualStart = shouldFlagMissingActualStart(activity);
  const missingUpdateFields = [
    needsRemainingDuration && "remaining duration",
    needsExpectedFinish && "expected finish",
    needsActualStart && "actual start",
  ].filter((value): value is string => Boolean(value));
  const remainingStat = isMilestone
    ? {
        value: "0",
        sub: activity.percent_complete >= 100 ? "milestone met" : "zero-duration point",
        tone: activity.percent_complete >= 100 ? ("success" as const) : ("default" as const),
      }
    : activity.percent_complete >= 100
      ? { value: "0", sub: "complete", tone: "success" as const }
      : !hasActualStartBasis
        ? {
            value: activity.percent_complete > 0 ? "Actual start" : "Not started",
            sub:
              activity.percent_complete > 0
                ? "set before remaining duration"
                : "forecast dates control",
            tone: "default" as const,
          }
        : needsRemainingDuration
          ? {
              value: remainingDuration == null ? "Missing" : String(remainingDuration),
              sub: remainingDuration == null ? "enter remaining duration" : "inferred, not saved",
              tone: "warning" as const,
            }
          : remainingDuration == null
            ? { value: "Missing", sub: "enter remaining duration", tone: "warning" as const }
            : {
                value: String(remainingDuration),
                sub: dataDate ? `saved as of ${shortDate(dataDate)}` : "saved update basis",
                tone: "default" as const,
              };
  const updateBasisTone =
    missingUpdateFields.length > 0
      ? ("warning" as const)
      : isMilestone && activity.percent_complete < 100
        ? ("default" as const)
        : activity.percent_complete >= 100
          ? ("success" as const)
          : ("default" as const);
  const updateBasisValue =
    missingUpdateFields.length > 0
      ? "Needs update"
      : isMilestone && activity.percent_complete < 100
        ? "Milestone"
        : activity.percent_complete >= 100
          ? "Complete"
          : enteredRemainingDuration != null
            ? "Remaining"
            : "Forecast";
  const updateBasisSub =
    missingUpdateFields.length > 0
      ? `Missing ${missingUpdateFields.join(", ")}`
      : isMilestone && activity.percent_complete < 100
        ? "forecast point"
        : activity.percent_complete >= 100
          ? "actual finish controls"
          : enteredRemainingDuration != null
            ? "remaining duration controls"
            : "expected finish controls";
  const linkedDelayFragments = useMemo(() => {
    const delayFragmentsByActivity = groupDelayFragmentsByActivity(delayFragments);
    return getDelayFragmentsForActivity(activity, delayFragmentsByActivity);
  }, [activity, delayFragments]);
  const linkedDelaySummary = useMemo(
    () => buildDelayFragmentSummary(linkedDelayFragments),
    [linkedDelayFragments],
  );
  const delayAdjustedDraft =
    linkedDelaySummary.openDays > 0
      ? applyOpenDelayToDraftForecast(draft, linkedDelaySummary.openDays, dataDate)
      : null;
  const openDelayForecastAligned =
    linkedDelaySummary.openDays > 0 &&
    delayAdjustedDraft?.forecast_finish_date === draft.forecast_finish_date &&
    delayAdjustedDraft.remaining_duration_days === draft.remaining_duration_days;
  const updateImpact = useMemo(() => buildActivityUpdateImpact(draft, dataDate), [draft, dataDate]);
  const saving = isSaving || isSubmitting;
  const saveAndContinueLabel = !updateQueueContext
    ? "Save & next update row"
    : updateQueueContext.nextActivity
      ? "Save & next update row"
      : "Save & close queue";
  const currentActivityBlockedIds = useMemo(
    () =>
      Array.from(
        new Set([activity.activity_id, draft.activity_id].map((id) => id.trim()).filter(Boolean)),
      ),
    [activity.activity_id, draft.activity_id],
  );
  const logicTieTotal =
    activity.predecessor_activity_ids.length + activity.successor_activity_ids.length;
  const progressStatusLabel =
    activity.percent_complete >= 100
      ? "complete"
      : activity.percent_complete > 0
        ? `${activity.percent_complete}% done`
        : "not started";
  const plannedDurationLabel = isMilestone
    ? "Milestone point"
    : plannedDuration == null
      ? "Planned dates needed"
      : `Planned ${plannedDuration}d`;

  useEffect(() => {
    setDraft(activityDraftFromRow(activity));
    setSaveError(null);
    setIsSubmitting(false);
  }, [activity]);

  const saveActivity = async (afterSave: "close" | "queue" = "close") => {
    if (saving) return;
    const validationError = validateActivityDraft(draft, activities, activity.id);
    if (validationError) {
      setSaveError(validationError);
      return;
    }
    const name = draft.name.trim();
    const milestoneDate = getMilestoneDraftDate(draft);
    const baselineStart = draft.is_milestone
      ? milestoneDate
      : draft.baseline_start_date || draft.start_date || null;
    const baselineFinish = draft.is_milestone
      ? milestoneDate
      : draft.baseline_finish_date || draft.finish_date || null;
    const forecastStart = draft.is_milestone
      ? milestoneDate
      : draft.forecast_start_date || baselineStart;
    const forecastFinish = draft.is_milestone
      ? milestoneDate
      : draft.forecast_finish_date || baselineFinish;
    setSaveError(null);
    setIsSubmitting(true);
    try {
      await onSave({
        activity_id: draft.activity_id.trim(),
        name,
        division: draft.is_milestone ? "Milestones" : draft.division.trim() || "General",
        start_date: baselineStart,
        finish_date: baselineFinish,
        baseline_start_date: baselineStart,
        baseline_finish_date: baselineFinish,
        forecast_start_date: forecastStart,
        forecast_finish_date: forecastFinish,
        actual_start_date: draft.actual_start_date || null,
        actual_finish_date: draft.actual_finish_date || null,
        remaining_duration_days: draft.is_milestone
          ? 0
          : draftHasActualStartBasis
            ? parseRemainingDuration(draft.remaining_duration_days)
            : null,
        percent_complete: parsePercent(draft.percent_complete),
        predecessor_activity_ids: serializeActivityLinksToArray(draft.predecessor_activity_ids),
        successor_activity_ids: serializeActivityLinksToArray(draft.successor_activity_ids),
        notes: draft.notes.trim(),
      });
      if (afterSave === "queue" && updateQueueContext) {
        onSaveAndContinue(updateQueueContext.nextActivity);
      } else {
        onClose();
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Activity did not update.");
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:w-[min(calc(100vw-2rem),80rem)] sm:max-w-[80rem] sm:rounded-2xl">
        <DialogHeader className="border-b border-hairline bg-surface px-4 py-4 pr-12 text-left sm:px-6">
          <div className="eyebrow">Activity</div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {activity.activity_id || "No ID"}
            </span>
            <DialogTitle className="min-w-0 break-words font-serif text-2xl font-normal leading-tight">
              {activity.name}
            </DialogTitle>
            {isCriticalPath && (
              <span className="shrink-0 rounded-full border border-current px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-danger">
                Critical
              </span>
            )}
            {updateImpact.slipTone === "danger" && (
              <span className="shrink-0 rounded-full border border-current px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-warning">
                {updateImpact.slipValue} slip
              </span>
            )}
          </div>
          <DialogDescription className="text-xs">
            {activity.division || "General"} · {progressStatusLabel} ·{" "}
            <span
              className={cn(updateBasisTone === "warning" && "text-warning")}
              title={`Update basis — ${updateBasisSub}`}
            >
              {updateBasisValue.toLowerCase()} basis
            </span>{" "}
            · data date {dataDate ? shortDate(dataDate) : "not set"}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6">
          {updateQueueContext && (
            <div className="rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="font-mono text-[9px] font-bold uppercase tracking-[0.12em]">
                    Data-date update queue
                  </div>
                  <div className="mt-1 text-foreground">
                    Row {updateQueueContext.position} of {updateQueueContext.total} needs{" "}
                    {updateQueueContext.reason.toLowerCase()}.
                  </div>
                </div>
                <div className="min-w-0 text-xs text-muted-foreground sm:text-right">
                  {updateQueueContext.nextLabel
                    ? `Next: ${updateQueueContext.nextLabel}`
                    : "Save this row, then save the CPM update snapshot."}
                </div>
              </div>
            </div>
          )}

          <div className="grid min-w-0 items-start gap-x-6 gap-y-4 lg:grid-cols-2">
            {/* LEFT — activity setup, then baseline (fixed) → current update. */}
            <div className="min-w-0 space-y-4">
              <div className="rounded-[10px] border border-hairline bg-surface p-3.5">
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                      Activity setup
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Edit the row identity and parent / child WBS path. The baseline plan and
                      current update follow below.
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant={draft.is_milestone ? "default" : "outline"}
                    className="gap-2"
                    aria-pressed={draft.is_milestone}
                    disabled={saving}
                    onClick={() => setDraft(toggleMilestoneDraft(draft, !draft.is_milestone))}
                  >
                    <Diamond className="h-4 w-4" />
                    Milestone
                  </Button>
                </div>
                <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-[150px_minmax(0,1.6fr)_minmax(0,1fr)]">
                  <LabeledField label="Activity ID">
                    <Input
                      value={draft.activity_id}
                      onChange={(e) => setDraft({ ...draft, activity_id: e.target.value })}
                      className="h-10 min-w-0 font-semibold tabular"
                    />
                  </LabeledField>
                  <LabeledField label="Activity">
                    <Input
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      className="h-10 min-w-0"
                    />
                  </LabeledField>
                  <LabeledField label="WBS / area">
                    <ActivityDivisionInput
                      value={draft.division}
                      onChange={(division) => setDraft({ ...draft, division })}
                      options={divisionOptions}
                      listId={`activity-${activity.id}-wbs-divisions`}
                    />
                  </LabeledField>
                </div>
              </div>

              <div className="rounded-[10px] border border-hairline bg-surface p-3.5">
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <div className="eyebrow">Baseline (fixed) → current update</div>
                  <div className="font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                    {plannedDurationLabel} · Data date {dataDate ? shortDate(dataDate) : "not set"}
                  </div>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {isMilestone
                    ? "For this data date, mark whether this milestone was met and set the current forecast date. Milestones are zero-duration schedule points."
                    : draftHasActualStartBasis
                      ? "For this data date, enter actual progress and either remaining duration or current expected finish. The other field recalculates so the CPM finish, float, and delay impact reflect the update."
                      : draftPercentComplete > 0
                        ? "Progress is entered but actual start is missing. Set actual start first; remaining duration unlocks after actual start."
                        : "This activity has not started. Leave remaining duration blank; adjust current start and current expected finish until actual start is entered."}
                </div>

                {/* Layout note: the previous full-width update grid pinned
                    xl:grid-cols-[145px_145px_150px_145px_145px_105px] to keep the modal free
                    of horizontal scroll; the two-column reorg replaces it with half-width
                    2-up grids (w-full inputs, min-w-0 columns) which hold the same
                    no-horizontal-scroll guarantee. */}
                <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
                  <LabeledField label="Baseline start">
                    <Input
                      type="date"
                      value={draft.baseline_start_date}
                      onChange={(e) =>
                        setDraft(updateDraftBaselineStartDate(draft, e.target.value))
                      }
                      className="h-10 min-w-0"
                      title="Baseline plan — the committed start. Baseline dates stay fixed; variance is measured against them."
                    />
                  </LabeledField>
                  <LabeledField label="Baseline finish">
                    <Input
                      type="date"
                      value={draft.baseline_finish_date}
                      onChange={(e) =>
                        setDraft(updateDraftBaselineFinishDate(draft, e.target.value))
                      }
                      className="h-10 min-w-0"
                      title="Baseline plan — the committed finish. Baseline dates stay fixed; variance is measured against them."
                    />
                  </LabeledField>
                  <LabeledField label="Current start">
                    <Input
                      type="date"
                      value={draft.forecast_start_date}
                      onChange={(e) =>
                        setDraft(updateDraftForecastStartDate(draft, e.target.value, dataDate))
                      }
                      className="h-10 min-w-0"
                    />
                  </LabeledField>
                  <LabeledField label="Current expected finish">
                    <Input
                      type="date"
                      value={draft.forecast_finish_date}
                      onChange={(e) =>
                        setDraft(updateDraftForecastFinishDate(draft, e.target.value, dataDate))
                      }
                      className={cn(
                        "h-10 min-w-0",
                        updateImpact.finishTone === "danger" && "text-danger",
                      )}
                    />
                  </LabeledField>
                </div>

                <div className="mt-4 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                  Current update
                </div>
                <div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2">
                  <LabeledField label="Actual start">
                    <Input
                      type="date"
                      value={draft.actual_start_date}
                      onChange={(e) =>
                        setDraft(updateDraftActualStartDate(draft, e.target.value, dataDate))
                      }
                      className="h-10 min-w-0"
                    />
                  </LabeledField>
                  <LabeledField label="Actual finish">
                    <Input
                      type="date"
                      value={draft.actual_finish_date}
                      onChange={(e) =>
                        setDraft(updateDraftActualFinishDate(draft, e.target.value, dataDate))
                      }
                      className="h-10 min-w-0"
                    />
                  </LabeledField>
                  <LabeledField label="% done">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={draft.percent_complete}
                      onChange={(e) =>
                        setDraft(updateDraftPercentComplete(draft, e.target.value, dataDate))
                      }
                      className="h-10 min-w-0 tabular"
                    />
                  </LabeledField>
                  <LabeledField label={isMilestone ? "Milestone duration" : "Remaining duration"}>
                    <Input
                      type="number"
                      min={0}
                      value={
                        isMilestone
                          ? "0"
                          : draftHasActualStartBasis
                            ? draft.remaining_duration_days
                            : ""
                      }
                      onChange={(e) =>
                        setDraft(updateDraftRemainingDuration(draft, e.target.value, dataDate))
                      }
                      placeholder={
                        isMilestone ? "0" : draftHasActualStartBasis ? "days" : "not started"
                      }
                      disabled={isMilestone || !draftHasActualStartBasis}
                      className="h-10 min-w-0 tabular"
                    />
                    {!isMilestone && !draftHasActualStartBasis && (
                      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                        Record an actual start first — remaining duration applies to in-progress
                        work.
                      </p>
                    )}
                  </LabeledField>
                </div>

                <div className="mt-4 grid min-w-0 gap-2.5 sm:grid-cols-3">
                  <ScheduleWorkbenchStat
                    label="% done"
                    value={`${activity.percent_complete}%`}
                    sub={activity.percent_complete >= 100 ? "complete" : "percent complete"}
                    tone={activity.percent_complete >= 100 ? "success" : "default"}
                  />
                  <ScheduleWorkbenchStat
                    label="Remaining"
                    value={remainingStat.value}
                    sub={remainingStat.sub}
                    tone={remainingStat.tone}
                  />
                  <ScheduleWorkbenchStat
                    label="Schedule slip"
                    value={updateImpact.slipValue}
                    sub={updateImpact.slipBasis}
                    tone={updateImpact.slipTone}
                  />
                </div>
                <div className="mt-2.5 grid min-w-0 gap-2.5 sm:grid-cols-2">
                  <ActivityUpdateImpactTile
                    label="Baseline finish"
                    value={updateImpact.baselineFinish}
                    sub="original planned finish"
                  />
                  <ActivityUpdateImpactTile
                    label="Current expected finish"
                    value={updateImpact.expectedFinish}
                    sub="current forecast finish"
                    tone={updateImpact.finishTone}
                  />
                  <ActivityUpdateImpactTile
                    label={isMilestone ? "Milestone basis" : "Remaining basis"}
                    value={updateImpact.remainingValue}
                    sub={updateImpact.remainingBasis}
                  />
                  <ActivityUpdateImpactTile
                    label="Schedule slip"
                    value={updateImpact.slipValue}
                    sub={updateImpact.slipBasis}
                    tone={updateImpact.slipTone}
                  />
                </div>

                <div className="mt-3 rounded-md bg-secondary px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">Update rule:</span>{" "}
                  {isMilestone
                    ? "Milestones stay at zero duration. Move the current expected finish to forecast the milestone date, or mark it 100% when it is met. The CPM recalculates float against the completion path."
                    : draftHasActualStartBasis
                      ? "Baseline dates stay fixed. Remaining duration is counted from the data date for started work. Changing remaining duration moves current expected finish, and changing current expected finish recalculates remaining duration. After save, the CPM recalculates float against the baseline completion path, including negative total float."
                      : "Baseline dates stay fixed. Unstarted work is forecast with current start and current expected finish; remaining duration is not required until actual start is entered."}
                </div>
                {!dataDate && (
                  <div className="mt-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {isMilestone
                        ? "Set the CPM data date before updating this milestone forecast so it is anchored to the right schedule snapshot."
                        : "Set the CPM data date before updating remaining duration so expected finish dates are anchored to the right schedule snapshot."}
                    </span>
                  </div>
                )}
                {linkedDelaySummary.openDays > 0 && (
                  <div className="mt-3 flex flex-col gap-3 rounded-md border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-semibold">
                        <AlertTriangle className="h-4 w-4" />
                        {linkedDelaySummary.openDays} open delay day
                        {linkedDelaySummary.openDays === 1 ? "" : "s"} on this activity
                      </div>
                      <div className="mt-1 text-xs text-danger/85">
                        {openDelayForecastAligned
                          ? "The current expected finish already carries at least this delay against the baseline."
                          : delayAdjustedDraft?.forecast_finish_date
                            ? isMilestone
                              ? `Apply this to move the milestone forecast to ${shortDate(delayAdjustedDraft.forecast_finish_date)}.`
                              : `Apply this to move expected finish to ${shortDate(delayAdjustedDraft.forecast_finish_date)} and recalculate remaining duration.`
                            : "Set a baseline or expected finish, then apply the delay to the forecast."}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 shrink-0 border-danger/30 bg-card text-danger hover:bg-danger/10 hover:text-danger"
                      disabled={
                        saving ||
                        openDelayForecastAligned ||
                        !delayAdjustedDraft?.forecast_finish_date
                      }
                      onClick={() => delayAdjustedDraft && setDraft(delayAdjustedDraft)}
                    >
                      Apply delay to forecast
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT — logic ties, delay impacts, notes. */}
            <div className="min-w-0 space-y-4">
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <div className="eyebrow">Logic ties</div>
                  <span className="font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                    · {logicTieTotal} pred / succ {logicTieTotal === 1 ? "tie" : "ties"}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Predecessors drive this activity. Successors are the activities this row drives.
                </div>
                <div className="mt-3 grid min-w-0 gap-3">
                  <ActivityDependencyPicker
                    label="Predecessors - work before this activity"
                    emptyLabel="Choose activities that must finish first"
                    selectedIds={draft.predecessor_activity_ids}
                    activities={activities}
                    blockedIds={[
                      ...currentActivityBlockedIds,
                      ...parseActivityIds(draft.successor_activity_ids),
                    ]}
                    onChange={(value) => setDraft({ ...draft, predecessor_activity_ids: value })}
                  />
                  <ActivityDependencyPicker
                    label="Successors - work after this activity"
                    emptyLabel="Choose activities that follow this one"
                    selectedIds={draft.successor_activity_ids}
                    activities={activities}
                    blockedIds={[
                      ...currentActivityBlockedIds,
                      ...parseActivityIds(draft.predecessor_activity_ids),
                    ]}
                    onChange={(value) => setDraft({ ...draft, successor_activity_ids: value })}
                  />
                  <div className="min-w-0 rounded-[10px] border border-hairline bg-surface p-3">
                    <div className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                      Dependency readout
                    </div>
                    <div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-muted-foreground">
                          Predecessors
                        </div>
                        <ActivityRelationshipRows
                          tokens={parseActivityTokens(draft.predecessor_activity_ids)}
                          activities={activities}
                          emptyLabel="No predecessor logic"
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-muted-foreground">
                          Successors
                        </div>
                        <ActivityRelationshipRows
                          tokens={parseActivityTokens(draft.successor_activity_ids)}
                          activities={activities}
                          emptyLabel="No successor logic"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <div className="eyebrow">Delay impacts</div>
                  <span className="font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                    · {linkedDelaySummary.openCount} open · {linkedDelaySummary.openDays} days
                  </span>
                </div>
                <ActivityDelayFragmentPanel
                  activity={activity}
                  delayFragments={delayFragments}
                  isSaving={isSavingDelayFragment}
                  onAddDelayFragment={onAddDelayFragment}
                  onPatchDelayFragment={onPatchDelayFragment}
                  onDeleteDelayFragment={onDeleteDelayFragment}
                />
              </div>

              <div className="min-w-0">
                <div className="eyebrow">Notes / constraint</div>
                <Textarea
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  placeholder="Sequencing constraint, procurement issue, field note, or CPM update narrative."
                  className="mt-2 min-h-28 min-w-0 resize-y bg-card"
                  aria-label="Notes / constraint"
                />
              </div>
            </div>
          </div>
        </div>

        {saveError && (
          <div className="border-t border-danger/20 bg-danger/10 px-4 py-2 text-sm text-danger sm:px-6">
            {saveError}
          </div>
        )}

        <DialogFooter className="gap-2 border-t border-hairline bg-surface px-4 py-4 sm:justify-between sm:space-x-0 sm:px-6">
          <Button
            type="button"
            variant="outline"
            className="gap-2 text-danger"
            onClick={onDelete}
            disabled={saving}
          >
            <Trash2 className="h-4 w-4" />
            Delete activity
          </Button>
          {/* Fixed order, fixed emphasis: Send to Risk Tally, Save & next (present
              but disabled outside the queue), Save activity (always primary), Close. */}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => void onSendToRiskTally(activity)}
              disabled={saving || isSendingToRiskTally}
            >
              <AlertTriangle className="h-4 w-4" />
              {isSendingToRiskTally ? "Sending..." : "Send to Risk Tally"}
            </Button>
            <Button
              type="button"
              variant="outline"
              title={
                updateQueueContext ? undefined : "Available while working the needs-update queue."
              }
              onClick={() => void saveActivity("queue")}
              disabled={!updateQueueContext || !draft.name.trim() || saving}
            >
              {saving ? "Saving..." : saveAndContinueLabel}
            </Button>
            <Button
              type="button"
              onClick={() => void saveActivity()}
              disabled={!draft.name.trim() || saving}
            >
              {saving ? "Saving..." : "Save activity"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Close
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ActivityUpdateImpactTile({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "default" | "danger" | "success" | "warning";
}) {
  const toneClass =
    tone === "danger"
      ? "text-danger"
      : tone === "success"
        ? "text-success"
        : tone === "warning"
          ? "text-warning"
          : "text-foreground";
  return (
    <div className="min-w-0 rounded-[10px] border border-hairline bg-background px-3 py-2">
      <div className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-1 truncate text-base font-semibold tabular", toneClass)}>{value}</div>
      <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
