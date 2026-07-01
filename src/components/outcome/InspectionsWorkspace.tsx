import { useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fmtUSD } from "@/lib/format";
import type { InspectionResult, InspectionRow, InspectionStatus } from "@/lib/projects.functions";
import { cn } from "@/lib/utils";
import { ClipboardList, Pencil, Plus, RotateCcw, ShieldAlert, Trash2 } from "lucide-react";

export type InspectionDraft = {
  parent_inspection_id?: string | null;
  inspection_type: string;
  authority: string;
  location: string;
  responsible_party: string;
  inspector: string;
  requested_date?: string | null;
  scheduled_date?: string | null;
  completed_date?: string | null;
  status: InspectionStatus;
  result: InspectionResult;
  attempt_number: number;
  required_reinspection: boolean;
  cost_impact: number;
  schedule_impact_weeks?: number | null;
  notes: string;
  corrective_action: string;
  risk_exposure_id?: string | null;
};

export type InspectionPatch = Partial<InspectionDraft>;

type InspectionsWorkspaceProps = {
  inspections: InspectionRow[];
  onCreate: (input: InspectionDraft) => void;
  onUpdate: (id: string, patch: InspectionPatch) => void;
  onDelete: (id: string) => void;
  onCreateRisk: (inspection: InspectionRow) => void;
  savingInspection?: boolean;
  creatingRiskId?: string | null;
};

const STATUS_OPTIONS: Array<{ value: InspectionStatus; label: string }> = [
  { value: "planned", label: "Planned" },
  { value: "requested", label: "Requested" },
  { value: "scheduled", label: "Scheduled" },
  { value: "passed", label: "Passed" },
  { value: "failed", label: "Failed" },
  { value: "partial", label: "Partial" },
  { value: "cancelled", label: "Cancelled" },
];

const RESULT_OPTIONS: Array<{ value: InspectionResult; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "pass", label: "Pass" },
  { value: "fail", label: "Fail" },
  { value: "partial", label: "Partial" },
  { value: "cancelled", label: "Cancelled" },
];

const emptyInspectionDraft = (): InspectionDraft => ({
  parent_inspection_id: null,
  inspection_type: "",
  authority: "",
  location: "",
  responsible_party: "",
  inspector: "",
  requested_date: null,
  scheduled_date: null,
  completed_date: null,
  status: "planned",
  result: "pending",
  attempt_number: 1,
  required_reinspection: false,
  cost_impact: 0,
  schedule_impact_weeks: null,
  notes: "",
  corrective_action: "",
  risk_exposure_id: null,
});

const inspectionToDraft = (inspection: InspectionRow): InspectionDraft => ({
  parent_inspection_id: inspection.parent_inspection_id,
  inspection_type: inspection.inspection_type,
  authority: inspection.authority,
  location: inspection.location,
  responsible_party: inspection.responsible_party,
  inspector: inspection.inspector,
  requested_date: inspection.requested_date,
  scheduled_date: inspection.scheduled_date,
  completed_date: inspection.completed_date,
  status: inspection.status,
  result: inspection.result,
  attempt_number: inspection.attempt_number,
  required_reinspection: inspection.required_reinspection,
  cost_impact: inspection.cost_impact,
  schedule_impact_weeks: inspection.schedule_impact_weeks,
  notes: inspection.notes,
  corrective_action: inspection.corrective_action,
  risk_exposure_id: inspection.risk_exposure_id,
});

