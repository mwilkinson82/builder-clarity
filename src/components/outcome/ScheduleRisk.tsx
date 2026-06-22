import { useState, useEffect } from "react";
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
import {
  Plus,
  Trash2,
  AlertTriangle,
  PackageSearch,
  Users,
  ClipboardList,
  Pencil,
  CheckCircle2,
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
  const [forecastDraft, setForecastDraft] = useState(project.forecast_completion_date ?? "");
  const [updateDate, setUpdateDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [updateNotes, setUpdateNotes] = useState("");

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
  const useScheduleMutation = <I,>(fn: (i: { data: I }) => Promise<unknown>) =>
    useMutation({ mutationFn: (i: I) => fn({ data: i }), onSuccess: invalidateSchedule });

  const msCreate = useScheduleMutation<{ projectId: string; name: string }>(createMs);
  const msUpdate = useScheduleMutation<{ id: string; patch: Partial<MilestoneRow> }>(
    updateMs as never,
  );
  const msDelete = useScheduleMutation<{ id: string }>(deleteMs);
  const rCreate = useScheduleMutation<{ projectId: string; kind: ScheduleRiskKind; title: string }>(
    createRisk,
  );
  const rUpdate = useScheduleMutation<{ id: string; patch: Partial<ScheduleRiskRow> }>(
    updateRisk as never,
  );
  const rDelete = useScheduleMutation<{ id: string }>(deleteRisk);

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
  });

  const milestones = data?.milestones ?? [];
  const risks = data?.risks ?? [];
  const updates = data?.updates ?? [];
  const milestoneUpdates = data?.milestoneUpdates ?? [];
  const lastScheduleUpdate = updates[0] ?? null;
  const lastMovementWeeks = lastScheduleUpdate
    ? lastScheduleUpdate.movement_weeks
    : weeksBetween(lastReviewForecast, project.forecast_completion_date);
  const scheduleVariance = computeScheduleVarianceWeeks(
    project.baseline_completion_date,
    forecastDraft || project.forecast_completion_date,
  );
  useEffect(() => {
    setForecastDraft(project.forecast_completion_date ?? "");
  }, [project.forecast_completion_date]);

  const scheduleUpdate = useMutation({
    mutationFn: () =>
      createUpdate({
        data: {
          projectId,
          forecast_completion_date: forecastDraft,
          update_date: updateDate,
          notes: updateNotes,
        },
      }),
    onSuccess: async () => {
      setUpdateNotes("");
      await Promise.all([invalidateSchedule(), invalidateProject()]);
      toast.success("Schedule update saved", {
        description: "Forecast movement has been added to the schedule history.",
      });
    },
    onError: (error) => {
      toast.error("Schedule update did not save", {
        description:
          error instanceof Error ? error.message : "Check the forecast date and try again.",
      });
    },
  });

  return (
    <div className="space-y-8">
      {/* Top: editable completion summary */}
      <section className="rounded-lg border border-hairline bg-card p-6">
        <div className="mb-4">
          <h3 className="font-serif text-2xl text-foreground">Project completion</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Baseline is what you committed to. Forecast is what you actually believe. Both feed the
            IOR report.
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
            label="Forecast completion"
            value={forecastDraft}
            accent
            onCommit={(v) => setForecastDraft(v ?? "")}
          />
          <ScheduleVarianceCard value={scheduleVariance} />
          <ScheduleDeltaCard value={lastMovementWeeks} />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-end">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Update date
            </Label>
            <Input type="date" value={updateDate} onChange={(e) => setUpdateDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Schedule movement note
            </Label>
            <Input
              value={updateNotes}
              onChange={(e) => setUpdateNotes(e.target.value)}
              placeholder="What changed since the last schedule update?"
            />
          </div>
          <Button
            type="button"
            disabled={!forecastDraft || scheduleUpdate.isPending}
            onClick={() => scheduleUpdate.mutate()}
          >
            {scheduleUpdate.isPending ? "Saving..." : "Save schedule update"}
          </Button>
        </div>
      </section>

      <ScheduleUpdateLedger updates={updates} milestoneUpdates={milestoneUpdates} />

      {/* Interim milestones */}
      <section className="rounded-lg border border-hairline bg-card p-6">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="font-serif text-2xl text-foreground">Interim milestones</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Dry-in, rough-ins, owner-furnished deliveries, substantial completion — anything
              between today and project completion. Log the reason whenever something slips.
            </p>
          </div>
          <AddInline
            placeholder="Add interim milestone (e.g. Roof dry-in)"
            onAdd={(name) => msCreate.mutate({ projectId, name })}
          />
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : milestones.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No interim milestones yet. Add your first one above.
          </p>
        ) : (
          <div className="space-y-3">
            {milestones.map((m) => (
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
      ? "No prior IOR"
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
        Since last schedule update
      </Label>
      <div
        className={`flex h-9 items-center rounded-md border border-input px-3 text-sm tabular ${tone}`}
      >
        {label}
      </div>
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
          No formal schedule updates have been saved yet. The next saved forecast becomes update 1.
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
          Each saved update records forecast movement against the baseline and the prior update.
        </p>
      </div>
      <div className="overflow-hidden rounded-md border border-hairline">
        <div className="grid grid-cols-[72px_110px_1fr_110px_110px_90px] bg-surface px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <div>Update</div>
          <div>Date</div>
          <div>Forecast</div>
          <div>Variance</div>
          <div>Movement</div>
          <div>Milestones</div>
        </div>
        {updates.map((update) => (
          <div
            key={update.id}
            className="grid grid-cols-[72px_110px_1fr_110px_110px_90px] items-start border-t border-hairline px-3 py-3 text-sm"
          >
            <div className="font-medium tabular text-foreground">#{update.update_number}</div>
            <div className="text-muted-foreground">{shortDate(update.update_date)}</div>
            <div>
              <div className="font-medium text-foreground">
                {shortDate(update.forecast_completion_date)}
              </div>
              {update.notes && (
                <div className="mt-1 max-w-2xl text-xs text-muted-foreground">{update.notes}</div>
              )}
            </div>
            <div className={`tabular ${varianceTone(update.variance_weeks)}`}>
              {varianceLabel(update.variance_weeks)}
            </div>
            <div className={`tabular ${varianceTone(update.movement_weeks)}`}>
              {varianceLabel(update.movement_weeks)}
            </div>
            <div className="tabular text-muted-foreground">
              {milestoneCountByUpdate[update.update_number] ?? 0}
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
            <CompactField label="Forecast" value={shortDate(local.forecast_date)} />
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
            Forecast
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
  const visibleItems = statusView === "all" ? items : items.filter((r) => r.status === statusView);
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
