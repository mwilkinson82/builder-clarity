import { useState, useEffect } from "react";
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
import { StatusChip } from "@/components/ui/status-chip";
import { Plus, Trash2, Pencil, CheckCircle2 } from "lucide-react";
import {
  type ScheduleRiskKind,
  type ScheduleRiskStatus,
  type ScheduleRiskRow,
} from "@/lib/schedule.functions";
import { fmtUSD } from "@/lib/format";
import { type HoldClass, type ResponsePath } from "@/lib/ior";
import { RISK_META, RISK_STATUS_LABEL, RISK_STATUS_STYLES, shortDate } from "./scheduleShared";
import { CompactField } from "./ScheduleMilestones";

export function RiskGroup({
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
                <StatusChip tone="complete" icon={CheckCircle2}>
                  Linked
                </StatusChip>
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

export function AddInline({
  placeholder,
  onAdd,
}: {
  placeholder: string;
  onAdd: (v: string) => void;
}) {
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
