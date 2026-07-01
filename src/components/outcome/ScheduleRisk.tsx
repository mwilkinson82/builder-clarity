import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
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
  CalendarDays,
  ListTree,
  ArrowUp,
  ArrowDown,
  GripVertical,
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
  importScheduleCpmTemplate,
  listScheduleCpmTemplates,
  saveCurrentScheduleAsCpmTemplate,
  type MilestoneStatus,
  type ScheduleRiskKind,
  type ScheduleRiskStatus,
  type MilestoneRow,
  type ScheduleActivityRow,
  type ScheduleCpmTemplateRow,
  type ScheduleDelayFragmentRow,
  type ScheduleWbsPersistence,
  type ScheduleWbsSectionRow,
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
  describeConstructLineDependencyToken,
  formatConstructLineDependencyToken,
  isConstructLineMilestoneActivity,
  offsetFromTimelineStart,
  parseConstructLineDependencyToken,
  type ConstructLineCpmModel,
  type ConstructLineCpmTask,
  type ConstructLineDependencyToken,
  type ConstructLineRelationshipType,
} from "@/lib/constructline-cpm";
import {
  buildWbsDivisionOrder,
  buildWbsDivisionRows,
  cleanWbsDivisionInput,
  compareWbsDivision,
  formatIndentedWbsLabel,
  getImmediateChildWbsTitle,
  getValidWbsParentRows,
  getWbsChildRows,
  getWbsDisplayMeta,
  getWbsSiblingPosition,
  getWbsSiblingRows,
  hasWbsDivision,
  isSameWbsParent,
  isWbsDescendantPath,
  joinWbsPath,
  moveWbsDivisionInOrder,
  normalizeWbsDivisionName,
  splitWbsPath,
  type WbsDivisionRow,
} from "@/lib/constructline-wbs";

const EMPTY_MILESTONES: MilestoneRow[] = [];
const EMPTY_ACTIVITIES: ScheduleActivityRow[] = [];
const EMPTY_DELAY_FRAGMENTS: ScheduleDelayFragmentRow[] = [];
const EMPTY_CPM_TEMPLATES: ScheduleCpmTemplateRow[] = [];
const EMPTY_SCHEDULE_RISKS: ScheduleRiskRow[] = [];
const EMPTY_SCHEDULE_UPDATES: ScheduleUpdateRow[] = [];
const EMPTY_MILESTONE_UPDATES: ScheduleMilestoneUpdateRow[] = [];
const BROWSER_CPM_TEMPLATE_STORAGE_KEY = "constructline:cpm-templates:v1";

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
const DAY_MS = 24 * 60 * 60 * 1000;
type ScheduleActivityOrder = "start" | "wbs";
type ScheduleGridView =
  | "all"
  | "active"
  | "lookahead_1w"
  | "lookahead_2w"
  | "lookahead_6w"
  | "critical"
  | "issues"
  | "milestones";
type ActivityPatchOptions = { silent?: boolean };
type ActivityMatrixRow =
  | { kind: "parent"; division: string; tasks: ConstructLineCpmTask[] }
  | { kind: "group"; division: string; tasks: ConstructLineCpmTask[] }
  | { kind: "task"; task: ConstructLineCpmTask };
type WbsReorderInput = {
  parentId: string | null;
  orderedIds: string[];
};
const CONSTRUCTLINE_RELATIONSHIP_TYPES: ConstructLineRelationshipType[] = ["FS", "SS", "FF", "SF"];
const SCHEDULE_GRID_VIEW_OPTIONS: Array<{ value: ScheduleGridView; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "lookahead_1w", label: "1 week lookahead" },
  { value: "lookahead_2w", label: "2 week lookahead" },
  { value: "lookahead_6w", label: "6 week lookahead" },
  { value: "critical", label: "Critical" },
  { value: "issues", label: "Issues" },
  { value: "milestones", label: "Milestones" },
];
const SCHEDULE_LOOKAHEAD_DAYS: Partial<Record<ScheduleGridView, number>> = {
  lookahead_1w: 7,
  lookahead_2w: 14,
  lookahead_6w: 42,
};
const CONSTRUCTLINE_RELATIONSHIP_LABELS: Record<ConstructLineRelationshipType, string> = {
  FS: "Finish to start",
  SS: "Start to start",
  FF: "Finish to finish",
  SF: "Start to finish",
};

const DELAY_FRAGMENT_STATUS_LABEL: Record<ScheduleDelayFragmentRow["status"], string> = {
  active: "Active",
  mitigated: "Mitigated",
  accepted: "Accepted",
  recovered: "Recovered",
};
const DELAY_FRAGMENT_SOURCE_LABEL: Record<ScheduleDelayFragmentRow["source"], string> = {
  field: "Field",
  trade: "Trade",
  owner: "Owner",
  design: "Design",
  procurement: "Procurement",
  weather: "Weather",
  other: "Other",
};

export type ActivityCreateInput = { name: string } & Partial<
  Pick<
    ScheduleActivityRow,
    | "activity_id"
    | "division"
    | "start_date"
    | "finish_date"
    | "baseline_start_date"
    | "baseline_finish_date"
    | "forecast_start_date"
    | "forecast_finish_date"
    | "actual_start_date"
    | "actual_finish_date"
    | "remaining_duration_days"
    | "percent_complete"
    | "predecessor_activity_ids"
    | "successor_activity_ids"
    | "notes"
    | "sort_order"
  >
>;
type BrowserCpmTemplate = ScheduleCpmTemplateRow & {
  source: "browser";
  activities: ActivityCreateInput[];
  wbsSections: ScheduleWbsSectionRow[];
};

export type DelayFragmentCreateInput = { title: string } & Partial<
  Pick<
    ScheduleDelayFragmentRow,
    | "schedule_activity_id"
    | "activity_id"
    | "reason"
    | "delay_days"
    | "source"
    | "status"
    | "owner"
    | "identified_on"
    | "resolved_on"
  >
>;

type DelayFragmentPatchInput = Partial<
  Pick<
    ScheduleDelayFragmentRow,
    | "schedule_activity_id"
    | "activity_id"
    | "title"
    | "reason"
    | "delay_days"
    | "source"
    | "status"
    | "owner"
    | "identified_on"
    | "resolved_on"
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

  const milestones = data?.milestones ?? EMPTY_MILESTONES;
  const activities = data?.activities ?? EMPTY_ACTIVITIES;
  const delayFragments = data?.delayFragments ?? EMPTY_DELAY_FRAGMENTS;
  const risks = data?.risks ?? EMPTY_SCHEDULE_RISKS;
  const updates = data?.updates ?? EMPTY_SCHEDULE_UPDATES;
  const milestoneUpdates = data?.milestoneUpdates ?? EMPTY_MILESTONE_UPDATES;
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

type DelayFragmentSummary = {
  totalCount: number;
  openCount: number;
  openDays: number;
  activeCount: number;
  mitigatedCount: number;
  recoveredCount: number;
  driverLabels: string[];
};

type ScheduleQualityQueueItem = {
  task: ConstructLineCpmTask;
  severity: "danger" | "warning";
  reasons: string[];
  guidance: string;
  sort: number;
};

function filterMilestones(milestones: MilestoneRow[], view: MilestoneView) {
  if (view === "all") return milestones;
  if (view === "complete") return milestones.filter((m) => m.status === "complete");
  return milestones.filter((m) => m.status !== "complete");
}

function buildScheduleQualityQueue(model: ConstructLineCpmModel): ScheduleQualityQueueItem[] {
  const items = model.tasks.flatMap((task) => {
    const reasons: string[] = [];
    let severity: ScheduleQualityQueueItem["severity"] = "warning";
    let sort = 90;

    if (task.hasMissingDates) {
      reasons.push("Missing start or finish date");
      severity = "danger";
      sort = Math.min(sort, 10);
    }
    if (task.missingPredecessorKeys.length > 0 || task.missingSuccessorKeys.length > 0) {
      reasons.push("Missing logic reference");
      severity = "danger";
      sort = Math.min(sort, 12);
    }
    if (model.openStartCount > 1 && task.isOpenStart) {
      reasons.push("Open start");
      sort = Math.min(sort, 20);
    }
    if (model.openFinishCount > 1 && task.isOpenFinish) {
      reasons.push("Open finish");
      sort = Math.min(sort, 22);
    }
    if (task.isOutOfSequence) {
      reasons.push("Out-of-sequence progress");
      severity = "danger";
      sort = Math.min(sort, 30);
    }
    if (task.isLate) {
      reasons.push("Late against data date");
      severity = "danger";
      sort = Math.min(sort, 34);
    }
    if (
      task.predecessorKeys.length === 0 &&
      task.successorKeys.length === 0 &&
      !task.isMilestone &&
      !reasons.some((reason) => reason.startsWith("Open"))
    ) {
      reasons.push("No logic ties");
      sort = Math.min(sort, 42);
    }

    if (reasons.length === 0) return [];
    return [
      {
        task,
        severity,
        reasons,
        guidance: buildScheduleQualityGuidance(task, reasons),
        sort,
      },
    ];
  });

  return items.sort((a, b) => {
    const severity = a.severity === b.severity ? 0 : a.severity === "danger" ? -1 : 1;
    if (severity !== 0) return severity;
    return a.sort - b.sort || a.task.totalFloat - b.task.totalFloat;
  });
}

function buildScheduleQualityGuidance(task: ConstructLineCpmTask, reasons: string[]) {
  if (reasons.some((reason) => reason.includes("Missing start"))) {
    return "Add dates so the row can participate in CPM math.";
  }
  if (reasons.some((reason) => reason.includes("Missing logic reference"))) {
    const missingIds = [...task.missingPredecessorKeys, ...task.missingSuccessorKeys];
    return `Replace ${missingIds.join(", ")} with an existing activity from the picker.`;
  }
  if (reasons.includes("Open start")) {
    return "Tie this row to the launch path or mark it as an intentional start milestone.";
  }
  if (reasons.includes("Open finish")) {
    return "Tie this row to a downstream completion path.";
  }
  if (reasons.includes("Out-of-sequence progress")) {
    return "Review progress against predecessor completion before the next update.";
  }
  if (reasons.includes("Late against data date")) {
    return "Update progress, add a delay impact, or revise the recovery path.";
  }
  if (reasons.includes("No logic ties")) {
    return task.totalFloat <= 0
      ? "Add predecessor and successor logic before relying on this as critical."
      : "Connect this row so the schedule is not just a date list.";
  }
  return "Open the activity and clean up dates, logic, or progress.";
}