function normalizeDraft(draft: InspectionDraft): InspectionDraft {
  const result = draft.result;
  const status =
    result === "pass"
      ? "passed"
      : result === "fail"
        ? "failed"
        : result === "partial"
          ? "partial"
          : result === "cancelled"
            ? "cancelled"
            : draft.status;

  return {
    ...draft,
    inspection_type: draft.inspection_type.trim(),
    authority: draft.authority.trim(),
    location: draft.location.trim(),
    responsible_party: draft.responsible_party.trim(),
    inspector: draft.inspector.trim(),
    requested_date: cleanDate(draft.requested_date),
    scheduled_date: cleanDate(draft.scheduled_date),
    completed_date: cleanDate(draft.completed_date),
    status,
    attempt_number: Math.max(1, Math.round(Number(draft.attempt_number) || 1)),
    cost_impact: Math.max(0, Number(draft.cost_impact) || 0),
    schedule_impact_weeks:
      draft.schedule_impact_weeks == null
        ? null
        : Math.max(0, Number(draft.schedule_impact_weeks) || 0),
    notes: draft.notes.trim(),
    corrective_action: draft.corrective_action.trim(),
  };
}

export function InspectionsWorkspace({
  inspections,
  onCreate,
  onUpdate,
  onDelete,
  onCreateRisk,
  savingInspection = false,
  creatingRiskId = null,
}: InspectionsWorkspaceProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<InspectionDraft>(() => emptyInspectionDraft());

  const orderedInspections = useMemo(
    () =>
      [...inspections].sort((a, b) => {
        const aDate = a.scheduled_date || a.requested_date || a.created_at || "";
        const bDate = b.scheduled_date || b.requested_date || b.created_at || "";
        return aDate.localeCompare(bDate) || a.attempt_number - b.attempt_number;
      }),
    [inspections],
  );

  const metrics = useMemo(() => {
    const open = inspections.filter(
      (inspection) => !["passed", "cancelled"].includes(inspection.status),
    );
    const failed = inspections.filter(
      (inspection) => inspection.status === "failed" || inspection.result === "fail",
    );
    const partial = inspections.filter(
      (inspection) => inspection.status === "partial" || inspection.result === "partial",
    );
    const reinspectionCount = inspections.filter(
      (inspection) => inspection.attempt_number > 1 || inspection.parent_inspection_id,
    ).length;
    const impactRows = inspections.filter(
      (inspection) =>
        inspection.cost_impact > 0 ||
        Number(inspection.schedule_impact_weeks ?? 0) > 0 ||
        inspection.status === "failed" ||
        inspection.result === "fail" ||
        inspection.status === "partial" ||
        inspection.result === "partial",
    );

    return {
      open: open.length,
      failed: failed.length,
      partial: partial.length,
      passed: inspections.filter((inspection) => inspection.status === "passed").length,
      reinspectionCount,
      costImpact: impactRows.reduce((sum, inspection) => sum + inspection.cost_impact, 0),
      scheduleImpact: impactRows.reduce(
        (sum, inspection) => sum + Number(inspection.schedule_impact_weeks ?? 0),
        0,
      ),
    };
  }, [inspections]);

  const openNew = () => {
    setEditingId(null);
    setDraft(emptyInspectionDraft());
    setDialogOpen(true);
  };

  const openEdit = (inspection: InspectionRow) => {
    setEditingId(inspection.id);
    setDraft(inspectionToDraft(inspection));
    setDialogOpen(true);
  };

  const createReinspection = (inspection: InspectionRow) => {
    setEditingId(null);
    setDraft({
      ...inspectionToDraft(inspection),
      parent_inspection_id: inspection.id,
      requested_date: null,
      scheduled_date: null,
      completed_date: null,
      status: "requested",
      result: "pending",
      attempt_number: inspection.attempt_number + 1,
      required_reinspection: false,
      cost_impact: 0,
      schedule_impact_weeks: null,
      notes: `Reinspection for ${inspection.inspection_type}.`,
      corrective_action: inspection.corrective_action,
      risk_exposure_id: inspection.risk_exposure_id,
    });
    setDialogOpen(true);
  };

  const saveDraft = () => {
    const next = normalizeDraft(draft);
    if (!next.inspection_type) return;
    if (editingId) {
      onUpdate(editingId, next);
    } else {
      onCreate(next);
    }
    setDialogOpen(false);
    setEditingId(null);
    setDraft(emptyInspectionDraft());
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Inspection control
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Load required inspections, track each attempt, and convert failures or schedule impact
            into the IOR risk tally before they become margin drift.
          </p>
        </div>
        <Button onClick={openNew} className="gap-1.5">
          <Plus className="h-4 w-4" /> Log inspection
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <InspectionMetric label="Open" value={String(metrics.open)} />
        <InspectionMetric label="Failed" value={String(metrics.failed)} tone="danger" />
        <InspectionMetric label="Partial" value={String(metrics.partial)} tone="warning" />
        <InspectionMetric label="Passed" value={String(metrics.passed)} tone="success" />
        <InspectionMetric label="Cost impact" value={fmtUSD(metrics.costImpact)} />
        <InspectionMetric
          label="Schedule impact"
          value={`${formatNumber(metrics.scheduleImpact)} wk`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          {orderedInspections.length === 0 ? (
            <div className="rounded-lg border border-dashed border-hairline bg-card px-5 py-8 text-sm text-muted-foreground">
              No inspections are loaded yet. Add required rough, final, specialty, or AHJ
              inspections so failed attempts can feed schedule and change-order risk.
            </div>
          ) : (
            orderedInspections.map((inspection) => (
              <InspectionLogRow
                key={inspection.id}
                inspection={inspection}
                onEdit={() => openEdit(inspection)}
                onReinspect={() => createReinspection(inspection)}
                onDelete={() => onDelete(inspection.id)}
                onCreateRisk={() => onCreateRisk(inspection)}
                creatingRisk={creatingRiskId === inspection.id}
              />
            ))
          )}
        </div>

        <aside className="rounded-lg border border-hairline bg-card p-4 shadow-card xl:sticky xl:top-6">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-accent" />
            <div className="text-sm font-semibold text-foreground">Inspection risk posture</div>
          </div>
          <div className="mt-4 space-y-3 text-sm">
            <RiskReadout
              label="Reinspections"
              value={String(metrics.reinspectionCount)}
              detail="Attempts after the first pass/fail cycle."
            />
            <RiskReadout
              label="Potential CO pressure"
              value={fmtUSD(metrics.costImpact)}
              detail="Cost impact currently carried by inspection outcomes."
            />
            <RiskReadout
              label="Schedule pressure"
              value={`${formatNumber(metrics.scheduleImpact)} wk`}
              detail="Inspection-related float or completion movement to protect."
            />
          </div>
          <p className="mt-4 border-t border-hairline pt-3 text-xs leading-5 text-muted-foreground">
            Failed or partial inspections should be pushed to Risk Tally when they can create cost,
            owner-delay, trade recovery, or schedule-compression exposure.
          </p>
        </aside>
      </div>

      <InspectionDialog
        open={dialogOpen}
        editing={Boolean(editingId)}
        draft={draft}
        saving={savingInspection}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingId(null);
            setDraft(emptyInspectionDraft());
          }
        }}
        onDraftChange={setDraft}
        onSave={saveDraft}
      />
    </div>
  );
}

