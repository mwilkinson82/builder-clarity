import { useState, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
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
import { MoneyInput } from "@/components/ui/money-input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Plus,
  Trash2,
  AlertTriangle,
  PackageSearch,
  Users,
  ClipboardList,
  Pencil,
  CheckCircle2,
  Printer,
  ExternalLink,
  GitBranch,
  Gauge,
  Layers,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  Diamond,
  Check,
  ChevronsUpDown,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  listSchedule,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  createScheduleRisk,
  updateScheduleRisk,
  deleteScheduleRisk,
  createScheduleUpdate,
  type MilestoneStatus,
  type ScheduleRiskKind,
  type ScheduleRiskStatus,
  type MilestoneRow,
  type ScheduleActivityRow,
  type ScheduleRiskRow,
  type ScheduleUpdateRow,
  type ScheduleMilestoneUpdateRow,
} from "@/lib/schedule.functions";
import { createExposure, updateProjectFinancials, type ProjectRow } from "@/lib/projects.functions";
import { fmtUSD } from "@/lib/format";
import {
  computeScheduleVarianceWeeks,
  type ExposureCategory,
  type HoldClass,
  type ResponsePath,
} from "@/lib/ior";
import {
  buildConstructLineCpmModel,
  isConstructLineMilestoneActivity,
  offsetFromTimelineStart,
  type ConstructLineCpmModel,
  type ConstructLineCpmTask,
} from "@/lib/constructline-cpm";

const STATUS_LABEL: Record<MilestoneStatus, string> = {
  on_track: "On track",
  at_risk: "At risk",
  delayed: "Delayed",
  complete: "Complete",
};
const STATUS_STYLES: Record<MilestoneStatus, string> = {
  on_track: "bg-success/15 text-success border-success/30",
  at_risk: "bg-warning/15 text-warning border-warning/30",
  delayed: "bg-danger/15 text-danger border-danger/30",
  complete: "bg-muted text-muted-foreground border-hairline",
};

const RISK_STATUS_LABEL: Record<ScheduleRiskStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  completed: "Completed",
};
const RISK_STATUS_STYLES: Record<ScheduleRiskStatus, string> = {
  active: "bg-warning/15 text-warning border-warning/30",
  inactive: "bg-secondary text-muted-foreground border-hairline",
  completed: "bg-success/15 text-success border-success/30",
};

const RISK_META: Record<
  ScheduleRiskKind,
  {
    label: string;
    icon: typeof PackageSearch;
    category: ExposureCategory;
    placeholder: string;
    detailPlaceholder: string;
  }
> = {
  critical_decision: {
    label: "Critical delayed decisions",
    icon: ClipboardList,
    category: "owner_decision",
    placeholder: "Short title (e.g. Appliance package selection)",
    detailPlaceholder:
      "Who owns it, what's blocked, dollar/schedule impact, mitigation plan, and dates. The more context here, the better the IOR report reads.",
  },
  procurement: {
    label: "Procurement risks",
    icon: PackageSearch,
    category: "procurement",
    placeholder: "Short title (e.g. Window package — manufacturer slip)",
    detailPlaceholder:
      "Lead-time situation, vendor commitments, fallback options, cost impact if expedited, and what triggers escalation.",
  },
  trade_performance: {
    label: "Trade performance risks",
    icon: Users,
    category: "trade_performance",
    placeholder: "Short title (e.g. Drywall sub — quality + manpower)",
    detailPlaceholder:
      "What's actually happening on site, evidence, sub's response, supplemental crew options, and dollar risk if it continues.",
  },
};

const CONSTRUCTLINE_ZOOM_LEVELS = [
  { label: "Fit", dayPx: 2 },
  { label: "Month", dayPx: 4 },
  { label: "Week", dayPx: 10 },
  { label: "Day", dayPx: 22 },
] as const;
const CONSTRUCTLINE_FIT_DAY_PX = CONSTRUCTLINE_ZOOM_LEVELS[0].dayPx;
const CONSTRUCTLINE_PRINT_TABLE_WIDTH = 490;
const CONSTRUCTLINE_PRINT_TIMELINE_WIDTH = 1040;

export type ActivityCreateInput = { name: string } & Partial<
  Pick<
    ScheduleActivityRow,
    | "activity_id"
    | "division"
    | "start_date"
    | "finish_date"
    | "percent_complete"
    | "predecessor_activity_ids"
    | "successor_activity_ids"
    | "notes"
    | "sort_order"
  >
