import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, AlertTriangle, PackageSearch, Users, ClipboardList, Clock } from "lucide-react";
import {
  listSchedule, createMilestone, updateMilestone, deleteMilestone,
  createScheduleRisk, updateScheduleRisk, deleteScheduleRisk,
  type MilestoneStatus, type ScheduleRiskKind, type MilestoneRow, type ScheduleRiskRow,
} from "@/lib/schedule.functions";
import type { ProjectRow } from "@/lib/projects.functions";

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

const RISK_META: Record<ScheduleRiskKind, { label: string; icon: typeof PackageSearch; placeholder: string }> = {
  critical_decision: {
    label: "Critical delayed decisions",
    icon: ClipboardList,
    placeholder: "e.g. Appliance package selection (owner) — blocking MEP rough-in",
  },
  procurement: {
    label: "Procurement risks",
    icon: PackageSearch,
    placeholder: "e.g. Window package — manufacturer slip of 5 weeks",
  },
  trade_performance: {
    label: "Trade performance risks",
    icon: Users,
    placeholder: "e.g. Drywall subcontractor — quality + manpower concerns",
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

  const { data, isLoading } = useQuery({
    queryKey: ["schedule", projectId],
    queryFn: () => listFn({ data: { projectId } }),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["schedule", projectId] });
  const mk = <I,>(fn: (i: { data: I }) => Promise<unknown>) =>
    useMutation({ mutationFn: (i: I) => fn({ data: i }), onSuccess: invalidate });

  const msCreate = mk<{ projectId: string; name: string }>(createMs);
  const msUpdate = mk<{ id: string; patch: Partial<MilestoneRow> }>(updateMs as never);
  const msDelete = mk<{ id: string }>(deleteMs);
  const rCreate = mk<{ projectId: string; kind: ScheduleRiskKind; title: string }>(createRisk);
  const rUpdate = mk<{ id: string; patch: Partial<ScheduleRiskRow> }>(updateRisk as never);
  const rDelete = mk<{ id: string }>(deleteRisk);

  const milestones = data?.milestones ?? [];
  const risks = data?.risks ?? [];

  return (
    <div className="space-y-8">
      {/* Top: completion summary */}
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline md:grid-cols-3">
        <DateCell label="Baseline completion" value={project.baseline_completion_date} />
        <DateCell label="Forecast completion" value={project.forecast_completion_date} accent />
        <div className="bg-card px-6 py-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Variance</div>
          <div className={`mt-1 flex items-center gap-2 font-serif text-2xl tabular ${project.schedule_variance_weeks > 0 ? "text-danger" : "text-success"}`}>
            <Clock className="h-5 w-5" />
            {project.schedule_variance_weeks > 0 ? "+" : ""}{project.schedule_variance_weeks} weeks
          </div>
        </div>
      </div>

      {/* Milestones */}
      <section className="rounded-lg border border-hairline bg-card p-6">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h3 className="font-serif text-2xl text-foreground">Milestones</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Track key dates (dry-in, rough-ins, owner-furnished, substantial completion). Log the reason when something slips.
            </p>
          </div>
          <AddInline
            placeholder="Add a milestone (e.g. Roof dry-in)"
            onAdd={(name) => msCreate.mutate({ projectId, name })}
          />
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : milestones.length === 0 ? (
          <p className="text-sm text-muted-foreground">No milestones yet. Add your first one above.</p>
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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
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

function DateCell({ label, value, accent }: { label: string; value: string | null; accent?: boolean }) {
  const formatted = value
    ? new Date(value + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "—";
  return (
    <div className="bg-card px-6 py-5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={`mt-1 font-serif text-2xl tabular ${accent ? "text-accent" : ""}`}>{formatted}</div>
    </div>
  );
}

function MilestoneRowEditor({
  row, onPatch, onDelete,
}: {
  row: MilestoneRow;
  onPatch: (patch: Partial<MilestoneRow>) => void;
  onDelete: () => void;
}) {
  const [local, setLocal] = useState(row);
  const commit = (patch: Partial<MilestoneRow>) => {
    setLocal((s) => ({ ...s, ...patch }));
    onPatch(patch);
  };

  return (
    <div className="rounded-md border border-hairline bg-surface p-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end">
        <div className="space-y-1 md:col-span-3">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Milestone</Label>
          <Input
            value={local.name}
            onChange={(e) => setLocal({ ...local, name: e.target.value })}
            onBlur={() => row.name !== local.name && commit({ name: local.name })}
          />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Baseline</Label>
          <Input
            type="date"
            value={local.baseline_date ?? ""}
            onChange={(e) => commit({ baseline_date: e.target.value || null })}
          />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Forecast</Label>
          <Input
            type="date"
            value={local.forecast_date ?? ""}
            onChange={(e) => commit({ forecast_date: e.target.value || null })}
          />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</Label>
          <Select
            value={local.status}
            onValueChange={(v) => commit({ status: v as MilestoneStatus })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(STATUS_LABEL) as MilestoneStatus[]).map((s) => (
                <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Owner</Label>
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
            rows={2}
            value={local.delay_reason}
            onChange={(e) => setLocal({ ...local, delay_reason: e.target.value })}
            onBlur={() => row.delay_reason !== local.delay_reason && commit({ delay_reason: local.delay_reason })}
            placeholder="What's causing the slip? Long-lead procurement, owner decision, weather, trade manpower…"
          />
        </div>
      )}
      <div className="mt-2 flex justify-end">
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_STYLES[local.status]}`}>
          {STATUS_LABEL[local.status]}
        </span>
      </div>
    </div>
  );
}

function RiskGroup({
  kind, items, onAdd, onPatch, onDelete,
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
    <div className="rounded-lg border border-hairline bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <div className="rounded-md bg-accent/10 p-1.5 text-accent">
          <Icon className="h-4 w-4" />
        </div>
        <h4 className="text-sm font-semibold text-foreground">{meta.label}</h4>
      </div>
      <div className="space-y-2">
        {items.length === 0 && (
          <p className="text-xs text-muted-foreground">None yet. Add one below.</p>
        )}
        {items.map((r) => (
          <RiskItem key={r.id} row={r} onPatch={(p) => onPatch(r.id, p)} onDelete={() => onDelete(r.id)} />
        ))}
      </div>
      <div className="mt-3">
        <AddInline placeholder={meta.placeholder} onAdd={onAdd} compact />
      </div>
    </div>
  );
}

function RiskItem({
  row, onPatch, onDelete,
}: {
  row: ScheduleRiskRow;
  onPatch: (patch: Partial<ScheduleRiskRow>) => void;
  onDelete: () => void;
}) {
  const [local, setLocal] = useState(row);
  return (
    <div className="group rounded-md border border-hairline bg-surface p-2.5">
      <div className="flex items-start gap-2">
        <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />
        <div className="flex-1 space-y-1.5">
          <Input
            className="h-8 border-0 bg-transparent px-0 text-sm font-medium shadow-none focus-visible:ring-0"
            value={local.title}
            onChange={(e) => setLocal({ ...local, title: e.target.value })}
            onBlur={() => row.title !== local.title && onPatch({ title: local.title })}
          />
          <Textarea
            rows={2}
            className="text-xs"
            placeholder="Add detail, owner, mitigation…"
            value={local.detail}
            onChange={(e) => setLocal({ ...local, detail: e.target.value })}
            onBlur={() => row.detail !== local.detail && onPatch({ detail: local.detail })}
          />
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function AddInline({
  placeholder, onAdd, compact,
}: { placeholder: string; onAdd: (v: string) => void; compact?: boolean }) {
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
        className={compact ? "h-8 text-xs" : "h-9"}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
        placeholder={placeholder}
      />
      <Button size={compact ? "sm" : "sm"} variant="outline" className="gap-1 shrink-0" onClick={submit}>
        <Plus className="h-3.5 w-3.5" /> Add
      </Button>
    </div>
  );
}
