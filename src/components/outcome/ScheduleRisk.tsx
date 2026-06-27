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
} from "lucide-react";
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
  useEffect(() => {
    setCompletionUpdateDraft(project.forecast_completion_date ?? "");
  }, [project.forecast_completion_date]);

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
        },
      }),
    onSuccess: async () => {
      setUpdateNotes("");
      setMoneyNotes("");
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
        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Update explanation
            </Label>
            <Input
              value={updateNotes}
              onChange={(e) => setUpdateNotes(e.target.value)}
              placeholder="What changed since the prior schedule update?"
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
          <Button
            type="button"
            disabled={!completionUpdateDraft || scheduleUpdate.isPending}
            onClick={() => scheduleUpdate.mutate()}
          >
            {scheduleUpdate.isPending ? "Saving..." : "Save update"}
          </Button>
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

function filterMilestones(milestones: MilestoneRow[], view: MilestoneView) {
  if (view === "all") return milestones;
  if (view === "complete") return milestones.filter((m) => m.status === "complete");
  return milestones.filter((m) => m.status !== "complete");
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
  const completedActivities = activities.filter((activity) => activity.percent_complete >= 100).length;
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
  onDeleteActivity,
}: {
  activities: ScheduleActivityRow[];
  milestones: MilestoneRow[];
  project: ProjectRow;
  latestDataDate: string | null;
  onAddActivity: (activity: ActivityCreateInput) => void;
  onSeedActivities: (activities: ActivityCreateInput[]) => void;
  isSeedingActivities: boolean;
  onPatchActivity: (id: string, patch: Partial<ScheduleActivityRow>) => void;
  onDeleteActivity: (id: string) => void;
}) {
  const [draft, setDraft] = useState<ActivityDraft>(() => emptyActivityDraft());
  const [showDraft, setShowDraft] = useState(false);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
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

  const addActivity = () => {
    const name = draft.name.trim();
    if (!name) return;
    onAddActivity({
      activity_id: draft.activity_id.trim() || undefined,
      name,
      division: draft.division.trim() || "General",
      start_date: draft.start_date || null,
      finish_date: draft.finish_date || null,
      percent_complete: parsePercent(draft.percent_complete),
      predecessor_activity_ids: parseActivityIds(draft.predecessor_activity_ids),
      successor_activity_ids: parseActivityIds(draft.successor_activity_ids),
      notes: draft.notes.trim(),
    });
    setDraft(emptyActivityDraft());
    setShowDraft(false);
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

  return (
    <div className="rounded-lg border border-hairline bg-surface p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Schedule workbench
          </div>
          <h4 className="mt-1 font-serif text-2xl text-foreground">Activity table + Gantt</h4>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Build the working job schedule with activity IDs, divisions, start/finish dates,
            progress, and predecessor/successor logic. Baseline and update milestones can still roll
            up into the IOR view above.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
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
            onClick={() => typeof window !== "undefined" && window.print()}
          >
            <Printer className="h-4 w-4" />
            Print
          </Button>
          <Button type="button" className="gap-2" onClick={() => setShowDraft((open) => !open)}>
            <Plus className="h-4 w-4" />
            Add activity
          </Button>
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
          {milestoneSeedRows.length} milestone {milestoneSeedRows.length === 1 ? "is" : "are"} ready
          to become CPM activity rows. Build them once, then add logic ties and update percent
          complete from the schedule workbench.
        </div>
      )}

      {showDraft && (
        <div className="mt-5 rounded-md border border-hairline bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                New activity
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                Add one schedule row now. Dependencies can be typed as comma-separated activity IDs.
              </div>
            </div>
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
                onChange={(e) => setDraft({ ...draft, start_date: e.target.value })}
                className="h-10"
              />
            </LabeledField>
            <LabeledField label="Finish">
              <Input
                type="date"
                value={draft.finish_date}
                onChange={(e) => setDraft({ ...draft, finish_date: e.target.value })}
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
          <div className="mt-3 grid gap-3 lg:grid-cols-[180px_180px_minmax(260px,1fr)_auto] lg:items-end">
            <LabeledField label="Predecessors">
              <Input
                value={draft.predecessor_activity_ids}
                onChange={(e) => setDraft({ ...draft, predecessor_activity_ids: e.target.value })}
                placeholder="A-001, A-002"
                className="h-10 tabular"
              />
            </LabeledField>
            <LabeledField label="Successors">
              <Input
                value={draft.successor_activity_ids}
                onChange={(e) => setDraft({ ...draft, successor_activity_ids: e.target.value })}
                placeholder="A-030"
                className="h-10 tabular"
              />
            </LabeledField>
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
              <Plus className="h-4 w-4" />
              Add activity
            </Button>
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-4 2xl:grid-cols-[minmax(760px,1.05fr)_minmax(680px,0.95fr)]">
        <ActivityRegister
          grouped={grouped}
          onOpenActivity={(activity) => setSelectedActivityId(activity.id)}
          onDeleteActivity={(id) => {
            if (selectedActivityId === id) setSelectedActivityId(null);
            onDeleteActivity(id);
          }}
        />

        <ActivityGanttPanel
          grouped={grouped}
          bounds={bounds}
          dataDatePosition={timelinePosition(latestDataDate, bounds)}
          onOpenActivity={(activity) => setSelectedActivityId(activity.id)}
        />
      </div>

      {selectedActivity && (
        <ActivityDetailDialog
          activity={selectedActivity}
          onClose={() => setSelectedActivityId(null)}
          onSave={(patch) => onPatchActivity(selectedActivity.id, patch)}
          onDelete={() => {
            const id = selectedActivity.id;
            setSelectedActivityId(null);
            onDeleteActivity(id);
          }}
        />
      )}
    </div>
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
  tone?: "default" | "success" | "warning";
}) {
  const toneClass =
    tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-md border border-hairline bg-card p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold tabular ${toneClass}`}>{value}</div>
      <div className="mt-1 truncate text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function LabeledField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function ActivityRegister({
  grouped,
  onOpenActivity,
  onDeleteActivity,
}: {
  grouped: Array<{ division: string; activities: ScheduleActivityRow[] }>;
  onOpenActivity: (activity: ScheduleActivityRow) => void;
  onDeleteActivity: (id: string) => void;
}) {
  const totalActivities = grouped.reduce((sum, group) => sum + group.activities.length, 0);
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-hairline bg-card">
      <div className="flex flex-col gap-2 border-b border-hairline px-4 py-4 sm:flex-row sm:items-end sm:justify-between">
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
      <div className="hidden grid-cols-[64px_minmax(0,1.35fr)_104px_116px_58px_76px_52px] gap-3 border-b border-hairline bg-muted/55 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground lg:grid">
        <div>ID</div>
        <div>Activity</div>
        <div>Division</div>
        <div>Dates</div>
        <div>% done</div>
        <div>Logic</div>
        <div />
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
        grouped.map((group) => (
          <ActivityRegisterGroup
            key={group.division}
            group={group}
            onOpenActivity={onOpenActivity}
            onDeleteActivity={onDeleteActivity}
          />
        ))
      )}
    </div>
  );
}

function ActivityRegisterGroup({
  group,
  onOpenActivity,
  onDeleteActivity,
}: {
  group: { division: string; activities: ScheduleActivityRow[] };
  onOpenActivity: (activity: ScheduleActivityRow) => void;
  onDeleteActivity: (id: string) => void;
}) {
  return (
    <div>
      <div className="border-b border-hairline bg-muted/35 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {group.division} · {group.activities.length} activities
      </div>
      {group.activities.map((activity) => (
        <ActivityRegisterRow
          key={activity.id}
          activity={activity}
          onOpen={() => onOpenActivity(activity)}
          onDelete={() => onDeleteActivity(activity.id)}
        />
      ))}
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
      className="grid cursor-pointer gap-3 border-b border-hairline px-4 py-3 transition-colors last:border-b-0 hover:bg-muted/45 lg:grid-cols-[64px_minmax(0,1.35fr)_104px_116px_58px_76px_52px] lg:items-center"
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
          className="rounded border border-hairline bg-card px-1.5 py-0.5 text-[11px] font-semibold tabular text-foreground"
        >
          {id}
        </span>
      ))}
    </div>
  );
}

function ActivityGanttPanel({
  grouped,
  bounds,
  dataDatePosition,
  onOpenActivity,
}: {
  grouped: Array<{ division: string; activities: ScheduleActivityRow[] }>;
  bounds: TimelineBounds;
  dataDatePosition: number | null;
  onOpenActivity: (activity: ScheduleActivityRow) => void;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-hairline bg-card">
      <div className="flex flex-col gap-3 border-b border-hairline px-4 py-4 lg:flex-row lg:items-end lg:justify-between">
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
      {grouped.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-muted-foreground">
          Add activities to draw the Gantt chart. The chart will show each activity duration,
          percent-complete overlay, and the latest data-date marker.
        </div>
      ) : (
        <div className="max-h-[760px] overflow-y-auto">
          {grouped.map((group) => (
            <div key={group.division}>
              <div className="border-b border-hairline bg-muted/40 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {group.division}
              </div>
              {group.activities.map((activity) => (
                <ActivityGanttRow
                  key={activity.id}
                  activity={activity}
                  bounds={bounds}
                  dataDatePosition={dataDatePosition}
                  onOpen={() => onOpenActivity(activity)}
                />
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
      className="grid w-full gap-3 border-b border-hairline px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/40 lg:grid-cols-[172px_minmax(150px,1fr)_58px] lg:items-center"
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
  onClose,
  onSave,
  onDelete,
}: {
  activity: ScheduleActivityRow;
  onClose: () => void;
  onSave: (patch: Partial<ScheduleActivityRow>) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<ActivityDraft>(() => activityDraftFromRow(activity));
  const duration = getActivityDurationDays(activity);

  useEffect(() => {
    setDraft(activityDraftFromRow(activity));
  }, [activity]);

  const saveActivity = () => {
    const name = draft.name.trim();
    if (!name) return;
    onSave({
      activity_id: draft.activity_id.trim(),
      name,
      division: draft.division.trim() || "General",
      start_date: draft.start_date || null,
      finish_date: draft.finish_date || null,
      percent_complete: parsePercent(draft.percent_complete),
      predecessor_activity_ids: parseActivityIds(draft.predecessor_activity_ids),
      successor_activity_ids: parseActivityIds(draft.successor_activity_ids),
      notes: draft.notes.trim(),
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">CPM activity detail</DialogTitle>
          <DialogDescription>
            Review the full activity, dependency logic, dates, percent complete, and field notes.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-4">
          <ScheduleWorkbenchStat
            label="Activity ID"
            value={activity.activity_id || "No ID"}
            sub={activity.division || "General"}
          />
          <ScheduleWorkbenchStat
            label="Duration"
            value={duration == null ? "No dates" : String(duration)}
            sub={duration == null ? "start / finish needed" : "calendar days"}
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
              activity.predecessor_activity_ids.length + activity.successor_activity_ids.length > 0
                ? "success"
                : "warning"
            }
          />
        </div>

        <div className="rounded-md border border-hairline bg-surface p-4">
          <div className="grid gap-3 lg:grid-cols-[130px_minmax(240px,1fr)_180px_150px_150px_110px]">
            <LabeledField label="Activity ID">
              <Input
                value={draft.activity_id}
                onChange={(e) => setDraft({ ...draft, activity_id: e.target.value })}
                className="h-10 font-semibold tabular"
              />
            </LabeledField>
            <LabeledField label="Activity">
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="h-10"
              />
            </LabeledField>
            <LabeledField label="Division">
              <Input
                value={draft.division}
                onChange={(e) => setDraft({ ...draft, division: e.target.value })}
                className="h-10"
              />
            </LabeledField>
            <LabeledField label="Start">
              <Input
                type="date"
                value={draft.start_date}
                onChange={(e) => setDraft({ ...draft, start_date: e.target.value })}
                className="h-10"
              />
            </LabeledField>
            <LabeledField label="Finish">
              <Input
                type="date"
                value={draft.finish_date}
                onChange={(e) => setDraft({ ...draft, finish_date: e.target.value })}
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

          <div className="mt-3 grid gap-3 lg:grid-cols-[200px_200px_minmax(240px,1fr)]">
            <LabeledField label="Predecessors">
              <Input
                value={draft.predecessor_activity_ids}
                onChange={(e) => setDraft({ ...draft, predecessor_activity_ids: e.target.value })}
                placeholder="A-001, A-002"
                className="h-10 tabular"
              />
            </LabeledField>
            <LabeledField label="Successors">
              <Input
                value={draft.successor_activity_ids}
                onChange={(e) => setDraft({ ...draft, successor_activity_ids: e.target.value })}
                placeholder="A-030"
                className="h-10 tabular"
              />
            </LabeledField>
            <div className="rounded-md border border-hairline bg-card p-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Dependency readout
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold text-muted-foreground">Predecessors</div>
                  <ActivityIdPills
                    ids={parseActivityIds(draft.predecessor_activity_ids)}
                    emptyLabel="No predecessor logic"
                  />
                </div>
                <div>
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
                className="min-h-28 resize-y bg-card"
              />
            </LabeledField>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between sm:space-x-0">
          <Button type="button" variant="outline" className="gap-2 text-danger" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
            Delete activity
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button type="button" onClick={saveActivity} disabled={!draft.name.trim()}>
              Save activity
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
        start_date: milestone.baseline_date,
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