function InspectionLogRow({
  inspection,
  onEdit,
  onReinspect,
  onDelete,
  onCreateRisk,
  creatingRisk,
}: {
  inspection: InspectionRow;
  onEdit: () => void;
  onReinspect: () => void;
  onDelete: () => void;
  onCreateRisk: () => void;
  creatingRisk: boolean;
}) {
  const canCreateRisk =
    !inspection.risk_exposure_id &&
    (inspection.status === "failed" ||
      inspection.status === "partial" ||
      inspection.result === "fail" ||
      inspection.result === "partial" ||
      inspection.cost_impact > 0 ||
      Number(inspection.schedule_impact_weeks ?? 0) > 0);

  return (
    <article className="rounded-lg border border-hairline bg-card p-4 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-foreground">
              {inspection.inspection_type}
            </h3>
            <InspectionBadge status={inspection.status} result={inspection.result} />
            {inspection.required_reinspection && (
              <Badge variant="outline" className="border-warning/40 text-warning">
                Reinspection required
              </Badge>
            )}
            {inspection.risk_exposure_id && (
              <Badge variant="outline" className="border-accent/40 text-accent">
                Risk linked
              </Badge>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Attempt {inspection.attempt_number} / {inspection.authority || "Authority not set"}
            {inspection.location ? ` / ${inspection.location}` : ""}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={onReinspect}>
            <RotateCcw className="h-3.5 w-3.5" /> Reinspection
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={onCreateRisk}
            disabled={!canCreateRisk || creatingRisk}
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            {inspection.risk_exposure_id
              ? "Risk linked"
              : creatingRisk
                ? "Sending"
                : "Send to risk"}
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5 text-danger" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <InspectionDetail label="Scheduled" value={formatDate(inspection.scheduled_date)} />
        <InspectionDetail label="Completed" value={formatDate(inspection.completed_date)} />
        <InspectionDetail label="Responsible" value={inspection.responsible_party || "-"} />
        <InspectionDetail label="Cost impact" value={fmtUSD(inspection.cost_impact)} />
        <InspectionDetail
          label="Schedule impact"
          value={`${formatNumber(Number(inspection.schedule_impact_weeks ?? 0))} wk`}
        />
      </div>

      {(inspection.notes || inspection.corrective_action) && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {inspection.notes && (
            <div className="rounded-md border border-hairline bg-surface px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Notes
              </div>
              <p className="mt-1 text-sm leading-5 text-foreground">{inspection.notes}</p>
            </div>
          )}
          {inspection.corrective_action && (
            <div className="rounded-md border border-hairline bg-surface px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Corrective action
              </div>
              <p className="mt-1 text-sm leading-5 text-foreground">
                {inspection.corrective_action}
              </p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function InspectionDialog({
  open,
  editing,
  draft,
  saving,
  onOpenChange,
  onDraftChange,
  onSave,
}: {
  open: boolean;
  editing: boolean;
  draft: InspectionDraft;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (draft: InspectionDraft) => void;
  onSave: () => void;
}) {
  const setDraft = (patch: Partial<InspectionDraft>) => onDraftChange({ ...draft, ...patch });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit inspection" : "Log inspection"}</DialogTitle>
          <DialogDescription>
            Record the inspection attempt, outcome, corrective action, and cost or schedule impact.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Inspection type">
            <Input
              value={draft.inspection_type}
              onChange={(event) => setDraft({ inspection_type: event.target.value })}
              placeholder="Electrical rough-in inspection"
            />
          </Field>
          <Field label="Authority / AHJ">
            <Input
              value={draft.authority}
              onChange={(event) => setDraft({ authority: event.target.value })}
              placeholder="City Building Department"
            />
          </Field>
          <Field label="Location">
            <Input
              value={draft.location}
              onChange={(event) => setDraft({ location: event.target.value })}
              placeholder="Kitchen, service entry, pool equipment"
            />
          </Field>
          <Field label="Responsible party">
            <Input
              value={draft.responsible_party}
              onChange={(event) => setDraft({ responsible_party: event.target.value })}
              placeholder="Subcontractor, PM, vendor, or owner"
            />
          </Field>
          <Field label="Inspector">
            <Input
              value={draft.inspector}
              onChange={(event) => setDraft({ inspector: event.target.value })}
              placeholder="Inspector name"
            />
          </Field>
          <Field label="Attempt">
            <Input
              type="number"
              min={1}
              value={draft.attempt_number}
              onChange={(event) => setDraft({ attempt_number: Number(event.target.value) || 1 })}
            />
          </Field>
          <Field label="Requested date">
            <Input
              type="date"
              value={draft.requested_date ?? ""}
              onChange={(event) => setDraft({ requested_date: cleanDate(event.target.value) })}
            />
          </Field>
          <Field label="Scheduled date">
            <Input
              type="date"
              value={draft.scheduled_date ?? ""}
              onChange={(event) => setDraft({ scheduled_date: cleanDate(event.target.value) })}
            />
          </Field>
          <Field label="Completed date">
            <Input
              type="date"
              value={draft.completed_date ?? ""}
              onChange={(event) => setDraft({ completed_date: cleanDate(event.target.value) })}
            />
          </Field>
          <Field label="Status">
            <Select
              value={draft.status}
              onValueChange={(value) => setDraft({ status: value as InspectionStatus })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Result">
            <Select
              value={draft.result}
              onValueChange={(value) => setDraft({ result: value as InspectionResult })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESULT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Cost impact">
            <MoneyInput
              value={draft.cost_impact}
              onValueChange={(cost_impact) => setDraft({ cost_impact })}
            />
          </Field>
          <Field label="Schedule impact weeks">
            <Input
              type="number"
              min={0}
              step={0.25}
              value={draft.schedule_impact_weeks ?? ""}
              onChange={(event) =>
                setDraft({
                  schedule_impact_weeks:
                    event.target.value === "" ? null : Number(event.target.value),
                })
              }
            />
          </Field>
          <Field label="Reinspection required">
            <Select
              value={draft.required_reinspection ? "yes" : "no"}
              onValueChange={(value) => setDraft({ required_reinspection: value === "yes" })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no">No</SelectItem>
                <SelectItem value="yes">Yes</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Notes">
            <Textarea
              rows={4}
              value={draft.notes}
              onChange={(event) => setDraft({ notes: event.target.value })}
              placeholder="Inspection context, documents, photos, or field notes."
            />
          </Field>
          <Field label="Corrective action">
            <Textarea
              rows={4}
              value={draft.corrective_action}
              onChange={(event) => setDraft({ corrective_action: event.target.value })}
              placeholder="What has to happen before the next pass."
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={saving || !draft.inspection_type.trim()}>
            {saving ? "Saving" : editing ? "Save inspection" : "Log inspection"}
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

function InspectionMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "danger" | "warning" | "success";
}) {
  return (
    <div
      className={cn(
        "flex min-h-[72px] flex-col justify-between rounded-md border border-hairline bg-card px-3 py-2 shadow-card",
        tone === "danger" && "border-danger/30 bg-danger/5",
        tone === "warning" && "border-warning/30 bg-warning/5",
        tone === "success" && "border-success/30 bg-success/5",
      )}
    >
      <div className="text-[10px] font-semibold uppercase leading-snug tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="pt-2 text-lg font-medium tabular leading-none text-foreground">{value}</div>
    </div>
  );
}

function InspectionDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-hairline bg-surface px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 min-h-[20px] text-sm font-medium tabular text-foreground">{value}</div>
    </div>
  );
}

function RiskReadout({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-md border border-hairline bg-surface px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-lg font-medium tabular text-foreground">{value}</div>
      <p className="mt-1 text-xs leading-4 text-muted-foreground">{detail}</p>
    </div>
  );
}

function InspectionBadge({
  status,
  result,
}: {
  status: InspectionStatus;
  result: InspectionResult;
}) {
  const label =
    result !== "pending"
      ? RESULT_OPTIONS.find((option) => option.value === result)?.label
      : STATUS_OPTIONS.find((option) => option.value === status)?.label;
  return (
    <Badge
      variant="outline"
      className={cn(
        "capitalize",
        (status === "failed" || result === "fail") && "border-danger/40 text-danger",
        (status === "partial" || result === "partial") && "border-warning/40 text-warning",
        (status === "passed" || result === "pass") && "border-success/40 text-success",
        status === "scheduled" && result === "pending" && "border-accent/40 text-accent",
      )}
    >
      <ClipboardList className="mr-1.5 h-3 w-3" />
      {label ?? status}
    </Badge>
  );
}

function cleanDate(value?: string | null) {
  return value && value.trim() ? value : null;
}

function formatDate(value: string | null) {
  return value ? value.slice(0, 10) : "-";
}

function formatNumber(value: number) {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
