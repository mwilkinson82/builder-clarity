import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Clock,
} from "lucide-react";
import {
  listSchedule,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  createScheduleRisk,
  updateScheduleRisk,
  deleteScheduleRisk,
  type MilestoneStatus,
  type ScheduleRiskKind,
  type MilestoneRow,
  type ScheduleRiskRow,
} from "@/lib/schedule.functions";
import { updateProjectFinancials, type ProjectRow } from "@/lib/projects.functions";

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

const RISK_META: Record<
  ScheduleRiskKind,
  { label: string; icon: typeof PackageSearch; placeholder: string; detailPlaceholder: string }
> = {
  critical_decision: {
    label: "Critical delayed decisions",
    icon: ClipboardList,
    placeholder: "Short title (e.g. Appliance package selection)",
    detailPlaceholder:
      "Who owns it, what's blocked, dollar/schedule impact, mitigation plan, and dates. The more context here, the better the IOR report reads.",
  },
  procurement: {
    label: "Procurement risks",
    icon: PackageSearch,
    placeholder: "Short title (e.g. Window package — manufacturer slip)",
    detailPlaceholder:
      "Lead-time situation, vendor commitments, fallback options, cost impact if expedited, and what triggers escalation.",
  },
  trade_performance: {
    label: "Trade performance risks",
    icon: Users,
    placeholder: "Short title (e.g. Drywall sub — quality + manpower)",
    detailPlaceholder:
      "What's actually happening on site, evidence, sub's response, supplemental crew options, and dollar risk if it continues.",
  },
};

export function ScheduleRisk({ project }: { project: ProjectRow }) {
  const qc = useQueryClient();
  const projectId = project.id;
  const listFn = useServerFn(listSchedule);
  const createMs = useServerFn(createMilestone);
  const updateMs = useServerFn(updateMilestone);
  const deleteMs = useServerFn(deleteMilestone);
  const createRisk = useServerFn(createScheduleRisk);
  const updateRisk = useServerFn(updateScheduleRisk);
  const deleteRisk = useServerFn(deleteScheduleRisk);
  const updateFin = useServerFn(updateProjectFinancials);

  const { data, isLoading } = useQuery({
    queryKey: ["schedule", projectId],
    queryFn: () => listFn({ data: { projectId } }),
  });
  const invalidateSchedule = () => qc.invalidateQueries({ queryKey: ["schedule", projectId] });
  const invalidateProject = () => {
    qc.invalidateQueries({ queryKey: ["project", projectId] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };
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

  const finMut = useMutation({
    mutationFn: (patch: Record<string, unknown>) => updateFin({ data: { projectId, patch } }),
    onSuccess: invalidateProject,
  });

  const milestones = data?.milestones ?? [];
  const risks = data?.risks ?? [];

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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <DateField
            label="Baseline completion"
            value={project.baseline_completion_date}
            onCommit={(v) => finMut.mutate({ baseline_completion_date: v })}
          />
          <DateField
            label="Forecast completion"
            value={project.forecast_completion_date}
            accent
            onCommit={(v) => finMut.mutate({ forecast_completion_date: v })}
          />
          <NumberField
            label="Schedule variance (weeks)"
            value={project.schedule_variance_weeks}
            icon={<Clock className="h-4 w-4" />}
            tone={project.schedule_variance_weeks > 0 ? "danger" : "success"}
            onCommit={(v) => finMut.mutate({ schedule_variance_weeks: v })}
          />
        </div>
      </section>

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
          />
        ))}
      </div>
    </div>
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

function NumberField({
  label,
  value,
  icon,
  tone,
  onCommit,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
  tone?: "danger" | "success";
  onCommit: (v: number) => void;
}) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => {
    setLocal(String(value));
  }, [value]);
  const toneCls =
    tone === "danger" && value > 0
      ? "text-danger"
      : tone === "success" && value <= 0
        ? "text-success"
        : "";
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        {icon} {label}
      </Label>
      <Input
        type="number"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const n = Number(local);
          if (!Number.isFinite(n)) {
            setLocal(String(value));
            return;
          }
          if (n !== value) onCommit(n);
        }}
        className={`tabular ${toneCls}`}
      />
    </div>
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
  useEffect(() => {
    setLocal(row);
  }, [row]);
  const commit = (patch: Partial<MilestoneRow>) => {
    setLocal((s) => ({ ...s, ...patch }));
    onPatch(patch);
  };

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
      <div className="mt-2 flex justify-end">
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_STYLES[local.status]}`}
        >
          {STATUS_LABEL[local.status]}
        </span>
      </div>
    </div>
  );
}

function RiskGroup({
  kind,
  items,
  onAdd,
  onPatch,
  onDelete,
}: {
  kind: ScheduleRiskKind;
  items: ScheduleRiskRow[];
  onAdd: (title: string) => void;
  onPatch: (id: string, patch: Partial<ScheduleRiskRow>) => void;
  onDelete: (id: string) => void;
}) {
  const meta = RISK_META[kind];
  const Icon = meta.icon;
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
                : `${items.length} item${items.length === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>
        <div className="w-full max-w-sm">
          <AddInline placeholder={meta.placeholder} onAdd={onAdd} />
        </div>
      </div>
      <div className="space-y-3">
        {items.map((r) => (
          <RiskItem
            key={r.id}
            row={r}
            detailPlaceholder={meta.detailPlaceholder}
            onPatch={(p) => onPatch(r.id, p)}
            onDelete={() => onDelete(r.id)}
          />
        ))}
      </div>
    </div>
  );
}

function RiskItem({
  row,
  detailPlaceholder,
  onPatch,
  onDelete,
}: {
  row: ScheduleRiskRow;
  detailPlaceholder: string;
  onPatch: (patch: Partial<ScheduleRiskRow>) => void;
  onDelete: () => void;
}) {
  const [local, setLocal] = useState(row);
  useEffect(() => {
    setLocal(row);
  }, [row]);
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