function buildCpmScheduleUpdateDraft({
  dataDate,
  delaySummary,
  milestones,
  model,
  previousUpdate,
  project,
}: {
  dataDate: string;
  delaySummary: DelayFragmentSummary;
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
  if (delaySummary.openCount > 0) {
    qualityParts.push(
      `${delaySummary.openCount} open delay impacts / ${delaySummary.openDays} days`,
    );
  }

  const previewParts = [
    `CPM forecast ${shortDate(forecastCompletion)} (${varianceLabel(
      varianceWeeks,
    )} vs baseline, ${varianceLabel(movementWeeks)} movement).`,
    qualityParts.join("; ") + ".",
    criticalDrivers.length > 0 ? `Drivers: ${criticalDrivers.join(", ")}.` : null,
    delaySummary.driverLabels.length > 0
      ? `Delay ledger: ${delaySummary.driverLabels.join(", ")}.`
      : null,
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

function buildDelayFragmentSummary(fragments: ScheduleDelayFragmentRow[]): DelayFragmentSummary {
  const openFragments = fragments.filter(isOpenDelayFragment);
  const sortedDrivers = [...openFragments]
    .sort((a, b) => b.delay_days - a.delay_days)
    .slice(0, 3)
    .map((fragment) => `${fragment.activity_id || "Unassigned"} ${fragment.delay_days}d`);
  return {
    totalCount: fragments.length,
    openCount: openFragments.length,
    openDays: openFragments.reduce((total, fragment) => total + fragment.delay_days, 0),
    activeCount: fragments.filter((fragment) => fragment.status === "active").length,
    mitigatedCount: fragments.filter((fragment) => fragment.status === "mitigated").length,
    recoveredCount: fragments.filter((fragment) => fragment.status === "recovered").length,
    driverLabels: sortedDrivers,
  };
}

function buildActivityRiskDescription(
  activity: ScheduleActivityRow,
  delaySummary: DelayFragmentSummary,
) {
  const pieces = [
    `CPM activity ${activity.activity_id || "without ID"}: ${activity.name}.`,
    getActivityBaselineStart(activity) || getActivityBaselineFinish(activity)
      ? `Baseline dates: ${shortDate(getActivityBaselineStart(activity))} to ${shortDate(
          getActivityBaselineFinish(activity),
        )}.`
      : "Baseline dates are not fully set.",
    getActivityForecastStart(activity) || getActivityForecastFinish(activity)
      ? `Forecast dates: ${shortDate(getActivityForecastStart(activity))} to ${shortDate(
          getActivityForecastFinish(activity),
        )}.`
      : "Forecast dates are not fully set.",
    `${activity.percent_complete}% complete.`,
  ];
  if (delaySummary.openDays > 0) {
    pieces.push(
      `Open delay impact: ${delaySummary.openDays} days across ${delaySummary.openCount} fragment${
        delaySummary.openCount === 1 ? "" : "s"
      }.`,
    );
  }
  if (activity.notes) pieces.push(`Activity notes: ${activity.notes}`);
  return pieces.join(" ");
}

function isOpenDelayFragment(fragment: ScheduleDelayFragmentRow) {
  return fragment.status === "active" || fragment.status === "accepted";
}

function groupDelayFragmentsByActivity(fragments: ScheduleDelayFragmentRow[]) {
  const byKey = new Map<string, ScheduleDelayFragmentRow[]>();
  for (const fragment of fragments) {
    const keys = [fragment.schedule_activity_id, fragment.activity_id]
      .map((key) => key?.trim())
      .filter((key): key is string => Boolean(key));
    for (const key of keys) {
      byKey.set(key, [...(byKey.get(key) ?? []), fragment]);
    }
  }
  return byKey;
}

function getDelayFragmentsForActivity(
  activity: ScheduleActivityRow,
  byKey: Map<string, ScheduleDelayFragmentRow[]>,
) {
  const unique = new Map<string, ScheduleDelayFragmentRow>();
  for (const key of [activity.id, activity.activity_id]) {
    if (!key) continue;
    for (const fragment of byKey.get(key) ?? []) {
      unique.set(fragment.id, fragment);
    }
  }
  return Array.from(unique.values());
}

function buildDelayExtensionFinishDates(
  activities: ScheduleActivityRow[],
  delayFragments: ScheduleDelayFragmentRow[],
) {
  const byActivity = groupDelayFragmentsByActivity(delayFragments);
  return activities.flatMap((activity) => {
    const baseMs = parseDateMs(
      getActivityForecastFinish(activity) ?? getActivityForecastStart(activity),
    );
    if (baseMs == null) return [];
    const delaySummary = buildDelayFragmentSummary(
      getDelayFragmentsForActivity(activity, byActivity),
    );
    if (delaySummary.openDays <= 0) return [];
    const baselineMs = parseDateMs(getActivityBaselineFinish(activity));
    const delayDaysAlreadyCarried =
      baselineMs == null ? 0 : Math.max(0, Math.round((baseMs - baselineMs) / DAY_MS));
    const uncarriedDelayDays = Math.max(0, delaySummary.openDays - delayDaysAlreadyCarried);
    if (uncarriedDelayDays <= 0) return [];
    return [isoDateFromMs(baseMs + uncarriedDelayDays * DAY_MS)];
  });
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
  const workspacePanels = [
    "Full CPM activity table + Gantt",
    "Schedule update history",
    "Interim milestones",
    "Critical delayed decisions",
    "Procurement risks",
    "Trade performance risks",
  ];

  return (
    <div className="rounded-md border border-hairline bg-surface p-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.46fr)] xl:items-start">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Schedule workspace
          </div>
          <h4 className="mt-1 font-serif text-2xl text-foreground">
            Open the full construction schedule workspace
          </h4>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            This tab keeps the IOR schedule signal clean. The full-width workspace is where the PM
            manages the CPM activity table, Gantt, WBS hierarchy, data dates, schedule updates, and
            schedule-linked risks without the left navigation constraining the work.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {workspacePanels.map((panel) => (
              <div
                key={panel}
                className="min-w-0 rounded border border-hairline bg-card px-3 py-2 text-xs font-semibold leading-5 text-foreground"
              >
                {panel}
              </div>
            ))}
          </div>
        </div>
        <div className="min-w-0 rounded-md border border-hairline bg-card p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Working surface
          </div>
          <div className="mt-1 text-sm leading-6 text-muted-foreground">
            Use this when you need to build, update, print, or analyze the actual project schedule.
          </div>
          <Button asChild className="mt-4 w-full gap-2 print:hidden">
            <a href={`/projects/${project.id}/schedule#cpm-grid`} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              Open full schedule workspace
            </a>
          </Button>
        </div>
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
  baseline_start_date: string;
  baseline_finish_date: string;
  forecast_start_date: string;
  forecast_finish_date: string;
  actual_start_date: string;
  actual_finish_date: string;
  remaining_duration_days: string;
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
  baseline_start_date: "",
  baseline_finish_date: "",
  forecast_start_date: "",
  forecast_finish_date: "",
  actual_start_date: "",
  actual_finish_date: "",
  remaining_duration_days: "",
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
  baseline_start_date: activity.baseline_start_date ?? activity.start_date ?? "",
  baseline_finish_date: activity.baseline_finish_date ?? activity.finish_date ?? "",
  forecast_start_date: activity.forecast_start_date ?? activity.start_date ?? "",
  forecast_finish_date: activity.forecast_finish_date ?? activity.finish_date ?? "",
  actual_start_date: activity.actual_start_date ?? "",
  actual_finish_date: activity.actual_finish_date ?? "",
  remaining_duration_days:
    activity.remaining_duration_days == null ? "" : String(activity.remaining_duration_days),
  percent_complete: String(activity.percent_complete),
  predecessor_activity_ids: formatActivityIds(activity.predecessor_activity_ids),
  successor_activity_ids: formatActivityIds(activity.successor_activity_ids),
  notes: activity.notes ?? "",
  is_milestone: isConstructLineMilestoneActivity(activity),
});

export function CpmActivityPlanner({
  workspaceMode = "full",
  activities,
  wbsSections,
  wbsPersistence = "ready",
  delayFragments,
  delayFragmentPersistence = "ready",
  milestones,
  project,
  latestDataDate,
  onAddActivity,
  onSeedActivities,
  isSeedingActivities,
  onPatchActivity,
  isSavingActivity,
  onDeleteActivity,
  onAddDelayFragment,
  onPatchDelayFragment,
  onDeleteDelayFragment,
  isSavingDelayFragment,
  onAddWbsSection,
  onRenameWbsSection,
  onMoveWbsSectionParent,
  onReorderWbsSections,
  isSavingWbs,
  isSavingWbsOrder = false,
}: {
  workspaceMode?: "embedded" | "full";
  activities: ScheduleActivityRow[];
  wbsSections: ScheduleWbsSectionRow[];
  wbsPersistence?: ScheduleWbsPersistence;
  delayFragments: ScheduleDelayFragmentRow[];
  delayFragmentPersistence?: "ready" | "migration_required";
  milestones: MilestoneRow[];
  project: ProjectRow;
  latestDataDate: string | null;
  onAddActivity: (activity: ActivityCreateInput) => void;
  onSeedActivities: (activities: ActivityCreateInput[]) => void;
  isSeedingActivities: boolean;
  onPatchActivity: (
    id: string,
    patch: Partial<ScheduleActivityRow>,
    options?: ActivityPatchOptions,
  ) => Promise<void>;
  isSavingActivity: boolean;
  onDeleteActivity: (id: string) => void;
  onAddDelayFragment: (fragment: DelayFragmentCreateInput) => Promise<void>;
  onPatchDelayFragment: (id: string, patch: DelayFragmentPatchInput) => Promise<void>;
  onDeleteDelayFragment: (id: string) => Promise<void>;
  isSavingDelayFragment: boolean;
  onAddWbsSection: (name: string, parentId?: string | null) => Promise<void>;
  onRenameWbsSection: (id: string, name: string) => Promise<void>;
  onMoveWbsSectionParent: (id: string, parentId: string | null) => Promise<void>;
  onReorderWbsSections: (input: WbsReorderInput) => Promise<void>;
  isSavingWbs: boolean;
  isSavingWbsOrder?: boolean;
}) {
  const isFullWorkspace = workspaceMode === "full";
  const qc = useQueryClient();
  const createUpdateFn = useServerFn(createScheduleUpdate);
  const listTemplatesFn = useServerFn(listScheduleCpmTemplates);
  const saveTemplateFn = useServerFn(saveCurrentScheduleAsCpmTemplate);
  const importTemplateFn = useServerFn(importScheduleCpmTemplate);
  const createActivityExposureFn = useServerFn(createExposure);
  const [draft, setDraft] = useState<ActivityDraft>(() => emptyActivityDraft());
  const [showDraft, setShowDraft] = useState(false);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [dayPx, setDayPx] =
    useState<(typeof CONSTRUCTLINE_ZOOM_LEVELS)[number]["dayPx"]>(CONSTRUCTLINE_FIT_DAY_PX);
  const [showLogicLines, setShowLogicLines] = useState(true);
  const [activityOrder, setActivityOrder] = useState<ScheduleActivityOrder>("start");
  const [scheduleView, setScheduleView] = useState<ScheduleGridView>("all");
  const [dataDateDraft, setDataDateDraft] = useState(() => latestDataDate ?? todayIsoDate());
  const [templateName, setTemplateName] = useState(() => `${project.name} CPM`);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [browserTemplates, setBrowserTemplates] = useState<BrowserCpmTemplate[]>([]);
  const [isWbsManagerOpen, setIsWbsManagerOpen] = useState(false);
  const [isFocusOpen, setIsFocusOpen] = useState(false);
  const didScrollToGridRef = useRef(false);
  const effectiveDataDate = dataDateDraft || latestDataDate || null;
  const wbsDivisionOrder = useMemo(
    () => buildWbsDivisionOrder(activities, wbsSections),
    [activities, wbsSections],
  );
  const sortedActivities = useMemo(
    () =>
      [...activities].sort((a, b) => {
        if (activityOrder === "start") {
          return compareScheduleActivitiesByStart(a, b);
        }
        const division = compareWbsDivision(a.division, b.division, wbsDivisionOrder);
        if (division !== 0) return division;
        return compareScheduleActivitiesByStart(a, b);
      }),
    [activities, activityOrder, wbsDivisionOrder],
  );
  const grouped = useMemo(() => groupActivitiesByDivision(sortedActivities), [sortedActivities]);
  const wbsDivisionRows = useMemo(
    () => buildWbsDivisionRows(sortedActivities, wbsSections, wbsDivisionOrder),
    [sortedActivities, wbsDivisionOrder, wbsSections],
  );
  const knownWbsDivisions = useMemo(
    () => wbsDivisionRows.map((row) => row.division),
    [wbsDivisionRows],
  );
  const isWbsMigrationRequired = wbsPersistence === "migration_required";
  const isWbsPathFallback = wbsPersistence === "path_fallback";
  const showWbsMigrationPending = () => {
    toast.error("Use activity WBS fields for now", {
      description:
        "The grid still groups by each activity WBS path. Edit an activity WBS to adjust the visible schedule structure.",
    });
  };
  const delaySummary = useMemo(() => buildDelayFragmentSummary(delayFragments), [delayFragments]);
  const baseCpmModel = useMemo(
    () =>
      buildConstructLineCpmModel(sortedActivities, {
        dataDate: effectiveDataDate,
        nearCriticalFloat: 5,
      }),
    [effectiveDataDate, sortedActivities],
  );
  const cpmModel = useMemo(
    () => orderConstructLineCpmModel(baseCpmModel, activityOrder, wbsDivisionOrder),
    [activityOrder, baseCpmModel, wbsDivisionOrder],
  );
  const qualityQueueItems = useMemo(() => buildScheduleQualityQueue(cpmModel), [cpmModel]);
  const gridViewReferenceDate = effectiveDataDate ?? todayIsoDate();
  const displayedCpmModel = useMemo(
    () =>
      filterConstructLineCpmModel(cpmModel, scheduleView, gridViewReferenceDate, delayFragments),
    [cpmModel, delayFragments, gridViewReferenceDate, scheduleView],
  );
  const scheduleViewSummary = useMemo(
    () =>
      describeScheduleGridView(
        scheduleView,
        displayedCpmModel.tasks.length,
        cpmModel.tasks.length,
        gridViewReferenceDate,
      ),
    [cpmModel.tasks.length, displayedCpmModel.tasks.length, gridViewReferenceDate, scheduleView],
  );
  const delayExtensionFinishDates = useMemo(
    () => buildDelayExtensionFinishDates(sortedActivities, delayFragments),
    [delayFragments, sortedActivities],
  );
  const bounds = useMemo(
    () =>
      getTimelineBounds([
        project.baseline_completion_date,
        project.forecast_completion_date,
        effectiveDataDate,
        ...activities.flatMap((activity) => [
          activity.start_date,
          activity.finish_date,
          activity.baseline_start_date,
          activity.baseline_finish_date,
          activity.forecast_start_date,
          activity.forecast_finish_date,
          activity.actual_start_date,
          activity.actual_finish_date,
        ]),
        ...delayExtensionFinishDates,
      ]),
    [
      activities,
      delayExtensionFinishDates,
      effectiveDataDate,
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
    setDataDateDraft(latestDataDate ?? todayIsoDate());
  }, [latestDataDate]);

  const templateQuery = useQuery({
    queryKey: ["schedule-cpm-templates", project.id],
    queryFn: () => listTemplatesFn({ data: { projectId: project.id } }),
    staleTime: 30_000,
  });
  const templatePersistence = templateQuery.data?.persistence ?? "ready";
  const cpmTemplates = useMemo(
    () => [...(templateQuery.data?.templates ?? EMPTY_CPM_TEMPLATES), ...browserTemplates],
    [browserTemplates, templateQuery.data?.templates],
  );

  useEffect(() => {
    setBrowserTemplates(readBrowserCpmTemplates());
  }, []);

  useEffect(() => {
    if (!selectedTemplateId && cpmTemplates[0]?.id) setSelectedTemplateId(cpmTemplates[0].id);
  }, [cpmTemplates, selectedTemplateId]);

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

  useEffect(() => {
    if (
      didScrollToGridRef.current ||
      typeof window === "undefined" ||
      window.location.hash !== "#cpm-grid"
    ) {
      return;
    }
    const grid = document.getElementById("cpm-grid");
    if (!grid) return;
    didScrollToGridRef.current = true;
    window.requestAnimationFrame(() => {
      grid.scrollIntoView({ block: "start" });
    });
  }, [displayedCpmModel.tasks.length]);

  const addActivity = () => {
    const validationError = validateActivityDraft(draft, sortedActivities);
    if (validationError) {
      toast.error("Activity is not ready to save", {
        description: validationError,
      });
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
    onAddActivity({
      activity_id: draft.activity_id.trim() || undefined,
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
      remaining_duration_days: parseRemainingDuration(draft.remaining_duration_days),
      percent_complete: parsePercent(draft.percent_complete),
      predecessor_activity_ids: serializeActivityLinksToArray(draft.predecessor_activity_ids),
      successor_activity_ids: serializeActivityLinksToArray(draft.successor_activity_ids),
      notes: draft.notes.trim(),
    });
    setDraft(emptyActivityDraft());
    setShowDraft(false);
  };
  const openActivityDraft = () => {
    setDraft({
      ...emptyActivityDraft(),
      activity_id: getNextActivityId(sortedActivities),
      division: knownWbsDivisions[0] ?? "General",
    });
    setShowDraft(true);
  };
  const toggleActivityDraft = () => {
    if (showDraft) {
      setShowDraft(false);
      return;
    }
    openActivityDraft();
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
  const addWbsDivision = (divisionName: string, parentId: string | null = null) => {
    if (isWbsMigrationRequired) {
      showWbsMigrationPending();
      return;
    }
    const division = cleanWbsDivisionInput(divisionName);
    if (!division) return;
    const parentRow = parentId ? wbsDivisionRows.find((row) => row.id === parentId) : null;
    const nextPath = parentRow
      ? joinWbsPath([...splitWbsPath(parentRow.division), division])
      : division;
    if (hasWbsDivision(knownWbsDivisions, nextPath)) {
      toast.error("WBS already exists", {
        description: `${nextPath} is already in the schedule.`,
      });
      return;
    }
    setActivityOrder("wbs");
    void onAddWbsSection(division, parentId);
  };
  const renameWbsDivision = async (fromDivision: string, toDivision: string) => {
    if (isWbsMigrationRequired) {
      showWbsMigrationPending();
      return;
    }
    const nextDivision = cleanWbsDivisionInput(toDivision);
    if (!nextDivision || nextDivision === fromDivision) return;
    const row = wbsDivisionRows.find((item) => item.division === fromDivision);
    const nextPath = row?.parentPath
      ? joinWbsPath([...splitWbsPath(row.parentPath), nextDivision])
      : nextDivision;
    if (
      hasWbsDivision(
        knownWbsDivisions.filter((division) => division !== fromDivision),
        nextPath,
      )
    ) {
      toast.error("WBS already exists", {
        description: `${nextPath} is already in the schedule.`,
      });
      return;
    }
    if (!row?.id) return;
    await onRenameWbsSection(row.id, nextDivision);
  };
  const moveWbsDivisionParent = async (division: string, parentId: string | null) => {
    if (isWbsMigrationRequired) {
      showWbsMigrationPending();
      return;
    }
    const row = wbsDivisionRows.find((item) => item.division === division);
    const alreadyInTargetParent =
      (row?.parentId ?? null) === parentId && (!isWbsPathFallback || !row?.parentPath);
    if (!row?.id || alreadyInTargetParent) return;
    const parentRow = parentId ? wbsDivisionRows.find((item) => item.id === parentId) : null;
    const nextPath = parentRow
      ? joinWbsPath([...splitWbsPath(parentRow.division), row.title])
      : row.title;
    if (
      hasWbsDivision(
        knownWbsDivisions.filter((item) => item !== division),
        nextPath,
      )
    ) {
      toast.error("WBS already exists", {
        description: `${nextPath} is already in the schedule.`,
      });
      return;
    }
    setActivityOrder("wbs");
    await onMoveWbsSectionParent(row.id, parentId);
  };
  const moveWbsDivision = (division: string, direction: -1 | 1) => {
    if (isWbsMigrationRequired) {
      showWbsMigrationPending();
      return;
    }
    const orderedRows = moveWbsDivisionInOrder(wbsDivisionRows, division, direction);
    const orderedIds = orderedRows.map((row) => row.id).filter((id): id is string => Boolean(id));
    if (orderedIds.length > 0) {
      void onReorderWbsSections({
        parentId: orderedRows[0]?.parentId ?? null,
        orderedIds,
      });
    }
    setActivityOrder("wbs");
  };
  const reorderWbsDivisions = (orderedDivisions: string[]) => {
    if (isWbsMigrationRequired) {
      showWbsMigrationPending();
      return;
    }
    const orderedRows = orderedDivisions
      .map((division) => wbsDivisionRows.find((row) => row.division === division))
      .filter((row): row is WbsDivisionRow => Boolean(row?.id));
    const orderedIds = orderedRows.map((row) => row.id).filter((id): id is string => Boolean(id));
    if (orderedIds.length > 0) {
      void onReorderWbsSections({
        parentId: orderedRows[0]?.parentId ?? null,
        orderedIds,
      });
    }
    setActivityOrder("wbs");
  };
  const dataDateUpdate = useMutation({
    mutationFn: (nextDataDate: string) =>
      createUpdateFn({
        data: {
          projectId: project.id,
          forecast_completion_date:
            project.forecast_completion_date ||
            cpmModel.cpmFinishDate ||
            project.baseline_completion_date ||
            todayIsoDate(),
          data_date: nextDataDate,
          update_date: nextDataDate,
          schedule_money_exposure: 0,
          schedule_money_recovery: 0,
          money_notes: "No schedule dollars auto-calculated from CPM data-date save.",
          notes: `Data date set from the CPM schedule workbench. CPM finish: ${shortDate(
            cpmModel.cpmFinishDate,
          )}.`,
          milestone_forecasts: [],
        },
      }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["schedule", project.id] }),
        qc.invalidateQueries({ queryKey: ["project", project.id] }),
        qc.invalidateQueries({ queryKey: ["projects"] }),
      ]);
      toast.success("Data date saved", {
        description: "The CPM data-date snapshot was added to the schedule update history.",
      });
    },
    onError: (error) => {
      toast.error("Data date did not save", {
        description: error instanceof Error ? error.message : "Refresh and try again.",
      });
    },
  });
  const saveBrowserTemplate = () => {
    const template = buildBrowserCpmTemplate(
      project,
      templateName.trim() || `${project.name} CPM`,
      sortedActivities,
      wbsSections,
    );
    const nextTemplates = [
      template,
      ...browserTemplates.filter((item) => item.name !== template.name),
    ].slice(0, 25);
    writeBrowserCpmTemplates(nextTemplates);
    setBrowserTemplates(nextTemplates);
    setSelectedTemplateId(template.id);
    toast.success("CPM template saved", {
      description:
        "Template saved in this browser and available from the template picker on other projects opened here.",
    });
  };
  const templateSave = useMutation({
    mutationFn: () =>
      saveTemplateFn({
        data: {
          projectId: project.id,
          name: templateName.trim() || `${project.name} CPM`,
          description: `Saved from ${project.name} on ${shortDate(todayIsoDate())}.`,
        },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["schedule-cpm-templates", project.id] });
      toast.success("CPM template saved", {
        description: "This schedule can now be used on another project.",
      });
    },
    onError: (error) => {
      toast.error("CPM template did not save", {
        description: error instanceof Error ? error.message : "Refresh and try again.",
      });
    },
  });
  const templateImport = useMutation({
    mutationFn: (templateId: string) =>
      importTemplateFn({ data: { projectId: project.id, templateId } }),
    onSuccess: async (result) => {
      await qc.invalidateQueries({ queryKey: ["schedule", project.id] });
      toast.success("CPM template applied", {
        description: `${result.inserted} activities added${
          result.skipped ? `, ${result.skipped} duplicate IDs skipped` : ""
        }.`,
      });
    },
    onError: (error) => {
      toast.error("CPM template did not apply", {
        description: error instanceof Error ? error.message : "Refresh and try again.",
      });
    },
  });
  const applyBrowserTemplate = (template: BrowserCpmTemplate) => {
    const existingIds = new Set(sortedActivities.map((activity) => activity.activity_id));
    const rows = template.activities
      .filter((activity) => !activity.activity_id || !existingIds.has(activity.activity_id))
      .map((activity, index) => ({
        ...activity,
        percent_complete: 0,
        sort_order: sortedActivities.length + index + 1,
      }));
    if (rows.length === 0) {
      toast.info("Template already matches this schedule", {
        description: "No new activity IDs were available to add.",
      });
      return;
    }
    onSeedActivities(rows);
    toast.success("CPM template applied", {
      description: `${rows.length} browser template ${rows.length === 1 ? "activity" : "activities"} queued for this project.`,
    });
  };
  const saveCpmTemplate = () => {
    if (!templateName.trim()) return;
    if (templatePersistence === "migration_required") {
      saveBrowserTemplate();
      return;
    }
    templateSave.mutate();
  };
  const applySelectedCpmTemplate = () => {
    if (!selectedTemplateId) return;
    const browserTemplate = browserTemplates.find((template) => template.id === selectedTemplateId);
    if (browserTemplate) {
      applyBrowserTemplate(browserTemplate);
      return;
    }
    templateImport.mutate(selectedTemplateId);
  };
  const activityRiskCreate = useMutation({
    mutationFn: async (activity: ScheduleActivityRow) => {
      const linkedDelaySummary = buildDelayFragmentSummary(
        getDelayFragmentsForActivity(activity, groupDelayFragmentsByActivity(delayFragments)),
      );
      const scheduleImpactWeeks =
        linkedDelaySummary.openDays > 0
          ? Math.max(1, Math.ceil(linkedDelaySummary.openDays / 7))
          : null;
      return createActivityExposureFn({
        data: {
          projectId: project.id,
          title: `${activity.activity_id ? `${activity.activity_id} - ` : ""}${activity.name}`,
          description: buildActivityRiskDescription(activity, linkedDelaySummary),
          category: "schedule_compression",
          dollar_exposure: 0,
          probability: 100,
          schedule_impact_weeks: scheduleImpactWeeks,
          owner: project.project_manager || "",
          response_path: "recover",
          hold_class: "E-Hold",
          status: "active",
          due_date: activity.forecast_finish_date ?? activity.finish_date,
          next_review_at: effectiveDataDate ?? todayIsoDate(),
          release_condition: `Activity recovered or absorbed: ${activity.activity_id || activity.name}`,
          notes:
            "Created from the CPM activity detail. Price the exposure and set the response path in Risk Tally.",
        },
      });
    },
    onSuccess: async (_result, activity) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["project", project.id] }),
        qc.invalidateQueries({ queryKey: ["projects"] }),
      ]);
      toast.success("Activity sent to Risk Tally", {
        description: `${activity.activity_id || activity.name} is ready to price as a schedule risk.`,
      });
    },
    onError: (error) => {
      toast.error("Activity did not send to Risk Tally", {
        description: error instanceof Error ? error.message : "Refresh and try again.",
      });
    },
  });
  const completedActivities = sortedActivities.filter(
    (activity) => activity.percent_complete >= 100,
  ).length;
  const activitiesWithLogic = sortedActivities.filter(
    (activity) =>
      activity.predecessor_activity_ids.length > 0 || activity.successor_activity_ids.length > 0,
  ).length;
  const activitiesWithDates = sortedActivities.filter(
    (activity) =>
      activity.start_date ||
      activity.finish_date ||
      activity.baseline_start_date ||
      activity.baseline_finish_date ||
      activity.forecast_start_date ||
      activity.forecast_finish_date,
  ).length;
  const printedLogicTieCount = displayedCpmModel.tasks.reduce(
    (total, task) => total + task.predecessorKeys.length,
    0,
  );
  const isDataDateDirty = dataDateDraft !== (latestDataDate ?? "");
  const scheduleReportTitle = getScheduleReportTitle(scheduleView);
  const isCriticalPathReport = scheduleView === "critical";
  const printReportLabel = isCriticalPathReport ? "Critical Path Report" : scheduleReportTitle;
  const contractorName = project.organization_name || "Overwatch";
  const criticalBasisLabel = displayedCpmModel.criticalPathReliable
    ? "Critical basis valid"
    : "Critical basis provisional";
  const saveDataDate = () => {
    if (!dataDateDraft || dataDateUpdate.isPending || !isDataDateDirty) return;
    dataDateUpdate.mutate(dataDateDraft);
  };
  const confirmDeleteActivity = (activity: ScheduleActivityRow) => {
    const label = activity.activity_id
      ? `${activity.activity_id} - ${activity.name}`
      : activity.name;
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete ${label}? This also removes its logic ties from linked activities.`)
    ) {
      return;
    }
    if (selectedActivityId === activity.id) setSelectedActivityId(null);
    onDeleteActivity(activity.id);
  };

  return (
    <>
      <section className="constructline-cpm-print-shell" aria-label="Printable CPM schedule">
        <div className="constructline-cpm-print-titlebar">
          <div>
            {(project.organization_logo_url || project.organization_name) && (
              <div className="constructline-print-brand">
                {project.organization_logo_url && (
                  <img
                    src={project.organization_logo_url}
                    alt={`${project.organization_name} logo`}
                  />
                )}
                {project.organization_name && <span>{project.organization_name}</span>}
              </div>
            )}
            <div className="constructline-cpm-print-kicker">
              {contractorName} · ConstructLine CPM
            </div>
            <h1>
              {project.name} · {printReportLabel}
            </h1>
            <div className="constructline-cpm-print-meta">
              {project.job_number && <span>Job # {project.job_number}</span>}
              {project.client && <span>{project.client}</span>}
              {project.project_manager && <span>PM {project.project_manager}</span>}
              <span>Data date {effectiveDataDate ? shortDate(effectiveDataDate) : "not set"}</span>
              <span>
                {shortDate(displayedCpmModel.timelineStartDate)} to{" "}
                {shortDate(displayedCpmModel.timelineFinishDate)}
              </span>
              {showLogicLines && (
                <span>
                  {displayedCpmModel.tasks.length} activities · {printedLogicTieCount} logic ties
                  shown
                </span>
              )}
              {delaySummary.openCount > 0 && (
                <span>
                  {delaySummary.openCount} open delay impact
                  {delaySummary.openCount === 1 ? "" : "s"} · {delaySummary.openDays} days
                </span>
              )}
              <span>Optimized for 11 x 17 landscape</span>
              <span>{activityOrder === "start" ? "Start-date order" : "WBS order"}</span>
              <span>{scheduleViewSummary}</span>
            </div>
          </div>
          <div
            className={cn(
              "constructline-cpm-print-status",
              isCriticalPathReport && "constructline-cpm-print-status-critical",
            )}
          >
            <span>{isCriticalPathReport ? "Critical path report" : "Report type"}</span>
            <strong>{printReportLabel}</strong>
            <em>
              {criticalBasisLabel} · Finish {shortDate(displayedCpmModel.cpmFinishDate)}
            </em>
          </div>
        </div>
        <div className="constructline-cpm-print-report-strip">
          <span className="constructline-cpm-print-report-strip-company">
            <strong>Company</strong>
            {contractorName}
          </span>
          <span className="constructline-cpm-print-report-strip-report">
            <strong>Report</strong>
            {printReportLabel}
          </span>
          <span className="constructline-cpm-print-report-strip-basis">
            <strong>Critical basis</strong>
            {displayedCpmModel.criticalPathReliable ? "Valid" : "Provisional"}
          </span>
          <span>
            <strong>Finish</strong>
            {shortDate(displayedCpmModel.cpmFinishDate)}
          </span>
          <span>
            <strong>Data date</strong>
            {effectiveDataDate ? shortDate(effectiveDataDate) : "Not set"}
          </span>
          <span>
            <strong>Legend</strong>
            Critical red · near critical gold · complete green · milestone diamond · hatched delay
            period
          </span>
        </div>
        <ActivityScheduleMatrix
          model={displayedCpmModel}
          delayFragments={delayFragments}
          dayPx={CONSTRUCTLINE_FIT_DAY_PX}
          dataDate={effectiveDataDate}
          viewSummary={scheduleViewSummary}
          emptyTitle="No activities match this schedule view."
          emptyDescription="Switch back to All activities or choose a broader view."
          showLogicLines={showLogicLines}
          isPrintMode
          onOpenActivity={() => undefined}
          onDeleteActivity={() => undefined}
        />
        <footer className="constructline-cpm-print-footer">
          <span className="constructline-cpm-print-footer-primary">Company: {contractorName}</span>
          <span className="constructline-cpm-print-footer-report">
            {printReportLabel} · {criticalBasisLabel} · Finish{" "}
            {shortDate(displayedCpmModel.cpmFinishDate)}
          </span>
          <span>Critical path finish {shortDate(displayedCpmModel.cpmFinishDate)}</span>
          <span>Project finish {shortDate(displayedCpmModel.cpmFinishDate)}</span>
          <span>Data date {effectiveDataDate ? shortDate(effectiveDataDate) : "not set"}</span>
          <span>
            Legend: critical red · near critical gold · complete green · milestone diamond · hatched
            delay period
          </span>
        </footer>
      </section>
      <div
        className={cn(
          "constructline-screen-workbench rounded-lg border border-hairline bg-surface",
          isFullWorkspace ? "p-4 lg:p-5" : "p-5",
        )}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {isFullWorkspace ? "Schedule operations bench" : "ConstructLine beta"}
            </div>
            <h4 className="mt-1 font-serif text-2xl text-foreground">
              {isFullWorkspace ? "Construction schedule workspace" : "CPM schedule workbench"}
            </h4>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {isFullWorkspace
                ? "Work the CPM grid first, then use the panels below for schedule intelligence, updates, milestones, delayed decisions, procurement, and trade performance risks."
                : "Build the working job schedule with activity IDs, divisions, start/finish dates, progress, predecessor/successor logic, float, critical path, and activity stacking."}
            </p>
          </div>
        </div>

        {isWbsMigrationRequired && (
          <div className="mt-4 rounded-md border border-warning/25 bg-warning/10 px-4 py-3 text-sm text-warning">
            This project is using activity WBS paths for grouping. Schedule sections remain visible,
            and activity-level WBS edits still control where each row appears.
          </div>
        )}

        {isWbsPathFallback && (
          <div className="mt-4 rounded-md border border-hairline bg-card px-4 py-3 text-sm text-muted-foreground">
            Activity-path WBS mode is active. Parent and child areas save as readable paths such as
            Concrete / Northwest corner, so the CPM grid can group location, room, area, trade, or
            subcontractor sequences.
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
              <LabeledField label="WBS / area">
                <ActivityDivisionInput
                  value={draft.division}
                  onChange={(division) => setDraft({ ...draft, division })}
                  options={knownWbsDivisions}
                  listId="new-activity-wbs-divisions"
                />
              </LabeledField>
              <LabeledField label="Baseline start">
                <Input
                  type="date"
                  value={draft.baseline_start_date}
                  onChange={(e) => setDraft(updateDraftBaselineStartDate(draft, e.target.value))}
                  className="h-10"
                />
              </LabeledField>
              <LabeledField label="Baseline finish">
                <Input
                  type="date"
                  value={draft.baseline_finish_date}
                  onChange={(e) => setDraft(updateDraftBaselineFinishDate(draft, e.target.value))}
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
          matrixId="cpm-grid"
          model={displayedCpmModel}
          delayFragments={delayFragments}
          toolbar={
            <CpmGridToolbar
              scheduleView={scheduleView}
              onScheduleViewChange={setScheduleView}
              activityOrder={activityOrder}
              onActivityOrderChange={setActivityOrder}
              dayPx={dayPx}
              onZoomChange={setDayPx}
              showLogicLines={showLogicLines}
              onToggleLogicLines={() => setShowLogicLines((visible) => !visible)}
              onManageWbs={() => setIsWbsManagerOpen(true)}
              onExpand={() => setIsFocusOpen(true)}
              onSeedActivities={() => onSeedActivities(milestoneSeedRows)}
              canSeedActivities={milestoneSeedRows.length > 0}
              isSeedingActivities={isSeedingActivities}
              onPrint={() => typeof window !== "undefined" && window.print()}
              onToggleActivityDraft={toggleActivityDraft}
              isActivityDraftOpen={showDraft}
              onAddMilestone={openMilestoneDraft}
              dataDateDraft={dataDateDraft}
              latestDataDate={latestDataDate}
              isSavingDataDate={dataDateUpdate.isPending}
              onDataDateChange={setDataDateDraft}
              onSaveDataDate={saveDataDate}
              templateName={templateName}
              onTemplateNameChange={setTemplateName}
              templates={cpmTemplates}
              selectedTemplateId={selectedTemplateId}
              onSelectedTemplateChange={setSelectedTemplateId}
              templatePersistence={templatePersistence}
              isTemplateLoading={templateQuery.isLoading}
              isSavingTemplate={templateSave.isPending}
              isApplyingTemplate={templateImport.isPending || isSeedingActivities}
              onSaveTemplate={saveCpmTemplate}
              onApplyTemplate={applySelectedCpmTemplate}
            />
          }
          viewSummary={scheduleViewSummary}
          emptyTitle={
            scheduleView === "all"
              ? "No CPM activities yet."
              : "No activities match this schedule view."
          }
          emptyDescription={
            scheduleView === "all"
              ? "Add the first activity to start building the working schedule."
              : "Switch back to All activities or choose a broader view."
          }
          dayPx={dayPx}
          dataDate={effectiveDataDate}
          showLogicLines={showLogicLines}
          onOpenActivity={(activity) => setSelectedActivityId(activity.id)}
          onDeleteActivity={(id) => {
            const activity = sortedActivities.find((item) => item.id === id);
            if (activity) confirmDeleteActivity(activity);
          }}
        />

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
            {delaySummary.openCount > 0 && (
              <div className="mt-3 rounded border border-danger/20 bg-danger/10 px-3 py-2 text-xs text-danger">
                Delay ledger has {delaySummary.openCount} open fragment
                {delaySummary.openCount === 1 ? "" : "s"} totaling {delaySummary.openDays} days.
                {delaySummary.driverLabels.length > 0
                  ? ` Drivers: ${delaySummary.driverLabels.join(", ")}.`
                  : ""}
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

        <ScheduleQualityQueue
          items={qualityQueueItems}
          onShowIssues={() => setScheduleView("issues")}
          onOpenActivity={(activity) => setSelectedActivityId(activity.id)}
        />

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
              <CpmDataDateControl
                value={dataDateDraft}
                savedValue={latestDataDate}
                isSaving={dataDateUpdate.isPending}
                onChange={setDataDateDraft}
                onSave={saveDataDate}
                className="min-w-[300px]"
              />
              <ScheduleViewControls value={scheduleView} onChange={setScheduleView} />
              <ScheduleOrderControls value={activityOrder} onChange={setActivityOrder} />
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={() => setIsWbsManagerOpen(true)}
              >
                <ListTree className="h-4 w-4" />
                WBS / areas
              </Button>
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
            model={displayedCpmModel}
            delayFragments={delayFragments}
            dayPx={dayPx}
            dataDate={effectiveDataDate}
            viewSummary={scheduleViewSummary}
            emptyTitle={
              scheduleView === "all"
                ? "No CPM activities yet."
                : "No activities match this schedule view."
            }
            emptyDescription={
              scheduleView === "all"
                ? "Add the first activity to start building the working schedule."
                : "Switch back to All activities or choose a broader view."
            }
            showLogicLines={showLogicLines}
            isFocusMode
            onOpenActivity={(activity) => setSelectedActivityId(activity.id)}
            onDeleteActivity={(id) => {
              const activity = sortedActivities.find((item) => item.id === id);
              if (activity) confirmDeleteActivity(activity);
            }}
          />
        </div>
      )}

      {selectedActivity && (
        <ActivityDetailDialog
          activity={selectedActivity}
          activities={sortedActivities}
          dataDate={effectiveDataDate}
          isSaving={isSavingActivity}
          onClose={() => setSelectedActivityId(null)}
          onSave={(patch) => onPatchActivity(selectedActivity.id, patch)}
          onDelete={() => confirmDeleteActivity(selectedActivity)}
          divisionOptions={knownWbsDivisions}
          delayFragments={delayFragments}
          delayFragmentPersistence={delayFragmentPersistence}
          isSavingDelayFragment={isSavingDelayFragment}
          onAddDelayFragment={onAddDelayFragment}
          onPatchDelayFragment={onPatchDelayFragment}
          onDeleteDelayFragment={onDeleteDelayFragment}
          isSendingToRiskTally={activityRiskCreate.isPending}
          onSendToRiskTally={(activity) => activityRiskCreate.mutateAsync(activity)}
        />
      )}

      <WbsManagerDialog
        open={isWbsManagerOpen}
        divisions={wbsDivisionRows}
        isSaving={isSavingWbs}
        onOpenChange={setIsWbsManagerOpen}
        onAddDivision={addWbsDivision}
        onRenameDivision={renameWbsDivision}
        onMoveDivisionParent={moveWbsDivisionParent}
        onMoveDivision={moveWbsDivision}
        onReorderDivisions={reorderWbsDivisions}
        isSavingOrder={isSavingWbsOrder}
        isPersistenceReady={!isWbsMigrationRequired}
        isPathFallback={isWbsPathFallback}
      />
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

function ScheduleQualityQueue({
  items,
  onShowIssues,
  onOpenActivity,
}: {
  items: ScheduleQualityQueueItem[];
  onShowIssues: () => void;
  onOpenActivity: (activity: ScheduleActivityRow) => void;
}) {
  const visibleItems = items.slice(0, 6);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);

  return (
    <div className="mt-4 rounded-md border border-hairline bg-card p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5" />
            Schedule quality queue
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            Rows that need cleanup before the CPM path should be trusted.
          </div>
        </div>
        <Button type="button" variant="outline" className="h-9 gap-2" onClick={onShowIssues}>
          <AlertTriangle className="h-4 w-4" />
          Show issue rows
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="mt-3 rounded border border-success/25 bg-success/10 px-3 py-2 text-sm text-success">
          No blocking schedule quality items detected.
        </div>
      ) : (
        <div className="mt-3 grid gap-2 xl:grid-cols-2">
          {visibleItems.map((item) => (
            <div
              key={item.task.activity.id}
              className={cn(
                "grid min-w-0 gap-3 rounded border px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
                item.severity === "danger"
                  ? "border-danger/20 bg-danger/10"
                  : "border-warning/25 bg-warning/10",
              )}
            >
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-semibold tabular text-foreground">
                    {item.task.dependencyKey}
                  </span>
                  <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                    {item.task.activity.name}
                  </span>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
                      item.severity === "danger"
                        ? "bg-danger/15 text-danger"
                        : "bg-warning/15 text-warning",
                    )}
                  >
                    {item.reasons[0]}
                  </span>
                </div>
                <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {item.guidance}
                </div>
                {item.reasons.length > 1 && (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Also: {item.reasons.slice(1).join(", ")}
                  </div>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-8 justify-self-start px-3 text-xs sm:justify-self-end"
                onClick={() => onOpenActivity(item.task.activity)}
              >
                Open
              </Button>
            </div>
          ))}
          {hiddenCount > 0 && (
            <div className="rounded border border-hairline bg-surface px-3 py-2 text-sm text-muted-foreground">
              {hiddenCount} more {hiddenCount === 1 ? "item" : "items"} in the issue view.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CpmGridToolbar({
  scheduleView,
  onScheduleViewChange,
  activityOrder,
  onActivityOrderChange,
  dayPx,
  onZoomChange,
  showLogicLines,
  onToggleLogicLines,
  onManageWbs,
  onExpand,
  onSeedActivities,
  canSeedActivities,
  isSeedingActivities,
  onPrint,
  onToggleActivityDraft,
  isActivityDraftOpen,
  onAddMilestone,
  dataDateDraft,
  latestDataDate,
  isSavingDataDate,
  onDataDateChange,
  onSaveDataDate,
  templateName,
  onTemplateNameChange,
  templates,
  selectedTemplateId,
  onSelectedTemplateChange,
  templatePersistence,
  isTemplateLoading,
  isSavingTemplate,
  isApplyingTemplate,
  onSaveTemplate,
  onApplyTemplate,
}: {
  scheduleView: ScheduleGridView;
  onScheduleViewChange: (value: ScheduleGridView) => void;
  activityOrder: ScheduleActivityOrder;
  onActivityOrderChange: (value: ScheduleActivityOrder) => void;
  dayPx: (typeof CONSTRUCTLINE_ZOOM_LEVELS)[number]["dayPx"];
  onZoomChange: (dayPx: (typeof CONSTRUCTLINE_ZOOM_LEVELS)[number]["dayPx"]) => void;
  showLogicLines: boolean;
  onToggleLogicLines: () => void;
  onManageWbs: () => void;
  onExpand: () => void;
  onSeedActivities: () => void;
  canSeedActivities: boolean;
  isSeedingActivities: boolean;
  onPrint: () => void;
  onToggleActivityDraft: () => void;
  isActivityDraftOpen: boolean;
  onAddMilestone: () => void;
  dataDateDraft: string;
  latestDataDate: string | null;
  isSavingDataDate: boolean;
  onDataDateChange: (value: string) => void;
  onSaveDataDate: () => void;
  templateName: string;
  onTemplateNameChange: (value: string) => void;
  templates: Array<ScheduleCpmTemplateRow | BrowserCpmTemplate>;
  selectedTemplateId: string;
  onSelectedTemplateChange: (value: string) => void;
  templatePersistence: "ready" | "migration_required";
  isTemplateLoading: boolean;
  isSavingTemplate: boolean;
  isApplyingTemplate: boolean;
  onSaveTemplate: () => void;
  onApplyTemplate: () => void;
}) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-3">
      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(300px,0.9fr)_minmax(0,1.7fr)_minmax(280px,0.9fr)]">
        <CpmToolbarGroup label="Schedule snapshot">
          <CpmDataDateControl
            value={dataDateDraft}
            savedValue={latestDataDate}
            isSaving={isSavingDataDate}
            onChange={onDataDateChange}
            onSave={onSaveDataDate}
            className="w-full"
            embedded
          />
        </CpmToolbarGroup>
        <CpmToolbarGroup label="View filters">
          <ScheduleViewControls value={scheduleView} onChange={onScheduleViewChange} />
        </CpmToolbarGroup>
        <CpmToolbarGroup label="Sort and WBS">
          <ScheduleOrderControls value={activityOrder} onChange={onActivityOrderChange} />
          <Button
            type="button"
            variant="outline"
            className="h-9 gap-2 whitespace-nowrap"
            onClick={onManageWbs}
          >
            <ListTree className="h-4 w-4" />
            WBS / areas
          </Button>
        </CpmToolbarGroup>
      </div>

      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(540px,1.15fr)]">
        <CpmToolbarGroup label="Scale and logic">
          <ScheduleZoomControls dayPx={dayPx} onChange={onZoomChange} />
          <Button
            type="button"
            variant={showLogicLines ? "default" : "outline"}
            className="h-9 gap-2 whitespace-nowrap"
            aria-pressed={showLogicLines}
            onClick={onToggleLogicLines}
          >
            <GitBranch className="h-4 w-4" />
            Logic lines
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-9 gap-2 whitespace-nowrap"
            onClick={onExpand}
          >
            <Maximize2 className="h-4 w-4" />
            Expand
          </Button>
        </CpmToolbarGroup>
        <CpmToolbarGroup label="Schedule actions">
          <Button
            type="button"
            variant="outline"
            className="h-9 gap-2 whitespace-nowrap"
            disabled={!canSeedActivities || isSeedingActivities}
            onClick={onSeedActivities}
          >
            <ClipboardList className="h-4 w-4" />
            {isSeedingActivities ? "Building..." : "Build from milestones"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-9 gap-2 whitespace-nowrap"
            title="Print optimized for Tabloid / 11 x 17 landscape"
            onClick={onPrint}
          >
            <Printer className="h-4 w-4" />
            Print 11x17
          </Button>
          <Button
            type="button"
            className="h-9 gap-2 whitespace-nowrap"
            onClick={onToggleActivityDraft}
          >
            <Plus className="h-4 w-4" />
            {isActivityDraftOpen ? "Close form" : "Add activity"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-9 gap-2 whitespace-nowrap"
            onClick={onAddMilestone}
          >
            <Diamond className="h-4 w-4" />
            Add milestone
          </Button>
        </CpmToolbarGroup>
      </div>

      <CpmToolbarGroup label="Templates">
        <Input
          value={templateName}
          onChange={(event) => onTemplateNameChange(event.target.value)}
          className="h-9 w-[min(100%,280px)] min-w-[220px] bg-card"
          placeholder="Template name"
          disabled={isSavingTemplate}
        />
        <Button
          type="button"
          variant="outline"
          className="h-9 gap-2 whitespace-nowrap"
          disabled={!templateName.trim() || isSavingTemplate}
          onClick={onSaveTemplate}
        >
          <ClipboardList className="h-4 w-4" />
          {isSavingTemplate ? "Saving..." : "Save current CPM as template"}
        </Button>
        <Select
          value={selectedTemplateId}
          onValueChange={onSelectedTemplateChange}
          disabled={isTemplateLoading || templates.length === 0 || isApplyingTemplate}
        >
          <SelectTrigger className="h-9 w-[min(100%,260px)] min-w-[220px] bg-card">
            <SelectValue
              placeholder={isTemplateLoading ? "Loading templates" : "Choose template"}
            />
          </SelectTrigger>
          <SelectContent>
            {templates.map((template) => (
              <SelectItem key={template.id} value={template.id}>
                {template.name} · {template.activity_count} activities
                {"source" in template ? " · browser" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          className="h-9 gap-2 whitespace-nowrap"
          disabled={!selectedTemplateId || isApplyingTemplate || templates.length === 0}
          onClick={onApplyTemplate}
        >
          <Plus className="h-4 w-4" />
          {isApplyingTemplate ? "Applying..." : "Use template"}
        </Button>
        {templatePersistence === "migration_required" && (
          <span className="text-xs text-muted-foreground">
            Private browser templates are active. Templates saved here stay in this browser and can
            be reused on other projects opened here.
          </span>
        )}
      </CpmToolbarGroup>
    </div>
  );
}

function CpmToolbarGroup({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-md border border-hairline bg-surface/70 px-3 py-2.5",
        className,
      )}
    >
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function CpmDataDateControl({
  value,
  savedValue,
  isSaving,
  onChange,
  onSave,
  className,
  embedded = false,
}: {
  value: string;
  savedValue: string | null;
  isSaving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  className?: string;
  embedded?: boolean;
}) {
  const isDirty = value !== (savedValue ?? "");
  return (
    <div
      className={cn(
        "flex min-h-9 flex-wrap items-center gap-2",
        !embedded && "rounded-md border border-hairline bg-card px-2 py-1",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <CalendarDays className="h-3.5 w-3.5" />
        Data date
      </div>
      <Input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-[148px] bg-surface px-2 text-xs tabular"
        aria-label="Schedule data date"
      />
      <Button
        type="button"
        size="sm"
        variant={isDirty ? "default" : "outline"}
        className="h-8 gap-1.5 px-2.5"
        disabled={!value || isSaving || !isDirty}
        onClick={onSave}
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        {isSaving ? "Saving..." : "Save"}
      </Button>
      <div className="basis-full text-[11px] text-muted-foreground sm:basis-auto">
        {isDirty
          ? "Unsaved date is driving this CPM view."
          : savedValue
            ? `Saved ${shortDate(savedValue)}`
            : "Not set"}
      </div>
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

function ScheduleViewControls({
  value,
  onChange,
}: {
  value: ScheduleGridView;
  onChange: (value: ScheduleGridView) => void;
}) {
  return (
    <div className="flex max-w-full overflow-x-auto rounded-md border border-hairline bg-card">
      {SCHEDULE_GRID_VIEW_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          className={cn(
            "h-9 whitespace-nowrap border-r border-hairline px-3 text-xs font-semibold text-muted-foreground last:border-r-0 hover:bg-muted/60",
            value === option.value && "bg-foreground text-background hover:bg-foreground",
          )}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ScheduleOrderControls({
  value,
  onChange,
}: {
  value: ScheduleActivityOrder;
  onChange: (value: ScheduleActivityOrder) => void;
}) {
  const options: Array<{
    value: ScheduleActivityOrder;
    label: string;
    icon: typeof CalendarDays;
  }> = [
    { value: "start", label: "Start date", icon: CalendarDays },
    { value: "wbs", label: "WBS order", icon: ListTree },
  ];

  return (
    <div className="flex overflow-hidden rounded-md border border-hairline bg-card">
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            className={cn(
              "h-9 border-r border-hairline px-3 text-xs font-semibold text-muted-foreground last:border-r-0 hover:bg-muted/60",
              value === option.value && "bg-foreground text-background hover:bg-foreground",
            )}
            onClick={() => onChange(option.value)}
          >
            <span className="inline-flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5" />
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function WbsManagerDialog({
  open,
  divisions,
  isSaving,
  isSavingOrder,
  onOpenChange,
  onAddDivision,
  onRenameDivision,
  onMoveDivisionParent,
  onMoveDivision,
  onReorderDivisions,
  isPersistenceReady,
  isPathFallback,
}: {
  open: boolean;
  divisions: WbsDivisionRow[];
  isSaving: boolean;
  isSavingOrder: boolean;
  isPersistenceReady: boolean;
  isPathFallback: boolean;
  onOpenChange: (open: boolean) => void;
  onAddDivision: (division: string, parentId?: string | null) => void;
  onRenameDivision: (fromDivision: string, toDivision: string) => Promise<void>;
  onMoveDivisionParent: (division: string, parentId: string | null) => Promise<void>;
  onMoveDivision: (division: string, direction: -1 | 1) => void;
  onReorderDivisions: (orderedDivisions: string[]) => void;
}) {
  const [newDivision, setNewDivision] = useState("");
  const [newDivisionParentId, setNewDivisionParentId] = useState<string>("root");
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [savingDivision, setSavingDivision] = useState<string | null>(null);
  const [movingParentDivision, setMovingParentDivision] = useState<string | null>(null);
  const [draggingDivision, setDraggingDivision] = useState<string | null>(null);
  const [dropTargetDivision, setDropTargetDivision] = useState<string | null>(null);
  const [dropParentTargetId, setDropParentTargetId] = useState<string | null>(null);
  const newDivisionInputRef = useRef<HTMLInputElement | null>(null);
  const wasOpenRef = useRef(false);
  const isLocked = !isPersistenceReady;
  const selectedParentRow =
    newDivisionParentId === "root"
      ? null
      : (divisions.find((row) => row.id === newDivisionParentId) ?? null);
  const parentDivisionCount = divisions.filter((row) => row.level === 0).length;
  const childDivisionCount = divisions.filter((row) => row.level > 0).length;

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    setDraftNames((current) =>
      Object.fromEntries(
        divisions.map((row) => [row.division, current[row.division] ?? row.title]),
      ),
    );
    if (!wasOpenRef.current) {
      setNewDivisionParentId("root");
      setSavingDivision(null);
      setMovingParentDivision(null);
      setDraggingDivision(null);
      setDropTargetDivision(null);
      setDropParentTargetId(null);
      wasOpenRef.current = true;
    }
  }, [divisions, open]);

  const addDivision = () => {
    if (isLocked) return;
    const division = cleanWbsDivisionInput(newDivision);
    if (!division) return;
    onAddDivision(division, newDivisionParentId === "root" ? null : newDivisionParentId);
    setNewDivision("");
  };
  const startChildDivision = (row: WbsDivisionRow) => {
    if (!row.id || isLocked) return;
    setNewDivisionParentId(row.id);
    setNewDivision("");
    window.requestAnimationFrame(() => newDivisionInputRef.current?.focus());
  };

  const renameDivision = async (division: string) => {
    if (isLocked) return;
    const nextDivision = cleanWbsDivisionInput(draftNames[division]);
    if (!nextDivision || nextDivision === division) return;
    setSavingDivision(division);
    try {
      await onRenameDivision(division, nextDivision);
    } finally {
      setSavingDivision(null);
    }
  };
  const moveDivisionParent = async (division: string, parentId: string | null) => {
    if (isLocked) return;
    setMovingParentDivision(division);
    try {
      await onMoveDivisionParent(division, parentId);
    } finally {
      setMovingParentDivision(null);
    }
  };
  const reorderDivision = (targetDivision: string) => {
    if (isLocked || !draggingDivision || draggingDivision === targetDivision) return;
    const draggingRow = divisions.find((row) => row.division === draggingDivision);
    const targetRow = divisions.find((row) => row.division === targetDivision);
    if (!draggingRow?.id || !targetRow?.id || !isSameWbsParent(draggingRow, targetRow)) return;
    const orderedDivisions = getWbsSiblingRows(divisions, draggingRow).map((row) => row.division);
    const fromIndex = orderedDivisions.indexOf(draggingDivision);
    const toIndex = orderedDivisions.indexOf(targetDivision);
    if (fromIndex < 0 || toIndex < 0) return;
    const nextOrder = [...orderedDivisions];
    const [movedDivision] = nextOrder.splice(fromIndex, 1);
    if (!movedDivision) return;
    nextOrder.splice(toIndex, 0, movedDivision);
    onReorderDivisions(nextOrder);
  };
  const canDropIntoParent = (parentId: string | null) => {
    const draggingRow = divisions.find((row) => row.division === draggingDivision);
    if (!draggingRow?.id || (draggingRow.parentId ?? null) === parentId) return false;
    const parentRow = parentId ? divisions.find((row) => row.id === parentId) : null;
    if (parentId && !parentRow?.id) return false;
    if (parentRow && isWbsDescendantPath(parentRow, draggingRow)) return false;
    return true;
  };
  const moveDraggingDivisionToParent = async (parentId: string | null) => {
    const draggingRow = divisions.find((row) => row.division === draggingDivision);
    if (!draggingRow?.id || !canDropIntoParent(parentId)) {
      resetDragState();
      return;
    }
    await moveDivisionParent(draggingRow.division, parentId);
    resetDragState();
  };
  const resetDragState = () => {
    setDraggingDivision(null);
    setDropTargetDivision(null);
    setDropParentTargetId(null);
  };
  const renderParentDropZone = (
    parentId: string | null,
    title: string,
    description: string,
    depth = 0,
  ) => {
    const dropKey = parentId ?? "root";
    const isActive = dropParentTargetId === dropKey && canDropIntoParent(parentId);
    const canDrop = Boolean(draggingDivision) && canDropIntoParent(parentId);
    return (
      <div
        className={cn(
          "rounded-md border border-dashed border-hairline bg-surface/60 px-3 py-2 text-xs text-muted-foreground transition",
          canDrop && "border-accent/50 bg-accent/10 text-foreground",
          isActive && "border-foreground/50 bg-muted text-foreground shadow-sm",
        )}
        style={{ marginLeft: `${Math.min(depth, 4) * 18}px` }}
        onDragOver={(event) => {
          if (!canDropIntoParent(parentId) || isSaving || isLocked) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          setDropParentTargetId(dropKey);
        }}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget as Node | null;
          if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
            setDropParentTargetId((current) => (current === dropKey ? null : current));
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void moveDraggingDivisionToParent(parentId);
        }}
      >
        <div className="flex min-w-0 items-start gap-2">
          <ListTree className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0">
            <div className="font-semibold text-foreground">{title}</div>
            <div className="mt-0.5 leading-4">{description}</div>
          </div>
        </div>
      </div>
    );
  };
  const renderChildDropTarget = (row: WbsDivisionRow) => {
    if (
      !row.id ||
      !draggingDivision ||
      draggingDivision === row.division ||
      !canDropIntoParent(row.id)
    ) {
      return null;
    }
    const isActive = dropParentTargetId === row.id;
    return (
      <div
        className={cn(
          "rounded border border-dashed border-accent/40 bg-accent/10 px-3 py-2 text-xs font-semibold text-foreground transition",
          isActive && "border-foreground/50 bg-card shadow-sm",
        )}
        onDragOver={(event) => {
          if (isSaving || isLocked || !canDropIntoParent(row.id)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          setDropTargetDivision(null);
          setDropParentTargetId(row.id);
        }}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget as Node | null;
          if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
            setDropParentTargetId((current) => (current === row.id ? null : current));
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void moveDraggingDivisionToParent(row.id);
        }}
      >
        Nest under {row.title}
      </div>
    );
  };
  const getChildRowsForRender = (parentId: string | null, parentPath: string | null = null) => {
    if (parentId) return getWbsChildRows(divisions, parentId);
    if (parentPath) {
      return divisions.filter((row) => !row.parentId && row.parentPath === parentPath);
    }
    return getWbsChildRows(divisions, null);
  };
  const renderDivisionRows = (
    parentId: string | null,
    depth = 0,
    parentPath: string | null = null,
  ): ReactNode => {
    const childRows = getChildRowsForRender(parentId, parentPath);
    if (childRows.length === 0) {
      if (parentId === null) return null;
      return (
        <div
          className="rounded-md border border-dashed border-hairline bg-surface/35 px-3 py-2 text-xs text-muted-foreground"
          style={{ marginLeft: `${Math.min(depth, 4) * 18}px` }}
        >
          No child areas yet. Add one above or drag another WBS onto this parent.
        </div>
      );
    }

    return childRows.map((row) => {
      const draftName = draftNames[row.division] ?? row.title;
      const cleanDraftName = cleanWbsDivisionInput(draftName);
      const hasNameChange =
        normalizeWbsDivisionName(draftName) !== normalizeWbsDivisionName(row.title);
      const isRowSaving =
        savingDivision === row.division || movingParentDivision === row.division || isSaving;
      const canPersistRow = Boolean(row.id);
      const siblingPosition = getWbsSiblingPosition(divisions, row);
      const canMoveUp = canPersistRow && siblingPosition.index > 0;
      const canMoveDown =
        canPersistRow &&
        siblingPosition.index >= 0 &&
        siblingPosition.index < siblingPosition.count - 1;
      const parentOptions = getValidWbsParentRows(divisions, row);
      const childRowsForRow = getChildRowsForRender(row.id ?? null, row.division);
      const hasChildren = childRowsForRow.length > 0;
      const selectedParentId =
        row.parentId ??
        (row.parentPath
          ? (divisions.find((candidate) => candidate.division === row.parentPath)?.id ?? null)
          : null);

      return (
        <div key={row.division} className="grid gap-2">
          <div
            className={cn(
              "grid min-w-0 gap-3 rounded-md border border-hairline bg-card p-3 transition xl:grid-cols-[40px_minmax(260px,1fr)_minmax(220px,0.82fr)_minmax(150px,0.56fr)]",
              row.level > 0 && "border-l-4 border-l-accent/45",
              selectedParentRow?.id === row.id && "border-foreground/40 bg-muted/30",
              draggingDivision === row.division && "opacity-55",
              dropTargetDivision === row.division &&
                draggingDivision !== row.division &&
                "border-foreground/35 bg-muted/40 shadow-sm",
              dropParentTargetId === row.id &&
                draggingDivision !== row.division &&
                "border-accent/60 bg-accent/10 shadow-sm",
            )}
            style={{ marginLeft: `${Math.min(depth, 4) * 18}px` }}
            onDragOver={(event) => {
              if (
                !draggingDivision ||
                draggingDivision === row.division ||
                isSaving ||
                isLocked ||
                !canPersistRow
              )
                return;
              const draggingRow = divisions.find((item) => item.division === draggingDivision);
              if (!draggingRow?.id) return;
              if (!isSameWbsParent(draggingRow, row)) {
                if (!row.id || !canDropIntoParent(row.id)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTargetDivision(null);
                setDropParentTargetId(row.id);
                return;
              }
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropTargetDivision(row.division);
              setDropParentTargetId(null);
            }}
            onDragLeave={(event) => {
              const nextTarget = event.relatedTarget as Node | null;
              if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
                setDropTargetDivision((current) => (current === row.division ? null : current));
                setDropParentTargetId((current) => (current === row.id ? null : current));
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              const draggingRow = divisions.find((item) => item.division === draggingDivision);
              if (!canPersistRow || !draggingRow?.id) {
                resetDragState();
                return;
              }
              if (!isSameWbsParent(draggingRow, row)) {
                if (row.id && canDropIntoParent(row.id)) {
                  void moveDraggingDivisionToParent(row.id);
                  return;
                }
                resetDragState();
                return;
              }
              reorderDivision(row.division);
              resetDragState();
            }}
          >
            <button
              type="button"
              draggable={!isSaving && !isLocked && canPersistRow}
              className="flex h-9 w-9 cursor-grab items-center justify-center rounded border border-hairline bg-surface text-muted-foreground transition hover:bg-muted hover:text-foreground active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50 xl:self-center"
              aria-label={`Drag ${row.division} to reorder WBS`}
              title="Drag onto another row to reorder. Use the Nest target to make it a child area."
              disabled={isSaving || isLocked || !canPersistRow}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", row.division);
                setDraggingDivision(row.division);
                setDropTargetDivision(null);
                setDropParentTargetId(null);
              }}
              onDragEnd={resetDragState}
            >
              <GripVertical className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                <span>{row.level > 0 ? "Child WBS / area" : "Parent WBS"}</span>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                  Level {row.level + 1}
                </span>
              </div>
              <Input
                value={draftName}
                onChange={(event) =>
                  setDraftNames((current) => ({
                    ...current,
                    [row.division]: event.target.value,
                  }))
                }
                className="h-9 min-w-0"
                disabled={isRowSaving || isLocked}
              />
              <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
                {row.parentPath ? `Path: ${row.division}` : "Top-level schedule WBS"}
              </div>
            </div>
            <LabeledField label="Parent WBS">
              <Select
                value={selectedParentId ?? "root"}
                disabled={!canPersistRow || isRowSaving || isLocked}
                onValueChange={(value) => {
                  void moveDivisionParent(row.division, value === "root" ? null : value);
                }}
              >
                <SelectTrigger className="h-9 min-w-0 bg-surface">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="root">Top level WBS</SelectItem>
                  {parentOptions.map((parentRow) => (
                    <SelectItem key={parentRow.id!} value={parentRow.id!}>
                      {formatIndentedWbsLabel(parentRow)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </LabeledField>
            <div className="min-w-0 rounded border border-hairline bg-surface px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Activities
              </div>
              <div className="mt-1 text-sm font-semibold tabular text-foreground">
                {row.activityCount}
              </div>
              <div className="text-[11px] leading-4 text-muted-foreground">
                {row.childCount > 0
                  ? `${row.directActivityCount} direct · ${row.childCount} child ${
                      row.childCount === 1 ? "area" : "areas"
                    }`
                  : !row.isPersisted
                    ? "derived from activities"
                    : row.isPlaceholder
                      ? "empty"
                      : `${shortDate(row.firstStart)} to ${shortDate(row.lastFinish)}`}
              </div>
            </div>
            <div className="grid min-w-0 gap-2 xl:col-span-3 xl:col-start-2">
              {renderChildDropTarget(row)}
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 whitespace-nowrap"
                  disabled={!canPersistRow || isSaving || isLocked}
                  onClick={() => startChildDivision(row)}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add child area
                </Button>
                <Button
                  type="button"
                  variant={selectedParentRow?.id === row.id ? "default" : "outline"}
                  className="h-9 whitespace-nowrap"
                  disabled={!canPersistRow || isSaving || isLocked}
                  onClick={() => setNewDivisionParentId(row.id ?? "root")}
                >
                  Use as parent
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 whitespace-nowrap"
                  disabled={
                    !canPersistRow || !cleanDraftName || !hasNameChange || isRowSaving || isLocked
                  }
                  onClick={() => renameDivision(row.division)}
                >
                  {savingDivision === row.division ? "Saving..." : "Save title"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  disabled={!canMoveUp || isSaving || isLocked}
                  onClick={() => onMoveDivision(row.division, -1)}
                  aria-label={`Move ${row.division} up`}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  disabled={!canMoveDown || isSaving || isLocked}
                  onClick={() => onMoveDivision(row.division, 1)}
                  aria-label={`Move ${row.division} down`}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {hasChildren && (
            <div className="grid gap-2 border-l border-hairline/70 pl-3">
              {renderDivisionRows(row.id ?? null, depth + 1, row.division)}
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isSaving && onOpenChange(nextOpen)}>
      <DialogContent className="flex max-h-[88vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:w-[min(calc(100vw-2rem),72rem)] sm:max-w-[72rem]">
        <DialogHeader className="border-b border-hairline px-4 py-4 pr-12 sm:px-6">
          <DialogTitle className="font-serif text-2xl">WBS / area manager</DialogTitle>
          <DialogDescription>
            Build parent WBS sections, child areas, and the order each level appears in the CPM
            grid.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
          {isLocked && (
            <div className="rounded-md border border-warning/25 bg-warning/10 px-4 py-3 text-sm text-warning">
              This project is using activity WBS paths for grouping. Existing paths still display as
              WBS groups, and activity-level WBS edits can still adjust the schedule structure.
            </div>
          )}
          {isPathFallback && !isLocked && (
            <div className="rounded-md border border-hairline bg-card px-4 py-3 text-sm text-muted-foreground">
              Activity-path WBS mode is active. Parent and child areas save as schedule paths, so
              Concrete / Northwest corner, campus zones, rooms, trades, or subcontractor sequences
              can be grouped immediately.
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(240px,0.55fr)]">
            <div className="rounded-md border border-hairline bg-card px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                WBS hierarchy
              </div>
              <div className="mt-2 text-sm leading-6 text-muted-foreground">
                Create a parent WBS such as{" "}
                <span className="font-semibold text-foreground">Concrete</span>, then add child
                areas like <span className="font-semibold text-foreground">Northwest corner</span>,{" "}
                <span className="font-semibold text-foreground">Southwest corner</span>, or{" "}
                <span className="font-semibold text-foreground">Eastern corner</span>. Activities
                assigned to child areas roll up under the parent WBS.
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-hairline bg-card px-3 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Parent WBS
                </div>
                <div className="mt-1 text-2xl font-semibold tabular text-foreground">
                  {parentDivisionCount}
                </div>
              </div>
              <div className="rounded-md border border-hairline bg-card px-3 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Child areas
                </div>
                <div className="mt-1 text-2xl font-semibold tabular text-foreground">
                  {childDivisionCount}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-hairline bg-surface p-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                <LabeledField
                  label={selectedParentRow ? "New child WBS / area" : "New top-level WBS"}
                >
                  <Input
                    ref={newDivisionInputRef}
                    value={newDivision}
                    onChange={(event) => setNewDivision(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addDivision();
                      }
                    }}
                    placeholder={selectedParentRow ? "Northwest corner" : "Concrete"}
                    className="h-10 min-w-0"
                    disabled={isSaving || isLocked}
                  />
                </LabeledField>
                <Button
                  type="button"
                  className="h-10 gap-2"
                  disabled={!newDivision.trim() || isSaving || isLocked}
                  onClick={addDivision}
                >
                  <Plus className="h-4 w-4" />
                  {selectedParentRow ? "Add child area" : "Add WBS"}
                </Button>
              </div>
              <LabeledField label="Parent / child relationship">
                <Select
                  value={newDivisionParentId}
                  onValueChange={setNewDivisionParentId}
                  disabled={isSaving || isLocked}
                >
                  <SelectTrigger className="h-10 min-w-0 bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="root">Top level WBS</SelectItem>
                    {divisions
                      .filter((row) => row.id)
                      .map((row) => (
                        <SelectItem key={row.id!} value={row.id!}>
                          {formatIndentedWbsLabel(row)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </LabeledField>
            </div>
            <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <div className="min-w-0 rounded border border-hairline bg-card px-3 py-2">
                <span className="font-semibold text-foreground">Path preview:</span>{" "}
                {selectedParentRow
                  ? `${selectedParentRow.division} / ${newDivision.trim() || "New child area"}`
                  : newDivision.trim() || "New top-level WBS"}
              </div>
              {selectedParentRow && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 whitespace-nowrap"
                  onClick={() => setNewDivisionParentId("root")}
                  disabled={isSaving || isLocked}
                >
                  Add at top level
                </Button>
              )}
            </div>
          </div>

          <div className="grid gap-3">
            {renderParentDropZone(
              null,
              "Drop here to make top-level WBS",
              "Use this when a section should sit beside General Requirements, Concrete, Finishes, or Milestones.",
            )}
            {divisions.length === 0 ? (
              <div className="rounded-md border border-hairline bg-card px-4 py-8 text-center text-sm text-muted-foreground">
                No WBS sections yet.
              </div>
            ) : (
              renderDivisionRows(null)
            )}
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 border-t border-hairline px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="text-xs text-muted-foreground">
            {isSavingOrder
              ? "Order already changed in the grid; final save is confirming in the background."
              : isLocked
                ? "This project is grouped by the WBS field on each activity."
                : "Drag rows to reorder. Drop onto a parent to build child areas such as Concrete / Northwest corner."}
          </div>
          <Button type="button" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
          {(project.organization_logo_url || project.organization_name) && (
            <div className="constructline-print-brand">
              {project.organization_logo_url && (
                <img
                  src={project.organization_logo_url}
                  alt={`${project.organization_name} logo`}
                />
              )}
              {project.organization_name && <span>{project.organization_name}</span>}
            </div>
          )}
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
          <span>Current dates</span>
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
              const groupMeta = getWbsDisplayMeta(row.division);
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
                  <span style={{ paddingLeft: `${Math.min(groupMeta.level, 4) * 7}px` }}>
                    {groupMeta.parentPath && <em>{groupMeta.parentPath} / </em>}
                    {groupMeta.title} · {row.tasks.length} activities
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
  }, [groupHeight, taskHeight, rows]);
  const taskByKey = useMemo(
    () => new Map(model.tasks.map((task) => [task.activityKey, task])),
    [model.tasks],
  );
  const lines = useMemo(
    () =>
      model.tasks.flatMap((task) =>
        task.predecessorLinks.flatMap((link) => {
          const predecessor = taskByKey.get(link.predecessorKey);
          const fromY = predecessor ? rowPositions.get(predecessor.activityKey) : null;
          const toY = rowPositions.get(task.activityKey);
          if (!predecessor || fromY == null || toY == null) return [];
          const { fromOffset, toOffset } = getLogicLineEndpointOffsets(
            predecessor,
            task,
            link.relationshipType,
            model.timelineStartDate,
          );
          const fromX = timelinePrintOffsetPercent(fromOffset, model.totalTimelineDays);
          const toX = timelinePrintOffsetPercent(toOffset, model.totalTimelineDays);
          return [
            {
              id: `print-${predecessor.activityKey}->${task.activityKey}-${link.relationshipType}-${link.lagDays}`,
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
    task.slippageDays > 0 ? `+${task.slippageDays}d slip` : null,
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
        {shortPrintDate(task.statusStartDate)}-{shortPrintDate(task.statusFinishDate)}
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

function ActivityDivisionInput({
  value,
  onChange,
  options,
  listId: _listId,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  listId: string;
}) {
  const [customMode, setCustomMode] = useState(false);
  const normalizedOptions = Array.from(
    new Set(options.map((option) => normalizeWbsDivisionName(option)).filter(Boolean)),
  );
  const normalizedValue = normalizeWbsDivisionName(value);
  const selectedOption = normalizedOptions.find(
    (option) => option.toLocaleLowerCase() === normalizedValue.toLocaleLowerCase(),
  );
  const isCustom = customMode || !selectedOption;
  const selectValue = isCustom ? "__custom__" : (selectedOption ?? "__custom__");

  if (normalizedOptions.length === 0) {
    return (
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Concrete / Northwest corner"
        className="h-10 min-w-0"
      />
    );
  }

  return (
    <div className="grid min-w-0 gap-2">
      <Select
        value={selectValue}
        onValueChange={(nextValue) => {
          if (nextValue === "__custom__") {
            setCustomMode(true);
            return;
          }
          setCustomMode(false);
          onChange(nextValue);
        }}
      >
        <SelectTrigger className="h-10 min-w-0 bg-card">
          <SelectValue placeholder="Choose WBS / child area" />
        </SelectTrigger>
        <SelectContent className="max-h-[22rem]">
          <SelectItem value="__custom__">Custom WBS / child area path</SelectItem>
          {normalizedOptions.map((option) => {
            const meta = getWbsDisplayMeta(option);
            return (
              <SelectItem key={option} value={option}>
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="shrink-0 text-muted-foreground"
                    aria-hidden="true"
                    style={{ width: `${Math.min(meta.level, 4) * 14}px` }}
                  />
                  <span className="min-w-0 truncate">{meta.level > 0 ? meta.title : option}</span>
                  {meta.parentPath && (
                    <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">
                      {meta.parentPath}
                    </span>
                  )}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {isCustom ? (
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Concrete / Northwest corner"
          className="h-10 min-w-0"
        />
      ) : (
        <div className="truncate text-xs text-muted-foreground">
          {getWbsDisplayMeta(selectedOption).parentPath
            ? `Child area under ${getWbsDisplayMeta(selectedOption).parentPath}`
            : "Top-level WBS"}
        </div>
      )}
    </div>
  );
}

function ActivityScheduleMatrix({
  matrixId,
  model,
  delayFragments,
  toolbar,
  viewSummary,
  emptyTitle = "No CPM activities yet.",
  emptyDescription = "Add the first activity to start building the working schedule.",
  dayPx,
  dataDate,
  showLogicLines = false,
  isFocusMode = false,
  isPrintMode = false,
  onOpenActivity,
  onDeleteActivity,
}: {
  matrixId?: string;
  model: ConstructLineCpmModel;
  delayFragments: ScheduleDelayFragmentRow[];
  toolbar?: ReactNode;
  viewSummary?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  dayPx: number;
  dataDate: string | null;
  showLogicLines?: boolean;
  isFocusMode?: boolean;
  isPrintMode?: boolean;
  onOpenActivity: (activity: ScheduleActivityRow) => void;
  onDeleteActivity: (id: string) => void;
}) {
  const totalActivities = model.tasks.length;
  const isFitZoom = !isPrintMode && dayPx === CONSTRUCTLINE_FIT_DAY_PX;
  const matrixScrollRef = useRef<HTMLDivElement | null>(null);
  const [matrixViewportWidth, setMatrixViewportWidth] = useState(0);
  const measuredMatrixWidth =
    matrixViewportWidth > 0 ? matrixViewportWidth : isFocusMode ? 1320 : 1180;
  const fitTableWidth = Math.round(
    Math.min(
      isFocusMode ? 760 : 680,
      Math.max(isFocusMode ? 620 : 600, measuredMatrixWidth * (isFocusMode ? 0.42 : 0.45)),
    ),
  );
  const tableWidth = isPrintMode
    ? CONSTRUCTLINE_PRINT_TABLE_WIDTH
    : isFitZoom
      ? fitTableWidth
      : 860;
  const fitTimelineTargetWidth =
    matrixViewportWidth > 0
      ? Math.max(360, measuredMatrixWidth - tableWidth - 1)
      : isFocusMode
        ? 720
        : 640;
  const printDayPx = CONSTRUCTLINE_PRINT_TIMELINE_WIDTH / Math.max(1, model.totalTimelineDays);
  const fitDayPx = Math.max(0.85, fitTimelineTargetWidth / Math.max(1, model.totalTimelineDays));
  const activeDayPx = isPrintMode ? printDayPx : isFitZoom ? fitDayPx : dayPx;
  const tableColumns = isPrintMode
    ? "62px minmax(180px,1fr) 44px 56px 56px 48px 40px 42px"
    : isFitZoom
      ? "64px minmax(190px,1fr) 48px 62px 62px 58px 44px 48px"
      : "82px minmax(260px,1fr) 64px 86px 86px 74px 56px 64px";
  const rowHeight = isPrintMode ? 31 : 72;
  const groupHeight = isPrintMode ? 16 : 32;
  const headerHeight = isPrintMode ? 30 : 48;
  const timelineWidth = isPrintMode
    ? CONSTRUCTLINE_PRINT_TIMELINE_WIDTH
    : isFitZoom
      ? Math.max(fitTimelineTargetWidth, Math.ceil(model.totalTimelineDays * activeDayPx))
      : Math.max(720, model.totalTimelineDays * activeDayPx);
  useEffect(() => {
    if (isPrintMode || model.groups.length === 0 || typeof ResizeObserver === "undefined") return;
    const element = matrixScrollRef.current;
    if (!element) return;

    const updateWidth = () => setMatrixViewportWidth(Math.round(element.clientWidth));
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [isPrintMode, model.groups.length]);
  const monthBands = buildConstructLineMonthBands(
    model.timelineStartDate,
    model.totalTimelineDays,
    activeDayPx,
  );
  const dataDateX =
    dataDate == null
      ? null
      : offsetFromTimelineStart(dataDate, model.timelineStartDate) * activeDayPx;
  const delayFragmentsByActivity = useMemo(
    () => groupDelayFragmentsByActivity(delayFragments),
    [delayFragments],
  );
  const activeDelayFragmentCount = delayFragments.filter(isOpenDelayFragment).length;
  const rows = useMemo(() => buildActivityMatrixRows(model.groups), [model.groups]);
  const { bodyHeight, rowPositions } = useMemo(() => {
    const positions = new Map<string, number>();
    let height = 0;
    for (const row of rows) {
      if (row.kind === "parent" || row.kind === "group") {
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
      task.predecessorLinks.flatMap((link) => {
        const predecessor = taskByKey.get(link.predecessorKey);
        const fromY = predecessor ? rowPositions.get(predecessor.activityKey) : null;
        const toY = rowPositions.get(task.activityKey);
        if (!predecessor || fromY == null || toY == null) return [];
        const { fromOffset, toOffset } = getLogicLineEndpointOffsets(
          predecessor,
          task,
          link.relationshipType,
          model.timelineStartDate,
        );
        const fromX = fromOffset * activeDayPx;
        const toX = toOffset * activeDayPx;
        return [
          {
            id: `${predecessor.activityKey}->${task.activityKey}-${link.relationshipType}-${link.lagDays}`,
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
      id={matrixId}
      className={cn(
        "constructline-cpm-matrix scroll-mt-24 min-w-0 overflow-hidden rounded-md border border-hairline bg-card",
        isPrintMode && "constructline-cpm-matrix-print",
        isFocusMode ? "mt-0 flex min-h-0 flex-1 flex-col" : isPrintMode ? "mt-0" : "mt-5",
      )}
    >
      <div className="constructline-cpm-matrix-head flex flex-col gap-4 border-b border-hairline px-4 py-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="constructline-cpm-matrix-title">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <GitBranch className="h-3.5 w-3.5" />
              ConstructLine CPM grid
            </div>
            <div className="mt-1 font-serif text-xl text-foreground">Activity table + Gantt</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {shortDate(model.timelineStartDate)} to {shortDate(model.timelineFinishDate)}
            </div>
            {viewSummary && (
              <div className="mt-1 text-xs font-semibold text-foreground">{viewSummary}</div>
            )}
          </div>
          <div className="constructline-cpm-matrix-legend flex flex-wrap gap-x-4 gap-y-2 text-[12px] text-muted-foreground xl:justify-end">
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
            {activeDelayFragmentCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="constructline-delay-legend-swatch h-3 w-8 rounded-full border border-danger/40" />
                Delay period
              </span>
            )}
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
        {toolbar && <div className="constructline-cpm-matrix-toolbar print:hidden">{toolbar}</div>}
      </div>

      {model.groups.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <div className="font-serif text-xl text-foreground">{emptyTitle}</div>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">{emptyDescription}</p>
        </div>
      ) : (
        <div
          ref={matrixScrollRef}
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
                  Plan dur
                </div>
                <div className="flex items-center justify-end border-l border-hairline/70 px-2">
                  Current start
                </div>
                <div className="flex items-center justify-end border-l border-hairline/70 px-2">
                  Exp finish
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
                    title={band.label}
                    style={{ left: band.x, width: band.width }}
                  >
                    <div className="flex h-full items-center text-muted-foreground">
                      {band.width >= 46 ? band.label : ""}
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
              if (row.kind === "parent") {
                const groupMeta = getWbsDisplayMeta(row.division);
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
                const childCount = new Set(
                  row.tasks
                    .map((task) => getImmediateChildWbsTitle(row.division, task.activity.division))
                    .filter(Boolean),
                ).size;
                return (
                  <div
                    key={`parent-${row.division}`}
                    className="flex border-b border-hairline bg-foreground/[0.045]"
                    style={{ height: groupHeight }}
                  >
                    <div
                      className="sticky left-0 z-20 flex shrink-0 items-center border-r border-hairline bg-muted/75 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
                      style={{ width: tableWidth }}
                    >
                      <div
                        className="min-w-0"
                        style={{ paddingLeft: `${Math.min(groupMeta.level, 4) * 14}px` }}
                      >
                        <div className="truncate">
                          {groupMeta.title} · {childCount} child{" "}
                          {childCount === 1 ? "area" : "areas"} · {row.tasks.length} activities
                        </div>
                      </div>
                    </div>
                    <div className="relative shrink-0" style={{ width: timelineWidth }}>
                      <div
                        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-foreground/45"
                        style={{
                          left: groupStart * activeDayPx,
                          width: Math.max(8, (groupFinish - groupStart + 1) * activeDayPx),
                        }}
                      />
                    </div>
                  </div>
                );
              }

              if (row.kind === "group") {
                const groupMeta = getWbsDisplayMeta(row.division);
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
                      <div
                        className="min-w-0"
                        style={{ paddingLeft: `${Math.min(groupMeta.level, 4) * 14}px` }}
                      >
                        {groupMeta.parentPath && (
                          <div className="truncate normal-case tracking-normal text-muted-foreground/80">
                            {groupMeta.parentPath}
                          </div>
                        )}
                        <div className="truncate">
                          {groupMeta.title} · {row.tasks.length} activities
                        </div>
                      </div>
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
                  delayFragments={getDelayFragmentsForActivity(
                    row.task.activity,
                    delayFragmentsByActivity,
                  )}
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
  delayFragments,
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
  delayFragments: ScheduleDelayFragmentRow[];
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
  const delaySummary = buildDelayFragmentSummary(delayFragments);
  const hasOpenDelay = delaySummary.openCount > 0;
  const carriedDelayDays =
    hasOpenDelay && !task.isMilestone
      ? Math.max(0, Math.min(delaySummary.openDays, task.slippageDays))
      : 0;
  const uncarriedDelayDays =
    hasOpenDelay && !task.isMilestone ? Math.max(0, delaySummary.openDays - carriedDelayDays) : 0;
  const delayMarkerLeft = Math.min(
    timelineWidth - 10,
    Math.max(10, barLeft + Math.min(barWidth, Math.max(12, delaySummary.openDays * dayPx))),
  );
  const embeddedDelayWidth =
    carriedDelayDays > 0 ? Math.max(6, Math.min(barWidth, carriedDelayDays * dayPx)) : 0;
  const embeddedDelayLeft = Math.max(barLeft, barLeft + barWidth - embeddedDelayWidth);
  const embeddedDelayLabel = getDelayPeriodLabel(carriedDelayDays, embeddedDelayWidth, isPrintMode);
  const delayExtensionLeft = barLeft + barWidth;
  const delayExtensionAvailableWidth = Math.max(0, timelineWidth - delayExtensionLeft);
  const delayExtensionWidth =
    uncarriedDelayDays > 0 && delayExtensionAvailableWidth > 0
      ? Math.max(6, Math.min(delayExtensionAvailableWidth, uncarriedDelayDays * dayPx))
      : 0;
  const delayExtensionLabel = getDelayPeriodLabel(
    uncarriedDelayDays,
    delayExtensionWidth,
    isPrintMode,
  );
  const visualDelayMarkerLeft =
    delayExtensionWidth > 0
      ? Math.min(timelineWidth - 8, Math.max(8, delayExtensionLeft))
      : embeddedDelayWidth > 0
        ? Math.min(timelineWidth - 8, Math.max(8, embeddedDelayLeft))
        : delayMarkerLeft;
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
          <div className="constructline-task-name text-sm font-semibold leading-snug text-foreground">
            {activity.name}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {task.isMilestone && <ScheduleFlag tone="warning">milestone</ScheduleFlag>}
            {task.isCritical && <ScheduleFlag tone="danger">critical</ScheduleFlag>}
            {task.isNearCritical && <ScheduleFlag tone="warning">near critical</ScheduleFlag>}
            {task.isLate && <ScheduleFlag tone="danger">late</ScheduleFlag>}
            {task.isOutOfSequence && <ScheduleFlag tone="warning">out of seq</ScheduleFlag>}
            {task.isOpenStart && <ScheduleFlag tone="warning">open start</ScheduleFlag>}
            {task.isOpenFinish && <ScheduleFlag tone="warning">open finish</ScheduleFlag>}
            {task.hasMissingDates && <ScheduleFlag tone="warning">missing dates</ScheduleFlag>}
            {task.slippageDays > 0 && (
              <ScheduleFlag tone="danger">+{task.slippageDays}d slip</ScheduleFlag>
            )}
            {hasOpenDelay && (
              <ScheduleFlag tone="danger">{delaySummary.openDays}d delay</ScheduleFlag>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end border-l border-hairline/50 px-2 tabular text-muted-foreground">
          {task.isMilestone ? "M" : task.durationDays}
        </div>
        <div className="flex items-center justify-end border-l border-hairline/50 px-2 tabular text-muted-foreground">
          {shortPrintDate(task.statusStartDate)}
        </div>
        <div className="flex items-center justify-end border-l border-hairline/50 px-2 tabular text-muted-foreground">
          {shortPrintDate(task.statusFinishDate)}
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
          <>
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
              <div
                className={cn("h-full rounded-full", barClass)}
                style={{ width: `${percent}%` }}
              />
            </div>
            {embeddedDelayWidth > 0 && (
              <div
                className="constructline-delay-extension absolute top-1/2 flex h-4 -translate-y-1/2 items-center justify-center overflow-hidden rounded-full border border-danger/45 text-[9px] font-bold uppercase tracking-[0.08em] text-danger"
                style={{ left: embeddedDelayLeft, width: embeddedDelayWidth }}
                title={`${carriedDelayDays} delay days are carried inside the current expected finish`}
                aria-label={`${carriedDelayDays} day delay period carried in forecast`}
              >
                {embeddedDelayLabel && (
                  <span className="constructline-delay-label">{embeddedDelayLabel}</span>
                )}
              </div>
            )}
            {delayExtensionWidth > 0 && (
              <div
                className="constructline-delay-extension absolute top-1/2 flex h-4 -translate-y-1/2 items-center justify-center overflow-hidden rounded-r-full border border-danger/40 text-[9px] font-bold uppercase tracking-[0.08em] text-danger"
                style={{ left: delayExtensionLeft, width: delayExtensionWidth }}
                title={`${uncarriedDelayDays} delay days are not yet carried into the current expected finish`}
                aria-label={`${uncarriedDelayDays} day delay period not yet carried in forecast`}
              >
                {delayExtensionLabel && (
                  <span className="constructline-delay-label">{delayExtensionLabel}</span>
                )}
              </div>
            )}
          </>
        )}
        {hasOpenDelay && (
          <span
            className="constructline-delay-marker absolute top-1/2 z-20 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-danger bg-danger shadow-sm ring-4 ring-danger/15"
            style={{ left: visualDelayMarkerLeft }}
            title={`${delaySummary.openDays} open delay days on ${activity.activity_id || activity.name}`}
          />
        )}
      </button>
    </div>
  );
}

function getDelayPeriodLabel(days: number, width: number, isPrintMode: boolean) {
  if (days <= 0 || width <= 0) return null;
  if (width >= (isPrintMode ? 42 : 76)) return `${days}d delay`;
  if (width >= (isPrintMode ? 24 : 48)) return "delay";
  return null;
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

function getLogicLineEndpointOffsets(
  predecessor: ConstructLineCpmTask,
  successor: ConstructLineCpmTask,
  relationshipType: ConstructLineRelationshipType,
  timelineStartDate: string,
) {
  const fromDate =
    relationshipType === "SS" || relationshipType === "SF"
      ? predecessor.visualStartDate
      : predecessor.visualFinishDate;
  const toDate =
    relationshipType === "FF" || relationshipType === "SF"
      ? successor.visualFinishDate
      : successor.visualStartDate;
  const fromOffset =
    offsetFromTimelineStart(fromDate, timelineStartDate) +
    (relationshipType === "FS" || relationshipType === "FF"
      ? predecessor.isMilestone
        ? 0
        : 1
      : 0);
  const toOffset =
    offsetFromTimelineStart(toDate, timelineStartDate) +
    (relationshipType === "FF" || relationshipType === "SF" ? (successor.isMilestone ? 0 : 1) : 0);
  return { fromOffset, toOffset };
}

function orderConstructLineCpmModel(
  model: ConstructLineCpmModel,
  order: ScheduleActivityOrder,
  wbsDivisionOrder: string[] = [],
): ConstructLineCpmModel {
  const orderedTasks = [...model.tasks].sort(
    order === "start"
      ? compareCpmTasksByStart
      : (a, b) => compareCpmTasksByWbsThenStart(a, b, wbsDivisionOrder),
  );

  return {
    ...model,
    tasks: orderedTasks,
    groups:
      order === "start"
        ? [{ division: "Start date order", tasks: orderedTasks }]
        : groupCpmTasksByWbsDivision(orderedTasks, wbsDivisionOrder),
  };
}

function buildActivityMatrixRows(
  groups: Array<{ division: string; tasks: ConstructLineCpmTask[] }>,
): ActivityMatrixRow[] {
  const parentRollups = new Map<string, ConstructLineCpmTask[]>();
  for (const group of groups) {
    const parts = splitWbsPath(group.division);
    for (let depth = 1; depth < parts.length; depth += 1) {
      const parentPath = joinWbsPath(parts.slice(0, depth));
      parentRollups.set(parentPath, [...(parentRollups.get(parentPath) ?? []), ...group.tasks]);
    }
  }

  const insertedParents = new Set<string>();
  const rows: ActivityMatrixRow[] = [];
  for (const group of groups) {
    const parts = splitWbsPath(group.division);
    for (let depth = 1; depth < parts.length; depth += 1) {
      const parentPath = joinWbsPath(parts.slice(0, depth));
      if (insertedParents.has(parentPath)) continue;
      const parentTasks = parentRollups.get(parentPath) ?? [];
      if (parentTasks.length > 0) {
        rows.push({ kind: "parent", division: parentPath, tasks: parentTasks });
      }
      insertedParents.add(parentPath);
    }
    rows.push({ kind: "group", division: group.division, tasks: group.tasks });
    rows.push(...group.tasks.map((task) => ({ kind: "task" as const, task })));
  }
  return rows;
}

function filterConstructLineCpmModel(
  model: ConstructLineCpmModel,
  view: ScheduleGridView,
  referenceDate: string,
  delayFragments: ScheduleDelayFragmentRow[],
): ConstructLineCpmModel {
  if (view === "all") return model;
  const delayFragmentsByActivity = groupDelayFragmentsByActivity(delayFragments);
  const tasks = model.tasks.filter((task) =>
    taskMatchesScheduleGridView(task, view, referenceDate, delayFragmentsByActivity),
  );
  const visibleTaskKeys = new Set(tasks.map((task) => task.activityKey));
  return {
    ...model,
    tasks,
    groups: model.groups
      .map((group) => ({
        ...group,
        tasks: group.tasks.filter((task) => visibleTaskKeys.has(task.activityKey)),
      }))
      .filter((group) => group.tasks.length > 0),
  };
}

function taskMatchesScheduleGridView(
  task: ConstructLineCpmTask,
  view: ScheduleGridView,
  referenceDate: string,
  delayFragmentsByActivity: Map<string, ScheduleDelayFragmentRow[]>,
) {
  const percent = Math.max(0, Math.min(100, task.activity.percent_complete));
  const isIncomplete = percent < 100;
  const isActive = isIncomplete && taskIntersectsDateWindow(task, referenceDate, referenceDate);
  const hasStartedButIncomplete = percent > 0 && isIncomplete;

  if (view === "active") return isActive || hasStartedButIncomplete;
  const lookaheadDays = SCHEDULE_LOOKAHEAD_DAYS[view];
  if (lookaheadDays) {
    const referenceMs = parseDateMs(referenceDate) ?? parseDateMs(todayIsoDate()) ?? Date.now();
    const finishDate = isoDateFromMs(referenceMs + lookaheadDays * DAY_MS);
    return isIncomplete && taskIntersectsDateWindow(task, referenceDate, finishDate);
  }
  if (view === "critical") return task.isCritical || task.isNearCritical;
  if (view === "issues") {
    return (
      task.isLate ||
      task.isOutOfSequence ||
      task.isOpenStart ||
      task.isOpenFinish ||
      task.hasMissingDates ||
      getDelayFragmentsForActivity(task.activity, delayFragmentsByActivity).some(
        isOpenDelayFragment,
      )
    );
  }
  if (view === "milestones") return task.isMilestone;
  return true;
}

function taskIntersectsDateWindow(
  task: ConstructLineCpmTask,
  windowStartDate: string,
  windowFinishDate: string,
) {
  const taskStart = parseDateMs(task.visualStartDate);
  const taskFinish = parseDateMs(task.visualFinishDate);
  const windowStart = parseDateMs(windowStartDate);
  const windowFinish = parseDateMs(windowFinishDate);
  if (taskStart == null || taskFinish == null || windowStart == null || windowFinish == null) {
    return false;
  }
  return taskFinish >= windowStart && taskStart <= windowFinish;
}

function describeScheduleGridView(
  view: ScheduleGridView,
  visibleCount: number,
  totalCount: number,
  referenceDate: string,
) {
  const countText =
    visibleCount === totalCount
      ? `${visibleCount} ${visibleCount === 1 ? "activity" : "activities"} shown`
      : `${visibleCount} of ${totalCount} activities shown`;
  if (view === "all") return `All activities · ${countText}`;
  if (view === "active") return `Active as of ${shortDate(referenceDate)} · ${countText}`;
  const lookaheadDays = SCHEDULE_LOOKAHEAD_DAYS[view];
  if (lookaheadDays) {
    const lookaheadLabel =
      lookaheadDays % 7 === 0 ? `${lookaheadDays / 7}-week` : `${lookaheadDays}-day`;
    return `${lookaheadLabel} lookahead from ${shortDate(referenceDate)} · ${countText}`;
  }
  if (view === "critical") return `Critical and near-critical path · ${countText}`;
  if (view === "issues") return `Schedule issues · ${countText}`;
  if (view === "milestones") return `Milestones only · ${countText}`;
  return countText;
}

function getScheduleReportTitle(view: ScheduleGridView) {
  if (view === "critical") return "Critical Path Report";
  if (view === "lookahead_1w") return "1-Week Lookahead Report";
  if (view === "lookahead_2w") return "2-Week Lookahead Report";
  if (view === "lookahead_6w") return "6-Week Lookahead Report";
  if (view === "issues") return "Schedule Issues Report";
  if (view === "milestones") return "Milestone Report";
  if (view === "active") return "Active Schedule Report";
  return "Full CPM Schedule Report";
}

function compareCpmTasksByStart(a: ConstructLineCpmTask, b: ConstructLineCpmTask) {
  return (
    a.visualStartDate.localeCompare(b.visualStartDate) ||
    a.visualFinishDate.localeCompare(b.visualFinishDate) ||
    naturalScheduleCompare(a.dependencyKey, b.dependencyKey) ||
    naturalScheduleCompare(a.activity.name, b.activity.name)
  );
}

function compareScheduleActivitiesByStart(a: ScheduleActivityRow, b: ScheduleActivityRow) {
  const aStart = a.start_date ?? a.finish_date ?? "9999-12-31";
  const bStart = b.start_date ?? b.finish_date ?? "9999-12-31";
  const aFinish = a.finish_date ?? a.start_date ?? "9999-12-31";
  const bFinish = b.finish_date ?? b.start_date ?? "9999-12-31";
  return (
    aStart.localeCompare(bStart) ||
    aFinish.localeCompare(bFinish) ||
    naturalScheduleCompare(a.activity_id || a.name, b.activity_id || b.name) ||
    naturalScheduleCompare(a.name, b.name)
  );
}

function compareCpmTasksByWbsThenStart(
  a: ConstructLineCpmTask,
  b: ConstructLineCpmTask,
  wbsDivisionOrder: string[] = [],
) {
  return (
    compareWbsDivision(a.activity.division, b.activity.division, wbsDivisionOrder) ||
    compareCpmTasksByStart(a, b)
  );
}

function groupCpmTasksByWbsDivision(
  tasks: ConstructLineCpmTask[],
  wbsDivisionOrder: string[] = [],
) {
  const groups = new Map<string, ConstructLineCpmTask[]>();
  for (const task of tasks) {
    const division = normalizeWbsDivisionName(task.activity.division);
    groups.set(division, [...(groups.get(division) ?? []), task]);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => compareWbsDivision(a, b, wbsDivisionOrder))
    .map(([division, rows]) => ({ division, tasks: rows.sort(compareCpmTasksByStart) }));
}

function naturalScheduleCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
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
          {shortDate(getActivityForecastStart(activity))} →{" "}
          {shortDate(getActivityForecastFinish(activity))}
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
          {describeConstructLineDependencyToken(id)}
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
  const selectedLinks = parseActivityLinks(selectedIds);
  const selectedActivityIds = selectedLinks.map((link) => link.activityId);
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
    const nextLinks = selectedIdSet.has(activityId)
      ? selectedLinks.filter((link) => link.activityId !== activityId)
      : [...selectedLinks, { activityId, relationshipType: "FS" as const, lagDays: 0 }];
    onChange(formatActivityLinks(nextLinks));
  };
  const removeActivity = (activityId: string) => {
    onChange(formatActivityLinks(selectedLinks.filter((link) => link.activityId !== activityId)));
  };
  const updateActivityLink = (
    activityId: string,
    patch: Partial<Pick<ConstructLineDependencyToken, "relationshipType" | "lagDays">>,
  ) => {
    onChange(
      formatActivityLinks(
        selectedLinks.map((link) =>
          link.activityId === activityId
            ? {
                ...link,
                ...patch,
                lagDays: patch.lagDays ?? link.lagDays,
                relationshipType: patch.relationshipType ?? link.relationshipType,
              }
            : link,
        ),
      ),
    );
  };

  return (
    <div className="min-w-0 space-y-2">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Pick activities from the schedule, then set relationship type and lag days.
        </div>
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
                          {activity.division || "General"} ·{" "}
                          {shortDate(getActivityForecastStart(activity))} to{" "}
                          {shortDate(getActivityForecastFinish(activity))}
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
      {selectedLinks.length > 0 && (
        <div className="grid gap-2">
          {selectedLinks.map((link) => {
            const activityId = link.activityId;
            const activity = activitiesById.get(activityId);
            return (
              <div
                key={activityId}
                className="grid min-w-0 gap-3 rounded-md border border-hairline bg-card p-3 xl:grid-cols-[minmax(300px,1fr)_minmax(150px,180px)_120px_32px] xl:items-end"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="shrink-0 text-xs font-semibold tabular text-foreground">
                      {activityId}
                    </span>
                    <span className="min-w-0 break-words text-sm font-medium text-foreground">
                      {activity?.name ?? "Activity not found"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {activity
                      ? `${activity.division || "General"} · ${shortDate(
                          getActivityForecastStart(activity),
                        )} to ${shortDate(getActivityForecastFinish(activity))}`
                      : "This saved activity ID is not currently in the schedule list."}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Relationship
                  </div>
                  <Select
                    value={link.relationshipType}
                    onValueChange={(relationshipType) =>
                      updateActivityLink(activityId, {
                        relationshipType: relationshipType as ConstructLineRelationshipType,
                      })
                    }
                  >
                    <SelectTrigger
                      className="h-9 min-w-0 px-2 text-xs font-semibold"
                      aria-label={`${activityId} relationship type`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONSTRUCTLINE_RELATIONSHIP_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          <span className="font-semibold tabular">{type}</span>
                          <span className="ml-2 text-muted-foreground">
                            {CONSTRUCTLINE_RELATIONSHIP_LABELS[type]}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-0">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Lag / lead
                  </div>
                  <div className="relative min-w-0">
                    <Input
                      type="number"
                      min={-999}
                      max={999}
                      value={link.lagDays}
                      onChange={(event) =>
                        updateActivityLink(activityId, { lagDays: Number(event.target.value) })
                      }
                      title="Lag days. Use negative values for lead."
                      className="h-9 min-w-0 pr-6 text-xs font-semibold tabular"
                      aria-label={`${activityId} lag days`}
                    />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-muted-foreground">
                      d
                    </span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 justify-self-end text-muted-foreground hover:text-danger lg:justify-self-center"
                  onClick={() => removeActivity(activityId)}
                  aria-label={`Remove ${activityId}`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
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
  const start = timelinePosition(getActivityForecastStart(activity), bounds);
  const finish = timelinePosition(getActivityForecastFinish(activity), bounds);
  const left = Math.min(start ?? finish ?? 0, finish ?? start ?? 0);
  const width =
    start == null && finish == null
      ? 0
      : Math.max(1.5, Math.abs((finish ?? start ?? 0) - (start ?? finish ?? 0)));
  const percent = Math.max(0, Math.min(100, activity.percent_complete));
  const dataDateMs = parseDateMs(new Date().toISOString().slice(0, 10));
  const finishMs = parseDateMs(getActivityForecastFinish(activity));
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
  dataDate,
  divisionOptions,
  delayFragments,
  delayFragmentPersistence,
  isSaving,
  isSavingDelayFragment,
  onClose,
  onSave,
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
  divisionOptions: string[];
  delayFragments: ScheduleDelayFragmentRow[];
  delayFragmentPersistence: "ready" | "migration_required";
  isSaving: boolean;
  isSavingDelayFragment: boolean;
  onClose: () => void;
  onSave: (patch: Partial<ScheduleActivityRow>) => Promise<void>;
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
  const remainingDuration =
    activity.percent_complete >= 100
      ? 0
      : (activity.remaining_duration_days ??
        getDateDurationDays(
          dataDate ?? activity.forecast_start_date ?? activity.start_date,
          activity.forecast_finish_date ?? activity.finish_date,
        ));
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
  const isMilestone = isConstructLineMilestoneActivity(activity);
  const saving = isSaving || isSubmitting;
  const currentActivityBlockedIds = useMemo(
    () =>
      Array.from(
        new Set([activity.activity_id, draft.activity_id].map((id) => id.trim()).filter(Boolean)),
      ),
    [activity.activity_id, draft.activity_id],
  );

  useEffect(() => {
    setDraft(activityDraftFromRow(activity));
    setSaveError(null);
    setIsSubmitting(false);
  }, [activity]);

  const saveActivity = async () => {
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
        remaining_duration_days: parseRemainingDuration(draft.remaining_duration_days),
        percent_complete: parsePercent(draft.percent_complete),
        predecessor_activity_ids: serializeActivityLinksToArray(draft.predecessor_activity_ids),
        successor_activity_ids: serializeActivityLinksToArray(draft.successor_activity_ids),
        notes: draft.notes.trim(),
      });
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Activity did not update.");
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:w-[min(calc(100vw-2rem),80rem)] sm:max-w-[80rem]">
        <DialogHeader className="border-b border-hairline px-4 py-4 pr-12 sm:px-6">
          <DialogTitle className="font-serif text-2xl">CPM activity detail</DialogTitle>
          <DialogDescription>
            Review the full activity, dependency logic, planned dates, percent complete, and field
            notes.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <ScheduleWorkbenchStat
              label="Activity ID"
              value={activity.activity_id || "No ID"}
              sub={activity.division || "General"}
            />
            <ScheduleWorkbenchStat
              label="Planned duration"
              value={
                isMilestone
                  ? "Milestone"
                  : plannedDuration == null
                    ? "No dates"
                    : String(plannedDuration)
              }
              sub={
                isMilestone
                  ? "schedule point"
                  : plannedDuration == null
                    ? "start / finish needed"
                    : "baseline start to finish"
              }
            />
            <ScheduleWorkbenchStat
              label="Remaining"
              value={remainingDuration == null ? "Set" : String(remainingDuration)}
              sub={dataDate ? `as of ${shortDate(dataDate)}` : "set data date"}
              tone={remainingDuration === 0 ? "success" : "default"}
            />
            <ScheduleWorkbenchStat
              label="Progress"
              value={`${activity.percent_complete}%`}
              sub={activity.percent_complete >= 100 ? "complete" : "percent complete"}
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
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Activity setup
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Edit the row identity, parent / child WBS path, baseline dates, status update,
                  progress, and milestone status.
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
              <LabeledField label="WBS / area">
                <ActivityDivisionInput
                  value={draft.division}
                  onChange={(division) => setDraft({ ...draft, division })}
                  options={divisionOptions}
                  listId={`activity-${activity.id}-wbs-divisions`}
                />
              </LabeledField>
              <LabeledField label="Baseline start">
                <Input
                  type="date"
                  value={draft.baseline_start_date}
                  onChange={(e) => setDraft(updateDraftBaselineStartDate(draft, e.target.value))}
                  className="h-10 min-w-0"
                />
              </LabeledField>
              <LabeledField label="Baseline finish">
                <Input
                  type="date"
                  value={draft.baseline_finish_date}
                  onChange={(e) => setDraft(updateDraftBaselineFinishDate(draft, e.target.value))}
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

            <div className="mt-4 rounded-md border border-hairline bg-card p-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Status update
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Enter actuals, remaining duration, and expected finish for the current data
                    date.
                  </div>
                </div>
                <div className="text-xs font-semibold text-muted-foreground">
                  Data date {dataDate ? shortDate(dataDate) : "not set"}
                </div>
              </div>
              <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-[145px_145px_150px_145px_145px]">
                <LabeledField label="Actual start">
                  <Input
                    type="date"
                    value={draft.actual_start_date}
                    onChange={(e) => setDraft({ ...draft, actual_start_date: e.target.value })}
                    className="h-10 min-w-0"
                  />
                </LabeledField>
                <LabeledField label="Actual finish">
                  <Input
                    type="date"
                    value={draft.actual_finish_date}
                    onChange={(e) => setDraft({ ...draft, actual_finish_date: e.target.value })}
                    className="h-10 min-w-0"
                  />
                </LabeledField>
                <LabeledField label="Remaining duration">
                  <Input
                    type="number"
                    min={0}
                    value={draft.remaining_duration_days}
                    onChange={(e) =>
                      setDraft(updateDraftRemainingDuration(draft, e.target.value, dataDate))
                    }
                    placeholder="days"
                    className="h-10 min-w-0 tabular"
                  />
                </LabeledField>
                <LabeledField label="Forecast start">
                  <Input
                    type="date"
                    value={draft.forecast_start_date}
                    onChange={(e) => setDraft({ ...draft, forecast_start_date: e.target.value })}
                    className="h-10 min-w-0"
                  />
                </LabeledField>
                <LabeledField label="Expected finish">
                  <Input
                    type="date"
                    value={draft.forecast_finish_date}
                    onChange={(e) =>
                      setDraft(updateDraftForecastFinishDate(draft, e.target.value, dataDate))
                    }
                    className="h-10 min-w-0"
                  />
                </LabeledField>
              </div>
              <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <ActivityUpdateImpactTile
                  label="Baseline finish"
                  value={updateImpact.baselineFinish}
                  sub="original planned finish"
                />
                <ActivityUpdateImpactTile
                  label="Expected finish"
                  value={updateImpact.expectedFinish}
                  sub="current forecast finish"
                  tone={updateImpact.finishTone}
                />
                <ActivityUpdateImpactTile
                  label="Remaining basis"
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
              {!dataDate && (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Set the CPM data date before updating remaining duration so expected finish
                    dates are anchored to the right schedule snapshot.
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
                          ? `Apply this to move expected finish to ${shortDate(delayAdjustedDraft.forecast_finish_date)} and recalculate remaining duration.`
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

            <div className="mt-5 grid min-w-0 gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Logic ties
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Predecessors drive this activity. Successors are the activities this row drives.
                </div>
              </div>
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
              <div className="min-w-0 rounded-md border border-hairline bg-card p-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Dependency readout
                </div>
                <div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-muted-foreground">Predecessors</div>
                    <ActivityIdPills
                      ids={parseActivityTokens(draft.predecessor_activity_ids)}
                      emptyLabel="No predecessor logic"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-muted-foreground">Successors</div>
                    <ActivityIdPills
                      ids={parseActivityTokens(draft.successor_activity_ids)}
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

            <ActivityDelayFragmentPanel
              activity={activity}
              delayFragments={delayFragments}
              persistence={delayFragmentPersistence}
              isSaving={isSavingDelayFragment}
              onAddDelayFragment={onAddDelayFragment}
              onPatchDelayFragment={onPatchDelayFragment}
              onDeleteDelayFragment={onDeleteDelayFragment}
            />
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
            disabled={saving}
          >
            <Trash2 className="h-4 w-4" />
            Delete activity
          </Button>
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
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Close
            </Button>
            <Button type="button" onClick={saveActivity} disabled={!draft.name.trim() || saving}>
              {saving ? "Saving..." : "Save activity"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type DelayFragmentDraft = {
  title: string;
  reason: string;
  delay_days: string;
  source: ScheduleDelayFragmentRow["source"];
  status: ScheduleDelayFragmentRow["status"];
  owner: string;
  identified_on: string;
};

function ActivityDelayFragmentPanel({
  activity,
  delayFragments,
  persistence,
  isSaving,
  onAddDelayFragment,
  onPatchDelayFragment,
  onDeleteDelayFragment,
}: {
  activity: ScheduleActivityRow;
  delayFragments: ScheduleDelayFragmentRow[];
  persistence: "ready" | "migration_required";
  isSaving: boolean;
  onAddDelayFragment: (fragment: DelayFragmentCreateInput) => Promise<void>;
  onPatchDelayFragment: (id: string, patch: DelayFragmentPatchInput) => Promise<void>;
  onDeleteDelayFragment: (id: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<DelayFragmentDraft>(() =>
    emptyDelayFragmentDraft(activity.name),
  );
  const linkedFragments = useMemo(
    () =>
      delayFragments.filter(
        (fragment) =>
          fragment.schedule_activity_id === activity.id ||
          Boolean(activity.activity_id && fragment.activity_id === activity.activity_id),
      ),
    [activity.activity_id, activity.id, delayFragments],
  );
  const linkedSummary = useMemo(
    () => buildDelayFragmentSummary(linkedFragments),
    [linkedFragments],
  );

  useEffect(() => {
    setDraft(emptyDelayFragmentDraft(activity.name));
  }, [activity.id, activity.name]);

  const addFragment = async () => {
    const title = draft.title.trim();
    if (!title || persistence === "migration_required") return;
    await onAddDelayFragment({
      schedule_activity_id: activity.id,
      activity_id: activity.activity_id,
      title,
      reason: draft.reason.trim(),
      delay_days: parseDelayDays(draft.delay_days),
      source: draft.source,
      status: draft.status,
      owner: draft.owner.trim(),
      identified_on: draft.identified_on || todayIsoDate(),
      resolved_on: isOpenDelayStatus(draft.status) ? null : todayIsoDate(),
    });
    setDraft(emptyDelayFragmentDraft(activity.name));
  };

  return (
    <div className="mt-4 rounded-md border border-hairline bg-card p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5" />
            Delay impacts
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {linkedSummary.openCount} open · {linkedSummary.openDays} days ·{" "}
            {linkedSummary.totalCount} total
          </div>
        </div>
      </div>

      {persistence === "migration_required" ? (
        <div className="mt-3 rounded border border-hairline bg-surface px-3 py-2 text-xs text-muted-foreground">
          Use Notes / Constraint for the delay narrative on this activity. Activity details and CPM
          logic still save normally.
        </div>
      ) : (
        <>
          <div className="mt-3 grid min-w-0 gap-2 xl:grid-cols-[minmax(0,1fr)_96px_150px_140px_140px]">
            <LabeledField label="Fragment title">
              <Input
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                className="h-9 min-w-0"
                placeholder="Window delivery slipped"
                disabled={isSaving}
              />
            </LabeledField>
            <LabeledField label="Days">
              <Input
                type="number"
                min={0}
                max={365}
                value={draft.delay_days}
                onChange={(event) => setDraft({ ...draft, delay_days: event.target.value })}
                className="h-9 min-w-0 tabular"
                disabled={isSaving}
              />
            </LabeledField>
            <LabeledField label="Source">
              <Select
                value={draft.source}
                onValueChange={(source) =>
                  setDraft({ ...draft, source: source as ScheduleDelayFragmentRow["source"] })
                }
                disabled={isSaving}
              >
                <SelectTrigger className="h-9 min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.keys(DELAY_FRAGMENT_SOURCE_LABEL) as ScheduleDelayFragmentRow["source"][]
                  ).map((source) => (
                    <SelectItem key={source} value={source}>
                      {DELAY_FRAGMENT_SOURCE_LABEL[source]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </LabeledField>
            <LabeledField label="Status">
              <Select
                value={draft.status}
                onValueChange={(status) =>
                  setDraft({ ...draft, status: status as ScheduleDelayFragmentRow["status"] })
                }
                disabled={isSaving}
              >
                <SelectTrigger className="h-9 min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.keys(DELAY_FRAGMENT_STATUS_LABEL) as ScheduleDelayFragmentRow["status"][]
                  ).map((status) => (
                    <SelectItem key={status} value={status}>
                      {DELAY_FRAGMENT_STATUS_LABEL[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </LabeledField>
            <LabeledField label="Identified">
              <Input
                type="date"
                value={draft.identified_on}
                onChange={(event) => setDraft({ ...draft, identified_on: event.target.value })}
                className="h-9 min-w-0"
                disabled={isSaving}
              />
            </LabeledField>
          </div>

          <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1fr)_220px_auto] lg:items-end">
            <LabeledField label="Reason / impact">
              <Textarea
                value={draft.reason}
                onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
                className="min-h-16 min-w-0 resize-y"
                placeholder="What happened, who owns it, and what path it affects."
                disabled={isSaving}
              />
            </LabeledField>
            <LabeledField label="Owner">
              <Input
                value={draft.owner}
                onChange={(event) => setDraft({ ...draft, owner: event.target.value })}
                className="h-9 min-w-0"
                placeholder="PM / trade / client"
                disabled={isSaving}
              />
            </LabeledField>
            <Button
              type="button"
              className="h-9 gap-2"
              disabled={!draft.title.trim() || isSaving}
              onClick={() => void addFragment()}
            >
              <Plus className="h-4 w-4" />
              Add delay
            </Button>
          </div>

          <div className="mt-3 grid gap-2">
            {linkedFragments.length === 0 ? (
              <div className="rounded border border-dashed border-hairline bg-surface/70 px-3 py-3 text-sm text-muted-foreground">
                No delay impacts tied to this activity.
              </div>
            ) : (
              linkedFragments.map((fragment) => (
                <DelayFragmentRow
                  key={fragment.id}
                  fragment={fragment}
                  isSaving={isSaving}
                  onPatchDelayFragment={onPatchDelayFragment}
                  onDeleteDelayFragment={onDeleteDelayFragment}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function DelayFragmentRow({
  fragment,
  isSaving,
  onPatchDelayFragment,
  onDeleteDelayFragment,
}: {
  fragment: ScheduleDelayFragmentRow;
  isSaving: boolean;
  onPatchDelayFragment: (id: string, patch: DelayFragmentPatchInput) => Promise<void>;
  onDeleteDelayFragment: (id: string) => Promise<void>;
}) {
  const updateStatus = (status: ScheduleDelayFragmentRow["status"]) => {
    void onPatchDelayFragment(fragment.id, {
      status,
      resolved_on: isOpenDelayStatus(status) ? null : (fragment.resolved_on ?? todayIsoDate()),
    });
  };
  return (
    <div className="grid min-w-0 gap-2 rounded border border-hairline bg-surface p-2 lg:grid-cols-[minmax(0,1fr)_88px_130px_138px_36px] lg:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{fragment.title}</span>
          <span className="rounded border border-hairline bg-card px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {DELAY_FRAGMENT_SOURCE_LABEL[fragment.source]}
          </span>
        </div>
        <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
          {fragment.reason || "No reason entered."}
        </div>
      </div>
      <div className="text-sm font-semibold tabular text-foreground">
        {fragment.delay_days} days
      </div>
      <div className="text-xs text-muted-foreground">
        {shortDate(fragment.identified_on)}
        {fragment.resolved_on ? ` to ${shortDate(fragment.resolved_on)}` : ""}
      </div>
      <Select value={fragment.status} onValueChange={updateStatus} disabled={isSaving}>
        <SelectTrigger className="h-9 min-w-0 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(DELAY_FRAGMENT_STATUS_LABEL) as ScheduleDelayFragmentRow["status"][]).map(
            (status) => (
              <SelectItem key={status} value={status}>
                {DELAY_FRAGMENT_STATUS_LABEL[status]}
              </SelectItem>
            ),
          )}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 justify-self-end text-muted-foreground hover:text-danger"
        disabled={isSaving}
        onClick={() => void onDeleteDelayFragment(fragment.id)}
        aria-label={`Delete ${fragment.title}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
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
        baseline_start_date: finishDate,
        baseline_finish_date: finishDate,
        forecast_start_date: finishDate,
        forecast_finish_date: finishDate,
        actual_start_date: milestone.status === "complete" ? finishDate : null,
        actual_finish_date: milestone.status === "complete" ? finishDate : null,
        remaining_duration_days: milestone.status === "complete" ? 0 : null,
        percent_complete: milestone.status === "complete" ? 100 : 0,
        predecessor_activity_ids: [],
        successor_activity_ids: [],
        notes: milestoneActivityNotes(milestone),
      };
    });
}

