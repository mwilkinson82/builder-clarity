import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown, ExternalLink, Gauge } from "lucide-react";
import { toast } from "sonner";
import {
  listSchedule,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  createScheduleRisk,
  updateScheduleRisk,
  deleteScheduleRisk,
  createScheduleUpdate,
  annotateScheduleUpdate,
  type ScheduleRiskKind,
  type MilestoneRow,
  type ScheduleRiskRow,
} from "@/lib/schedule.functions";
import { createExposure, updateProjectFinancials, type ProjectRow } from "@/lib/projects.functions";
import { computeScheduleVarianceWeeks } from "@/lib/ior";
import { buildConstructLineCpmModel } from "@/lib/constructline-cpm";
import {
  selectCpmForecastStatus,
  selectLatestScheduleUpdate,
  selectSavedScheduleForecast,
  selectSavedScheduleMovementWeeks,
  selectSavedScheduleVarianceWeeks,
} from "@/lib/schedule-selectors";
import {
  EMPTY_ACTIVITIES,
  EMPTY_ACTIVITY_UPDATES,
  EMPTY_DELAY_FRAGMENTS,
  EMPTY_MILESTONES,
  EMPTY_MILESTONE_UPDATES,
  EMPTY_SCHEDULE_RISKS,
  EMPTY_SCHEDULE_UPDATES,
  type MilestoneView,
  RISK_META,
  shortDate,
  todayIsoDate,
  varianceLabel,
  varianceTone,
} from "./scheduleShared";
import { buildCpmScheduleUpdateDraft, buildDelayFragmentSummary } from "./scheduleUpdateDraft";
import {
  ScheduleCompletionPath,
  ScheduleDarkStatStrip,
  ScheduleMetaRow,
  ScheduleMilestonePlan,
  ScheduleWorkspaceLaunch,
} from "./ScheduleSnapshotTimeline";
import {
  ScheduleAttentionBanner,
  ScheduleCompletionOfRecordCard,
  ScheduleDeltaCard,
  ScheduleIntelligenceMetric,
  ScheduleMoneyNetCard,
  ScheduleUpdateLedger,
  ScheduleVarianceCard,
} from "./ScheduleUpdateHistory";
import { DateField, MilestoneRowEditor } from "./ScheduleMilestones";
import { AddInline, RiskGroup } from "./ScheduleRiskItems";

// v2 review-tab card order for the schedule-linked risk groups (mock order).
const RISK_GROUP_ORDER: ScheduleRiskKind[] = [
  "procurement",
  "trade_performance",
  "critical_decision",
];

