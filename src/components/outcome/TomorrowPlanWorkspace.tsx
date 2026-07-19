import { useEffect, useMemo, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CalendarCheck2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Pencil,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { DailyWipEntryRow } from "@/lib/daily-wip.functions";
import type { ScheduleActivityRow } from "@/lib/schedule.functions";
import type { SubcontractRow } from "@/lib/subcontracts.functions";
import {
  deleteTomorrowPlanItem,
  listTomorrowPlanItems,
  saveTomorrowPlanItem,
  type TomorrowPlanItemRow,
  type TomorrowPlanStatus,
} from "@/lib/tomorrow-plan.functions";
import { cn } from "@/lib/utils";

interface BucketOption {
  id: string;
  cost_code: string;
  bucket: string;
}

interface TomorrowPlanWorkspaceProps {
  projectId: string;
  buckets: BucketOption[];
  scheduleActivities: ScheduleActivityRow[];
  subcontracts: SubcontractRow[];
  actualEntries: DailyWipEntryRow[];
  initialDate?: string;
}

type Draft = Omit<
  TomorrowPlanItemRow,
  "id" | "project_id" | "confirmed_by" | "confirmed_at" | "created_at" | "updated_at"
>;

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: string, amount: number) => {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + amount);
  return isoDate(next);
};
const tomorrow = () => addDays(isoDate(new Date()), 1);
const formatDate = (date: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
const number = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const emptyDraft = (planDate: string): Draft => ({
  plan_date: planDate,
  schedule_activity_id: null,
  cost_bucket_id: null,
  subcontractor_id: null,
  activity: "",
  work_area: "",
  performer_type: "subcontractor",
  performer_name: "",
  crew_count: 1,
  people_per_crew: 2,
  hours_per_person: 8,
  planned_quantity: 0,
  unit: "",
  target_rate: null,
  materials: "",
  materials_ready: false,
  equipment: "",
  equipment_ready: false,
  information: "",
  information_ready: false,
  inspection: "",
  inspection_ready: false,
  work_area_ready: false,
  status: "at_risk",
  constraint_summary: "",
  constraint_owner: "",
  confirmation_status: "planned",
  notes: "",
});

const statusStyle: Record<TomorrowPlanStatus, string> = {
  ready: "border-success/30 bg-success/5 text-success",
  at_risk: "border-warning/30 bg-warning/5 text-warning-foreground",
  blocked: "border-danger/30 bg-danger/5 text-danger",
};

export function TomorrowPlanWorkspace({
  projectId,
  buckets,
  scheduleActivities,
  subcontracts,
  actualEntries,
  initialDate,
}: TomorrowPlanWorkspaceProps) {
  const client = useQueryClient();
  const listFn = useServerFn(listTomorrowPlanItems);
  const saveFn = useServerFn(saveTomorrowPlanItem);
  const deleteFn = useServerFn(deleteTomorrowPlanItem);
  const [selectedDate, setSelectedDate] = useState(initialDate ?? tomorrow());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(selectedDate));

  useEffect(() => {
    if (initialDate) setSelectedDate(initialDate);
  }, [initialDate]);

  const query = useQuery({
    queryKey: ["tomorrow-plan", projectId],
    queryFn: () => listFn({ data: { projectId } }),
  });
  const save = useMutation({
    mutationFn: () => saveFn({ data: { projectId, id: editingId, item: draft } }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["tomorrow-plan", projectId] });
      setDialogOpen(false);
      toast.success("Tomorrow Plan saved");
    },
    onError: (error) =>
      toast.error("Tomorrow Plan did not save", {
        description: error instanceof Error ? error.message : "Try again.",
      }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { projectId, id } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["tomorrow-plan", projectId] }),
    onError: (error) =>
      toast.error("Plan item did not delete", {
        description: error instanceof Error ? error.message : "Try again.",
      }),
  });

  const items = useMemo(
    () => (query.data?.items ?? []).filter((item) => item.plan_date === selectedDate),
    [query.data?.items, selectedDate],
  );
  const counts = useMemo(
    () => ({
      ready: items.filter((item) => item.status === "ready").length,
      atRisk: items.filter((item) => item.status === "at_risk").length,
      blocked: items.filter((item) => item.status === "blocked").length,
    }),
    [items],
  );
  const headline = counts.blocked
    ? `${counts.blocked} commitment${counts.blocked === 1 ? " is" : "s are"} blocked.`
    : counts.atRisk
      ? `${counts.atRisk} commitment${counts.atRisk === 1 ? " is" : "s are"} at risk.`
      : items.length
        ? "Tomorrow is ready to run."
        : "Build the plan before the field leaves today.";

  const openNew = () => {
    setEditingId(undefined);
    setDraft(emptyDraft(selectedDate));
    setDialogOpen(true);
  };
  const openEdit = (item: TomorrowPlanItemRow) => {
    const {
      id,
      project_id: _projectId,
      confirmed_by: _confirmedBy,
      confirmed_at: _confirmedAt,
      created_at: _createdAt,
      updated_at: _updatedAt,
      ...nextDraft
    } = item;
    setEditingId(id);
    setDraft(nextDraft);
    setDialogOpen(true);
  };

  if (query.data && !query.data.ready) {
    return (
      <div className="rounded-2xl border border-warning/30 bg-warning/5 p-6">
        <p className="font-serif text-2xl text-foreground">Tomorrow Plan is ready in the app.</p>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Publish the pending database migration to turn it on. Daily Reports and Daily WIP continue
          working normally until then.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-hairline bg-card">
        <div className="grid gap-5 p-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
              Field control · Tomorrow Plan
            </p>
            <h2 className="mt-2 font-serif text-3xl text-foreground">{headline}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Today’s field facts become tomorrow’s commitments. Confirm the crew, production
              target, work area, material, equipment, information, and inspection before anyone
              mobilizes.
            </p>
          </div>
          <Button onClick={openNew} className="gap-2">
            <Plus className="h-4 w-4" /> Add commitment
          </Button>
        </div>
        <div className="grid border-t border-hairline sm:grid-cols-3">
          {[
            ["READY", counts.ready, "text-success"],
            ["AT RISK", counts.atRisk, "text-warning-foreground"],
            ["BLOCKED", counts.blocked, "text-danger"],
          ].map(([label, value, color], index) => (
            <div
              key={String(label)}
              className={cn(
                "p-4",
                index > 0 && "border-t border-hairline sm:border-l sm:border-t-0",
              )}
            >
              <p className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
                {label}
              </p>
              <p className={cn("mt-1 font-serif text-3xl", color)}>{value}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setSelectedDate(addDays(selectedDate, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            className="w-40"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => setSelectedDate(addDays(selectedDate, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" onClick={() => setSelectedDate(tomorrow())}>
            Tomorrow
          </Button>
        </div>
        <p className="text-sm font-medium text-foreground">{formatDate(selectedDate)}</p>
      </div>

      {items.length === 0 ? (
        <button
          type="button"
          onClick={openNew}
          className="w-full rounded-2xl border border-dashed border-hairline bg-card px-6 py-12 text-left transition-colors hover:bg-muted/40"
        >
          <CalendarCheck2 className="h-7 w-7 text-accent" />
          <p className="mt-4 font-serif text-2xl text-foreground">What has to happen tomorrow?</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Add the work, resources, output, and readiness conditions before the field leaves today.
          </p>
        </button>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <PlanCard
              key={item.id}
              item={item}
              actualEntries={actualEntries}
              onEdit={() => openEdit(item)}
              onDelete={() => remove.mutate(item.id)}
            />
          ))}
        </div>
      )}

      <PlanDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        draft={draft}
        setDraft={setDraft}
        buckets={buckets}
        scheduleActivities={scheduleActivities}
        subcontracts={subcontracts}
        saving={save.isPending}
        onSave={() => save.mutate()}
        editing={Boolean(editingId)}
      />
    </div>
  );
}

function PlanCard({
  item,
  actualEntries,
  onEdit,
  onDelete,
}: {
  item: TomorrowPlanItemRow;
  actualEntries: DailyWipEntryRow[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const actual = actualEntries.filter((entry) => {
    if (entry.entry_date !== item.plan_date) return false;
    if (item.schedule_activity_id && entry.schedule_activity_id === item.schedule_activity_id)
      return true;
    return (
      entry.cost_bucket_id === item.cost_bucket_id &&
      (!item.subcontractor_id || entry.subcontractor_id === item.subcontractor_id)
    );
  });
  const actualQuantity = actual
    .filter((entry) => entry.unit.toLowerCase() === item.unit.toLowerCase())
    .reduce((sum, entry) => sum + entry.quantity, 0);
  const actualHours = actual.reduce(
    (sum, entry) => sum + entry.crew_count * entry.people_per_crew * entry.hours,
    0,
  );
  const actualRate = actualHours > 0 ? actualQuantity / actualHours : 0;
  const outcome = actual.length
    ? actualQuantity >= item.planned_quantity
      ? "Promise met"
      : "Promise missed"
    : "Awaiting actual";
  const checks = [
    ["Material", item.materials_ready],
    ["Equipment", item.equipment_ready],
    ["Information", item.information_ready],
    ["Inspection", item.inspection_ready],
    ["Work area", item.work_area_ready],
  ] as const;

  return (
    <article className="rounded-2xl border border-hairline bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em]",
                statusStyle[item.status],
              )}
            >
              {item.status.replace("_", " ")}
            </span>
            <span className="text-xs text-muted-foreground">{item.confirmation_status}</span>
          </div>
          <h3 className="mt-3 font-serif text-2xl text-foreground">{item.activity}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {item.performer_name || "Unassigned"} · {item.work_area || "Work area not set"}
          </p>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit commitment">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete commitment">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-5 grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline sm:grid-cols-4">
        {[
          ["CREW", `${item.crew_count} × ${item.people_per_crew} × ${item.hours_per_person} hr`],
          ["PLAN", `${item.planned_quantity.toLocaleString()} ${item.unit}`],
          ["TARGET", item.target_rate ? `${item.target_rate} ${item.unit}/labor hr` : "Not set"],
          [
            "ACTUAL",
            actual.length ? `${actualQuantity.toLocaleString()} ${item.unit}` : "Not logged",
          ],
        ].map(([label, value]) => (
          <div key={label} className="bg-card p-3">
            <p className="font-mono text-[9px] tracking-[0.15em] text-muted-foreground">{label}</p>
            <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {checks.map(([label, ready]) => (
          <span
            key={label}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
              ready ? "border-success/25 text-success" : "border-danger/25 text-danger",
            )}
          >
            {ready ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
            {label}
          </span>
        ))}
      </div>

      {item.constraint_summary ? (
        <div className="mt-4 rounded-xl border border-warning/30 bg-warning/5 p-3 text-sm">
          <p className="font-medium text-foreground">Constraint: {item.constraint_summary}</p>
          <p className="mt-1 text-muted-foreground">
            Owner: {item.constraint_owner || "Assign an owner before the field leaves."}
          </p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-4 text-sm">
        <span className="inline-flex items-center gap-2 font-medium text-foreground">
          {outcome === "Promise met" ? (
            <CheckCircle2 className="h-4 w-4 text-success" />
          ) : outcome === "Promise missed" ? (
            <AlertTriangle className="h-4 w-4 text-danger" />
          ) : (
            <CircleDot className="h-4 w-4 text-muted-foreground" />
          )}
          {outcome}
        </span>
        <span className="text-muted-foreground">
          {actual.length
            ? `${actualHours.toLocaleString()} labor-hours · ${actualRate.toFixed(2)} ${item.unit}/labor hr`
            : "The next Daily WIP entry closes the loop."}
        </span>
      </div>
    </article>
  );
}

function PlanDialog({
  open,
  onOpenChange,
  draft,
  setDraft,
  buckets,
  scheduleActivities,
  subcontracts,
  saving,
  onSave,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  buckets: BucketOption[];
  scheduleActivities: ScheduleActivityRow[];
  subcontracts: SubcontractRow[];
  saving: boolean;
  onSave: () => void;
  editing: boolean;
}) {
  const patch = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const readiness = [
    ["materials_ready", "Material is on site or confirmed", "materials"],
    ["equipment_ready", "Equipment is available and released", "equipment"],
    ["information_ready", "Drawings, decisions, and information are released", "information"],
    ["inspection_ready", "Inspection or quality hold point is scheduled", "inspection"],
    ["work_area_ready", "Work area is open, safe, and predecessor-complete", null],
  ] as const;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <p className="font-mono text-[10px] uppercase tracking-[0.17em] text-accent">
            Tomorrow is built today
          </p>
          <DialogTitle className="font-serif text-2xl">
            {editing ? "Edit the commitment" : "Add tomorrow’s commitment"}
          </DialogTitle>
          <DialogDescription>
            Define the work and remove the reasons it cannot start. This is a field-control promise,
            not a meeting note.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2 md:grid-cols-2">
          <Field label="Plan date">
            <Input
              type="date"
              value={draft.plan_date}
              onChange={(e) => patch("plan_date", e.target.value)}
            />
          </Field>
          <Field label="Activity">
            <Input
              value={draft.activity}
              onChange={(e) => patch("activity", e.target.value)}
              placeholder="What must happen?"
            />
          </Field>
          <Field label="CPM activity">
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={draft.schedule_activity_id ?? ""}
              onChange={(e) => patch("schedule_activity_id", e.target.value || null)}
            >
              <option value="">Not linked</option>
              {scheduleActivities.map((activity) => (
                <option key={activity.id} value={activity.id}>
                  {activity.activity_id} · {activity.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cost code / SOV line">
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={draft.cost_bucket_id ?? ""}
              onChange={(e) => patch("cost_bucket_id", e.target.value || null)}
            >
              <option value="">Not linked</option>
              {buckets.map((bucket) => (
                <option key={bucket.id} value={bucket.id}>
                  {bucket.cost_code} · {bucket.bucket}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Performed by">
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={draft.subcontractor_id ?? ""}
              onChange={(e) => {
                const match = subcontracts.find((sub) => sub.subcontractor_id === e.target.value);
                patch("subcontractor_id", e.target.value || null);
                if (match) patch("performer_name", match.title.split(" — ")[0]);
              }}
            >
              <option value="">Self-perform, vendor, or unlisted</option>
              {subcontracts.map((sub) => (
                <option key={sub.id} value={sub.subcontractor_id}>
                  {sub.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Company / crew name">
            <Input
              value={draft.performer_name}
              onChange={(e) => patch("performer_name", e.target.value)}
              placeholder="Who owns the work?"
            />
          </Field>
          <Field label="Work area">
            <Input
              value={draft.work_area}
              onChange={(e) => patch("work_area", e.target.value)}
              placeholder="Where can the crew start?"
            />
          </Field>
          <Field label="Status">
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={draft.status}
              onChange={(e) => patch("status", e.target.value as TomorrowPlanStatus)}
            >
              <option value="ready">Ready</option>
              <option value="at_risk">At risk</option>
              <option value="blocked">Blocked</option>
            </select>
          </Field>
        </div>

        <div className="grid gap-3 rounded-xl border border-hairline p-4 sm:grid-cols-6">
          <NumberField
            label="Crews"
            value={draft.crew_count}
            onChange={(value) => patch("crew_count", value)}
          />
          <NumberField
            label="People / crew"
            value={draft.people_per_crew}
            onChange={(value) => patch("people_per_crew", value)}
          />
          <NumberField
            label="Hours / person"
            value={draft.hours_per_person}
            onChange={(value) => patch("hours_per_person", value)}
          />
          <NumberField
            label="Planned qty"
            value={draft.planned_quantity}
            onChange={(value) => patch("planned_quantity", value)}
          />
          <Field label="Unit">
            <Input
              value={draft.unit}
              onChange={(e) => patch("unit", e.target.value)}
              placeholder="LF, SF, EA"
            />
          </Field>
          <NumberField
            label="Target / labor hr"
            value={draft.target_rate ?? 0}
            onChange={(value) => patch("target_rate", value || null)}
          />
        </div>

        <div className="mt-4 space-y-3 rounded-xl border border-hairline p-4">
          <div>
            <p className="text-sm font-medium text-foreground">Readiness gate</p>
            <p className="text-xs text-muted-foreground">
              Unchecked items are tomorrow’s constraints.
            </p>
          </div>
          {readiness.map(([key, label, detailKey]) => (
            <div
              key={key}
              className="grid gap-2 border-t border-hairline pt-3 md:grid-cols-[18px_240px_1fr] md:items-center"
            >
              <Checkbox
                checked={draft[key]}
                onCheckedChange={(checked) => patch(key, checked === true)}
              />
              <Label>{label}</Label>
              {detailKey ? (
                <Input
                  value={draft[detailKey]}
                  onChange={(e) => patch(detailKey, e.target.value)}
                  placeholder="What is required or confirmed?"
                />
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Constraint / reason this may not start">
            <Input
              value={draft.constraint_summary}
              onChange={(e) => patch("constraint_summary", e.target.value)}
              placeholder="Name the constraint plainly"
            />
          </Field>
          <Field label="Constraint owner">
            <Input
              value={draft.constraint_owner}
              onChange={(e) => patch("constraint_owner", e.target.value)}
              placeholder="One person owns the release"
            />
          </Field>
        </div>

        <DialogFooter className="mt-5">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving || !draft.activity.trim()} onClick={onSave}>
            {saving ? "Saving…" : "Save commitment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        min="0"
        value={value}
        onChange={(e) => onChange(number(e.target.value))}
      />
    </Field>
  );
}