function scheduleActivityToTemplateCreateInput(activity: ScheduleActivityRow): ActivityCreateInput {
  return {
    activity_id: activity.activity_id,
    name: activity.name,
    division: activity.division,
    start_date: activity.start_date,
    finish_date: activity.finish_date,
    baseline_start_date: activity.baseline_start_date,
    baseline_finish_date: activity.baseline_finish_date,
    forecast_start_date: activity.forecast_start_date,
    forecast_finish_date: activity.forecast_finish_date,
    actual_start_date: activity.actual_start_date,
    actual_finish_date: activity.actual_finish_date,
    remaining_duration_days: activity.remaining_duration_days,
    percent_complete: 0,
    predecessor_activity_ids: activity.predecessor_activity_ids,
    successor_activity_ids: activity.successor_activity_ids,
    notes: activity.notes,
    sort_order: activity.sort_order,
  };
}

function buildBrowserCpmTemplate(
  project: ProjectRow,
  name: string,
  activities: ScheduleActivityRow[],
  wbsSections: ScheduleWbsSectionRow[],
): BrowserCpmTemplate {
  const now = new Date().toISOString();
  const templateId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    id: `browser-${templateId}`,
    project_id: project.id,
    name,
    description: `Browser template saved from ${project.name}.`,
    activity_count: activities.length,
    created_at: now,
    updated_at: now,
    source: "browser",
    activities: activities.map(scheduleActivityToTemplateCreateInput),
    wbsSections,
  };
}

