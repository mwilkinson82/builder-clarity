import { useState, useEffect, useMemo } from "react";
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
import { GitBranch, Gauge, Check } from "lucide-react";
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
  type ScheduleRiskKind,
  type MilestoneRow,
  type ScheduleRiskRow,
} from "@/lib/schedule.functions";
import { createExposure, updateProjectFinancials, type ProjectRow } from "@/lib/projects.functions";
import { fmtUSD } from "@/lib/format";
import { computeScheduleVarianceWeeks } from "@/lib/ior";
import { buildConstructLineCpmModel } from "@/lib/constructline-cpm";
import {
  type CpmMilestoneForecast,
  EMPTY_ACTIVITIES,
  EMPTY_ACTIVITY_UPDATES,
  EMPTY_DELAY_FRAGMENTS,
  EMPTY_MILESTONES,
  EMPTY_MILESTONE_UPDATES,
  EMPTY_SCHEDULE_RISKS,
  EMPTY_SCHEDULE_UPDATES,
  type MilestoneView,
  RISK_META,
  moneyTone,
  shortDate,
  varianceLabel,
  varianceTone,
  weeksBetween,
} from "./scheduleShared";
import { buildCpmScheduleUpdateDraft, buildDelayFragmentSummary } from "./scheduleUpdateDraft";
import { ScheduleSnapshotTimeline } from "./ScheduleSnapshotTimeline";
import { ScheduleUpdateLedger } from "./ScheduleUpdateHistory";
import { DateField, MilestoneRowEditor } from "./ScheduleMilestones";
import { AddInline, RiskGroup } from "./ScheduleRiskItems";

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
  const createExposureFn = useServerFn(createExposure);
  const updateFin = useServerFn(updateProjectFinancials);
  const [completionUpdateDraft, setCompletionUpdateDraft] = useState(
    project.forecast_completion_date ?? "",
  );
  const [dataDate, setDataDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [scheduleMoneyExposure, setScheduleMoneyExposure] = useState(0);
  const [scheduleMoneyRecovery, setScheduleMoneyRecovery] = useState(0);
  const [moneyNotes, setMoneyNotes] = useState("");
  const [updateNotes, setUpdateNotes] = useState("");
  const [cpmMilestoneForecasts, setCpmMilestoneForecasts] = useState<CpmMilestoneForecast[]>([]);
  const [milestoneView, setMilestoneView] = useState<MilestoneView>("active");

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
      toast.success("Risk allocation created", {
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
  const lastScheduleUpdate = updates[0] ?? null;
  const lastMovementWeeks = lastScheduleUpdate
    ? lastScheduleUpdate.movement_weeks
    : weeksBetween(lastReviewForecast, project.forecast_completion_date);
  const scheduleVariance = computeScheduleVarianceWeeks(
    project.baseline_completion_date,
    completionUpdateDraft || project.forecast_completion_date,
  );
  const scheduleCpmModel = useMemo(
    () =>
      buildConstructLineCpmModel(activities, {
        dataDate,
        nearCriticalFloat: 5,
      }),
    [activities, dataDate],
  );
  const delaySummary = useMemo(() => buildDelayFragmentSummary(delayFragments), [delayFragments]);
  const cpmScheduleDraft = useMemo(
    () =>
      buildCpmScheduleUpdateDraft({
        dataDate,
        delaySummary,
        milestones,
        model: scheduleCpmModel,
        previousUpdate: lastScheduleUpdate,
        project,
      }),
    [dataDate, delaySummary, lastScheduleUpdate, milestones, project, scheduleCpmModel],
  );
  useEffect(() => {
    setCompletionUpdateDraft(project.forecast_completion_date ?? "");
  }, [project.forecast_completion_date]);

  const applyCpmDraft = () => {
    if (activities.length === 0) {
      toast.warning("CPM schedule is empty", {
        description: "Add activities before generating a schedule update.",
      });
      return;
    }
    setCompletionUpdateDraft(cpmScheduleDraft.forecast_completion_date);
    setDataDate(cpmScheduleDraft.data_date);
    setUpdateNotes(cpmScheduleDraft.notes);
    setCpmMilestoneForecasts(cpmScheduleDraft.milestone_forecasts);
    if (!moneyNotes.trim()) setMoneyNotes(cpmScheduleDraft.money_notes);
    toast.success("CPM forecast staged", {
      description:
        cpmScheduleDraft.milestone_forecasts.length > 0
          ? `${cpmScheduleDraft.milestone_forecasts.length} milestone forecast ${
              cpmScheduleDraft.milestone_forecasts.length === 1 ? "change is" : "changes are"
            } staged.`
          : "Completion and narrative fields were drafted from the CPM schedule.",
    });
  };

  const scheduleUpdate = useMutation({
    mutationFn: () =>
      createUpdate({
        data: {
          projectId,
          forecast_completion_date: completionUpdateDraft,
          data_date: dataDate,
          update_date: dataDate,
          schedule_money_exposure: scheduleMoneyExposure,
          schedule_money_recovery: scheduleMoneyRecovery,
          money_notes: moneyNotes,
          notes: updateNotes,
          milestone_forecasts: cpmMilestoneForecasts,
        },
      }),
    onSuccess: async () => {
      setUpdateNotes("");
      setMoneyNotes("");
      setCpmMilestoneForecasts([]);
      setScheduleMoneyExposure(0);
      setScheduleMoneyRecovery(0);
      await Promise.all([invalidateSchedule(), invalidateProject()]);
      toast.success("Schedule update saved", {
        description: "The data-date snapshot was added to the schedule update history.",
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
    <div className="space-y-8">
      {/* Top: editable completion summary */}
      <section className="rounded-lg border border-hairline bg-card p-6">
        <div className="mb-4">
          <h3 className="font-serif text-2xl text-foreground">Baseline vs schedule updates</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Create the committed baseline, then save dated updates with a data date. Each update is
            a snapshot in time and can carry schedule-related dollars.
          </p>
        </div>
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
          <DateField
            label="Current completion update"
            value={completionUpdateDraft}
            accent
            onCommit={(v) => setCompletionUpdateDraft(v ?? "")}
          />
          <ScheduleVarianceCard value={scheduleVariance} />
          <ScheduleDeltaCard value={lastMovementWeeks} />
        </div>
        <div className="mt-4 rounded-md border border-hairline bg-surface p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <Gauge className="h-3.5 w-3.5" />
                CPM schedule update assistant
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                <span className="rounded border border-hairline bg-card px-2 py-1">
                  1 Review CPM signal
                </span>
                <span className="rounded border border-hairline bg-card px-2 py-1">
                  2 Use CPM forecast
                </span>
                <span className="rounded border border-hairline bg-card px-2 py-1">
                  3 Save schedule update
                </span>
              </div>
              <div className="mt-2 grid gap-3 text-sm md:grid-cols-5">
                <ScheduleIntelligenceMetric
                  label="CPM forecast"
                  value={shortDate(cpmScheduleDraft.forecast_completion_date)}
                />
                <ScheduleIntelligenceMetric
                  label="CPM variance"
                  value={varianceLabel(cpmScheduleDraft.variance_weeks)}
                  tone={varianceTone(cpmScheduleDraft.variance_weeks)}
                />
                <ScheduleIntelligenceMetric
                  label="Critical basis"
                  value={scheduleCpmModel.criticalPathReliable ? "Reliable" : "Needs logic cleanup"}
                  tone={scheduleCpmModel.criticalPathReliable ? "text-success" : "text-warning"}
                />
                <ScheduleIntelligenceMetric
                  label="Milestone matches"
                  value={String(cpmScheduleDraft.milestone_forecasts.length)}
                  tone={
                    cpmScheduleDraft.milestone_forecasts.length > 0
                      ? "text-foreground"
                      : "text-muted-foreground"
                  }
                />
                <ScheduleIntelligenceMetric
                  label="Delay impacts"
                  value={`${delaySummary.openCount}/${delaySummary.totalCount}`}
                  tone={delaySummary.openDays > 0 ? "text-danger" : "text-muted-foreground"}
                />
              </div>
              <div className="mt-3 max-w-5xl text-xs text-muted-foreground">
                {cpmScheduleDraft.preview}
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="gap-2 lg:shrink-0"
              disabled={activities.length === 0}
              onClick={applyCpmDraft}
            >
              <GitBranch className="h-4 w-4" />
              Use CPM forecast
            </Button>
          </div>
          {cpmMilestoneForecasts.length > 0 && (
            <div className="mt-3 rounded border border-accent/25 bg-accent/10 px-3 py-2 text-xs font-medium text-foreground">
              CPM draft staged. Review the fields below, then save the schedule update.{" "}
              {cpmMilestoneForecasts.length} milestone forecast{" "}
              {cpmMilestoneForecasts.length === 1 ? "change is" : "changes are"} included.
            </div>
          )}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4 md:items-end">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Data date
            </Label>
            <Input type="date" value={dataDate} onChange={(e) => setDataDate(e.target.value)} />
          </div>
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
          <ScheduleMoneyNetCard exposure={scheduleMoneyExposure} recovery={scheduleMoneyRecovery} />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] md:items-end">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Schedule update narrative
            </Label>
            <Textarea
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
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={activities.length === 0}
              onClick={applyCpmDraft}
            >
              Use CPM forecast
            </Button>
            <Button
              type="button"
              disabled={!completionUpdateDraft || scheduleUpdate.isPending}
              onClick={() => scheduleUpdate.mutate()}
            >
              {scheduleUpdate.isPending ? "Saving..." : "Save schedule update"}
            </Button>
          </div>
        </div>
      </section>

      <ScheduleSnapshotTimeline
        project={project}
        updates={updates}
        milestones={milestones}
        activities={activities}
        milestoneView={milestoneView}
        onMilestoneViewChange={setMilestoneView}
      />

      <ScheduleUpdateLedger
        updates={updates}
        milestoneUpdates={milestoneUpdates}
        activityUpdates={activityUpdates}
      />

      {/* Interim milestones */}
      <section className="rounded-lg border border-hairline bg-card p-6">
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

      {/* Risk groups */}
      <div className="space-y-6">
        {(Object.keys(RISK_META) as ScheduleRiskKind[]).map((kind) => (
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

function ScheduleVarianceCard({ value }: { value: number | null }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Baseline variance
      </Label>
      <div
        className={`flex h-9 items-center rounded-md border border-input bg-surface px-3 text-sm tabular ${varianceTone(value)}`}
      >
        {varianceLabel(value)}
      </div>
    </div>
  );
}

function ScheduleDeltaCard({ value }: { value: number | null }) {
  const label =
    value == null
      ? "No prior update"
      : value > 0
        ? `+${value} wk`
        : value < 0
          ? `${value} wk`
          : "No movement";
  const tone =
    value == null
      ? "text-muted-foreground"
      : value > 0
        ? "text-danger"
        : value < 0
          ? "text-success"
          : "text-foreground";

  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Movement from prior update
      </Label>
      <div
        className={`flex h-9 items-center rounded-md border border-input px-3 text-sm tabular ${tone}`}
      >
        {label}
      </div>
    </div>
  );
}

function ScheduleMoneyNetCard({ exposure, recovery }: { exposure: number; recovery: number }) {
  const net = exposure - recovery;
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Net schedule dollars
      </Label>
      <div
        className={`flex h-9 items-center rounded-md border border-input bg-surface px-3 text-sm font-semibold tabular ${moneyTone(net)}`}
      >
        {fmtUSD(net)}
      </div>
    </div>
  );
}

function ScheduleIntelligenceMetric({
  label,
  value,
  tone = "text-foreground",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded border border-hairline bg-card px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 font-semibold tabular ${tone}`}>{value}</div>
    </div>
  );
}