>;

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

  const milestones = data?.milestones ?? [];
  const activities = data?.activities ?? [];
  const risks = data?.risks ?? [];
  const updates = data?.updates ?? [];
  const milestoneUpdates = data?.milestoneUpdates ?? [];
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
  const cpmScheduleDraft = useMemo(
    () =>
      buildCpmScheduleUpdateDraft({
        dataDate,
        milestones,
        model: scheduleCpmModel,
        previousUpdate: lastScheduleUpdate,
        project,
      }),
    [dataDate, lastScheduleUpdate, milestones, project, scheduleCpmModel],
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
              <div className="mt-2 grid gap-3 text-sm md:grid-cols-4">
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

      <ScheduleUpdateLedger updates={updates} milestoneUpdates={milestoneUpdates} />

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

const weeksBetween = computeScheduleVarianceWeeks;

type MilestoneView = "active" | "complete" | "all";

type CpmMilestoneForecast = {
  milestone_id: string;
  forecast_date: string | null;
  status: MilestoneStatus;
  delay_reason: string;
};

type CpmScheduleUpdateDraft = {
  data_date: string;
  forecast_completion_date: string;
  variance_weeks: number | null;
  movement_weeks: number | null;
  milestone_forecasts: CpmMilestoneForecast[];
  money_notes: string;
  notes: string;
  preview: string;
};

function filterMilestones(milestones: MilestoneRow[], view: MilestoneView) {
  if (view === "all") return milestones;
  if (view === "complete") return milestones.filter((m) => m.status === "complete");
  return milestones.filter((m) => m.status !== "complete");
}

function buildCpmScheduleUpdateDraft({
  dataDate,
  milestones,
  model,
  previousUpdate,
  project,
}: {
  dataDate: string;
  milestones: MilestoneRow[];
  model: ConstructLineCpmModel;
  previousUpdate: ScheduleUpdateRow | null;
  project: ProjectRow;
}): CpmScheduleUpdateDraft {
  const forecastCompletion =
    model.tasks.length > 0 ? model.cpmFinishDate : project.forecast_completion_date || dataDate;
  const previousCompletion =
    previousUpdate?.forecast_completion_date ?? project.forecast_completion_date ?? null;
  const varianceWeeks = computeScheduleVarianceWeeks(
    project.baseline_completion_date,
    forecastCompletion,
  );
  const movementWeeks = computeScheduleVarianceWeeks(previousCompletion, forecastCompletion);
  const milestoneForecasts = buildCpmMilestoneForecasts(model, milestones);
  const criticalDrivers = model.tasks
    .filter((task) => task.isCritical && task.activity.percent_complete < 100)
    .slice(0, 3)
    .map((task) => task.dependencyKey || task.activity.name);
  const qualityParts = model.criticalPathReliable
    ? [`${model.criticalCount} critical`, `${model.nearCriticalCount} near-critical`]
    : [`Critical path provisional: ${model.criticalPathReliabilityNote}`];
  if (model.openStartCount > 1 || model.openFinishCount > 1) {
    qualityParts.push(`${model.openStartCount}/${model.openFinishCount} open starts/finishes`);
  }
  if (model.lateCount > 0) qualityParts.push(`${model.lateCount} late`);
  if (model.outOfSequenceCount > 0) {
    qualityParts.push(`${model.outOfSequenceCount} out-of-sequence`);
  }
  if (model.maxStack >= 4) {
    qualityParts.push(`${model.maxStack} peak stack at ${model.maxStackLabel}`);
  }

  const previewParts = [
    `CPM forecast ${shortDate(forecastCompletion)} (${varianceLabel(
      varianceWeeks,
    )} vs baseline, ${varianceLabel(movementWeeks)} movement).`,
    qualityParts.join("; ") + ".",
    criticalDrivers.length > 0 ? `Drivers: ${criticalDrivers.join(", ")}.` : null,
    milestoneForecasts.length > 0
      ? `${milestoneForecasts.length} milestone forecast ${
          milestoneForecasts.length === 1 ? "update" : "updates"
        } matched from CPM diamonds.`
      : null,
  ].filter(Boolean);
  const preview = previewParts.join(" ");

  return {
    data_date: dataDate,
    forecast_completion_date: forecastCompletion,
    variance_weeks: varianceWeeks,
    movement_weeks: movementWeeks,
    milestone_forecasts: milestoneForecasts,
    money_notes: "No schedule dollars auto-calculated from CPM.",
    notes: preview,
    preview,
  };
}

function buildCpmMilestoneForecasts(
  model: ConstructLineCpmModel,
  milestones: MilestoneRow[],
): CpmMilestoneForecast[] {
  const milestoneByName = new Map(
    milestones.map((milestone) => [normalizeScheduleMatchName(milestone.name), milestone]),
  );
  const seen = new Set<string>();

  return model.tasks.flatMap((task) => {
    if (!task.isMilestone) return [];
    const milestone = milestoneByName.get(normalizeScheduleMatchName(task.activity.name));
    if (!milestone || seen.has(milestone.id)) return [];
    seen.add(milestone.id);
    const forecastDate = task.visualFinishDate;
    const varianceWeeks = computeScheduleVarianceWeeks(milestone.baseline_date, forecastDate);
    const status = cpmMilestoneStatus(task, varianceWeeks);
    const delayReason = cpmMilestoneReason(task, forecastDate, varianceWeeks);
    if (
      milestone.forecast_date === forecastDate &&
      milestone.status === status &&
      milestone.delay_reason === delayReason
    ) {
      return [];
    }
    return [
      {
        milestone_id: milestone.id,
        forecast_date: forecastDate,
        status,
        delay_reason: delayReason,
      },
    ];
  });
}

function cpmMilestoneStatus(
  task: ConstructLineCpmTask,
  varianceWeeks: number | null,
): MilestoneStatus {
  if (task.activity.percent_complete >= 100) return "complete";
  if ((varianceWeeks ?? 0) > 0 || task.isLate) return "delayed";
  if (task.isOutOfSequence || task.totalFloat <= 5) return "at_risk";
  return "on_track";
}

function cpmMilestoneReason(
  task: ConstructLineCpmTask,
  forecastDate: string,
  varianceWeeks: number | null,
) {
  const parts = [`CPM forecast ${shortDate(forecastDate)}`];
  if (varianceWeeks != null) parts.push(`${varianceLabel(varianceWeeks)} vs baseline`);
  if (task.isCritical) parts.push("critical path");
  else if (task.isNearCritical) parts.push(`${task.totalFloat}d total float`);
  if (task.isLate) parts.push("past data date");
  if (task.isOutOfSequence) parts.push("out-of-sequence progress");
  if (task.isOpenStart || task.isOpenFinish) parts.push("open-end logic");
  return `${parts.join("; ")}.`;
}

function normalizeScheduleMatchName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\bmilestone\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function MilestoneViewSelect({
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

function varianceLabel(value: number | null) {
  if (value == null) return "Set dates";
  if (value > 0) return `+${value} wk`;
  if (value < 0) return `${value} wk`;
  return "On plan";
}

function varianceTone(value: number | null) {
  if (value == null) return "text-muted-foreground";
  if (value > 0) return "text-danger";
  if (value < 0) return "text-success";
  return "text-foreground";
}

function moneyTone(value: number) {
  if (value > 0) return "text-danger";
  if (value < 0) return "text-success";
  return "text-foreground";
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

function ScheduleSnapshotTimeline({
  project,
  updates,
  milestones,
  activities,
  milestoneView,
  onMilestoneViewChange,
}: {
  project: ProjectRow;
  updates: ScheduleUpdateRow[];
  milestones: MilestoneRow[];
  activities: ScheduleActivityRow[];
  milestoneView: MilestoneView;
  onMilestoneViewChange: (value: MilestoneView) => void;
}) {
  const latestUpdate = updates[0] ?? null;
  const visibleMilestones = filterMilestones(milestones, milestoneView);
  const activeMilestoneCount = milestones.filter((m) => m.status !== "complete").length;
  const completedMilestoneCount = milestones.filter((m) => m.status === "complete").length;
  const schedulePressureCount = milestones.filter(
    (m) => m.status === "delayed" || m.status === "at_risk",
  ).length;
  const dateValues = [
    project.baseline_completion_date,
    project.forecast_completion_date,
    ...updates.flatMap((update) => [update.data_date, update.forecast_completion_date]),
    ...milestones.flatMap((milestone) => [milestone.baseline_date, milestone.forecast_date]),
  ];
  const bounds = getTimelineBounds(dateValues);
  const completionBaseline = timelinePosition(project.baseline_completion_date, bounds);
  const currentCompletion = timelinePosition(project.forecast_completion_date, bounds);
  const dataDatePosition = timelinePosition(latestUpdate?.data_date, bounds);
  const recentUpdates = updates.slice(0, 6).reverse();
  const completionVariance =
    computeScheduleVarianceWeeks(
      project.baseline_completion_date,
      project.forecast_completion_date,
    ) ?? 0;

  return (
    <section className="rounded-lg border border-hairline bg-card p-6">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h3 className="font-serif text-2xl text-foreground">Construction schedule</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Baseline dates stay fixed. Current bars move with each data-date update so the team can
            see the schedule snapshot without opening another scheduling tool.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <MilestoneViewSelect value={milestoneView} onChange={onMilestoneViewChange} />
          <div className="text-xs text-muted-foreground">
            {recentUpdates.length > 0
              ? `${recentUpdates.length} latest update${recentUpdates.length === 1 ? "" : "s"} shown`
              : "No updates saved yet"}
          </div>
        </div>
      </div>

      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-4">
          <ScheduleStat
            label="Latest data date"
            value={shortDate(latestUpdate?.data_date)}
            sub={latestUpdate ? `Update #${latestUpdate.update_number}` : "No update saved"}
          />
          <ScheduleStat
            label="Active milestones"
            value={String(activeMilestoneCount)}
            sub={`${completedMilestoneCount} complete`}
          />
          <ScheduleStat
            label="Delayed / at risk"
            value={String(schedulePressureCount)}
            sub="Needs meeting attention"
            tone={schedulePressureCount > 0 ? "danger" : "success"}
          />
          <ScheduleStat
            label="Schedule dollars"
            value={fmtUSD(latestUpdate?.schedule_money_net ?? 0)}
            sub="Latest update net"
            tone={(latestUpdate?.schedule_money_net ?? 0) > 0 ? "danger" : "success"}
          />
        </div>

        <div className="rounded-md border border-hairline bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-3 text-xs">
            <div>
              <div className="font-semibold text-foreground">Project completion path</div>
              <div className="text-muted-foreground">
                Baseline {shortDate(project.baseline_completion_date)} · Current update{" "}
                {shortDate(project.forecast_completion_date)}
              </div>
            </div>
            <div className={`font-semibold tabular ${varianceTone(completionVariance)}`}>
              {varianceLabel(completionVariance)}
            </div>
          </div>
          <div className="relative h-10 rounded-full bg-muted">
            {dataDatePosition != null && (
              <div
                className="absolute inset-y-1 w-px bg-foreground/35"
                style={{ left: `${dataDatePosition}%` }}
              >
                <span className="absolute -top-5 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Data date
                </span>
              </div>
            )}
            {completionBaseline != null && (
              <TimelineMarker
                left={completionBaseline}
                label="Baseline"
                className="border-foreground bg-foreground"
              />
            )}
            {currentCompletion != null && (
              <TimelineMarker
                left={currentCompletion}
                label="Current"
                className="border-accent bg-accent"
              />
            )}
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
            <span>{shortDate(bounds.startLabel)}</span>
            <span>{shortDate(bounds.endLabel)}</span>
          </div>
        </div>

        <ScheduleWorkspaceLaunch
          activities={activities}
          milestones={milestones}
          project={project}
          latestDataDate={latestUpdate?.data_date ?? null}
        />

        <div className="rounded-md border border-hairline bg-surface">
          <div className="border-b border-hairline px-4 py-3">
            <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Baseline vs current milestone plan
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Showing {visibleMilestones.length} of {milestones.length} milestones. Use this as
                  the simple Gantt view for meeting review.
                </div>
              </div>
              <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full border border-foreground bg-card" />
                  Baseline
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full border border-accent bg-accent" />
                  Current
                </span>
              </div>
            </div>
          </div>
          {visibleMilestones.length === 0 ? (
            <div className="px-4 py-8 text-sm text-muted-foreground">
              No {milestoneView === "complete" ? "completed" : milestoneView} milestones to show.
              Add schedule milestones below to build the plan.
            </div>
          ) : (
            <div className="max-h-[560px] overflow-y-auto">
              {visibleMilestones.map((milestone) => (
                <SchedulePlanRow
                  key={milestone.id}
                  milestone={milestone}
                  bounds={bounds}
                  dataDatePosition={dataDatePosition}
                />
              ))}
            </div>
          )}
        </div>

        {recentUpdates.length > 0 && (
          <div className="grid gap-3 md:grid-cols-3">
            {recentUpdates.map((update) => (
              <div key={update.id} className="rounded-md border border-hairline bg-surface p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Update #{update.update_number}
                    </div>
                    <div className="mt-1 font-medium text-foreground">
                      Data date {shortDate(update.data_date)}
                    </div>
                  </div>
                  <div
                    className={`text-sm font-semibold tabular ${moneyTone(
                      update.schedule_money_net,
                    )}`}
                  >
                    {fmtUSD(update.schedule_money_net)}
                  </div>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  Current completion {shortDate(update.forecast_completion_date)}
                </div>
                {(update.notes || update.money_notes) && (
                  <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">
                    {update.notes || update.money_notes}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ScheduleWorkspaceLaunch({
  project,
  activities,
  milestones,
  latestDataDate,
}: {
  project: ProjectRow;
  activities: ScheduleActivityRow[];
  milestones: MilestoneRow[];
  latestDataDate: string | null;
}) {
  const completedActivities = activities.filter(
    (activity) => activity.percent_complete >= 100,
  ).length;
  const activitiesWithLogic = activities.filter(
    (activity) =>
      activity.predecessor_activity_ids.length > 0 || activity.successor_activity_ids.length > 0,
  ).length;
  const activeMilestones = milestones.filter((milestone) => milestone.status !== "complete").length;

  return (
    <div className="rounded-md border border-hairline bg-surface p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Schedule workspace
          </div>
          <h4 className="mt-1 font-serif text-2xl text-foreground">
            Full activity table and Gantt
          </h4>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Build and manage the project construction schedule in a dedicated full-width workspace.
            This IOR page keeps the schedule signal, baseline variance, and milestone rollup clean.
          </p>
        </div>
        <Button asChild className="gap-2 print:hidden">
          <a href={`/projects/${project.id}/schedule`} target="_blank" rel="noreferrer">
            <ExternalLink className="h-4 w-4" />
            Open full schedule workspace
          </a>
        </Button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <ScheduleWorkbenchStat
          label="Activities"
          value={String(activities.length)}
          sub={`${completedActivities} complete`}
          tone={completedActivities > 0 ? "success" : "default"}
        />
        <ScheduleWorkbenchStat
          label="Logic ties"
          value={String(activitiesWithLogic)}
          sub="pred / succ"
          tone={activitiesWithLogic > 0 ? "success" : "warning"}
        />
        <ScheduleWorkbenchStat
          label="Milestones"
          value={String(activeMilestones)}
          sub={`${milestones.length} total`}
        />
        <ScheduleWorkbenchStat
          label="Latest data date"
          value={shortDate(latestDataDate)}
          sub="current snapshot"
        />
      </div>
    </div>
  );
}

type ActivityDraft = {
  activity_id: string;
  name: string;
  division: string;
  start_date: string;
  finish_date: string;
  percent_complete: string;
  predecessor_activity_ids: string;
  successor_activity_ids: string;
  notes: string;
  is_milestone: boolean;
};

const emptyActivityDraft = (): ActivityDraft => ({
  activity_id: "",
  name: "",
  division: "General",
  start_date: "",
  finish_date: "",
  percent_complete: "0",
  predecessor_activity_ids: "",
  successor_activity_ids: "",
  notes: "",
  is_milestone: false,
});

const activityDraftFromRow = (activity: ScheduleActivityRow): ActivityDraft => ({
  activity_id: activity.activity_id,
  name: activity.name,
  division: activity.division || "General",
  start_date: activity.start_date ?? "",
  finish_date: activity.finish_date ?? "",
  percent_complete: String(activity.percent_complete),
  predecessor_activity_ids: formatActivityIds(activity.predecessor_activity_ids),
  successor_activity_ids: formatActivityIds(activity.successor_activity_ids),
  notes: activity.notes ?? "",
  is_milestone: isConstructLineMilestoneActivity(activity),
});

export function CpmActivityPlanner({
  activities,
  milestones,
  project,
  latestDataDate,
  onAddActivity,
  onSeedActivities,
  isSeedingActivities,
  onPatchActivity,
  isSavingActivity,
  onDeleteActivity,
}: {
  activities: ScheduleActivityRow[];
  milestones: MilestoneRow[];
  project: ProjectRow;
  latestDataDate: string | null;
  onAddActivity: (activity: ActivityCreateInput) => void;
  onSeedActivities: (activities: ActivityCreateInput[]) => void;
  isSeedingActivities: boolean;
  onPatchActivity: (id: string, patch: Partial<ScheduleActivityRow>) => Promise<void>;
  isSavingActivity: boolean;
  onDeleteActivity: (id: string) => void;
}) {
  const [draft, setDraft] = useState<ActivityDraft>(() => emptyActivityDraft());
  const [showDraft, setShowDraft] = useState(false);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [dayPx, setDayPx] =
    useState<(typeof CONSTRUCTLINE_ZOOM_LEVELS)[number]["dayPx"]>(CONSTRUCTLINE_FIT_DAY_PX);
  const [showLogicLines, setShowLogicLines] = useState(false);
  const [isFocusOpen, setIsFocusOpen] = useState(false);
  const sortedActivities = useMemo(
    () =>
      [...activities].sort((a, b) => {
        const division = a.division.localeCompare(b.division);
        if (division !== 0) return division;
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return a.activity_id.localeCompare(b.activity_id);
      }),
    [activities],
  );
  const grouped = useMemo(() => groupActivitiesByDivision(sortedActivities), [sortedActivities]);
  const cpmModel = useMemo(
    () =>
      buildConstructLineCpmModel(sortedActivities, {
        dataDate: latestDataDate,
        nearCriticalFloat: 5,
      }),
    [latestDataDate, sortedActivities],
  );
  const bounds = useMemo(
    () =>
      getTimelineBounds([
        project.baseline_completion_date,
        project.forecast_completion_date,
        latestDataDate,
        ...activities.flatMap((activity) => [activity.start_date, activity.finish_date]),
      ]),
    [
      activities,
      latestDataDate,
      project.baseline_completion_date,
      project.forecast_completion_date,
    ],
  );
  const selectedActivity = useMemo(
    () => sortedActivities.find((activity) => activity.id === selectedActivityId) ?? null,
    [selectedActivityId, sortedActivities],
  );
  const milestoneSeedRows = useMemo(
    () => buildActivityRowsFromMilestones(milestones, sortedActivities),
    [milestones, sortedActivities],
  );

  useEffect(() => {
    if (selectedActivityId && !selectedActivity) setSelectedActivityId(null);
  }, [selectedActivity, selectedActivityId]);

  useEffect(() => {
    if (!isFocusOpen || typeof document === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isFocusOpen]);

  useEffect(() => {
    if (!isFocusOpen || typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFocusOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFocusOpen]);

  const addActivity = () => {
    const name = draft.name.trim();
    if (!name) return;
    const milestoneDate = getMilestoneDraftDate(draft);
    onAddActivity({
      activity_id: draft.activity_id.trim() || undefined,
      name,
      division: draft.is_milestone ? "Milestones" : draft.division.trim() || "General",
      start_date: draft.is_milestone ? milestoneDate : draft.start_date || null,
      finish_date: draft.is_milestone ? milestoneDate : draft.finish_date || null,
      percent_complete: parsePercent(draft.percent_complete),
      predecessor_activity_ids: parseActivityIds(draft.predecessor_activity_ids),
      successor_activity_ids: parseActivityIds(draft.successor_activity_ids),
      notes: draft.notes.trim(),
    });
    setDraft(emptyActivityDraft());
    setShowDraft(false);
  };
  const openMilestoneDraft = () => {
    const existingIds = new Set(sortedActivities.map((activity) => activity.activity_id));
    setDraft({
      ...emptyActivityDraft(),
      activity_id: uniqueActivityId(
        `MS-${String(milestones.length + 1).padStart(3, "0")}`,
        existingIds,
      ),
      division: "Milestones",
      is_milestone: true,
    });
    setShowDraft(true);
  };
  const completedActivities = sortedActivities.filter(
    (activity) => activity.percent_complete >= 100,
  ).length;
  const activitiesWithLogic = sortedActivities.filter(
    (activity) =>
      activity.predecessor_activity_ids.length > 0 || activity.successor_activity_ids.length > 0,
  ).length;
  const activitiesWithDates = sortedActivities.filter(
    (activity) => activity.start_date || activity.finish_date,
  ).length;
  const printedLogicTieCount = cpmModel.tasks.reduce(
    (total, task) => total + task.predecessorKeys.length,
    0,
  );

  return (
    <>
      <section className="constructline-cpm-print-shell" aria-label="Printable CPM schedule">
        <div className="constructline-cpm-print-titlebar">
          <div>
            <div className="constructline-cpm-print-kicker">ConstructLine CPM grid</div>
            <h1>{project.name} schedule</h1>
            <div className="constructline-cpm-print-meta">
              {project.job_number && <span>Job # {project.job_number}</span>}
              {project.client && <span>{project.client}</span>}
              {project.project_manager && <span>PM {project.project_manager}</span>}
              <span>
                {shortDate(cpmModel.timelineStartDate)} to {shortDate(cpmModel.timelineFinishDate)}
              </span>
              {showLogicLines && (
                <span>
                  {cpmModel.tasks.length} activities · {printedLogicTieCount} logic ties shown
                </span>
              )}
              <span>Optimized for 11 x 17 landscape</span>
            </div>
          </div>
          <div className="constructline-cpm-print-status">
            <span>Print setup</span>
            <strong>11 x 17 landscape</strong>
            <em>Critical basis: {cpmModel.criticalPathReliable ? "valid" : "provisional"}</em>
          </div>
        </div>
        <ActivityScheduleMatrix
          model={cpmModel}
          dayPx={CONSTRUCTLINE_FIT_DAY_PX}
          dataDate={latestDataDate}
          showLogicLines={showLogicLines}
          isPrintMode
          onOpenActivity={() => undefined}
          onDeleteActivity={() => undefined}
        />
      </section>
      <div className="constructline-screen-workbench rounded-lg border border-hairline bg-surface p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              ConstructLine beta
            </div>
            <h4 className="mt-1 font-serif text-2xl text-foreground">CPM schedule workbench</h4>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Build the working job schedule with activity IDs, divisions, start/finish dates,
              progress, predecessor/successor logic, float, critical path, and activity stacking.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            <ScheduleZoomControls dayPx={dayPx} onChange={setDayPx} />
            <Button
              type="button"
              variant={showLogicLines ? "default" : "outline"}
              className="gap-2"
              aria-pressed={showLogicLines}
              onClick={() => setShowLogicLines((visible) => !visible)}
            >
              <GitBranch className="h-4 w-4" />
              Logic lines
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => setIsFocusOpen(true)}
            >
              <Maximize2 className="h-4 w-4" />
              Expand
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              disabled={milestoneSeedRows.length === 0 || isSeedingActivities}
              onClick={() => onSeedActivities(milestoneSeedRows)}
            >
              <ClipboardList className="h-4 w-4" />
              {isSeedingActivities ? "Building..." : "Build from milestones"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              title="Print optimized for Tabloid / 11 x 17 landscape"
              onClick={() => typeof window !== "undefined" && window.print()}
            >
              <Printer className="h-4 w-4" />
              Print 11x17
            </Button>
            <Button type="button" className="gap-2" onClick={() => setShowDraft((open) => !open)}>
              <Plus className="h-4 w-4" />
              Add activity
            </Button>
            <Button type="button" variant="outline" className="gap-2" onClick={openMilestoneDraft}>
              <Diamond className="h-4 w-4" />
              Add milestone
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <ScheduleWorkbenchStat
            label="CPM health"
            value={`${cpmModel.healthScore}%`}
            sub="logic quality"
            tone={cpmModel.healthTone}
          />
          <ScheduleWorkbenchStat
            label="Critical"
            value={String(cpmModel.criticalCount)}
            sub={
              cpmModel.criticalPathReliable
                ? `${cpmModel.nearCriticalCount} near-critical`
                : "provisional until open ends close"
            }
            tone={
              cpmModel.criticalPathReliable
                ? cpmModel.criticalCount > 0
                  ? "danger"
                  : "default"
                : "warning"
            }
          />
          <ScheduleWorkbenchStat
            label="Open ends"
            value={`${cpmModel.openStartCount}/${cpmModel.openFinishCount}`}
            sub="starts / finishes"
            tone={
              cpmModel.openStartCount > 1 || cpmModel.openFinishCount > 1 ? "warning" : "success"
            }
          />
          <ScheduleWorkbenchStat
            label="Max stack"
            value={String(cpmModel.maxStack)}
            sub={cpmModel.maxStackLabel}
            tone={cpmModel.maxStack >= 4 ? "warning" : "default"}
          />
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-md border border-hairline bg-card p-4">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <Gauge className="h-3.5 w-3.5" />
              Schedule intelligence
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {cpmModel.recommendations.slice(0, 4).map((item) => (
                <div
                  key={item}
                  className="rounded border border-hairline bg-surface px-3 py-2 text-sm text-foreground"
                >
                  {item}
                </div>
              ))}
            </div>
            {cpmModel.diagnostics.length > 0 && (
              <div className="mt-3 rounded border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning">
                {cpmModel.diagnostics.slice(0, 2).join(" ")}
              </div>
            )}
          </div>
          <div className="rounded-md border border-hairline bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <Layers className="h-3.5 w-3.5" />
                Activity stacking
              </div>
              <div className="text-xs font-semibold tabular text-foreground">
                {cpmModel.maxStack} peak
              </div>
            </div>
            <StackingMiniMap model={cpmModel} />
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <ScheduleWorkbenchStat
            label="Activities"
            value={String(sortedActivities.length)}
            sub="in plan"
          />
          <ScheduleWorkbenchStat
            label="Complete"
            value={`${completedActivities}/${sortedActivities.length || 0}`}
            sub="progress count"
            tone={completedActivities > 0 ? "success" : "default"}
          />
          <ScheduleWorkbenchStat
            label="Logic ties"
            value={String(activitiesWithLogic)}
            sub="pred / succ"
            tone={activitiesWithLogic > 0 ? "success" : "warning"}
          />
          <ScheduleWorkbenchStat
            label="Dated"
            value={`${activitiesWithDates}/${sortedActivities.length || 0}`}
            sub={`${shortDate(bounds.startLabel)} to ${shortDate(bounds.endLabel)}`}
          />
        </div>

        {milestones.length > 0 && milestoneSeedRows.length > 0 && (
          <div className="mt-4 rounded-md border border-hairline bg-card p-3 text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">Milestone bridge:</span>{" "}
            {milestoneSeedRows.length} milestone {milestoneSeedRows.length === 1 ? "is" : "are"}{" "}
            ready to become CPM activity rows. Build them once, then add logic ties and update
            percent complete from the schedule workbench.
          </div>
        )}

        {showDraft && (
          <div className="mt-5 rounded-md border border-hairline bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {draft.is_milestone ? "New milestone" : "New activity"}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Add one schedule row now. Choose predecessors and successors from the current
                  activity list.
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant={draft.is_milestone ? "default" : "outline"}
                  className="gap-2 print:hidden"
                  aria-pressed={draft.is_milestone}
                  onClick={() => setDraft(toggleMilestoneDraft(draft, !draft.is_milestone))}
                >
                  <Diamond className="h-4 w-4" />
                  Milestone
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="print:hidden"
                  onClick={() => {
                    setDraft(emptyActivityDraft());
                    setShowDraft(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-[130px_minmax(240px,1fr)_170px_150px_150px_110px]">
              <LabeledField label="Activity ID">
                <Input
                  value={draft.activity_id}
                  onChange={(e) => setDraft({ ...draft, activity_id: e.target.value })}
                  placeholder="A-010"
                  className="h-10"
                />
              </LabeledField>
              <LabeledField label="Activity">
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Frame exterior walls"
                  className="h-10"
                />
              </LabeledField>
              <LabeledField label="Division">
                <Input
                  value={draft.division}
                  onChange={(e) => setDraft({ ...draft, division: e.target.value })}
                  placeholder="06 Wood"
                  className="h-10"
                />
              </LabeledField>
              <LabeledField label="Start">
                <Input
                  type="date"
                  value={draft.start_date}
                  onChange={(e) => setDraft(updateDraftStartDate(draft, e.target.value))}
                  className="h-10"
                />
              </LabeledField>
              <LabeledField label="Finish">
                <Input
                  type="date"
                  value={draft.finish_date}
                  onChange={(e) => setDraft(updateDraftFinishDate(draft, e.target.value))}
                  className="h-10"
                />
              </LabeledField>
              <LabeledField label="% done">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.percent_complete}
                  onChange={(e) => setDraft({ ...draft, percent_complete: e.target.value })}
                  className="h-10 tabular"
                />
              </LabeledField>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(220px,0.8fr)_minmax(220px,0.8fr)_minmax(260px,1fr)_auto] lg:items-end">
              <ActivityDependencyPicker
                label="Predecessors"
                emptyLabel="Choose activities that must finish first"
                selectedIds={draft.predecessor_activity_ids}
                activities={sortedActivities}
                blockedActivityId={draft.activity_id}
                blockedIds={parseActivityIds(draft.successor_activity_ids)}
                onChange={(value) => setDraft({ ...draft, predecessor_activity_ids: value })}
              />
              <ActivityDependencyPicker
                label="Successors"
                emptyLabel="Choose activities that follow this one"
                selectedIds={draft.successor_activity_ids}
                activities={sortedActivities}
                blockedActivityId={draft.activity_id}
                blockedIds={parseActivityIds(draft.predecessor_activity_ids)}
                onChange={(value) => setDraft({ ...draft, successor_activity_ids: value })}
              />
              <LabeledField label="Notes">
                <Textarea
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  placeholder="Scope, sequencing constraint, crew assumption, or schedule risk."
                  className="min-h-10 resize-y"
                />
              </LabeledField>
              <Button
                type="button"
                className="h-10 gap-2"
                disabled={!draft.name.trim()}
                onClick={addActivity}
              >
                {draft.is_milestone ? (
                  <Diamond className="h-4 w-4" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {draft.is_milestone ? "Add milestone" : "Add activity"}
              </Button>
            </div>
          </div>
        )}

        <ActivityScheduleMatrix
          model={cpmModel}
          dayPx={dayPx}
          dataDate={latestDataDate}
          showLogicLines={showLogicLines}
          onOpenActivity={(activity) => setSelectedActivityId(activity.id)}
          onDeleteActivity={(id) => {
            if (selectedActivityId === id) setSelectedActivityId(null);
            onDeleteActivity(id);
          }}
        />
      </div>

      {isFocusOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background p-3 text-foreground print:hidden sm:p-5">
          <div className="mb-3 flex flex-col gap-3 rounded-md border border-hairline bg-card px-4 py-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                ConstructLine CPM grid
              </div>
              <div className="mt-1 font-serif text-2xl text-foreground">
                {project.name} schedule
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <ScheduleZoomControls dayPx={dayPx} onChange={setDayPx} />
              <Button
                type="button"
                variant={showLogicLines ? "default" : "outline"}
                className="gap-2"
                aria-pressed={showLogicLines}
                onClick={() => setShowLogicLines((visible) => !visible)}
              >
                <GitBranch className="h-4 w-4" />
                Logic lines
              </Button>
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                title="Print optimized for Tabloid / 11 x 17 landscape"
                onClick={() => typeof window !== "undefined" && window.print()}
              >
                <Printer className="h-4 w-4" />
                Print 11x17
              </Button>
              <Button type="button" className="gap-2" onClick={() => setIsFocusOpen(false)}>
                <Minimize2 className="h-4 w-4" />
                Close
              </Button>
            </div>
          </div>

          <ActivityScheduleMatrix
            model={cpmModel}
            dayPx={dayPx}
            dataDate={latestDataDate}
            showLogicLines={showLogicLines}
            isFocusMode
            onOpenActivity={(activity) => setSelectedActivityId(activity.id)}
            onDeleteActivity={(id) => {
              if (selectedActivityId === id) setSelectedActivityId(null);
              onDeleteActivity(id);
            }}
          />
        </div>
      )}

      {selectedActivity && (
        <ActivityDetailDialog
          activity={selectedActivity}
          activities={sortedActivities}
          isSaving={isSavingActivity}
          onClose={() => setSelectedActivityId(null)}
          onSave={(patch) => onPatchActivity(selectedActivity.id, patch)}
          onDelete={() => {
            const id = selectedActivity.id;
            setSelectedActivityId(null);
            onDeleteActivity(id);
          }}
        />
      )}
    </>
  );
}

function ScheduleWorkbenchStat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-danger"
          : "text-foreground";
  return (
    <div className="min-w-0 rounded-md border border-hairline bg-card p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 truncate text-xl font-semibold tabular ${toneClass}`}>{value}</div>
      <div className="mt-1 truncate text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function ScheduleZoomControls({
  dayPx,
  onChange,
}: {
  dayPx: (typeof CONSTRUCTLINE_ZOOM_LEVELS)[number]["dayPx"];
  onChange: (dayPx: (typeof CONSTRUCTLINE_ZOOM_LEVELS)[number]["dayPx"]) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-hairline bg-card">
      {CONSTRUCTLINE_ZOOM_LEVELS.map((level) => (
        <button
          key={level.label}
          type="button"
          aria-pressed={dayPx === level.dayPx}
          className={cn(
            "h-9 border-r border-hairline px-3 text-xs font-semibold text-muted-foreground last:border-r-0 hover:bg-muted/60",
            dayPx === level.dayPx && "bg-foreground text-background hover:bg-foreground",
          )}
          onClick={() => onChange(level.dayPx)}
        >
          <span className="inline-flex items-center gap-1.5">
            {level.label === "Fit" && <ZoomOut className="h-3.5 w-3.5" />}
            {level.label === "Day" && <ZoomIn className="h-3.5 w-3.5" />}
            {level.label}
          </span>
        </button>
      ))}
    </div>
  );
}

function ConstructLinePrintReport({
  model,
  project,
  latestDataDate,
  showLogicLines,
}: {
  model: ConstructLineCpmModel;
  project: ProjectRow;
  latestDataDate: string | null;
  showLogicLines: boolean;
}) {
  const monthBands = useMemo(
    () => buildConstructLineMonthBands(model.timelineStartDate, model.totalTimelineDays, 1),
    [model.timelineStartDate, model.totalTimelineDays],
  );
  const printRows = useMemo(
    () =>
      model.groups.flatMap<
        | { kind: "group"; division: string; tasks: ConstructLineCpmTask[] }
        | { kind: "task"; task: ConstructLineCpmTask }
      >((group) => [
        { kind: "group", division: group.division, tasks: group.tasks },
        ...group.tasks.map((task) => ({ kind: "task" as const, task })),
      ]),
    [model.groups],
  );
  const dataDatePct =
    latestDataDate == null
      ? null
      : timelinePrintPercent(latestDataDate, model.timelineStartDate, model.totalTimelineDays);

  return (
    <section className="constructline-print-report" aria-label="Printable ConstructLine schedule">
      <header className="constructline-print-header">
        <div>
          <div className="constructline-print-kicker">ConstructLine CPM schedule</div>
          <h1>{project.name}</h1>
          <div className="constructline-print-meta">
            {project.job_number && <span>Job # {project.job_number}</span>}
            {project.client && <span>{project.client}</span>}
            {project.project_manager && <span>PM {project.project_manager}</span>}
            <span>
              {shortDate(model.projectStartDate)} to {shortDate(model.cpmFinishDate)}
            </span>
            {showLogicLines && <span>Logic lines shown</span>}
          </div>
        </div>
        <div className="constructline-print-status">
          <div>{model.healthScore}%</div>
          <span>CPM health</span>
        </div>
      </header>

      <div className="constructline-print-kpis">
        <PrintKpi label="Activities" value={String(model.tasks.length)} />
        <PrintKpi
          label="Critical / Near"
          value={`${model.criticalCount}/${model.nearCriticalCount}`}
        />
        <PrintKpi
          label="Open Starts / Finishes"
          value={`${model.openStartCount}/${model.openFinishCount}`}
        />
        <PrintKpi label="CPM Basis" value={model.criticalPathReliable ? "Valid" : "Provisional"} />
        <PrintKpi label="Max Stack" value={String(model.maxStack)} />
        <PrintKpi
          label="Data Date"
          value={latestDataDate ? shortDate(latestDataDate) : "Not set"}
        />
      </div>

      <div className="constructline-print-summary">
        <div>
          <div className="constructline-print-section-title">Schedule intelligence</div>
          <div className="constructline-print-notes">
            {model.recommendations.slice(0, 4).map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>
        <div>
          <div className="constructline-print-section-title">Activity stacking</div>
          <div className="constructline-print-stack">
            {model.stackBuckets.slice(0, 24).map((bucket) => (
              <span
                key={bucket.key}
                className={cn(bucket.criticalCount > 0 && "is-critical")}
                style={{
                  height: `${Math.max(8, (bucket.count / Math.max(1, model.maxStack)) * 44)}px`,
                }}
                title={`${bucket.label}: ${bucket.count}`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="constructline-print-grid">
        <div className="constructline-print-grid-head">
          <span>ID</span>
          <span>Activity</span>
          <span>Dates</span>
          <span>%</span>
          <span>TF</span>
          <span>Schedule Timeline</span>
        </div>
        <div className="constructline-print-months">
          <span />
          <span />
          <span />
          <span />
          <span />
          <div className="constructline-print-timeline">
            {monthBands.map((band) => (
              <span
                key={`${band.label}-${band.x}`}
                className="constructline-print-month"
                style={{
                  left: `${(band.x / model.totalTimelineDays) * 100}%`,
                  width: `${(band.width / model.totalTimelineDays) * 100}%`,
                }}
              >
                {band.label}
              </span>
            ))}
            {dataDatePct != null && (
              <span className="constructline-print-data-date" style={{ left: `${dataDatePct}%` }} />
            )}
          </div>
        </div>
        <div className="constructline-print-body">
          {printRows.map((row) => {
            if (row.kind === "group") {
              const groupStartPct = Math.min(
                ...row.tasks.map((task) =>
                  timelinePrintPercent(
                    task.visualStartDate,
                    model.timelineStartDate,
                    model.totalTimelineDays,
                  ),
                ),
              );
              const groupFinishPct = Math.max(
                ...row.tasks.map((task) =>
                  timelinePrintPercent(
                    task.visualFinishDate,
                    model.timelineStartDate,
                    model.totalTimelineDays,
                  ),
                ),
              );
              return (
                <div key={`print-${row.division}`} className="constructline-print-group">
                  <span>
                    {row.division} · {row.tasks.length} activities
                  </span>
                  <div className="constructline-print-timeline">
                    <span
                      className="constructline-print-group-bar"
                      style={{
                        left: `${Math.min(groupStartPct, groupFinishPct)}%`,
                        width: `${Math.max(1, Math.abs(groupFinishPct - groupStartPct))}%`,
                      }}
                    />
                  </div>
                </div>
              );
            }

            return (
              <ConstructLinePrintTaskRow
                key={`print-${row.task.activity.id}`}
                model={model}
                task={row.task}
                dataDatePct={dataDatePct}
              />
            );
          })}
          {showLogicLines && <ConstructLinePrintLogicOverlay rows={printRows} model={model} />}
        </div>
      </div>
    </section>
  );
}

function ConstructLinePrintLogicOverlay({
  rows,
  model,
}: {
  rows: Array<
    | { kind: "group"; division: string; tasks: ConstructLineCpmTask[] }
    | { kind: "task"; task: ConstructLineCpmTask }
  >;
  model: ConstructLineCpmModel;
}) {
  const groupHeight = 18;
  const taskHeight = 20.5;
  const { bodyHeight, rowPositions } = useMemo(() => {
    const positions = new Map<string, number>();
    let height = 0;

    for (const row of rows) {
      if (row.kind === "group") {
        height += groupHeight;
      } else {
        positions.set(row.task.activityKey, height + taskHeight / 2);
        height += taskHeight;
      }
    }

    return { bodyHeight: height, rowPositions: positions };
  }, [groupHeight, rowHeight, rows]);
  const taskByKey = useMemo(
    () => new Map(model.tasks.map((task) => [task.activityKey, task])),
    [model.tasks],
  );
  const lines = useMemo(
    () =>
      model.tasks.flatMap((task) =>
        task.predecessorKeys.flatMap((predecessorKey) => {
          const predecessor = taskByKey.get(predecessorKey);
          const fromY = predecessor ? rowPositions.get(predecessor.activityKey) : null;
          const toY = rowPositions.get(task.activityKey);
          if (!predecessor || fromY == null || toY == null) return [];
          const predecessorFinishOffset =
            offsetFromTimelineStart(predecessor.visualFinishDate, model.timelineStartDate) +
            (predecessor.isMilestone ? 0 : 1);
          const fromX = timelinePrintOffsetPercent(
            predecessorFinishOffset,
            model.totalTimelineDays,
          );
          const toX = timelinePrintPercent(
            task.visualStartDate,
            model.timelineStartDate,
            model.totalTimelineDays,
          );
          return [
            {
              id: `print-${predecessor.activityKey}->${task.activityKey}`,
              fromX,
              fromY,
              toX,
              toY,
              isCritical: predecessor.isCritical && task.isCritical,
              isOutOfSequence: toX < fromX,
            },
          ];
        }),
      ),
    [model.tasks, model.timelineStartDate, model.totalTimelineDays, rowPositions, taskByKey],
  );

  if (lines.length === 0) return null;

  return (
    <svg
      className="constructline-print-logic-overlay"
      viewBox={`0 0 100 ${bodyHeight}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <marker
          id="constructline-print-logic-arrow"
          markerWidth="2.5"
          markerHeight="2.5"
          refX="2.2"
          refY="1.25"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M 0 0 L 2.5 1.25 L 0 2.5 z" fill="#6f675c" />
        </marker>
        <marker
          id="constructline-print-logic-arrow-critical"
          markerWidth="2.5"
          markerHeight="2.5"
          refX="2.2"
          refY="1.25"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M 0 0 L 2.5 1.25 L 0 2.5 z" fill="#d53c31" />
        </marker>
      </defs>
      {lines.map((line) => {
        const distance = line.toX - line.fromX;
        const routeX =
          Math.abs(distance) < 1
            ? line.fromX
            : distance >= 0
              ? Math.min(99.4, Math.max(line.fromX, line.toX) + 1.2)
              : Math.max(0.6, Math.min(line.fromX, line.toX) - 1.2);
        const stroke = line.isCritical ? "#d53c31" : line.isOutOfSequence ? "#c68a18" : "#6f675c";
        const opacity = line.isCritical ? 0.72 : line.isOutOfSequence ? 0.58 : 0.34;
        const path =
          Math.abs(distance) < 1
            ? `M ${line.fromX} ${line.fromY} V ${line.toY}`
            : `M ${line.fromX} ${line.fromY} H ${routeX} V ${line.toY} H ${line.toX}`;
        return (
          <path
            key={line.id}
            d={path}
            fill="none"
            stroke={stroke}
            strokeWidth={line.isCritical ? 0.32 : 0.22}
            strokeDasharray={line.isOutOfSequence ? "1.2 1.1" : undefined}
            opacity={opacity}
            vectorEffect="non-scaling-stroke"
            markerEnd={`url(#${
              line.isCritical
                ? "constructline-print-logic-arrow-critical"
                : "constructline-print-logic-arrow"
            })`}
          />
        );
      })}
    </svg>
  );
}

function PrintKpi({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ConstructLinePrintTaskRow({
  model,
  task,
  dataDatePct,
}: {
  model: ConstructLineCpmModel;
  task: ConstructLineCpmTask;
  dataDatePct: number | null;
}) {
  const percent = Math.max(0, Math.min(100, task.activity.percent_complete));
  const startPct = timelinePrintPercent(
    task.visualStartDate,
    model.timelineStartDate,
    model.totalTimelineDays,
  );
  const finishPct = timelinePrintPercent(
    task.visualFinishDate,
    model.timelineStartDate,
    model.totalTimelineDays,
  );
  const left = Math.min(startPct, finishPct);
  const width = Math.max(0.8, Math.abs(finishPct - startPct));
  const tone = task.isCritical
    ? "is-critical"
    : task.isNearCritical
      ? "is-near-critical"
      : percent >= 100
        ? "is-complete"
        : "";
  const flags = [
    task.isMilestone ? "Milestone" : null,
    task.isCritical ? "Critical" : task.isNearCritical ? "Near critical" : null,
    task.isLate ? "Late" : null,
    task.isOpenStart ? "Open start" : null,
    task.isOpenFinish ? "Open finish" : null,
  ].filter(Boolean);

  return (
    <div className="constructline-print-row">
      <span className="constructline-print-id">{task.dependencyKey}</span>
      <span className="constructline-print-name">
        {task.activity.name}
        {flags.slice(0, 2).map((flag) => (
          <em key={flag}>{flag}</em>
        ))}
      </span>
      <span className="constructline-print-dates">
        {shortPrintDate(task.activity.start_date ?? task.visualStartDate)}-
        {shortPrintDate(task.activity.finish_date ?? task.visualFinishDate)}
      </span>
      <span>{percent}%</span>
      <span>{task.totalFloat}</span>
      <span className="constructline-print-timeline">
        {dataDatePct != null && (
          <span className="constructline-print-data-date" style={{ left: `${dataDatePct}%` }} />
        )}
        {task.isMilestone ? (
          <span
            className={cn("constructline-print-milestone", tone)}
            style={{ left: `${left}%` }}
          />
        ) : (
          <span
            className={cn("constructline-print-bar", tone)}
            style={{ left: `${left}%`, width: `${width}%` }}
          >
            <span style={{ width: `${percent}%` }} />
          </span>
        )}
      </span>
    </div>
  );
}

function LabeledField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 space-y-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function ActivityScheduleMatrix({
  model,
  dayPx,
  dataDate,
  showLogicLines = false,
  isFocusMode = false,
  isPrintMode = false,
  onOpenActivity,
  onDeleteActivity,
}: {
  model: ConstructLineCpmModel;
  dayPx: number;
  dataDate: string | null;
  showLogicLines?: boolean;
  isFocusMode?: boolean;
  isPrintMode?: boolean;
  onOpenActivity: (activity: ScheduleActivityRow) => void;
  onDeleteActivity: (id: string) => void;
}) {
  const totalActivities = model.tasks.length;
  const printDayPx = CONSTRUCTLINE_PRINT_TIMELINE_WIDTH / Math.max(1, model.totalTimelineDays);
  const activeDayPx = isPrintMode ? printDayPx : dayPx;
  const isFitZoom = !isPrintMode && dayPx === CONSTRUCTLINE_FIT_DAY_PX;
  const tableWidth = isPrintMode ? CONSTRUCTLINE_PRINT_TABLE_WIDTH : isFitZoom ? 760 : 860;
  const tableColumns = isPrintMode
    ? "62px minmax(170px,1fr) 42px 58px 58px 48px 40px 42px"
    : isFitZoom
      ? "76px minmax(220px,1fr) 58px 78px 78px 70px 54px 58px"
      : "82px minmax(260px,1fr) 64px 86px 86px 74px 56px 64px";
  const rowHeight = isPrintMode ? 22 : 64;
  const groupHeight = isPrintMode ? 16 : 32;
  const headerHeight = isPrintMode ? 30 : 48;
  const timelineWidth = isPrintMode
    ? CONSTRUCTLINE_PRINT_TIMELINE_WIDTH
    : isFitZoom
      ? Math.max(480, model.totalTimelineDays * activeDayPx)
      : Math.max(720, model.totalTimelineDays * activeDayPx);
  const monthBands = buildConstructLineMonthBands(
    model.timelineStartDate,
    model.totalTimelineDays,
    activeDayPx,
  );
  const dataDateX =
    dataDate == null
      ? null
      : offsetFromTimelineStart(dataDate, model.timelineStartDate) * activeDayPx;
  const rows = useMemo(
    () =>
      model.groups.flatMap<
        | { kind: "group"; division: string; tasks: ConstructLineCpmTask[] }
        | { kind: "task"; task: ConstructLineCpmTask }
      >((group) => [
        { kind: "group", division: group.division, tasks: group.tasks },
        ...group.tasks.map((task) => ({ kind: "task" as const, task })),
      ]),
    [model.groups],
  );
  const { bodyHeight, rowPositions } = useMemo(() => {
    const positions = new Map<string, number>();
    let height = 0;
    for (const row of rows) {
      if (row.kind === "group") {
        height += groupHeight;
      } else {
        positions.set(row.task.activityKey, height + rowHeight / 2);
        height += rowHeight;
      }
    }
    return { bodyHeight: height, rowPositions: positions };
  }, [groupHeight, rowHeight, rows]);
  const taskByKey = useMemo(
    () => new Map(model.tasks.map((task) => [task.activityKey, task])),
    [model.tasks],
  );
  const logicLines = useMemo(() => {
    if (!showLogicLines) return [];
    return model.tasks.flatMap((task) =>
      task.predecessorKeys.flatMap((predecessorKey) => {
        const predecessor = taskByKey.get(predecessorKey);
        const fromY = predecessor ? rowPositions.get(predecessor.activityKey) : null;
        const toY = rowPositions.get(task.activityKey);
        if (!predecessor || fromY == null || toY == null) return [];
        const predecessorFinishOffset = offsetFromTimelineStart(
          predecessor.visualFinishDate,
          model.timelineStartDate,
        );
        const fromX = (predecessorFinishOffset + (predecessor.isMilestone ? 0 : 1)) * activeDayPx;
        const toX =
          offsetFromTimelineStart(task.visualStartDate, model.timelineStartDate) * activeDayPx;
        return [
          {
            id: `${predecessor.activityKey}->${task.activityKey}`,
            fromX,
            fromY,
            toX,
            toY,
            isCritical: predecessor.isCritical && task.isCritical,
            isOutOfSequence: toX < fromX,
          },
        ];
      }),
    );
  }, [activeDayPx, model.tasks, model.timelineStartDate, rowPositions, showLogicLines, taskByKey]);

  return (
    <div
      className={cn(
        "constructline-cpm-matrix min-w-0 overflow-hidden rounded-md border border-hairline bg-card",
        isPrintMode && "constructline-cpm-matrix-print",
        isFocusMode ? "mt-0 flex min-h-0 flex-1 flex-col" : isPrintMode ? "mt-0" : "mt-5",
      )}
    >
      <div className="constructline-cpm-matrix-head flex flex-col gap-3 border-b border-hairline px-4 py-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="constructline-cpm-matrix-title">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <GitBranch className="h-3.5 w-3.5" />
            ConstructLine CPM grid
          </div>
          <div className="mt-1 font-serif text-xl text-foreground">Activity table + Gantt</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {shortDate(model.timelineStartDate)} to {shortDate(model.timelineFinishDate)}
          </div>
        </div>
        <div className="constructline-cpm-matrix-legend flex flex-wrap gap-4 text-[12px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-5 rounded-full bg-danger" />
            Critical
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-5 rounded-full bg-warning" />
            Near critical
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-5 rounded-full bg-success" />
            Complete
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rotate-45 rounded-[1px] border border-foreground/45 bg-card" />
            Milestone
          </span>
          <span className="font-semibold tabular text-foreground">
            {totalActivities} {totalActivities === 1 ? "activity" : "activities"}
          </span>
          {showLogicLines && (
            <span className="inline-flex items-center gap-1 font-semibold text-foreground">
              <GitBranch className="h-3.5 w-3.5" />
              {logicLines.length} ties shown
            </span>
          )}
        </div>
      </div>

      {model.groups.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <div className="font-serif text-xl text-foreground">No CPM activities yet.</div>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
            Add the first activity to start building the working schedule.
          </p>
        </div>
      ) : (
        <div
          className={cn(
            "constructline-cpm-matrix-scroll",
            isPrintMode
              ? "overflow-visible"
              : "overflow-auto overscroll-contain print:max-h-none print:overflow-visible",
            isFocusMode
              ? "min-h-0 flex-1"
              : isPrintMode
                ? ""
                : "max-h-[clamp(460px,calc(100vh-330px),820px)]",
          )}
        >
          <div
            className="constructline-cpm-matrix-inner relative min-h-full"
            style={{ width: tableWidth + timelineWidth, minWidth: "100%" }}
          >
            <div
              className="sticky top-0 z-30 flex border-b border-hairline bg-muted/65 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
              style={{ height: headerHeight }}
            >
              <div
                className="sticky left-0 z-40 grid shrink-0 border-r border-hairline bg-muted/80"
                style={{ width: tableWidth, gridTemplateColumns: tableColumns }}
              >
                <div className="flex items-center px-3">ID</div>
                <div className="flex min-w-0 items-center px-3">Activity</div>
                <div className="flex items-center justify-end border-l border-hairline/70 px-2">
                  Dur
                </div>
                <div className="flex items-center justify-end border-l border-hairline/70 px-2">
                  Start
                </div>
                <div className="flex items-center justify-end border-l border-hairline/70 px-2">
                  Finish
                </div>
                <div className="flex items-center justify-end border-l border-hairline/70 px-2">
                  % done
                </div>
                <div className="flex items-center justify-end border-l border-hairline/70 px-2">
                  TF
                </div>
                <div className="flex items-center justify-end border-l border-hairline/70 px-2">
                  Logic
                </div>
              </div>
              <div className="relative shrink-0 bg-muted/45" style={{ width: timelineWidth }}>
                {monthBands.map((band) => (
                  <div
                    key={`${band.label}-${band.x}`}
                    className="absolute inset-y-0 border-l border-hairline/80 px-2"
                    style={{ left: band.x, width: band.width }}
                  >
                    <div className="flex h-full items-center truncate text-muted-foreground">
                      {band.label}
                    </div>
                  </div>
                ))}
                {dataDateX != null && (
                  <div
                    className="absolute inset-y-0 z-10 w-px bg-foreground/50"
                    style={{ left: dataDateX }}
                  />
                )}
              </div>
            </div>

            {rows.map((row) => {
              if (row.kind === "group") {
                const groupStart = Math.min(
                  ...row.tasks.map((task) =>
                    offsetFromTimelineStart(task.visualStartDate, model.timelineStartDate),
                  ),
                );
                const groupFinish = Math.max(
                  ...row.tasks.map((task) =>
                    offsetFromTimelineStart(task.visualFinishDate, model.timelineStartDate),
                  ),
                );
                return (
                  <div
                    key={`group-${row.division}`}
                    className="flex border-b border-hairline bg-muted/35"
                    style={{ height: groupHeight }}
                  >
                    <div
                      className="sticky left-0 z-20 flex shrink-0 items-center border-r border-hairline bg-muted/55 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                      style={{ width: tableWidth }}
                    >
                      {row.division} · {row.tasks.length} activities
                    </div>
                    <div className="relative shrink-0" style={{ width: timelineWidth }}>
                      <div
                        className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-foreground/35"
                        style={{
                          left: groupStart * activeDayPx,
                          width: Math.max(8, (groupFinish - groupStart + 1) * activeDayPx),
                        }}
                      />
                    </div>
                  </div>
                );
              }

              return (
                <ConstructLineTaskRow
                  key={row.task.activity.id}
                  task={row.task}
                  rowHeight={rowHeight}
                  tableWidth={tableWidth}
                  tableColumns={tableColumns}
                  timelineWidth={timelineWidth}
                  timelineStartDate={model.timelineStartDate}
                  dayPx={activeDayPx}
                  isPrintMode={isPrintMode}
                  monthBands={monthBands}
                  dataDateX={dataDateX}
                  onOpen={() => onOpenActivity(row.task.activity)}
                  onDelete={() => onDeleteActivity(row.task.activity.id)}
                />
              );
            })}
            {showLogicLines && (
              <ConstructLineLogicOverlay
                lines={logicLines}
                tableWidth={tableWidth}
                timelineWidth={timelineWidth}
                headerHeight={headerHeight}
                bodyHeight={bodyHeight}
              />
            )}
          </div>
        </div>
      )}

      <div className="flex justify-between border-t border-hairline px-4 py-2 text-[11px] text-muted-foreground">
        <span>{shortDate(model.timelineStartDate)}</span>
        <span>{shortDate(model.timelineFinishDate)}</span>
      </div>
    </div>
  );
}

function ConstructLineLogicOverlay({
  lines,
  tableWidth,
  timelineWidth,
  headerHeight,
  bodyHeight,
}: {
  lines: Array<{
    id: string;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    isCritical: boolean;
    isOutOfSequence: boolean;
  }>;
  tableWidth: number;
  timelineWidth: number;
  headerHeight: number;
  bodyHeight: number;
}) {
  if (lines.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute z-10 overflow-visible"
      style={{
        left: tableWidth,
        top: headerHeight,
        width: timelineWidth,
        height: bodyHeight,
      }}
      viewBox={`0 0 ${timelineWidth} ${bodyHeight}`}
      aria-hidden="true"
    >
      <defs>
        <marker
          id="constructline-logic-arrow"
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" fill="#6f675c" />
        </marker>
        <marker
          id="constructline-logic-arrow-critical"
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" fill="#d53c31" />
        </marker>
      </defs>
      {lines.map((line) => {
        const distance = line.toX - line.fromX;
        const bend = Math.max(24, Math.min(96, Math.abs(distance) / 2));
        const midX = distance >= 0 ? line.fromX + bend : line.fromX - bend;
        const stroke = line.isCritical ? "#d53c31" : line.isOutOfSequence ? "#c68a18" : "#6f675c";
        const opacity = line.isCritical ? 0.72 : line.isOutOfSequence ? 0.58 : 0.36;
        return (
          <path
            key={line.id}
            d={`M ${line.fromX} ${line.fromY} C ${midX} ${line.fromY}, ${midX} ${line.toY}, ${line.toX} ${line.toY}`}
            fill="none"
            stroke={stroke}
            strokeWidth={line.isCritical ? 1.8 : 1.25}
            strokeDasharray={line.isOutOfSequence ? "5 4" : undefined}
            opacity={opacity}
            markerEnd={`url(#${
              line.isCritical ? "constructline-logic-arrow-critical" : "constructline-logic-arrow"
            })`}
          />
        );
      })}
    </svg>
  );
}

function ConstructLineTaskRow({
  task,
  rowHeight,
  tableWidth,
  tableColumns,
  timelineWidth,
  timelineStartDate,
  dayPx,
  isPrintMode,
  monthBands,
  dataDateX,
  onOpen,
  onDelete,
}: {
  task: ConstructLineCpmTask;
  rowHeight: number;
  tableWidth: number;
  tableColumns: string;
  timelineWidth: number;
  timelineStartDate: string;
  dayPx: number;
  isPrintMode: boolean;
  monthBands: ReturnType<typeof buildConstructLineMonthBands>;
  dataDateX: number | null;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const activity = task.activity;
  const percent = Math.max(0, Math.min(100, activity.percent_complete));
  const startOffset = offsetFromTimelineStart(task.visualStartDate, timelineStartDate);
  const finishOffset = offsetFromTimelineStart(task.visualFinishDate, timelineStartDate);
  const barLeft = startOffset * dayPx;
  const barWidth = Math.max(8, (finishOffset - startOffset + 1) * dayPx);
  const logicCount = task.predecessorKeys.length + task.successorKeys.length;
  const barClass = task.isCritical
    ? "bg-danger"
    : task.isNearCritical
      ? "bg-warning"
      : percent >= 100
        ? "bg-success"
        : "bg-accent";
  const milestoneClass = task.isCritical
    ? "border-danger bg-danger"
    : task.isNearCritical
      ? "border-warning bg-warning"
      : percent >= 100
        ? "border-success bg-success"
        : "border-accent bg-card";

  return (
    <div
      className="flex border-b border-hairline bg-card hover:bg-muted/30"
      style={{ height: rowHeight }}
    >
      <div
        role="button"
        tabIndex={0}
        className="sticky left-0 z-20 grid shrink-0 cursor-pointer border-r border-hairline bg-card text-xs hover:bg-muted/45"
        style={{ width: tableWidth, gridTemplateColumns: tableColumns }}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }}
      >
        <div className="flex items-center px-3 font-semibold tabular text-foreground">
          {activity.activity_id || "No ID"}
        </div>
        <div className="flex min-w-0 flex-col justify-center px-3">
          <div className="truncate text-sm font-semibold text-foreground">{activity.name}</div>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {task.isMilestone && <ScheduleFlag tone="warning">milestone</ScheduleFlag>}
            {task.isCritical && <ScheduleFlag tone="danger">critical</ScheduleFlag>}
            {task.isNearCritical && <ScheduleFlag tone="warning">near critical</ScheduleFlag>}
            {task.isLate && <ScheduleFlag tone="danger">late</ScheduleFlag>}
            {task.isOutOfSequence && <ScheduleFlag tone="warning">out of seq</ScheduleFlag>}
            {task.isOpenStart && <ScheduleFlag tone="warning">open start</ScheduleFlag>}
            {task.isOpenFinish && <ScheduleFlag tone="warning">open finish</ScheduleFlag>}
            {task.hasMissingDates && <ScheduleFlag tone="warning">missing dates</ScheduleFlag>}
          </div>
        </div>
        <div className="flex items-center justify-end border-l border-hairline/50 px-2 tabular text-muted-foreground">
          {task.isMilestone ? "M" : task.durationDays}
        </div>
        <div className="flex items-center justify-end border-l border-hairline/50 px-2 tabular text-muted-foreground">
          {shortPrintDate(activity.start_date ?? task.visualStartDate)}
        </div>
        <div className="flex items-center justify-end border-l border-hairline/50 px-2 tabular text-muted-foreground">
          {shortPrintDate(activity.finish_date ?? task.visualFinishDate)}
        </div>
        <div className="flex items-center justify-end border-l border-hairline/50 px-2 font-semibold tabular text-foreground">
          {percent}%
        </div>
        <div
          className={cn(
            "flex items-center justify-end border-l border-hairline/50 px-2 font-semibold tabular",
            task.isCritical
              ? "text-danger"
              : task.isNearCritical
                ? "text-warning"
                : "text-muted-foreground",
          )}
        >
          {task.totalFloat}
        </div>
        <div className="flex items-center justify-end gap-1 border-l border-hairline/50 px-1.5 tabular text-muted-foreground">
          <span>{logicCount}</span>
          {!isPrintMode && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-danger"
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
              aria-label={`Delete activity ${activity.activity_id || activity.name}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <button
        type="button"
        className="relative shrink-0 text-left"
        style={{ width: timelineWidth }}
        onClick={onOpen}
      >
        {monthBands.map((band) => (
          <div
            key={`${activity.id}-${band.label}-${band.x}`}
            className="absolute inset-y-0 border-l border-hairline/50"
            style={{ left: band.x }}
          />
        ))}
        {dataDateX != null && (
          <div
            className="absolute inset-y-0 z-10 w-px bg-foreground/35"
            style={{ left: dataDateX }}
          />
        )}
        {task.isMilestone ? (
          <div
            className={cn(
              "absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] border-2 shadow-sm",
              milestoneClass,
            )}
            style={{ left: barLeft }}
          />
        ) : (
          <div
            className={cn(
              "absolute top-1/2 h-4 -translate-y-1/2 rounded-full border",
              task.isCritical
                ? "border-danger/40 bg-danger/20"
                : task.isNearCritical
                  ? "border-warning/40 bg-warning/20"
                  : "border-accent/30 bg-accent/15",
            )}
            style={{ left: barLeft, width: barWidth }}
          >
            <div className={cn("h-full rounded-full", barClass)} style={{ width: `${percent}%` }} />
          </div>
        )}
      </button>
    </div>
  );
}

function ScheduleFlag({ children, tone }: { children: ReactNode; tone: "danger" | "warning" }) {
  return (
    <span
      className={cn(
        "rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
        tone === "danger"
          ? "border-danger/25 bg-danger/10 text-danger"
          : "border-warning/25 bg-warning/10 text-warning",
      )}
    >
      {children}
    </span>
  );
}

function buildConstructLineMonthBands(startDate: string, totalDays: number, dayPx: number) {
  const start = parseDateMs(startDate);
  if (start == null) return [];
  const bands: Array<{ x: number; width: number; label: string }> = [];
  let cursor = 0;
  while (cursor < totalDays) {
    const cursorMs = start + cursor * 24 * 60 * 60 * 1000;
    const d = new Date(cursorMs);
    const month = d.getUTCMonth();
    const year = d.getUTCFullYear();
    let length = 0;
    while (cursor + length < totalDays) {
      const next = new Date(start + (cursor + length) * 24 * 60 * 60 * 1000);
      if (next.getUTCMonth() !== month || next.getUTCFullYear() !== year) break;
      length += 1;
    }
    bands.push({
      x: cursor * dayPx,
      width: Math.max(dayPx, length * dayPx),
      label: `${MONTH_LABELS[month]} ${String(year).slice(2)}`,
    });
    cursor += Math.max(1, length);
  }
  return bands;
}

function timelinePrintPercent(value: string, timelineStartDate: string, totalTimelineDays: number) {
  const start = parseDateMs(timelineStartDate);
  const current = parseDateMs(value);
  if (start == null || current == null) return 0;
  const days = Math.max(0, Math.round((current - start) / (24 * 60 * 60 * 1000)));
  return timelinePrintOffsetPercent(days, totalTimelineDays);
}

function timelinePrintOffsetPercent(dayOffset: number, totalTimelineDays: number) {
  const days = Math.max(0, dayOffset);
  return Math.max(0, Math.min(100, (days / Math.max(1, totalTimelineDays)) * 100));
}

function StackingMiniMap({ model }: { model: ConstructLineCpmModel }) {
  const max = Math.max(1, model.maxStack);
  const buckets = model.stackBuckets.slice(0, 18);
  if (buckets.length === 0) {
    return <div className="mt-4 text-sm text-muted-foreground">No dated activities to stack.</div>;
  }
  return (
    <div className="mt-4 flex h-24 items-end gap-1">
      {buckets.map((bucket) => (
        <div key={bucket.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <div
            className={cn(
              "w-full rounded-t",
              bucket.criticalCount > 0
                ? "bg-danger"
                : bucket.count >= 4
                  ? "bg-warning"
                  : "bg-accent",
            )}
            style={{ height: `${Math.max(10, (bucket.count / max) * 72)}px` }}
            title={`${bucket.label}: ${bucket.count} active`}
          />
          <div className="w-full truncate text-center text-[10px] text-muted-foreground">
            {bucket.label.replace(" wk", "")}
          </div>
        </div>
      ))}
    </div>
  );
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function LegacyActivityScheduleMatrixReference() {
  return null;
}

function LegacyActivityScheduleMatrix({
  grouped,
  bounds,
  dataDatePosition,
  onOpenActivity,
  onDeleteActivity,
}: {
  grouped: Array<{ division: string; activities: ScheduleActivityRow[] }>;
  bounds: TimelineBounds;
  dataDatePosition: number | null;
  onOpenActivity: (activity: ScheduleActivityRow) => void;
  onDeleteActivity: (id: string) => void;
}) {
  const totalActivities = grouped.reduce((sum, group) => sum + group.activities.length, 0);

  return (
    <div className="mt-5 min-w-0 overflow-hidden rounded-md border border-hairline bg-card">
      <div className="grid border-b border-hairline 2xl:grid-cols-[minmax(760px,1.05fr)_minmax(680px,0.95fr)]">
        <div className="flex flex-col gap-2 border-b border-hairline px-4 py-4 sm:flex-row sm:items-end sm:justify-between 2xl:border-b-0 2xl:border-r 2xl:border-hairline">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Activity register
            </div>
            <div className="mt-1 font-serif text-xl text-foreground">CPM activity table</div>
          </div>
          <div className="text-sm font-semibold tabular text-muted-foreground">
            {totalActivities} {totalActivities === 1 ? "activity" : "activities"}
          </div>
        </div>
        <div className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Gantt chart
            </div>
            <div className="mt-1 font-serif text-xl text-foreground">Schedule timeline</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {shortDate(bounds.startLabel)} to {shortDate(bounds.endLabel)}
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-[12px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-5 rounded-full bg-accent/70" />
              Duration
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-5 rounded-full bg-success" />
              Complete
            </span>
          </div>
        </div>
      </div>

      <div className="hidden border-b border-hairline bg-muted/55 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground 2xl:grid 2xl:grid-cols-[minmax(760px,1.05fr)_minmax(680px,0.95fr)]">
        <div className="grid grid-cols-[64px_minmax(0,1.35fr)_104px_116px_58px_76px_52px] gap-3 border-r border-hairline px-4 py-3">
          <div>ID</div>
          <div>Activity</div>
          <div>Division</div>
          <div>Dates</div>
          <div>% done</div>
          <div>Logic</div>
          <div />
        </div>
        <div className="grid grid-cols-[172px_minmax(150px,1fr)_58px] gap-3 px-4 py-3">
          <div>Activity</div>
          <div>Timeline</div>
          <div className="text-right">Done</div>
        </div>
      </div>

      {grouped.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <div className="font-serif text-xl text-foreground">No CPM activities yet.</div>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
            Add the first activity to start building the working schedule. This is where the PM will
            eventually manage activity IDs, dates, progress, divisions, and logic ties.
          </p>
        </div>
      ) : (
        <div className="max-h-[clamp(420px,calc(100vh-310px),760px)] overflow-y-auto overscroll-contain">
          {grouped.map((group) => (
            <div key={group.division}>
              <div className="grid border-b border-hairline bg-muted/35 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground 2xl:grid-cols-[minmax(760px,1.05fr)_minmax(680px,0.95fr)]">
                <div className="px-4 py-2 2xl:border-r 2xl:border-hairline">
                  {group.division} · {group.activities.length} activities
                </div>
                <div className="hidden px-4 py-2 2xl:block">{group.division}</div>
              </div>
              {group.activities.map((activity) => (
                <div
                  key={activity.id}
                  className="grid border-b border-hairline last:border-b-0 2xl:grid-cols-[minmax(760px,1.05fr)_minmax(680px,0.95fr)]"
                >
                  <ActivityRegisterRow
                    activity={activity}
                    onOpen={() => onOpenActivity(activity)}
                    onDelete={() => onDeleteActivity(activity.id)}
                  />
                  <ActivityGanttRow
                    activity={activity}
                    bounds={bounds}
                    dataDatePosition={dataDatePosition}
                    onOpen={() => onOpenActivity(activity)}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-between border-t border-hairline px-4 py-2 text-[11px] text-muted-foreground">
        <span>{shortDate(bounds.startLabel)}</span>
        <span>{shortDate(bounds.endLabel)}</span>
      </div>
    </div>
  );
}

function ActivityRegisterRow({
  activity,
  onOpen,
  onDelete,
}: {
  activity: ScheduleActivityRow;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const duration = getActivityDurationDays(activity);
  const logicCount =
    activity.predecessor_activity_ids.length + activity.successor_activity_ids.length;
  const percent = Math.max(0, Math.min(100, activity.percent_complete));

  return (
    <div
      role="button"
      tabIndex={0}
      className="grid h-full min-h-[92px] cursor-pointer gap-3 px-4 py-3 transition-colors hover:bg-muted/45 lg:grid-cols-[64px_minmax(0,1.35fr)_104px_116px_58px_76px_52px] lg:items-center 2xl:border-r 2xl:border-hairline"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="font-semibold tabular text-foreground">{activity.activity_id || "No ID"}</div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-foreground">{activity.name}</div>
        {activity.notes && (
          <div className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">
            {activity.notes}
          </div>
        )}
      </div>
      <div className="truncate text-xs font-semibold text-muted-foreground">
        {activity.division || "General"}
      </div>
      <div className="text-xs text-muted-foreground">
        <div className="font-semibold tabular text-foreground">
          {shortDate(activity.start_date)} → {shortDate(activity.finish_date)}
        </div>
        <div className="mt-0.5 tabular">
          {duration == null ? "No duration" : `${duration} day${duration === 1 ? "" : "s"}`}
        </div>
      </div>
      <div className="text-sm font-semibold tabular text-foreground">
        <div>{percent}%</div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${percent >= 100 ? "bg-success" : "bg-accent"}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
      <div className="min-w-0 text-xs text-muted-foreground">
        <div className="font-semibold tabular text-foreground">{logicCount} ties</div>
        <div className="mt-1 hidden flex-wrap gap-1 xl:flex">
          <ActivityIdPills ids={activity.predecessor_activity_ids.slice(0, 2)} emptyLabel="" />
          <ActivityIdPills ids={activity.successor_activity_ids.slice(0, 2)} emptyLabel="" />
        </div>
      </div>
      <div className="flex justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          aria-label={`Open activity ${activity.activity_id || activity.name}`}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-danger"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          aria-label={`Delete activity ${activity.activity_id || activity.name}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function ActivityLogicSummary({ activity }: { activity: ScheduleActivityRow }) {
  const duration = getActivityDurationDays(activity);
  return (
    <div className="rounded-md border border-hairline bg-surface p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Logic summary
      </div>
      <div className="grid gap-2 text-sm sm:grid-cols-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Duration
          </div>
          <div className="mt-1 font-semibold tabular text-foreground">
            {duration == null ? "No dates" : `${duration} day${duration === 1 ? "" : "s"}`}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Predecessors
          </div>
          <ActivityIdPills ids={activity.predecessor_activity_ids} emptyLabel="None" />
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Successors
          </div>
          <ActivityIdPills ids={activity.successor_activity_ids} emptyLabel="None" />
        </div>
      </div>
    </div>
  );
}

function ActivityIdPills({ ids, emptyLabel }: { ids: string[]; emptyLabel: string }) {
  if (ids.length === 0) {
    if (!emptyLabel) return null;
    return <div className="mt-1 text-sm font-semibold text-muted-foreground">{emptyLabel}</div>;
  }
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {ids.map((id) => (
        <span
          key={id}
          className="max-w-full break-all rounded border border-hairline bg-card px-1.5 py-0.5 text-[11px] font-semibold tabular text-foreground"
        >
          {id}
        </span>
      ))}
    </div>
  );
}

function ActivityDependencyPicker({
  label,
  emptyLabel,
  selectedIds,
  activities,
  blockedActivityId,
  blockedIds = [],
  onChange,
}: {
  label: string;
  emptyLabel: string;
  selectedIds: string;
  activities: ScheduleActivityRow[];
  blockedActivityId?: string;
  blockedIds?: string[];
  onChange: (value: string) => void;
}) {
  const selectedActivityIds = parseActivityIds(selectedIds);
  const selectedIdSet = new Set(selectedActivityIds);
  const blockedIdSet = new Set(
    [blockedActivityId, ...blockedIds].map((id) => id?.trim()).filter(Boolean),
  );
  const activitiesById = new Map(
    activities
      .map((activity) => [activity.activity_id.trim(), activity] as const)
      .filter(([activityId]) => activityId.length > 0),
  );
  const options = activities.filter((activity) => {
    const activityId = activity.activity_id.trim();
    return activityId.length > 0 && !blockedIdSet.has(activityId);
  });

  const toggleActivity = (activityId: string) => {
    const nextIds = selectedIdSet.has(activityId)
      ? selectedActivityIds.filter((id) => id !== activityId)
      : [...selectedActivityIds, activityId];
    onChange(formatActivityIds(nextIds));
  };
  const removeActivity = (activityId: string) => {
    onChange(formatActivityIds(selectedActivityIds.filter((id) => id !== activityId)));
  };

  return (
    <div className="min-w-0 space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-auto min-h-10 w-full justify-between gap-2 px-3 py-2 text-left"
          >
            <span className="min-w-0 truncate text-sm font-medium">
              {selectedActivityIds.length > 0
                ? `${selectedActivityIds.length} selected`
                : emptyLabel}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0"
        >
          <Command>
            <CommandInput placeholder={`Search ${label.toLowerCase()}...`} />
            <CommandList>
              <CommandEmpty>No activities found.</CommandEmpty>
              <CommandGroup>
                {options.map((activity) => {
                  const activityId = activity.activity_id.trim();
                  const isSelected = selectedIdSet.has(activityId);
                  return (
                    <CommandItem
                      key={activity.id}
                      value={`${activityId} ${activity.name} ${activity.division}`}
                      onSelect={() => toggleActivity(activityId)}
                      className="items-start gap-3"
                    >
                      <Check
                        className={cn(
                          "mt-0.5 h-4 w-4 text-success",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0 font-semibold tabular text-foreground">
                            {activityId}
                          </span>
                          <span className="truncate font-medium text-foreground">
                            {activity.name}
                          </span>
                        </div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {activity.division || "General"} · {shortDate(activity.start_date)} to{" "}
                          {shortDate(activity.finish_date)}
                        </div>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selectedActivityIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedActivityIds.map((activityId) => {
            const activity = activitiesById.get(activityId);
            return (
              <button
                key={activityId}
                type="button"
                className="inline-flex max-w-full items-center gap-1 rounded border border-hairline bg-card px-1.5 py-1 text-left text-[11px] font-semibold text-foreground hover:bg-muted"
                onClick={() => removeActivity(activityId)}
              >
                <span className="shrink-0 tabular">{activityId}</span>
                {activity && (
                  <span className="max-w-36 truncate text-muted-foreground">{activity.name}</span>
                )}
                <X className="h-3 w-3 shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActivityGanttRow({
  activity,
  bounds,
  dataDatePosition,
  onOpen,
}: {
  activity: ScheduleActivityRow;
  bounds: TimelineBounds;
  dataDatePosition: number | null;
  onOpen: () => void;
}) {
  const start = timelinePosition(activity.start_date, bounds);
  const finish = timelinePosition(activity.finish_date, bounds);
  const left = Math.min(start ?? finish ?? 0, finish ?? start ?? 0);
  const width =
    start == null && finish == null
      ? 0
      : Math.max(1.5, Math.abs((finish ?? start ?? 0) - (start ?? finish ?? 0)));
  const percent = Math.max(0, Math.min(100, activity.percent_complete));
  const dataDateMs = parseDateMs(new Date().toISOString().slice(0, 10));
  const finishMs = parseDateMs(activity.finish_date);
  const isLate = percent < 100 && finishMs != null && dataDateMs != null && finishMs < dataDateMs;
  return (
    <button
      type="button"
      className="grid h-full min-h-[92px] w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 lg:grid-cols-[172px_minmax(150px,1fr)_58px] lg:items-center"
      onClick={onOpen}
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold tabular text-foreground">
          {activity.activity_id || "No ID"}
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{activity.name}</div>
      </div>
      <div className="relative h-10 rounded-md bg-muted">
        {dataDatePosition != null && (
          <div
            className="absolute inset-y-1 z-10 w-px bg-foreground/30"
            style={{ left: `${dataDatePosition}%` }}
          />
        )}
        {width > 0 && (
          <div
            className={`absolute top-1/2 h-3 -translate-y-1/2 overflow-hidden rounded-full ${
              isLate ? "bg-danger/35" : "bg-accent/35"
            }`}
            style={{ left: `${left}%`, width: `${width}%` }}
          >
            <div
              className={`h-full rounded-full ${isLate ? "bg-danger" : "bg-success"}`}
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </div>
      <div
        className={`text-right text-sm font-semibold tabular ${isLate ? "text-danger" : "text-muted-foreground"}`}
      >
        {percent}%
      </div>
    </button>
  );
}

function ActivityDetailDialog({
  activity,
  activities,
  isSaving,
  onClose,
  onSave,
  onDelete,
}: {
  activity: ScheduleActivityRow;
  activities: ScheduleActivityRow[];
  isSaving: boolean;
  onClose: () => void;
  onSave: (patch: Partial<ScheduleActivityRow>) => Promise<void>;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<ActivityDraft>(() => activityDraftFromRow(activity));
  const [saveError, setSaveError] = useState<string | null>(null);
  const duration = getActivityDurationDays(activity);
  const isMilestone = isConstructLineMilestoneActivity(activity);

  useEffect(() => {
    setDraft(activityDraftFromRow(activity));
    setSaveError(null);
  }, [activity]);

  const saveActivity = async () => {
    const name = draft.name.trim();
    if (!name) {
      setSaveError("Activity name is required.");
      return;
    }
    const milestoneDate = getMilestoneDraftDate(draft);
    setSaveError(null);
    try {
      await onSave({
        activity_id: draft.activity_id.trim(),
        name,
        division: draft.is_milestone ? "Milestones" : draft.division.trim() || "General",
        start_date: draft.is_milestone ? milestoneDate : draft.start_date || null,
        finish_date: draft.is_milestone ? milestoneDate : draft.finish_date || null,
        percent_complete: parsePercent(draft.percent_complete),
        predecessor_activity_ids: parseActivityIds(draft.predecessor_activity_ids),
        successor_activity_ids: parseActivityIds(draft.successor_activity_ids),
        notes: draft.notes.trim(),
      });
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Activity did not update.");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !isSaving && onClose()}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:w-[min(calc(100vw-2rem),68rem)] sm:max-w-[68rem]">
        <DialogHeader className="border-b border-hairline px-4 py-4 pr-12 sm:px-6">
          <DialogTitle className="font-serif text-2xl">CPM activity detail</DialogTitle>
          <DialogDescription>
            Review the full activity, dependency logic, dates, percent complete, and field notes.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ScheduleWorkbenchStat
              label="Activity ID"
              value={activity.activity_id || "No ID"}
              sub={activity.division || "General"}
            />
            <ScheduleWorkbenchStat
              label="Duration"
              value={isMilestone ? "Milestone" : duration == null ? "No dates" : String(duration)}
              sub={
                isMilestone
                  ? "schedule point"
                  : duration == null
                    ? "start / finish needed"
                    : "calendar days"
              }
            />
            <ScheduleWorkbenchStat
              label="Progress"
              value={`${activity.percent_complete}%`}
              sub={activity.percent_complete >= 100 ? "complete" : "remaining"}
              tone={activity.percent_complete >= 100 ? "success" : "default"}
            />
            <ScheduleWorkbenchStat
              label="Logic"
              value={String(
                activity.predecessor_activity_ids.length + activity.successor_activity_ids.length,
              )}
              sub="pred / succ ties"
              tone={
                activity.predecessor_activity_ids.length + activity.successor_activity_ids.length >
                0
                  ? "success"
                  : "warning"
              }
            />
          </div>

          <div className="rounded-md border border-hairline bg-surface p-4">
            <div className="mb-3 flex justify-end">
              <Button
                type="button"
                variant={draft.is_milestone ? "default" : "outline"}
                className="gap-2"
                aria-pressed={draft.is_milestone}
                disabled={isSaving}
                onClick={() => setDraft(toggleMilestoneDraft(draft, !draft.is_milestone))}
              >
                <Diamond className="h-4 w-4" />
                Milestone
              </Button>
            </div>
            <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-[130px_minmax(0,1.4fr)_minmax(0,1fr)_145px_145px_105px]">
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
              <LabeledField label="Division">
                <Input
                  value={draft.division}
                  onChange={(e) => setDraft({ ...draft, division: e.target.value })}
                  className="h-10 min-w-0"
                />
              </LabeledField>
              <LabeledField label="Start">
                <Input
                  type="date"
                  value={draft.start_date}
                  onChange={(e) => setDraft(updateDraftStartDate(draft, e.target.value))}
                  className="h-10 min-w-0"
                />
              </LabeledField>
              <LabeledField label="Finish">
                <Input
                  type="date"
                  value={draft.finish_date}
                  onChange={(e) => setDraft(updateDraftFinishDate(draft, e.target.value))}
                  className="h-10 min-w-0"
                />
              </LabeledField>
              <LabeledField label="% done">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.percent_complete}
                  onChange={(e) => setDraft({ ...draft, percent_complete: e.target.value })}
                  className="h-10 min-w-0 tabular"
                />
              </LabeledField>
            </div>

            <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-[minmax(0,230px)_minmax(0,230px)_minmax(0,1fr)]">
              <ActivityDependencyPicker
                label="Predecessors"
                emptyLabel="Choose activities that must finish first"
                selectedIds={draft.predecessor_activity_ids}
                activities={activities}
                blockedActivityId={draft.activity_id || activity.activity_id}
                blockedIds={parseActivityIds(draft.successor_activity_ids)}
                onChange={(value) => setDraft({ ...draft, predecessor_activity_ids: value })}
              />
              <ActivityDependencyPicker
                label="Successors"
                emptyLabel="Choose activities that follow this one"
                selectedIds={draft.successor_activity_ids}
                activities={activities}
                blockedActivityId={draft.activity_id || activity.activity_id}
                blockedIds={parseActivityIds(draft.predecessor_activity_ids)}
                onChange={(value) => setDraft({ ...draft, successor_activity_ids: value })}
              />
              <div className="min-w-0 rounded-md border border-hairline bg-card p-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Dependency readout
                </div>
                <div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-muted-foreground">Predecessors</div>
                    <ActivityIdPills
                      ids={parseActivityIds(draft.predecessor_activity_ids)}
                      emptyLabel="No predecessor logic"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-muted-foreground">Successors</div>
                    <ActivityIdPills
                      ids={parseActivityIds(draft.successor_activity_ids)}
                      emptyLabel="No successor logic"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3">
              <LabeledField label="Notes / constraint">
                <Textarea
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  placeholder="Sequencing constraint, procurement issue, field note, or CPM update narrative."
                  className="min-h-28 min-w-0 resize-y bg-card"
                />
              </LabeledField>
            </div>
          </div>
        </div>

        {saveError && (
          <div className="border-t border-danger/20 bg-danger/10 px-4 py-2 text-sm text-danger sm:px-6">
            {saveError}
          </div>
        )}

        <DialogFooter className="gap-2 border-t border-hairline px-4 py-4 sm:justify-between sm:space-x-0 sm:px-6">
          <Button
            type="button"
            variant="outline"
            className="gap-2 text-danger"
            onClick={onDelete}
            disabled={isSaving}
          >
            <Trash2 className="h-4 w-4" />
            Delete activity
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isSaving}>
              Close
            </Button>
            <Button type="button" onClick={saveActivity} disabled={!draft.name.trim() || isSaving}>
              {isSaving ? "Saving..." : "Save activity"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function groupActivitiesByDivision(activities: ScheduleActivityRow[]) {
  const groups = new Map<string, ScheduleActivityRow[]>();
  for (const activity of activities) {
    const division = activity.division || "General";
    groups.set(division, [...(groups.get(division) ?? []), activity]);
  }
  return Array.from(groups.entries()).map(([division, rows]) => ({ division, activities: rows }));
}

function buildActivityRowsFromMilestones(
  milestones: MilestoneRow[],
  activities: ScheduleActivityRow[],
): ActivityCreateInput[] {
  const existingNames = new Set(activities.map((activity) => normalizeActivityName(activity.name)));
  const existingIds = new Set(activities.map((activity) => activity.activity_id).filter(Boolean));

  return milestones
    .map((milestone, index) => ({ milestone, index }))
    .filter(({ milestone }) => {
      const name = milestone.name.trim();
      return name && !existingNames.has(normalizeActivityName(name));
    })
    .map(({ milestone, index }) => {
      const activityId = uniqueActivityId(`MS-${String(index + 1).padStart(3, "0")}`, existingIds);
      const finishDate = milestone.forecast_date || milestone.baseline_date || null;
      return {
        activity_id: activityId,
        name: milestone.name.trim(),
        division: "Milestones",
        start_date: finishDate,
        finish_date: finishDate,
        percent_complete: milestone.status === "complete" ? 100 : 0,
        predecessor_activity_ids: [],
        successor_activity_ids: [],
        notes: milestoneActivityNotes(milestone),
      };
    });
}

function normalizeActivityName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function uniqueActivityId(base: string, existingIds: Set<string>) {
  let next = base;
  let suffix = 2;
  while (existingIds.has(next)) {
    next = `${base}-${suffix}`;
    suffix += 1;
  }
  existingIds.add(next);
  return next;
}

function milestoneActivityNotes(milestone: MilestoneRow) {
  const pieces = [`Created from interim milestone: ${milestone.name}.`];
  if (milestone.owner) pieces.push(`Owner: ${milestone.owner}.`);
  pieces.push(`Milestone status: ${STATUS_LABEL[milestone.status]}.`);
  if (milestone.delay_reason) pieces.push(`Milestone note: ${milestone.delay_reason}`);
  return pieces.join(" ");
}

function parsePercent(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function parseActivityIds(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatActivityIds(value: string[]) {
  return value.join(", ");
}

function getMilestoneDraftDate(draft: ActivityDraft) {
  return draft.finish_date || draft.start_date || null;
}

function toggleMilestoneDraft(draft: ActivityDraft, isMilestone: boolean): ActivityDraft {
  if (!isMilestone) {
    return {
      ...draft,
      is_milestone: false,
      division: draft.division.trim().toLowerCase() === "milestones" ? "General" : draft.division,
    };
  }

  const milestoneDate = draft.finish_date || draft.start_date;
  return {
    ...draft,
    is_milestone: true,
    division: "Milestones",
    start_date: milestoneDate,
    finish_date: milestoneDate,
  };
}

function updateDraftStartDate(draft: ActivityDraft, value: string): ActivityDraft {
  if (!draft.is_milestone) return { ...draft, start_date: value };
  return { ...draft, start_date: value, finish_date: value };
}

function updateDraftFinishDate(draft: ActivityDraft, value: string): ActivityDraft {
  if (!draft.is_milestone) return { ...draft, finish_date: value };
  return { ...draft, start_date: value, finish_date: value };
}

function ScheduleStat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "default" | "danger" | "success";
}) {
  const toneClass =
    tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-foreground";
  return (
    <div className="rounded-md border border-hairline bg-surface px-3 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-lg font-semibold tabular ${toneClass}`}>{value}</div>
      <div className="mt-0.5 min-h-4 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

type TimelineBounds = {
  start: number;
  end: number;
  startLabel: string | null;
  endLabel: string | null;
};

function parseDateMs(value?: string | null) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day);
}

function isoDateFromMs(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

function getActivityDurationDays(activity: ScheduleActivityRow) {
  const start = parseDateMs(activity.start_date);
  const finish = parseDateMs(activity.finish_date);
  if (start == null || finish == null) return null;
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.max(1, Math.round((finish - start) / oneDay) + 1);
}

function getTimelineBounds(values: Array<string | null | undefined>): TimelineBounds {
  const parsed = values
    .map((value) => parseDateMs(value))
    .filter((value): value is number => value != null);
  const today = parseDateMs(new Date().toISOString().slice(0, 10)) ?? Date.now();
  const oneWeek = 7 * 24 * 60 * 60 * 1000;
  const start = Math.min(...parsed, today) - oneWeek;
  const end = Math.max(...parsed, today) + oneWeek;
  return {
    start,
    end,
    startLabel: isoDateFromMs(start),
    endLabel: isoDateFromMs(end),
  };
}

function timelinePosition(value: string | null | undefined, bounds: TimelineBounds) {
  const ms = parseDateMs(value);
  if (ms == null || bounds.end <= bounds.start) return null;
  const pct = ((ms - bounds.start) / (bounds.end - bounds.start)) * 100;
  return Math.max(0, Math.min(100, pct));
}

function TimelineMarker({
  left,
  label,
  className,
}: {
  left: number;
  label: string;
  className: string;
}) {
  return (
    <div className="absolute top-1/2 -translate-y-1/2" style={{ left: `${left}%` }}>
      <div className={`h-4 w-4 -translate-x-1/2 rounded-full border-2 ${className}`} />
      <div className="-translate-x-1/2 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function SchedulePlanRow({
  milestone,
  bounds,
  dataDatePosition,
}: {
  milestone: MilestoneRow;
  bounds: TimelineBounds;
  dataDatePosition: number | null;
}) {
  const baseline = timelinePosition(milestone.baseline_date, bounds);
  const current = timelinePosition(milestone.forecast_date, bounds);
  const start = baseline ?? current ?? 0;
  const end = current ?? baseline ?? 0;
  const left = Math.min(start, end);
  const width = Math.max(2, Math.abs(end - start));
  const variance = computeScheduleVarianceWeeks(milestone.baseline_date, milestone.forecast_date);
  const isLate = (variance ?? 0) > 0 || milestone.status === "delayed";
  const isPressure = isLate || milestone.status === "at_risk";
  return (
    <div className="grid gap-3 border-b border-hairline px-4 py-3 last:border-b-0 lg:grid-cols-[minmax(180px,1.25fr)_minmax(280px,2fr)_92px_92px_86px_116px] lg:items-center">
      <div className="min-w-0 lg:pr-2">
        <div className="text-sm font-medium leading-snug text-foreground">{milestone.name}</div>
        <div className="mt-1 text-xs text-muted-foreground">{milestone.owner || "Unassigned"}</div>
        {milestone.delay_reason && (
          <div className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">
            {milestone.delay_reason}
          </div>
        )}
      </div>
      <div>
        <div className="relative h-9 rounded-md bg-muted">
          {dataDatePosition != null && (
            <div
              className="absolute inset-y-1 w-px bg-foreground/25"
              style={{ left: `${dataDatePosition}%` }}
            />
          )}
          {(baseline != null || current != null) && (
            <div
              className={`absolute top-1/2 h-2 -translate-y-1/2 rounded-full ${
                isPressure ? "bg-danger/60" : "bg-success/60"
              }`}
              style={{ left: `${left}%`, width: `${width}%` }}
            />
          )}
          {baseline != null && (
            <span
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-foreground bg-card"
              style={{ left: `${baseline}%` }}
            />
          )}
          {current != null && (
            <span
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent bg-accent"
              style={{ left: `${current}%` }}
            />
          )}
        </div>
      </div>
      <CompactField label="Baseline" value={shortDate(milestone.baseline_date)} />
      <CompactField label="Current" value={shortDate(milestone.forecast_date)} />
      <CompactField label="Variance" value={varianceLabel(variance)} />
      <span
        className={`inline-flex min-h-8 items-center justify-center rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${STATUS_STYLES[milestone.status]}`}
      >
        {STATUS_LABEL[milestone.status]}
      </span>
    </div>
  );
}

function ScheduleUpdateLedger({
  updates,
  milestoneUpdates,
}: {
  updates: ScheduleUpdateRow[];
  milestoneUpdates: ScheduleMilestoneUpdateRow[];
}) {
  if (updates.length === 0) {
    return (
      <section className="rounded-lg border border-hairline bg-card p-6">
        <h3 className="font-serif text-2xl text-foreground">Schedule update history</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          No formal schedule updates have been saved yet. The next saved data-date snapshot becomes
          update 1.
        </p>
      </section>
    );
  }
  const milestoneCountByUpdate = milestoneUpdates.reduce<Record<number, number>>((acc, update) => {
    acc[update.update_number] = (acc[update.update_number] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <section className="rounded-lg border border-hairline bg-card p-6">
      <div className="mb-4">
        <h3 className="font-serif text-2xl text-foreground">Schedule update history</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Each saved update records a data date, current completion date, variance against baseline,
          movement from the prior update, and schedule-dollar movement.
        </p>
      </div>
      <div className="overflow-hidden rounded-md border border-hairline">
        <div className="grid grid-cols-[64px_100px_120px_140px_100px_100px_110px_minmax(180px,1fr)] bg-surface px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <div>Update</div>
          <div>Data date</div>
          <div>Baseline</div>
          <div>Current completion</div>
          <div>Variance</div>
          <div>Movement</div>
          <div>Net $</div>
          <div>Notes</div>
        </div>
        {updates.map((update) => (
          <div
            key={update.id}
            className="grid grid-cols-[64px_100px_120px_140px_100px_100px_110px_minmax(180px,1fr)] items-start border-t border-hairline px-3 py-3 text-sm"
          >
            <div className="font-medium tabular text-foreground">#{update.update_number}</div>
            <div className="text-muted-foreground">{shortDate(update.data_date)}</div>
            <div className="tabular text-muted-foreground">
              {shortDate(update.baseline_completion_date)}
            </div>
            <div className="font-medium text-foreground">
              {shortDate(update.forecast_completion_date)}
            </div>
            <div className={`tabular ${varianceTone(update.variance_weeks)}`}>
              {varianceLabel(update.variance_weeks)}
            </div>
            <div className={`tabular ${varianceTone(update.movement_weeks)}`}>
              {varianceLabel(update.movement_weeks)}
            </div>
            <div className={`font-semibold tabular ${moneyTone(update.schedule_money_net)}`}>
              {fmtUSD(update.schedule_money_net)}
            </div>
            <div>
              <div className="text-xs text-muted-foreground">
                {milestoneCountByUpdate[update.update_number] ?? 0} milestone snapshots
              </div>
              {update.notes && (
                <div className="mt-1 max-w-2xl text-xs text-muted-foreground">{update.notes}</div>
              )}
              {update.money_notes && (
                <div className="mt-1 max-w-2xl text-xs text-muted-foreground">
                  {update.money_notes}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DateField({
  label,
  value,
  accent,
  onCommit,
}: {
  label: string;
  value: string | null;
  accent?: boolean;
  onCommit: (v: string | null) => void;
}) {
  const [local, setLocal] = useState(value ?? "");
  useEffect(() => {
    setLocal(value ?? "");
  }, [value]);
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Input
        type="date"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const next = local || null;
          if (next !== (value ?? null)) onCommit(next);
        }}
        className={accent ? "border-accent/40 focus-visible:ring-accent" : ""}
      />
    </div>
  );
}

function shortDate(value?: string | null) {
  if (!value) return "Not set";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${month}/${day}/${year}`;
}

function shortPrintDate(value?: string | null) {
  if (!value) return "Not set";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${month}/${day}/${year.slice(2)}`;
}

function isBareMilestone(row: MilestoneRow) {
  return (
    !row.baseline_date &&
    !row.forecast_date &&
    !row.owner &&
    !row.delay_reason &&
    row.status === "on_track"
  );
}

function MilestoneRowEditor({
  row,
  onPatch,
  onDelete,
}: {
  row: MilestoneRow;
  onPatch: (patch: Partial<MilestoneRow>) => void;
  onDelete: () => void;
}) {
  const [local, setLocal] = useState(row);
  const [editing, setEditing] = useState(() => isBareMilestone(row));
  useEffect(() => {
    setLocal(row);
  }, [row]);
  const commit = (patch: Partial<MilestoneRow>) => {
    setLocal((s) => ({ ...s, ...patch }));
    onPatch(patch);
  };
  const changedFields = () => {
    const patch: Partial<MilestoneRow> = {};
    if (row.name !== local.name) patch.name = local.name;
    if (row.baseline_date !== local.baseline_date) patch.baseline_date = local.baseline_date;
    if (row.forecast_date !== local.forecast_date) patch.forecast_date = local.forecast_date;
    if (row.status !== local.status) patch.status = local.status;
    if (row.owner !== local.owner) patch.owner = local.owner;
    if (row.delay_reason !== local.delay_reason) patch.delay_reason = local.delay_reason;
    return patch;
  };
  const finishEditing = () => {
    const patch = changedFields();
    if (Object.keys(patch).length > 0) onPatch(patch);
    setEditing(false);
  };

  if (!editing) {
    const needsReason = local.status === "at_risk" || local.status === "delayed";
    return (
      <div className="rounded-md border border-hairline bg-surface p-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="font-medium text-foreground">{local.name}</div>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_STYLES[local.status]}`}
              >
                {STATUS_LABEL[local.status]}
              </span>
            </div>
            {needsReason && local.delay_reason && (
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{local.delay_reason}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs md:min-w-[440px] md:grid-cols-4">
            <CompactField label="Baseline" value={shortDate(local.baseline_date)} />
            <CompactField label="Current" value={shortDate(local.forecast_date)} />
            <CompactField label="Owner" value={local.owner || "Unassigned"} />
            <div className="flex items-center justify-end gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onDelete}
                aria-label="Delete milestone"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-hairline bg-surface p-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end">
        <div className="space-y-1 md:col-span-3">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Milestone
          </Label>
          <Input
            value={local.name}
            onChange={(e) => setLocal({ ...local, name: e.target.value })}
            onBlur={() => row.name !== local.name && commit({ name: local.name })}
          />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Baseline
          </Label>
          <Input
            type="date"
            value={local.baseline_date ?? ""}
            onChange={(e) => commit({ baseline_date: e.target.value || null })}
          />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Current
          </Label>
          <Input
            type="date"
            value={local.forecast_date ?? ""}
            onChange={(e) => commit({ forecast_date: e.target.value || null })}
          />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Status
          </Label>
          <Select
            value={local.status}
            onValueChange={(v) => commit({ status: v as MilestoneStatus })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(STATUS_LABEL) as MilestoneStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Owner
          </Label>
          <Input
            value={local.owner}
            onChange={(e) => setLocal({ ...local, owner: e.target.value })}
            onBlur={() => row.owner !== local.owner && commit({ owner: local.owner })}
            placeholder="PM, sub, owner…"
          />
        </div>
        <div className="md:col-span-1 md:flex md:justify-end">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {(local.status === "at_risk" || local.status === "delayed") && (
        <div className="mt-3 space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 text-warning" /> Reason for delay / risk
          </Label>
          <Textarea
            rows={6}
            className="min-h-[140px] text-sm leading-relaxed"
            value={local.delay_reason}
            onChange={(e) => setLocal({ ...local, delay_reason: e.target.value })}
            onBlur={() =>
              row.delay_reason !== local.delay_reason &&
              commit({ delay_reason: local.delay_reason })
            }
            placeholder="What's causing the slip? Long-lead procurement, owner decision, weather, trade manpower…"
          />
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-3">
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_STYLES[local.status]}`}
        >
          {STATUS_LABEL[local.status]}
        </span>
        <Button size="sm" className="gap-1.5" onClick={finishEditing}>
          <CheckCircle2 className="h-3.5 w-3.5" /> Done
        </Button>
      </div>
    </div>
  );
}

function CompactField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-hairline bg-card px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-medium text-foreground">{value}</div>
    </div>
  );
}

function RiskGroup({
  kind,
  items,
  onAdd,
  onPatch,
  onDelete,
  onCreateExposure,
  pendingExposureId,
  linkedExposureIds,
}: {
  kind: ScheduleRiskKind;
  items: ScheduleRiskRow[];
  onAdd: (title: string) => void;
  onPatch: (id: string, patch: Partial<ScheduleRiskRow>) => void;
  onDelete: (id: string) => void;
  onCreateExposure: (risk: ScheduleRiskRow) => void;
  pendingExposureId: string | null;
  linkedExposureIds: Record<string, string>;
}) {
  const meta = RISK_META[kind];
  const Icon = meta.icon;
  const [statusView, setStatusView] = useState<ScheduleRiskStatus | "all">("active");
  const visibleItems = (statusView === "all" ? items : items.filter((r) => r.status === statusView))
    .slice()
    .sort(
      (a, b) =>
        likelyRiskValue(b) - likelyRiskValue(a) ||
        a.sort_order - b.sort_order ||
        a.title.localeCompare(b.title),
    );
  const activeCount = items.filter((r) => r.status === "active").length;
  const completedCount = items.filter((r) => r.status === "completed").length;
  return (
    <div className="rounded-lg border border-hairline bg-card p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-accent/10 p-2 text-accent">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h4 className="font-serif text-xl text-foreground">{meta.label}</h4>
            <p className="text-xs text-muted-foreground">
              {items.length === 0
                ? "None logged yet."
                : `${activeCount} active · ${completedCount} completed · ${items.length} total`}
            </p>
          </div>
        </div>
        <div className="flex w-full max-w-xl flex-col gap-2 sm:flex-row">
          <Select
            value={statusView}
            onValueChange={(value) => setStatusView(value as ScheduleRiskStatus | "all")}
          >
            <SelectTrigger className="h-9 sm:w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <AddInline placeholder={meta.placeholder} onAdd={onAdd} />
        </div>
      </div>
      <div className="space-y-3">
        {visibleItems.length === 0 && (
          <div className="rounded-md border border-dashed border-hairline bg-surface/60 px-3 py-5 text-sm text-muted-foreground">
            No {statusView === "all" ? "" : statusView} items in this group.
          </div>
        )}
        {visibleItems.map((r) => (
          <RiskItem
            key={r.id}
            row={r}
            detailPlaceholder={meta.detailPlaceholder}
            onPatch={(p) => onPatch(r.id, p)}
            onDelete={() => onDelete(r.id)}
            onCreateExposure={onCreateExposure}
            creatingExposure={pendingExposureId === r.id}
            linkedExposureId={linkedExposureIds[r.id] ?? r.linked_exposure_id}
          />
        ))}
      </div>
    </div>
  );
}

const RESPONSE_LABEL: Record<ResponsePath, string> = {
  eliminate: "Eliminate",
  recover: "Recover",
  offset: "Offset",
  accept: "Accept",
};

function likelyRiskValue(row: ScheduleRiskRow) {
  return row.dollar_exposure * (row.probability / 100);
}

function isBareRisk(row: ScheduleRiskRow) {
  return !row.detail && row.dollar_exposure === 0 && !row.owner && !row.due_date;
}

function RiskItem({
  row,
  detailPlaceholder,
  onPatch,
  onDelete,
  onCreateExposure,
  creatingExposure,
  linkedExposureId,
}: {
  row: ScheduleRiskRow;
  detailPlaceholder: string;
  onPatch: (patch: Partial<ScheduleRiskRow>) => void;
  onDelete: () => void;
  onCreateExposure: (risk: ScheduleRiskRow) => void;
  creatingExposure: boolean;
  linkedExposureId: string | null;
}) {
  const [local, setLocal] = useState(row);
  const [editing, setEditing] = useState(() => isBareRisk(row));
  useEffect(() => {
    setLocal(row);
  }, [row]);

  const isLinked = Boolean(linkedExposureId);
  const changedFields = () => {
    const patch: Partial<ScheduleRiskRow> = {};
    if (row.title !== local.title) patch.title = local.title;
    if (row.detail !== local.detail) patch.detail = local.detail;
    if (row.dollar_exposure !== local.dollar_exposure) {
      patch.dollar_exposure = local.dollar_exposure;
    }
    if (row.probability !== local.probability) patch.probability = local.probability;
    if (row.schedule_impact_weeks !== local.schedule_impact_weeks) {
      patch.schedule_impact_weeks = local.schedule_impact_weeks;
    }
    if (row.owner !== local.owner) patch.owner = local.owner;
    if (row.due_date !== local.due_date) patch.due_date = local.due_date;
    if (row.response_path !== local.response_path) patch.response_path = local.response_path;
    if (row.hold_class !== local.hold_class) patch.hold_class = local.hold_class;
    if (row.status !== local.status) patch.status = local.status;
    if (row.completed_at !== local.completed_at) patch.completed_at = local.completed_at;
    if (row.inactive_reason !== local.inactive_reason) {
      patch.inactive_reason = local.inactive_reason;
    }
    return patch;
  };
  const saveDraft = () => {
    const patch = changedFields();
    if (Object.keys(patch).length > 0) onPatch(patch);
  };
  const finishEditing = () => {
    saveDraft();
    setEditing(false);
  };
  const createLinkedExposure = () => {
    saveDraft();
    onCreateExposure(local);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div
        className="rounded-md border border-hairline bg-surface p-3"
        onDoubleClick={() => setEditing(true)}
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="font-medium text-foreground">{local.title}</div>
              <span className="inline-flex items-center rounded-md border border-hairline px-1.5 py-0.5 font-mono text-[10px]">
                {local.hold_class}
              </span>
              {isLinked && (
                <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-success">
                  <CheckCircle2 className="h-3 w-3" /> Linked
                </span>
              )}
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${RISK_STATUS_STYLES[local.status]}`}
              >
                {RISK_STATUS_LABEL[local.status]}
              </span>
            </div>
            {local.detail && (
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{local.detail}</p>
            )}
            {local.status !== "active" && local.inactive_reason && (
              <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
                {local.status === "completed" ? "Completed: " : "Inactive: "}
                {local.inactive_reason}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs md:min-w-[560px] md:grid-cols-5">
            <CompactField label="Dollar risk" value={fmtUSD(local.dollar_exposure)} />
            <CompactField label="Likely risk" value={fmtUSD(likelyRiskValue(local))} />
            <CompactField
              label="Schedule"
              value={
                local.schedule_impact_weeks == null
                  ? "No impact"
                  : `${local.schedule_impact_weeks} wk`
              }
            />
            <CompactField label="Owner" value={local.owner || "Unassigned"} />
            <CompactField label="Due" value={shortDate(local.due_date)} />
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2 border-t border-hairline pt-3 md:flex-row md:items-center md:justify-between">
          <div className="text-xs text-muted-foreground">
            Treatment:{" "}
            <span className="font-medium text-foreground">
              {RESPONSE_LABEL[local.response_path]}
            </span>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {!isLinked && (
              <Button
                type="button"
                size="sm"
                disabled={creatingExposure}
                onClick={createLinkedExposure}
              >
                {creatingExposure ? "Creating..." : "Create risk allocation"}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onDelete}
              aria-label="Delete risk"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group rounded-md border border-hairline bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-3">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Title
            </Label>
            <Input
              value={local.title}
              onChange={(e) => setLocal({ ...local, title: e.target.value })}
              onBlur={() => row.title !== local.title && onPatch({ title: local.title })}
              className="font-medium"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Detail - owner, blocked scope, dollar/schedule impact, dates
            </Label>
            <Textarea
              rows={5}
              className="min-h-[140px] text-sm leading-relaxed"
              placeholder={detailPlaceholder}
              value={local.detail}
              onChange={(e) => setLocal({ ...local, detail: e.target.value })}
              onBlur={() => row.detail !== local.detail && onPatch({ detail: local.detail })}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
            <div className="space-y-1 md:col-span-2">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Dollar risk
              </Label>
              <MoneyInput
                value={local.dollar_exposure}
                onValueChange={(v) => setLocal({ ...local, dollar_exposure: v })}
                onBlur={() =>
                  row.dollar_exposure !== local.dollar_exposure &&
                  onPatch({ dollar_exposure: local.dollar_exposure })
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Probability %
              </Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={local.probability}
                onChange={(e) => setLocal({ ...local, probability: Number(e.target.value) })}
                onBlur={() =>
                  row.probability !== local.probability &&
                  onPatch({ probability: local.probability })
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Impact (wk)
              </Label>
              <Input
                type="number"
                value={local.schedule_impact_weeks ?? ""}
                onChange={(e) =>
                  setLocal({
                    ...local,
                    schedule_impact_weeks: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                onBlur={() =>
                  row.schedule_impact_weeks !== local.schedule_impact_weeks &&
                  onPatch({ schedule_impact_weeks: local.schedule_impact_weeks })
                }
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Owner
              </Label>
              <Input
                value={local.owner}
                onChange={(e) => setLocal({ ...local, owner: e.target.value })}
                onBlur={() => row.owner !== local.owner && onPatch({ owner: local.owner })}
                placeholder="PM, owner, trade"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Due date
              </Label>
              <Input
                type="date"
                value={local.due_date ?? ""}
                onChange={(e) => {
                  const next = e.target.value || null;
                  setLocal({ ...local, due_date: next });
                  if (row.due_date !== next) onPatch({ due_date: next });
                }}
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Treatment path
              </Label>
              <Select
                value={local.response_path}
                onValueChange={(v) => {
                  const next = v as ResponsePath;
                  setLocal({ ...local, response_path: next });
                  onPatch({ response_path: next });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="eliminate">Eliminate</SelectItem>
                  <SelectItem value="recover">Recover</SelectItem>
                  <SelectItem value="offset">Offset</SelectItem>
                  <SelectItem value="accept">Accept</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Hold class
              </Label>
              <Select
                value={local.hold_class}
                onValueChange={(v) => {
                  const next = v as HoldClass;
                  setLocal({ ...local, hold_class: next });
                  onPatch({ hold_class: next });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="E-Hold">E-Hold</SelectItem>
                  <SelectItem value="C-Hold">C-Hold</SelectItem>
                  <SelectItem value="Both">Both</SelectItem>
                  <SelectItem value="None">None</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Status
              </Label>
              <Select
                value={local.status}
                onValueChange={(v) => {
                  const next = v as ScheduleRiskStatus;
                  setLocal({
                    ...local,
                    status: next,
                    completed_at:
                      next === "completed"
                        ? (local.completed_at ?? new Date().toISOString())
                        : null,
                  });
                  onPatch({
                    status: next,
                    completed_at:
                      next === "completed"
                        ? (local.completed_at ?? new Date().toISOString())
                        : null,
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {local.status !== "active" && (
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {local.status === "completed" ? "Completion note" : "Inactive reason"}
              </Label>
              <Input
                value={local.inactive_reason}
                onChange={(e) => setLocal({ ...local, inactive_reason: e.target.value })}
                onBlur={() =>
                  row.inactive_reason !== local.inactive_reason &&
                  onPatch({ inactive_reason: local.inactive_reason })
                }
                placeholder="Why is this no longer an active schedule risk?"
              />
            </div>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {isLinked && (
              <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-1 text-xs font-medium text-success">
                <CheckCircle2 className="h-3.5 w-3.5" /> Linked to Risk Tally
              </span>
            )}
            <Button
              type="button"
              size="sm"
              variant={isLinked ? "outline" : "default"}
              disabled={creatingExposure || isLinked}
              onClick={createLinkedExposure}
            >
              {isLinked
                ? "Linked to Risk Tally"
                : creatingExposure
                  ? "Creating..."
                  : "Create risk allocation"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={finishEditing}>
              Done
            </Button>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 opacity-60 hover:opacity-100"
          onClick={onDelete}
          aria-label="Delete risk"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function AddInline({ placeholder, onAdd }: { placeholder: string; onAdd: (v: string) => void }) {
  const [v, setV] = useState("");
  const submit = () => {
    const t = v.trim();
    if (!t) return;
    onAdd(t);
    setV("");
  };
  return (
    <div className="flex gap-2">
      <Input
        className="h-9"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
      />
      <Button size="sm" variant="outline" className="gap-1 shrink-0" onClick={submit}>
        <Plus className="h-3.5 w-3.5" /> Add
      </Button>
    </div>
  );
}