function readBrowserCpmTemplates(): BrowserCpmTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(BROWSER_CPM_TEMPLATE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is BrowserCpmTemplate => {
        const row = item as Partial<BrowserCpmTemplate>;
        return Boolean(row.id && row.name && Array.isArray(row.activities));
      })
      .slice(0, 25);
  } catch {
    return [];
  }
}

function writeBrowserCpmTemplates(templates: BrowserCpmTemplate[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    BROWSER_CPM_TEMPLATE_STORAGE_KEY,
    JSON.stringify(templates.slice(0, 25)),
  );
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

function getNextActivityId(activities: ScheduleActivityRow[]) {
  const maxAutoNumber = activities.reduce((max, activity) => {
    const match = activity.activity_id.trim().match(/^A-(\d+)$/i);
    if (!match) return max;
    return Math.max(max, Number.parseInt(match[1], 10) || 0);
  }, 0);
  const existingIds = new Set(activities.map((activity) => activity.activity_id).filter(Boolean));
  return uniqueActivityId(`A-${String(maxAutoNumber + 1).padStart(3, "0")}`, existingIds);
}

function validateActivityDraft(
  draft: ActivityDraft,
  activities: ScheduleActivityRow[],
  currentActivityId?: string,
) {
  const activityId = draft.activity_id.trim();
  const name = draft.name.trim();
  if (!activityId) return "Activity ID is required.";
  if (!name) return "Activity name is required.";
  const duplicate = activities.find(
    (activity) =>
      activity.id !== currentActivityId &&
      activity.activity_id.trim().toLowerCase() === activityId.toLowerCase(),
  );
  if (duplicate) return `${activityId} is already used by ${duplicate.name}.`;

  const milestoneDate = getMilestoneDraftDate(draft) ?? "";
  if (draft.is_milestone && !milestoneDate) return "Milestones need a schedule date.";
  const start = parseDateMs(draft.baseline_start_date || draft.start_date);
  const finish = parseDateMs(draft.baseline_finish_date || draft.finish_date);
  if (start != null && finish != null && finish < start) {
    return "Baseline finish cannot be earlier than baseline start.";
  }
  const forecastStart = parseDateMs(draft.forecast_start_date);
  const forecastFinish = parseDateMs(draft.forecast_finish_date);
  if (forecastStart != null && forecastFinish != null && forecastFinish < forecastStart) {
    return "Expected finish cannot be earlier than forecast start.";
  }
  const actualStart = parseDateMs(draft.actual_start_date);
  const actualFinish = parseDateMs(draft.actual_finish_date);
  if (actualStart != null && actualFinish != null && actualFinish < actualStart) {
    return "Actual finish cannot be earlier than actual start.";
  }
  const remainingDuration = parseRemainingDuration(draft.remaining_duration_days);
  if (
    draft.remaining_duration_days.trim() &&
    (remainingDuration == null || remainingDuration < 0)
  ) {
    return "Remaining duration must be a whole number of days.";
  }
  return null;
}

function parsePercent(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function parseDelayDays(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(365, Math.round(parsed)));
}

function parseRemainingDuration(value: string | number | null | undefined) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(5000, Math.round(parsed)));
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function isOpenDelayStatus(status: ScheduleDelayFragmentRow["status"]) {
  return status === "active" || status === "accepted";
}

