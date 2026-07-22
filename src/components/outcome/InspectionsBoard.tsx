import type { KeyboardEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { fmtUSD } from "@/lib/format";
import type { InspectionResult, InspectionRow, InspectionStatus } from "@/lib/projects.functions";
import { cn } from "@/lib/utils";
import { Pencil, RotateCcw, ShieldAlert, Trash2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Shared inspection presentation helpers. InspectionsWorkspace (the list view)
// imports these so both views read status, severity, and risk-readiness with
// the exact same rules — one source of truth, no drift between List and Board.
// ---------------------------------------------------------------------------

export const INSPECTION_STATUS_OPTIONS: Array<{ value: InspectionStatus; label: string }> = [
  { value: "planned", label: "Planned" },
  { value: "requested", label: "Requested" },
  { value: "scheduled", label: "Scheduled" },
  { value: "passed", label: "Passed" },
  { value: "failed", label: "Failed" },
  { value: "partial", label: "Partial" },
  { value: "cancelled", label: "Cancelled" },
];

export const INSPECTION_RESULT_OPTIONS: Array<{ value: InspectionResult; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "pass", label: "Pass" },
  { value: "fail", label: "Fail" },
  { value: "partial", label: "Partial" },
  { value: "cancelled", label: "Cancelled" },
];

export type InspectionSeverity = "crit" | "warn" | "good" | "none";

/** Failed → crit, partial → warn, passed → good, everything else → none. */
export function inspectionSeverity(
  inspection: Pick<InspectionRow, "status" | "result">,
): InspectionSeverity {
  if (inspection.status === "failed" || inspection.result === "fail") return "crit";
  if (inspection.status === "partial" || inspection.result === "partial") return "warn";
  if (inspection.status === "passed" || inspection.result === "pass") return "good";
  return "none";
}

/**
 * Mirror of the route's send-to-risk eligibility: a row qualifies when it has
 * no risk link yet and carries a failed/partial outcome or any cost/schedule
 * impact.
 */
export function canSendInspectionToRisk(inspection: InspectionRow): boolean {
  return (
    !inspection.risk_exposure_id &&
    (inspection.status === "failed" ||
      inspection.status === "partial" ||
      inspection.result === "fail" ||
      inspection.result === "partial" ||
      inspection.cost_impact > 0 ||
      Number(inspection.schedule_impact_weeks ?? 0) > 0)
  );
}

export type InspectionGroups = {
  /** Failed / partial outcomes plus anything flagged reinspection-required. */
  attention: InspectionRow[];
  /** Planned / requested / scheduled (and any other non-terminal remainder). */
  scheduled: InspectionRow[];
  /** Passed outcomes. */
  passed: InspectionRow[];
};

/**
 * Partition inspections into the three workflow buckets both views share.
 * Every row lands in exactly one bucket so nothing can drop out of sight:
 * cancelled rows ride with the scheduled remainder, still wearing their
 * Cancelled pill.
 */
export function groupInspections(inspections: InspectionRow[]): InspectionGroups {
  const attention: InspectionRow[] = [];
  const scheduled: InspectionRow[] = [];
  const passed: InspectionRow[] = [];
  for (const inspection of inspections) {
    const severity = inspectionSeverity(inspection);
    if (severity === "crit" || severity === "warn" || inspection.required_reinspection) {
      attention.push(inspection);
    } else if (severity === "good") {
      passed.push(inspection);
    } else {
      scheduled.push(inspection);
    }
  }
  return { attention, scheduled, passed };
}

export function formatImpactWeeks(value: number) {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

const PILL_TONES = {
  crit: "border-danger/40 text-danger",
  warn: "border-warning/40 text-warning",
  good: "border-success/40 text-success",
  clay: "border-clay/40 text-clay",
  muted: "border-hairline text-muted-foreground",
} as const;

export function InspectionPill({
  tone = "muted",
  children,
}: {
  tone?: keyof typeof PILL_TONES;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "whitespace-nowrap rounded-full border px-2 py-[3px] font-mono text-[11px] font-bold uppercase tracking-[0.06em]",
        PILL_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Status/result pill: the result wins once it exists, otherwise the status. */
export function InspectionOutcomePill({
  status,
  result,
}: {
  status: InspectionStatus;
  result: InspectionResult;
}) {
  const label =
    result !== "pending"
      ? (INSPECTION_RESULT_OPTIONS.find((option) => option.value === result)?.label ?? result)
      : (INSPECTION_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status);
  const severity = inspectionSeverity({ status, result });
  const tone =
    severity !== "none"
      ? severity
      : status === "scheduled" && result === "pending"
        ? "clay"
        : "muted";
  return <InspectionPill tone={tone}>{label}</InspectionPill>;
}

// ---------------------------------------------------------------------------
// Board view — kanban columns by workflow state. Read-only stacks of compact
// cards: status changes stay in the Edit dialog (clicking a card opens it),
// so no drag-and-drop and no new mutation paths.
// ---------------------------------------------------------------------------

type InspectionsBoardProps = {
  groups: InspectionGroups;
  onEdit: (inspection: InspectionRow) => void;
  onCreateRisk: (inspection: InspectionRow) => void;
  creatingRiskId?: string | null;
};

export function InspectionsBoard({
  groups,
  onEdit,
  onCreateRisk,
  creatingRiskId = null,
}: InspectionsBoardProps) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <BoardColumn
        label="Needs attention"
        eyebrowClass="text-danger"
        inspections={groups.attention}
        onEdit={onEdit}
        onCreateRisk={onCreateRisk}
        creatingRiskId={creatingRiskId}
      />
      <BoardColumn
        label="Scheduled"
        eyebrowClass=""
        inspections={groups.scheduled}
        onEdit={onEdit}
        onCreateRisk={onCreateRisk}
        creatingRiskId={creatingRiskId}
      />
      <BoardColumn
        label="Passed"
        eyebrowClass="text-success"
        inspections={groups.passed}
        onEdit={onEdit}
        onCreateRisk={onCreateRisk}
        creatingRiskId={creatingRiskId}
      />
    </div>
  );
}

function BoardColumn({
  label,
  eyebrowClass,
  inspections,
  onEdit,
  onCreateRisk,
  creatingRiskId,
}: {
  label: string;
  eyebrowClass: string;
  inspections: InspectionRow[];
  onEdit: (inspection: InspectionRow) => void;
  onCreateRisk: (inspection: InspectionRow) => void;
  creatingRiskId: string | null;
}) {
  return (
    <div className="min-w-0">
      <div className={cn("eyebrow", eyebrowClass)}>
        {label} · {inspections.length}
      </div>
      <div className="mt-2.5 space-y-2.5">
        {inspections.length === 0 ? (
          <div className="rounded-lg border border-dashed border-hairline px-3 py-6 text-center text-xs text-muted-foreground">
            None
          </div>
        ) : (
          inspections.map((inspection) => (
            <BoardCard
              key={inspection.id}
              inspection={inspection}
              onEdit={() => onEdit(inspection)}
              onCreateRisk={() => onCreateRisk(inspection)}
              creatingRisk={creatingRiskId === inspection.id}
            />
          ))
        )}
      </div>
    </div>
  );
}

function BoardCard({
  inspection,
  onEdit,
  onCreateRisk,
  creatingRisk,
}: {
  inspection: InspectionRow;
  onEdit: () => void;
  onCreateRisk: () => void;
  creatingRisk: boolean;
}) {
  const severity = inspectionSeverity(inspection);
  const canSend = canSendInspectionToRisk(inspection);
  const costImpact = inspection.cost_impact;
  const weeks = Number(inspection.schedule_impact_weeks ?? 0);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onEdit();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={handleKeyDown}
      aria-label={`Edit ${inspection.inspection_type}`}
      className={cn(
        "cursor-pointer rounded-lg border bg-card p-3 shadow-card transition-colors hover:border-clay/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        severity === "crit" && "border-danger/35",
        severity === "warn" && "border-warning/35",
        severity !== "crit" && severity !== "warn" && "border-hairline",
      )}
    >
      <div className="flex flex-wrap items-start gap-2">
        <h4 className="min-w-0 flex-1 text-[13px] font-semibold leading-snug text-foreground">
          {inspection.inspection_type}
        </h4>
        <InspectionOutcomePill status={inspection.status} result={inspection.result} />
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        {inspection.authority || "Authority not set"} · Attempt {inspection.attempt_number}
      </div>
      {(costImpact > 0 || weeks > 0) && (
        <div className="mt-2 text-xs font-medium tabular">
          {costImpact > 0 && <span className="text-danger">{fmtUSD(costImpact)}</span>}
          {costImpact > 0 && weeks > 0 && <span className="text-muted-foreground"> · </span>}
          {weeks > 0 && <span className="text-warning">{formatImpactWeeks(weeks)} wk</span>}
        </div>
      )}
      {inspection.risk_exposure_id ? (
        <div className="mt-2.5">
          <Button
            variant="outline"
            size="sm"
            disabled
            className="border-clay/40 text-clay"
            onClick={(event) => event.stopPropagation()}
          >
            Risk linked
          </Button>
        </div>
      ) : canSend ? (
        <div className="mt-2.5">
          <Button
            variant="destructive"
            size="sm"
            className="gap-1.5"
            disabled={creatingRisk}
            onClick={(event) => {
              event.stopPropagation();
              onCreateRisk();
            }}
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            {creatingRisk ? "Sending" : "Send to risk"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full list card — the List view's per-inspection article. Lives here with the
// rest of the shared inspection presentation so InspectionsWorkspace stays
// within the repo's file-size ceiling.
// ---------------------------------------------------------------------------

export function InspectionLogRow({
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
  const severity = inspectionSeverity(inspection);
  const canCreateRisk = canSendInspectionToRisk(inspection);
  const scheduleWeeks = Number(inspection.schedule_impact_weeks ?? 0);

  return (
    <article
      className={cn(
        "rounded-xl border bg-card p-4 shadow-card",
        severity === "crit" && "border-danger/35",
        severity === "warn" && "border-warning/35",
        severity !== "crit" && severity !== "warn" && "border-hairline",
      )}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-foreground">
              {inspection.inspection_type}
            </h3>
            <InspectionOutcomePill status={inspection.status} result={inspection.result} />
            {inspection.required_reinspection && (
              <InspectionPill tone="warn">Reinspection required</InspectionPill>
            )}
            {inspection.risk_exposure_id && (
              <InspectionPill tone="clay">Risk linked</InspectionPill>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Attempt {inspection.attempt_number} · {inspection.authority || "Authority not set"}
            {inspection.location ? ` · ${inspection.location}` : ""}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {inspection.risk_exposure_id ? (
            <Button variant="outline" size="sm" disabled className="border-clay/40 text-clay">
              Risk linked
            </Button>
          ) : canCreateRisk ? (
            <Button
              variant="destructive"
              size="sm"
              className="gap-1.5"
              onClick={onCreateRisk}
              disabled={creatingRisk}
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              {creatingRisk ? "Sending" : "Send to risk"}
            </Button>
          ) : null}
          <Button variant="outline" size="sm" className="gap-1.5" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={onReinspect}>
            <RotateCcw className="h-3.5 w-3.5" /> Reinspection
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-danger"
            onClick={onDelete}
            aria-label={`Delete ${inspection.inspection_type}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <InspectionDetail label="Scheduled" value={formatDate(inspection.scheduled_date)} />
        <InspectionDetail label="Completed" value={formatDate(inspection.completed_date)} />
        <InspectionDetail label="Responsible" value={inspection.responsible_party || "-"} />
        <InspectionDetail
          label="Cost impact"
          value={fmtUSD(inspection.cost_impact)}
          tone={inspection.cost_impact > 0 ? "danger" : undefined}
        />
        <InspectionDetail
          label="Schedule impact"
          value={`${formatImpactWeeks(scheduleWeeks)} wk`}
          tone={scheduleWeeks > 0 ? "warning" : undefined}
        />
      </div>

      {(inspection.notes || inspection.corrective_action) && (
        <div className="mt-3 grid gap-2.5 lg:grid-cols-2">
          {inspection.notes && (
            <div className="rounded-lg border border-hairline bg-background px-3 py-2.5">
              <div className="font-mono text-[8px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Notes
              </div>
              <p className="mt-1 text-[12.5px] leading-5 text-foreground">{inspection.notes}</p>
            </div>
          )}
          {inspection.corrective_action && (
            <div className="rounded-lg border border-hairline bg-background px-3 py-2.5">
              <div className="font-mono text-[8px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Corrective action
              </div>
              <p className="mt-1 text-[12.5px] leading-5 text-foreground">
                {inspection.corrective_action}
              </p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function InspectionDetail({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger" | "warning";
}) {
  return (
    <div className="rounded-lg border border-hairline bg-background px-3 py-2">
      <div className="font-mono text-[8px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 min-h-[20px] text-[13px] font-medium tabular",
          tone === "danger"
            ? "text-danger"
            : tone === "warning"
              ? "text-warning"
              : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function formatDate(value: string | null) {
  return value ? value.slice(0, 10) : "-";
}