export function ScheduleRisk({
  project,
  lastReviewForecast,
}: {
  project: ProjectRow;
  lastReviewForecast?: string | null;
}) {
  const qc = useQueryClient();
  const projectId = project.id;
  const [linkedExposureIds, setLinkedExposureIds] = useState<Record<string, string>>({});
  const listFn = useServerFn(listSchedule);
  const createMs = useServerFn(createMilestone);
  const updateMs = useServerFn(updateMilestone);
  const deleteMs = useServerFn(deleteMilestone);
  const createRisk = useServerFn(createScheduleRisk);
  const updateRisk = useServerFn(updateScheduleRisk);
  const deleteRisk = useServerFn(deleteScheduleRisk);
  const createUpdate = useServerFn(createScheduleUpdate);
  const annotateUpdate = useServerFn(annotateScheduleUpdate);
  const createExposureFn = useServerFn(createExposure);
  const updateFin = useServerFn(updateProjectFinancials);
  const [manualCompletionDraft, setManualCompletionDraft] = useState(
    project.forecast_completion_date ?? "",
  );
  const [manualDataDate, setManualDataDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [scheduleMoneyExposure, setScheduleMoneyExposure] = useState(0);
  const [scheduleMoneyRecovery, setScheduleMoneyRecovery] = useState(0);
  const [moneyNotes, setMoneyNotes] = useState("");
  const [updateNotes, setUpdateNotes] = useState("");
  const [annotationSeedUpdateId, setAnnotationSeedUpdateId] = useState<string | null>(null);
  const [milestoneView, setMilestoneView] = useState<MilestoneView>("active");
  // Progressive disclosure: the annotate/save authoring panel lives collapsed
  // below the update history; the CTA row opens and scrolls to it.
  const [annotateOpen, setAnnotateOpen] = useState(false);
  const annotatePanelRef = useRef<HTMLDetailsElement>(null);
  const updateNotesRef = useRef<HTMLTextAreaElement>(null);
  const openAnnotatePanel = () => {
    setAnnotateOpen(true);
    requestAnimationFrame(() => {
      const panel = annotatePanelRef.current;
      if (!panel) return;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      panel.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      updateNotesRef.current?.focus({ preventScroll: true });
    });
  };

  const { data, isLoading } = useQuery({
    queryKey: ["schedule", projectId],
    queryFn: () => listFn({ data: { projectId } }),
  });
  const invalidateSchedule = () => qc.invalidateQueries({ queryKey: ["schedule", projectId] });
  const invalidateProject = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["project", projectId] }),
      qc.invalidateQueries({ queryKey: ["projects"] }),
    ]);
  const useScheduleMutation = <I,>(
    fn: (i: { data: I }) => Promise<unknown>,
    messages?: {
      successTitle?: string;
      successDescription?: string;
      errorTitle?: string;
    },
  ) =>
    useMutation({
      mutationFn: (i: I) => fn({ data: i }),
      onSuccess: async () => {
        await invalidateSchedule();
        if (messages?.successTitle) {
          toast.success(messages.successTitle, {
            description: messages.successDescription,
          });
        }
      },
      onError: (error) => {
        if (!messages?.errorTitle) return;
        toast.error(messages.errorTitle, {
          description: error instanceof Error ? error.message : "Refresh and try again.",
        });
      },
    });

  const msCreate = useScheduleMutation<{ projectId: string; name: string }>(createMs, {
    successTitle: "Milestone added",
    successDescription: "It is now part of the schedule working list.",
    errorTitle: "Milestone did not save",
  });
  const msUpdate = useScheduleMutation<{ id: string; patch: Partial<MilestoneRow> }>(
    updateMs as never,
    { errorTitle: "Milestone did not update" },
  );
  const msDelete = useScheduleMutation<{ id: string }>(deleteMs, {
    successTitle: "Milestone deleted",
    errorTitle: "Milestone did not delete",
  });
  const rCreate = useScheduleMutation<{ projectId: string; kind: ScheduleRiskKind; title: string }>(
    createRisk,
    {
      successTitle: "Schedule risk added",
      successDescription: "Fill in the dollars, owner, dates, and treatment path next.",
      errorTitle: "Schedule risk did not save",
    },
  );
  const rUpdate = useScheduleMutation<{ id: string; patch: Partial<ScheduleRiskRow> }>(
    updateRisk as never,
    { errorTitle: "Schedule risk did not update" },
  );
  const rDelete = useScheduleMutation<{ id: string }>(deleteRisk, {
    successTitle: "Schedule risk deleted",
    errorTitle: "Schedule risk did not delete",
  });

  const exposureCreate = useMutation({
    mutationFn: async (risk: ScheduleRiskRow) => {
      const meta = RISK_META[risk.kind];
      const result = await createExposureFn({
        data: {
          projectId,
          title: risk.title,
          description: risk.detail,
          category: meta.category,
          dollar_exposure: risk.dollar_exposure,
          probability: risk.probability,
          schedule_impact_weeks: risk.schedule_impact_weeks,
          owner: risk.owner,
          response_path: risk.response_path,
          hold_class: risk.hold_class,
          status: "active",
          due_date: risk.due_date,
          next_review_at: risk.due_date,
          release_condition: `Schedule risk resolved: ${risk.title}`,
          notes: risk.detail
            ? `Schedule action plan: ${risk.detail}`
            : "Created from the Schedule tab. Add the recovery, offset, elimination, or acceptance plan in the Risk Tally.",
        },
      });
      if (result.id) {
        await updateRisk({ data: { id: risk.id, patch: { linked_exposure_id: result.id } } });
      }
      return result;
    },
    onSuccess: async (result, risk) => {
      if (result.id) {
        setLinkedExposureIds((current) => ({ ...current, [risk.id]: result.id }));
      }
      await Promise.all([invalidateSchedule(), invalidateProject()]);
      await qc.refetchQueries({ queryKey: ["project", projectId] });
      toast.success("Sent to the Risk Tally", {
        description: `${risk.title} is now in the open risk tally.`,
      });
    },
    onError: (error) => {
      toast.error("Risk allocation did not save", {
        description: error instanceof Error ? error.message : "Check the risk and try again.",
      });
    },
  });

  const finMut = useMutation({
    mutationFn: (patch: Record<string, unknown>) => updateFin({ data: { projectId, patch } }),
    onSuccess: invalidateProject,
    onError: (error) => {
      toast.error("Schedule dates did not update", {
        description: error instanceof Error ? error.message : "Refresh and try again.",
      });
    },
  });

  const milestones = data?.milestones ?? EMPTY_MILESTONES;
  const activities = data?.activities ?? EMPTY_ACTIVITIES;
  const delayFragments = data?.delayFragments ?? EMPTY_DELAY_FRAGMENTS;
  const risks = data?.risks ?? EMPTY_SCHEDULE_RISKS;
  const updates = data?.updates ?? EMPTY_SCHEDULE_UPDATES;
  const milestoneUpdates = data?.milestoneUpdates ?? EMPTY_MILESTONE_UPDATES;
  const activityUpdates = data?.activityUpdates ?? EMPTY_ACTIVITY_UPDATES;
  const visibleMilestones = filterMilestones(milestones, milestoneView);
  const activeMilestoneCount = milestones.filter((m) => m.status !== "complete").length;
  const completedMilestoneCount = milestones.filter((m) => m.status === "complete").length;
  // The CPM workbench authors schedule updates. This tab consumes the latest
  // saved update; with no CPM activities yet it keeps a manual create path.
  const hasCpmActivities = activities.length > 0;
  const latestUpdate = selectLatestScheduleUpdate(updates);
  const savedForecast = selectSavedScheduleForecast(updates, project.forecast_completion_date);
  const lastMovementWeeks = selectSavedScheduleMovementWeeks(updates, {
    lastReviewForecast,
    currentForecast: project.forecast_completion_date,
  });
  const scheduleVariance = selectSavedScheduleVarianceWeeks(
    updates,
    project.baseline_completion_date,
    hasCpmActivities
      ? project.forecast_completion_date
      : manualCompletionDraft || project.forecast_completion_date,
  );
  const dataDateOfRecord = latestUpdate?.data_date ?? null;
  const scheduleCpmModel = useMemo(
    () =>
      buildConstructLineCpmModel(activities, {
        dataDate: dataDateOfRecord ?? todayIsoDate(),
        nearCriticalFloat: 5,
      }),
    [activities, dataDateOfRecord],
  );
  const delaySummary = useMemo(() => buildDelayFragmentSummary(delayFragments), [delayFragments]);
  const cpmScheduleDraft = useMemo(
    () =>
      buildCpmScheduleUpdateDraft({
        dataDate: dataDateOfRecord ?? todayIsoDate(),
        delaySummary,
        milestones,
        model: scheduleCpmModel,
        previousUpdate: latestUpdate,
        project,
      }),
    [dataDateOfRecord, delaySummary, latestUpdate, milestones, project, scheduleCpmModel],
  );
  const cpmForecastStatus = selectCpmForecastStatus({
    savedForecast,
    liveCpmForecast: hasCpmActivities ? cpmScheduleDraft.forecast_completion_date : null,
  });
  // How the live CPM finish compares to the saved record — so "the live schedule
  // points to Oct 9" doesn't read as a contradiction against a record that still
  // says Feb 7. Negative weeks = the live schedule is earlier (pulled ahead).
  const unsavedDeltaWeeks =
    cpmForecastStatus.isUnsaved &&
    cpmForecastStatus.forecastOfRecord &&
    cpmForecastStatus.unsavedForecast
      ? Math.round(
          (new Date(cpmForecastStatus.unsavedForecast).getTime() -
            new Date(cpmForecastStatus.forecastOfRecord).getTime()) /
            (7 * 24 * 60 * 60 * 1000),
        )
      : 0;
  const latestActivitySnapshotCount = latestUpdate
    ? activityUpdates.filter((row) => row.update_number === latestUpdate.update_number).length
    : 0;
  useEffect(() => {
    setManualCompletionDraft(project.forecast_completion_date ?? "");
  }, [project.forecast_completion_date]);

  // Seed the annotation fields from the latest saved update whenever a new
  // update becomes the record (render-time state adjustment, not an effect).
  if (hasCpmActivities && latestUpdate && annotationSeedUpdateId !== latestUpdate.id) {
    setAnnotationSeedUpdateId(latestUpdate.id);
    setUpdateNotes(latestUpdate.notes);
    setMoneyNotes(latestUpdate.money_notes);
    setScheduleMoneyExposure(latestUpdate.schedule_money_exposure);
    setScheduleMoneyRecovery(latestUpdate.schedule_money_recovery);
  }

  const annotate = useMutation({
    mutationFn: () => {
      if (!latestUpdate) throw new Error("Save a CPM update in the workbench first.");
      return annotateUpdate({
        data: {
          id: latestUpdate.id,
          projectId,
          notes: updateNotes,
          schedule_money_exposure: scheduleMoneyExposure,
          schedule_money_recovery: scheduleMoneyRecovery,
          money_notes: moneyNotes,
        },
      });
    },
    onSuccess: async (result) => {
      await Promise.all([invalidateSchedule(), invalidateProject()]);
      toast.success("Schedule update saved", {
        description: `Narrative and money fields were saved onto update #${result.update.update_number}.`,
      });
    },
    onError: (error) => {
      toast.error("Schedule update did not save", {
        description: error instanceof Error ? error.message : "Refresh and try again.",
      });
    },
  });

  const manualUpdate = useMutation({
    mutationFn: ({ replaceExisting = false }: { replaceExisting?: boolean }) =>
      createUpdate({
        data: {
          projectId,
          forecast_completion_date: manualCompletionDraft,
          data_date: manualDataDate,
          update_date: manualDataDate,
          schedule_money_exposure: scheduleMoneyExposure,
          schedule_money_recovery: scheduleMoneyRecovery,
          money_notes: moneyNotes,
          notes: updateNotes,
          replace_existing: replaceExisting,
          milestone_forecasts: [],
        },
      }),
    onSuccess: async (result) => {
      if (!result.ok) {
        const shouldReplace =
          typeof window !== "undefined" &&
          window.confirm(
            `Update #${result.duplicate.update_number} already covers ${shortDate(
              result.duplicate.data_date,
            )} — replace it?`,
          );
        if (shouldReplace) manualUpdate.mutate({ replaceExisting: true });
        return;
      }
      setUpdateNotes("");
      setMoneyNotes("");
      setScheduleMoneyExposure(0);
      setScheduleMoneyRecovery(0);
      await Promise.all([invalidateSchedule(), invalidateProject()]);
      toast.success("Schedule update saved", {
        description: "The manual data-date update was added to the schedule update history.",
      });
    },
    onError: (error) => {
      toast.error("Schedule update did not save", {
        description:
          error instanceof Error ? error.message : "Check the completion update and try again.",
      });
    },
  });

  return (
    <div className="space-y-6">
      {/* 1 · Dark stat strip: the schedule position at a glance */}
      <ScheduleDarkStatStrip
        project={project}
        updates={updates}
        cpmForecastStatus={cpmForecastStatus}
        unsavedDeltaWeeks={unsavedDeltaWeeks}
        delaySummary={delaySummary}
      />

      {/* 2 · Needs-attention banner (only when something needs attention) */}
      <ScheduleAttentionBanner
        updates={updates}
        cpmForecastStatus={cpmForecastStatus}
        unsavedDeltaWeeks={unsavedDeltaWeeks}
        delaySummary={delaySummary}
      />

      {/* 3 · CTA row — the workspace launch is the view's one coral signal */}
      <div className="flex flex-wrap gap-2.5">
        <Button asChild variant="signal" className="gap-2">
          <a href={`/projects/${projectId}/schedule#cpm-grid`} target="_blank" rel="noreferrer">
            <ExternalLink className="h-4 w-4" />
            Open schedule workspace
          </a>
        </Button>
        <Button type="button" variant="outline" onClick={openAnnotatePanel}>
          Save schedule update
        </Button>
      </div>

      {/* 4 · Completion path + verdict */}
      <ScheduleCompletionPath
        project={project}
        updates={updates}
        cpmForecastStatus={cpmForecastStatus}
        unsavedDeltaWeeks={unsavedDeltaWeeks}
      />

      {/* 5 · Schedule-linked risk */}
      <section>
        <div className="eyebrow">Schedule-linked risk</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Surfaced here because it moves the schedule, routed to the Risk Tally.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
          {RISK_GROUP_ORDER.map((kind) => (
            <RiskGroup
              key={kind}
              kind={kind}
              items={risks.filter((r) => r.kind === kind)}
              onAdd={(title) => rCreate.mutate({ projectId, kind, title })}
              onPatch={(id, patch) => rUpdate.mutate({ id, patch })}
              onDelete={(id) => rDelete.mutate({ id })}
              onCreateExposure={(risk) => exposureCreate.mutate(risk)}
              pendingExposureId={exposureCreate.variables?.id ?? null}
              linkedExposureIds={linkedExposureIds}
            />
          ))}
        </div>
      </section>

      {/* 6 · Interim milestone plan (meeting mini-Gantt + recent updates) */}
      <ScheduleMilestonePlan
        project={project}
        updates={updates}
        milestones={milestones}
        milestoneView={milestoneView}
        onMilestoneViewChange={setMilestoneView}
      />

      {/* Interim milestones working list */}
      <section className="rounded-xl border border-hairline bg-card p-6">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="font-serif text-2xl text-foreground">Interim milestones</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Dry-in, rough-ins, owner-furnished deliveries, substantial completion — anything
              between today and project completion. Completed items stay in history without taking
              over the working page.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {activeMilestoneCount} active · {completedMilestoneCount} complete ·{" "}
              {milestones.length} total
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 md:w-auto md:min-w-[520px] md:flex-row">
            <MilestoneViewSelect value={milestoneView} onChange={setMilestoneView} />
            <AddInline
              placeholder="Add interim milestone (e.g. Roof dry-in)"
              onAdd={(name) => msCreate.mutate({ projectId, name })}
            />
          </div>
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : milestones.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No interim milestones yet. Add your first one above.
          </p>
        ) : visibleMilestones.length === 0 ? (
          <p className="rounded-md border border-dashed border-hairline bg-surface/60 px-3 py-5 text-sm text-muted-foreground">
            No {milestoneView === "complete" ? "completed" : milestoneView} milestones to show.
          </p>
        ) : (
          <div className="space-y-3">
            {visibleMilestones.map((m) => (
              <MilestoneRowEditor
                key={m.id}
                row={m}
                onPatch={(patch) => msUpdate.mutate({ id: m.id, patch })}
                onDelete={() => msDelete.mutate({ id: m.id })}
              />
            ))}
          </div>
        )}
      </section>

      {/* 7 · Schedule update history */}
      <ScheduleUpdateLedger
        updates={updates}
        milestoneUpdates={milestoneUpdates}
        activityUpdates={activityUpdates}
      />

      {/* 8 · Annotate / save authoring — demoted into a collapsed panel; the
          CTA-row "Save schedule update" button opens and scrolls here. */}
      <details
        ref={annotatePanelRef}
        open={annotateOpen}
        onToggle={(event) => setAnnotateOpen(event.currentTarget.open)}
        className="group rounded-xl border border-hairline bg-card"
      >
        <summary className="flex cursor-pointer list-none items-center gap-3 px-6 py-4 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0">
            <h3 className="font-serif text-xl text-foreground">
              Annotate or save a schedule update
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Baseline date, schedule narrative, and schedule dollars for the update of record.
            </p>
          </div>
          <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="border-t border-hairline p-6">
          <p className="mb-4 text-sm text-muted-foreground">
            {hasCpmActivities
              ? "The CPM workspace authors every schedule update: set the data date, work the needs-update queue, save the snapshot. This panel reviews the saved record and adds the schedule narrative and money."
              : "No CPM activities yet, so schedule updates are recorded manually here. The CPM workspace takes over authoring the moment activities exist."}
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <DateField
              label="Baseline completion"
              value={project.baseline_completion_date}
              onCommit={(v) =>
                finMut.mutate({
                  baseline_completion_date: v,
                  schedule_variance_weeks:
                    computeScheduleVarianceWeeks(v, project.forecast_completion_date) ?? 0,
                })
              }
            />
            {hasCpmActivities ? (
              <ScheduleCompletionOfRecordCard value={savedForecast} update={latestUpdate} />
            ) : (
              <DateField
                label="Manual completion update"
                value={manualCompletionDraft}
                accent
                onCommit={(v) => setManualCompletionDraft(v ?? "")}
              />
            )}
            <ScheduleVarianceCard value={scheduleVariance} />
            <ScheduleDeltaCard value={lastMovementWeeks} />
          </div>
          {hasCpmActivities && (
            <div className="mt-4 rounded-md border border-hairline bg-surface p-4">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <Gauge className="h-3.5 w-3.5" />
                Latest CPM schedule update
              </div>
              {latestUpdate ? (
                <>
                  <div className="mt-2 grid gap-3 text-sm md:grid-cols-5">
                    <ScheduleIntelligenceMetric
                      label={`Update #${latestUpdate.update_number}`}
                      value={`Data date ${shortDate(latestUpdate.data_date)}`}
                    />
                    <ScheduleIntelligenceMetric
                      label="Completion forecast"
                      value={shortDate(latestUpdate.forecast_completion_date)}
                    />
                    <ScheduleIntelligenceMetric
                      label="Baseline variance"
                      value={varianceLabel(latestUpdate.variance_weeks)}
                      tone={varianceTone(latestUpdate.variance_weeks)}
                    />
                    <ScheduleIntelligenceMetric
                      label="Movement vs prior"
                      value={varianceLabel(latestUpdate.movement_weeks)}
                      tone={varianceTone(latestUpdate.movement_weeks)}
                    />
                    <ScheduleIntelligenceMetric
                      label="Activity snapshots"
                      value={String(latestActivitySnapshotCount)}
                      tone={
                        latestActivitySnapshotCount > 0
                          ? "text-foreground"
                          : "text-muted-foreground"
                      }
                    />
                  </div>
                  {latestUpdate.notes ? (
                    <div className="mt-3 max-w-5xl text-xs text-muted-foreground">
                      {latestUpdate.notes}
                    </div>
                  ) : null}
                  {cpmForecastStatus.isUnsaved && (
                    <div className="mt-3 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-medium text-foreground">
                      Unsaved forecast: the live CPM schedule now points to{" "}
                      {shortDate(cpmForecastStatus.unsavedForecast)}
                      {unsavedDeltaWeeks !== 0 ? (
                        <>
                          {" "}
                          — {Math.abs(unsavedDeltaWeeks)} week
                          {Math.abs(unsavedDeltaWeeks) === 1 ? "" : "s"}{" "}
                          {unsavedDeltaWeeks < 0 ? "earlier" : "later"} than the saved record (
                          {shortDate(cpmForecastStatus.forecastOfRecord)})
                        </>
                      ) : null}
                      . Save a new snapshot in the CPM workbench to make it the schedule update of
                      record.
                    </div>
                  )}
                </>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  No CPM update saved yet. In the CPM workbench, set the data date, work the
                  needs-update queue, and save the snapshot — that saved snapshot becomes schedule
                  update #1.
                </p>
              )}
            </div>
          )}
          <div className="mt-4 grid gap-3 md:grid-cols-4 md:items-end">
            {hasCpmActivities ? (
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Data date
                </Label>
                <div className="flex h-9 items-center rounded-md border border-input bg-surface px-3 text-sm tabular text-foreground">
                  {latestUpdate ? shortDate(latestUpdate.data_date) : "Set in the CPM workbench"}
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Data date
                </Label>
                <Input
                  type="date"
                  value={manualDataDate}
                  onChange={(e) => setManualDataDate(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Money exposure in update
              </Label>
              <MoneyInput value={scheduleMoneyExposure} onValueChange={setScheduleMoneyExposure} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Recovered / offset
              </Label>
              <MoneyInput value={scheduleMoneyRecovery} onValueChange={setScheduleMoneyRecovery} />
            </div>
            <ScheduleMoneyNetCard
              exposure={scheduleMoneyExposure}
              recovery={scheduleMoneyRecovery}
            />
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] md:items-end">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Schedule update narrative
              </Label>
              <Textarea
                ref={updateNotesRef}
                value={updateNotes}
                onChange={(e) => setUpdateNotes(e.target.value)}
                placeholder="What changed since the prior schedule update?"
                className="min-h-20 resize-y"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Money note
              </Label>
              <Input
                value={moneyNotes}
                onChange={(e) => setMoneyNotes(e.target.value)}
                placeholder="What dollar impact belongs to this update?"
              />
            </div>
            {hasCpmActivities ? (
              <Button
                type="button"
                disabled={!latestUpdate || annotate.isPending}
                onClick={() => annotate.mutate()}
              >
                {annotate.isPending
                  ? "Saving..."
                  : latestUpdate
                    ? `Save onto update #${latestUpdate.update_number}`
                    : "Save a CPM update first"}
              </Button>
            ) : (
              <Button
                type="button"
                disabled={!manualCompletionDraft || manualUpdate.isPending}
                onClick={() => manualUpdate.mutate({})}
              >
                {manualUpdate.isPending ? "Saving..." : "Save manual schedule update"}
              </Button>
            )}
          </div>
        </div>
      </details>

      {/* 9 · Dark workspace handoff panel */}
      <ScheduleWorkspaceLaunch
        project={project}
        activities={activities}
        milestones={milestones}
        latestDataDate={latestUpdate?.data_date ?? null}
      />

      {/* 10 · Job meta row */}
      <ScheduleMetaRow project={project} activities={activities} />
    </div>
  );
}

export function filterMilestones(milestones: MilestoneRow[], view: MilestoneView) {
  if (view === "all") return milestones;
  if (view === "complete") return milestones.filter((m) => m.status === "complete");
  return milestones.filter((m) => m.status !== "complete");
}

export function MilestoneViewSelect({
  value,
  onChange,
}: {
  value: MilestoneView;
  onChange: (value: MilestoneView) => void;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as MilestoneView)}>
      <SelectTrigger className="h-9 md:w-[150px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="active">Active</SelectItem>
        <SelectItem value="complete">Complete</SelectItem>
        <SelectItem value="all">All</SelectItem>
      </SelectContent>
    </Select>
  );
}