function emptyDelayFragmentDraft(activityName: string): DelayFragmentDraft {
  return {
    title: activityName ? `${activityName} delay` : "Schedule delay",
    reason: "",
    delay_days: "0",
    source: "field",
    status: "active",
    owner: "",
    identified_on: todayIsoDate(),
  };
}

function parseActivityIds(value: string) {
  return parseActivityLinks(value).map((item) => item.activityId);
}

function formatActivityIds(value: string[]) {
  return formatActivityLinks(value.map(parseConstructLineDependencyToken));
}

function parseActivityLinks(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(parseConstructLineDependencyToken);
}

function formatActivityLinks(value: ConstructLineDependencyToken[]) {
  return value
    .filter((item) => item.activityId.trim().length > 0)
    .map(formatConstructLineDependencyToken)
    .join(", ");
}

function parseActivityTokens(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function serializeActivityLinksToArray(value: string) {
  return parseActivityTokens(formatActivityLinks(parseActivityLinks(value)));
}

function getMilestoneDraftDate(draft: ActivityDraft) {
  return (
    draft.forecast_finish_date ||
    draft.baseline_finish_date ||
    draft.finish_date ||
    draft.forecast_start_date ||
    draft.baseline_start_date ||
    draft.start_date ||
    null
  );
}

function toggleMilestoneDraft(draft: ActivityDraft, isMilestone: boolean): ActivityDraft {
  if (!isMilestone) {
    return {
      ...draft,
      is_milestone: false,
      division: draft.division.trim().toLowerCase() === "milestones" ? "General" : draft.division,
    };
  }

  const milestoneDate = getMilestoneDraftDate(draft) ?? "";
  return {
    ...draft,
    is_milestone: true,
    division: "Milestones",
    start_date: milestoneDate,
    finish_date: milestoneDate,
    baseline_start_date: milestoneDate,
    baseline_finish_date: milestoneDate,
    forecast_start_date: milestoneDate,
    forecast_finish_date: milestoneDate,
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

function updateDraftBaselineStartDate(draft: ActivityDraft, value: string): ActivityDraft {
  if (!draft.is_milestone) {
    return {
      ...draft,
      start_date: value,
      baseline_start_date: value,
      forecast_start_date: draft.forecast_start_date || value,
    };
  }
  return {
    ...draft,
    start_date: value,
    finish_date: value,
    baseline_start_date: value,
    baseline_finish_date: value,
    forecast_start_date: value,
    forecast_finish_date: value,
  };
}

function updateDraftBaselineFinishDate(draft: ActivityDraft, value: string): ActivityDraft {
  if (!draft.is_milestone) {
    return {
      ...draft,
      finish_date: value,
      baseline_finish_date: value,
      forecast_finish_date: draft.forecast_finish_date || value,
    };
  }
  return {
    ...draft,
    start_date: value,
    finish_date: value,
    baseline_start_date: value,
    baseline_finish_date: value,
    forecast_start_date: value,
    forecast_finish_date: value,
  };
}

function getDraftStatusAnchorDate(draft: ActivityDraft, dataDate?: string | null) {
  return (
    dataDate ||
    draft.forecast_start_date ||
    draft.actual_start_date ||
    draft.baseline_start_date ||
    draft.start_date ||
    null
  );
}

function updateDraftRemainingDuration(
  draft: ActivityDraft,
  value: string,
  dataDate?: string | null,
): ActivityDraft {
  const remainingDuration = parseRemainingDuration(value);
  const anchorMs = parseDateMs(getDraftStatusAnchorDate(draft, dataDate));
  if (remainingDuration == null || anchorMs == null) {
    return { ...draft, remaining_duration_days: value };
  }
  const finishOffsetDays = Math.max(0, remainingDuration - 1);
  return {
    ...draft,
    remaining_duration_days: String(remainingDuration),
    forecast_finish_date: isoDateFromMs(anchorMs + finishOffsetDays * DAY_MS),
  };
}

function updateDraftForecastFinishDate(
  draft: ActivityDraft,
  value: string,
  dataDate?: string | null,
): ActivityDraft {
  const anchorMs = parseDateMs(getDraftStatusAnchorDate(draft, dataDate));
  const finishMs = parseDateMs(value);
  if (anchorMs == null || finishMs == null || finishMs < anchorMs) {
    return { ...draft, forecast_finish_date: value };
  }
  const remainingDuration = Math.max(1, Math.round((finishMs - anchorMs) / DAY_MS) + 1);
  return {
    ...draft,
    forecast_finish_date: value,
    remaining_duration_days: String(remainingDuration),
  };
}

function applyOpenDelayToDraftForecast(
  draft: ActivityDraft,
  openDelayDays: number,
  dataDate?: string | null,
): ActivityDraft {
  const delayDays = Math.max(0, Math.round(openDelayDays));
  if (delayDays <= 0) return draft;

  const baselineFinishMs = parseDateMs(draft.baseline_finish_date || draft.finish_date);
  const currentForecastFinishMs = parseDateMs(
    draft.forecast_finish_date || draft.baseline_finish_date || draft.finish_date,
  );
  const dataDateMs = parseDateMs(dataDate);
  const targetFinishMs =
    baselineFinishMs != null
      ? baselineFinishMs + delayDays * DAY_MS
      : currentForecastFinishMs != null
        ? currentForecastFinishMs + delayDays * DAY_MS
        : dataDateMs != null
          ? dataDateMs + Math.max(0, delayDays - 1) * DAY_MS
          : null;

  if (targetFinishMs == null) return draft;
  const currentOrTargetFinishMs =
    currentForecastFinishMs == null
      ? targetFinishMs
      : Math.max(currentForecastFinishMs, targetFinishMs);
  return updateDraftForecastFinishDate(draft, isoDateFromMs(currentOrTargetFinishMs), dataDate);
}

function buildActivityUpdateImpact(draft: ActivityDraft, dataDate?: string | null) {
  const baselineFinish = draft.baseline_finish_date || draft.finish_date || null;
  const expectedFinish = draft.forecast_finish_date || baselineFinish;
  const baselineFinishMs = parseDateMs(baselineFinish);
  const expectedFinishMs = parseDateMs(expectedFinish);
  const slipDays =
    baselineFinishMs == null || expectedFinishMs == null
      ? null
      : Math.round((expectedFinishMs - baselineFinishMs) / DAY_MS);
  const percentComplete = parsePercent(draft.percent_complete);
  const remainingDuration = parseRemainingDuration(draft.remaining_duration_days);
  const statusAnchor = getDraftStatusAnchorDate(draft, dataDate);
  const isComplete = percentComplete >= 100 || Boolean(draft.actual_finish_date);
  const finishTone = slipDays == null || slipDays <= 0 ? "default" : "danger";
  const slipTone =
    slipDays == null || slipDays === 0 ? "default" : slipDays > 0 ? "danger" : "success";
  return {
    baselineFinish: baselineFinish ? shortDate(baselineFinish) : "Set baseline",
    expectedFinish: expectedFinish ? shortDate(expectedFinish) : "Set forecast",
    finishTone,
    remainingValue: isComplete
      ? "Complete"
      : remainingDuration == null
        ? "Set"
        : String(remainingDuration),
    remainingBasis: isComplete
      ? "actual finish controls"
      : statusAnchor
        ? `from ${shortDate(statusAnchor)}`
        : "set data date",
    slipValue:
      slipDays == null
        ? "Set dates"
        : slipDays === 0
          ? "0d"
          : slipDays > 0
            ? `+${slipDays}d`
            : `${slipDays}d`,
    slipBasis:
      slipDays == null
        ? "baseline + expected finish"
        : slipDays === 0
          ? "on baseline"
          : slipDays > 0
            ? "late against baseline"
            : "early against baseline",
    slipTone,
  } as const;
}

function ActivityUpdateImpactTile({
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
    <div className="min-w-0 rounded-md border border-hairline bg-surface px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-1 truncate text-base font-semibold tabular", toneClass)}>{value}</div>
      <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>
    </div>
  );
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
  return getDateDurationDays(
    getActivityBaselineStart(activity),
    getActivityBaselineFinish(activity),
  );
}

function getActivityBaselineStart(activity: ScheduleActivityRow) {
  return activity.baseline_start_date ?? activity.start_date;
}

function getActivityBaselineFinish(activity: ScheduleActivityRow) {
  return activity.baseline_finish_date ?? activity.finish_date;
}

function getActivityForecastStart(activity: ScheduleActivityRow) {
  return (
    activity.actual_start_date ??
    activity.forecast_start_date ??
    activity.start_date ??
    activity.baseline_start_date
  );
}

function getActivityForecastFinish(activity: ScheduleActivityRow) {
  return (
    activity.actual_finish_date ??
    activity.forecast_finish_date ??
    activity.finish_date ??
    activity.baseline_finish_date
  );
}

function getDateDurationDays(startDate?: string | null, finishDate?: string | null) {
  const start = parseDateMs(startDate);
  const finish = parseDateMs(finishDate);
  if (start == null || finish == null) return null;
  return Math.max(1, Math.round((finish - start) / DAY_MS) + 1);
}

function getTimelineBounds(values: Array<string | null | undefined>): TimelineBounds {
  const parsed = values
    .map((value) => parseDateMs(value))
    .filter((value): value is number => value != null);
  const today = parseDateMs(new Date().toISOString().slice(0, 10)) ?? Date.now();
  const oneWeek = 7 * DAY_MS;
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
