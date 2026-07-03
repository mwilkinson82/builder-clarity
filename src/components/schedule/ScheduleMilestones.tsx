import { useState, useEffect } from "react";
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
import { Trash2, AlertTriangle, Pencil, CheckCircle2 } from "lucide-react";
import { type MilestoneStatus, type MilestoneRow } from "@/lib/schedule.functions";
import { STATUS_LABEL, STATUS_STYLES, shortDate } from "./scheduleShared";

export function DateField({
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

function isBareMilestone(row: MilestoneRow) {
  return (
    !row.baseline_date &&
    !row.forecast_date &&
    !row.owner &&
    !row.delay_reason &&
    row.status === "on_track"
  );
}

export function MilestoneRowEditor({
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

export function CompactField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-hairline bg-card px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-medium text-foreground">{value}</div>
    </div>
  );
}
