import { useMemo, useState, type ReactNode } from "react";
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
import { Check, Plus, ShieldAlert } from "lucide-react";
import {
  canSendInspectionToRisk,
  formatImpactWeeks,
  groupInspections,
  INSPECTION_RESULT_OPTIONS,
  INSPECTION_STATUS_OPTIONS,
  InspectionLogRow,
  InspectionsBoard,
} from "./InspectionsBoard";

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
  const [view, setView] = useState<"list" | "board">("list");
  const [showPassed, setShowPassed] = useState(false);

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

  const groups = useMemo(() => groupInspections(orderedInspections), [orderedInspections]);

  const unlinked = useMemo(
    () => orderedInspections.filter(canSendInspectionToRisk),
    [orderedInspections],
  );
  const unlinkedCost = unlinked.reduce((sum, inspection) => sum + inspection.cost_impact, 0);
  const unlinkedWeeks = unlinked.reduce(
    (sum, inspection) => sum + Number(inspection.schedule_impact_weeks ?? 0),
    0,
  );
  const hasUnlinkedExposure = unlinkedCost > 0 || unlinkedWeeks > 0;

  const passedNames = groups.passed.map((inspection) => inspection.inspection_type);
  const passedSummary =
    passedNames.length <= 3
      ? passedNames.join(", ")
      : `${passedNames.slice(0, 3).join(", ")}, and ${passedNames.length - 3} more`;

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
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-md border border-hairline px-2 py-[3px] font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-clay">
          Inspection control
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <div
            className="flex gap-0.5 rounded-[9px] bg-muted p-[3px]"
            role="group"
            aria-label="Inspections view"
          >
            <button
              type="button"
              onClick={() => setView("list")}
              aria-pressed={view === "list"}
              className={cn(
                "whitespace-nowrap rounded-[7px] px-3.5 py-1.5 text-xs transition-colors",
                view === "list"
                  ? "bg-primary font-semibold text-primary-foreground"
                  : "font-medium text-muted-foreground hover:text-foreground",
              )}
            >
              List
            </button>
            <button
              type="button"
              onClick={() => setView("board")}
              aria-pressed={view === "board"}
              className={cn(
                "whitespace-nowrap rounded-[7px] px-3.5 py-1.5 text-xs transition-colors",
                view === "board"
                  ? "bg-primary font-semibold text-primary-foreground"
                  : "font-medium text-muted-foreground hover:text-foreground",
              )}
            >
              Board
            </button>
          </div>
          <Button onClick={openNew} className="gap-1.5">
            <Plus className="h-4 w-4" /> Log inspection
          </Button>
        </div>
      </div>

      <div>
        <h2 className="max-w-[34ch] font-serif text-3xl font-normal leading-[1.16] text-foreground">
          {hasUnlinkedExposure ? (
            <>
              {metrics.failed} inspection{metrics.failed === 1 ? "" : "s"} failed — and{" "}
              <span className="text-danger">
                {fmtUSD(unlinkedCost)} of exposure isn&apos;t in the risk tally yet.
              </span>
            </>
          ) : metrics.failed > 0 ? (
            <>
              {metrics.failed} inspection{metrics.failed === 1 ? "" : "s"} failed — exposure is
              priced into the risk tally.
            </>
          ) : (
            <>
              Inspections are holding — {metrics.passed} passed, {metrics.open} open.
            </>
          )}
        </h2>
        <p className="mt-2 max-w-[70ch] text-sm leading-6 text-muted-foreground">
          A failed or partial inspection is a margin event, not a checkbox. Clear the ones carrying
          cost or schedule impact into Risk Tally before they drift.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <InspectionMetric label="Open" value={String(metrics.open)} />
        <InspectionMetric label="Failed" value={String(metrics.failed)} tone="danger" />
        <InspectionMetric label="Partial" value={String(metrics.partial)} tone="warning" />
        <InspectionMetric label="Passed" value={String(metrics.passed)} tone="success" />
        <InspectionMetric label="Cost impact" value={fmtUSD(metrics.costImpact)} />
        <InspectionMetric
          label="Schedule impact"
          value={`${formatImpactWeeks(metrics.scheduleImpact)} wk`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        {orderedInspections.length === 0 ? (
          <div className="rounded-xl border border-dashed border-hairline bg-card px-5 py-8 text-sm text-muted-foreground">
            No inspections are loaded yet. Add required rough, final, specialty, or AHJ inspections
            so failed attempts can feed schedule and change-order risk.
          </div>
        ) : view === "board" ? (
          <InspectionsBoard
            groups={groups}
            onEdit={openEdit}
            onCreateRisk={onCreateRisk}
            creatingRiskId={creatingRiskId}
          />
        ) : (
          <div className="space-y-3">
            {hasUnlinkedExposure && (
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border border-danger/35 bg-danger/5 px-3.5 py-2.5">
                <span className="h-2 w-2 flex-none rounded-full bg-danger" aria-hidden />
                <span className="text-[12.5px] font-semibold text-foreground">
                  {unlinked.length} outcome{unlinked.length === 1 ? " needs" : "s need"} to reach
                  Risk Tally
                </span>
                <span className="text-xs text-muted-foreground">
                  {fmtUSD(unlinkedCost)} + {formatImpactWeeks(unlinkedWeeks)} wk not yet linked
                </span>
                <button
                  type="button"
                  className="ml-auto whitespace-nowrap text-xs font-semibold text-danger hover:underline disabled:opacity-50"
                  onClick={() => onCreateRisk(unlinked[0])}
                  disabled={creatingRiskId != null}
                >
                  Send the first →
                </button>
              </div>
            )}

            {groups.attention.length > 0 && (
              <>
                <div className="eyebrow text-danger">
                  Needs attention · {groups.attention.length}
                </div>
                {groups.attention.map((inspection) => (
                  <InspectionLogRow
                    key={inspection.id}
                    inspection={inspection}
                    onEdit={() => openEdit(inspection)}
                    onReinspect={() => createReinspection(inspection)}
                    onDelete={() => onDelete(inspection.id)}
                    onCreateRisk={() => onCreateRisk(inspection)}
                    creatingRisk={creatingRiskId === inspection.id}
                  />
                ))}
              </>
            )}

            {groups.scheduled.length > 0 && (
              <>
                <div className="eyebrow pt-1">Upcoming · {groups.scheduled.length}</div>
                {groups.scheduled.map((inspection) => (
                  <InspectionLogRow
                    key={inspection.id}
                    inspection={inspection}
                    onEdit={() => openEdit(inspection)}
                    onReinspect={() => createReinspection(inspection)}
                    onDelete={() => onDelete(inspection.id)}
                    onCreateRisk={() => onCreateRisk(inspection)}
                    creatingRisk={creatingRiskId === inspection.id}
                  />
                ))}
              </>
            )}

            {groups.passed.length > 0 && (
              <>
                <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-hairline bg-card px-4 py-3">
                  <Check className="h-4 w-4 flex-none text-success" />
                  <span className="text-[13px] font-semibold text-foreground">
                    {groups.passed.length} passed
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {passedSummary}
                  </span>
                  <button
                    type="button"
                    className="whitespace-nowrap text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => setShowPassed((value) => !value)}
                    aria-expanded={showPassed}
                  >
                    {showPassed ? "Hide ▴" : "Show all ▾"}
                  </button>
                </div>
                {showPassed &&
                  groups.passed.map((inspection) => (
                    <InspectionLogRow
                      key={inspection.id}
                      inspection={inspection}
                      onEdit={() => openEdit(inspection)}
                      onReinspect={() => createReinspection(inspection)}
                      onDelete={() => onDelete(inspection.id)}
                      onCreateRisk={() => onCreateRisk(inspection)}
                      creatingRisk={creatingRiskId === inspection.id}
                    />
                  ))}
              </>
            )}
          </div>
        )}

        <aside className="rounded-xl border border-hairline bg-card p-4 shadow-card xl:sticky xl:top-6">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-clay" />
            <div className="text-[13px] font-semibold text-foreground">Inspection risk posture</div>
          </div>
          <div className="mt-4 space-y-2.5">
            <RiskReadout
              label="Reinspections"
              value={String(metrics.reinspectionCount)}
              detail="Attempts after the first pass/fail cycle."
            />
            <RiskReadout
              label="Potential CO pressure"
              value={fmtUSD(metrics.costImpact)}
              detail="Cost impact carried by inspection outcomes."
            />
            <RiskReadout
              label="Schedule pressure"
              value={`${formatImpactWeeks(metrics.scheduleImpact)} wk`}
              detail="Inspection-related completion movement to protect."
            />
          </div>
          <p className="mt-4 border-t border-hairline pt-3 text-[11.5px] leading-5 text-muted-foreground">
            Failed or partial inspections should be pushed to Risk Tally when they can create cost,
            owner-delay, trade-recovery, or schedule-compression exposure.
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
          <div className="eyebrow">Inspection control</div>
          <DialogTitle className="font-serif text-2xl font-normal">
            {editing ? "Edit inspection" : "Log inspection"}
          </DialogTitle>
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
                {INSPECTION_STATUS_OPTIONS.map((option) => (
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
                {INSPECTION_RESULT_OPTIONS.map((option) => (
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
      <Label className="font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </Label>
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
        "rounded-lg border border-hairline bg-card px-3.5 py-3",
        tone === "danger" && "border-danger/30 bg-danger/5",
        tone === "warning" && "border-warning/30 bg-warning/5",
        tone === "success" && "border-success/30 bg-success/5",
      )}
    >
      <div className="font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-2 font-serif text-2xl leading-none tabular",
          tone === "danger" && "text-danger",
          tone === "warning" && "text-warning",
          tone === "success" && "text-success",
          tone === "default" && "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function RiskReadout({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-background px-3 py-2.5">
      <div className="font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-serif text-xl tabular text-foreground">{value}</div>
      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{detail}</p>
    </div>
  );
}

function cleanDate(value?: string | null) {
  return value && value.trim() ? value : null;
}
