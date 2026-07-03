import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { type ScheduleActivityRow, type ScheduleDelayFragmentRow } from "@/lib/schedule.functions";
import {
  DAY_MS,
  DELAY_FRAGMENT_SOURCE_LABEL,
  DELAY_FRAGMENT_STATUS_LABEL,
  type DelayFragmentCreateInput,
  type DelayFragmentPatchInput,
  parseDelayDays,
  shortDate,
  todayIsoDate,
} from "./scheduleShared";
import { buildDelayFragmentSummary, isOpenDelayStatus } from "./scheduleUpdateDraft";
import { parseDateMs } from "./ScheduleSnapshotTimeline";
import { LabeledField } from "./WbsManager";
import { ActivityUpdateImpactTile } from "./ActivityDetailDialog";

type DelayFragmentDraft = {
  title: string;
  reason: string;
  delay_days: string;
  source: ScheduleDelayFragmentRow["source"];
  status: ScheduleDelayFragmentRow["status"];
  owner: string;
  identified_on: string;
};

export function ActivityDelayFragmentPanel({
  activity,
  delayFragments,
  persistence,
  isSaving,
  onAddDelayFragment,
  onPatchDelayFragment,
  onDeleteDelayFragment,
}: {
  activity: ScheduleActivityRow;
  delayFragments: ScheduleDelayFragmentRow[];
  persistence: "ready" | "migration_required";
  isSaving: boolean;
  onAddDelayFragment: (fragment: DelayFragmentCreateInput) => Promise<void>;
  onPatchDelayFragment: (id: string, patch: DelayFragmentPatchInput) => Promise<void>;
  onDeleteDelayFragment: (id: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<DelayFragmentDraft>(() =>
    emptyDelayFragmentDraft(activity.name),
  );
  const linkedFragments = useMemo(
    () =>
      delayFragments.filter(
        (fragment) =>
          fragment.schedule_activity_id === activity.id ||
          Boolean(activity.activity_id && fragment.activity_id === activity.activity_id),
      ),
    [activity.activity_id, activity.id, delayFragments],
  );
  const linkedSummary = useMemo(
    () => buildDelayFragmentSummary(linkedFragments),
    [linkedFragments],
  );
  const baselineFinishMs = parseDateMs(activity.baseline_finish_date ?? activity.finish_date);
  const forecastFinishMs = parseDateMs(activity.forecast_finish_date ?? activity.finish_date);
  const carriedDelayDays =
    baselineFinishMs == null || forecastFinishMs == null
      ? 0
      : Math.max(0, Math.round((forecastFinishMs - baselineFinishMs) / DAY_MS));
  const openDelayDays = Math.max(0, linkedSummary.openDays);
  const uncapturedDelayDays = Math.max(0, openDelayDays - carriedDelayDays);

  useEffect(() => {
    setDraft(emptyDelayFragmentDraft(activity.name));
  }, [activity.id, activity.name]);

  const addFragment = async () => {
    const title = draft.title.trim();
    if (!title || persistence === "migration_required") return;
    await onAddDelayFragment({
      schedule_activity_id: activity.id,
      activity_id: activity.activity_id,
      title,
      reason: draft.reason.trim(),
      delay_days: parseDelayDays(draft.delay_days),
      source: draft.source,
      status: draft.status,
      owner: draft.owner.trim(),
      identified_on: draft.identified_on || todayIsoDate(),
      resolved_on: isOpenDelayStatus(draft.status) ? null : todayIsoDate(),
    });
    setDraft(emptyDelayFragmentDraft(activity.name));
  };

  return (
    <div className="mt-4 rounded-md border border-hairline bg-card p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5" />
            Delay impacts
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {linkedSummary.openCount} open · {linkedSummary.openDays} days ·{" "}
            {linkedSummary.totalCount} total
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
        <ActivityUpdateImpactTile
          label="Logged open delay"
          value={`${openDelayDays}d`}
          sub="unresolved fragments"
          tone={openDelayDays > 0 ? "danger" : "default"}
        />
        <ActivityUpdateImpactTile
          label="Carried in forecast"
          value={`${Math.min(openDelayDays, carriedDelayDays)}d`}
          sub="baseline to expected finish"
          tone={carriedDelayDays > 0 ? "warning" : "default"}
        />
        <ActivityUpdateImpactTile
          label="Still not carried"
          value={`${uncapturedDelayDays}d`}
          sub="apply to expected finish"
          tone={uncapturedDelayDays > 0 ? "danger" : "success"}
        />
      </div>

      <div className="mt-3 rounded border border-hairline bg-surface px-3 py-2 text-xs text-muted-foreground">
        Delay fragments document why time was lost. They affect the CPM finish only after the
        activity expected finish or remaining duration is updated.
      </div>

      {persistence === "migration_required" ? (
        <div className="mt-3 rounded border border-hairline bg-surface px-3 py-2 text-xs text-muted-foreground">
          Use Notes / Constraint for the delay narrative on this activity. Activity details and CPM
          logic still save normally.
        </div>
      ) : (
        <>
          <div className="mt-3 grid min-w-0 gap-2 xl:grid-cols-[minmax(0,1fr)_96px_150px_140px_140px]">
            <LabeledField label="Fragment title">
              <Input
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                className="h-9 min-w-0"
                placeholder="Window delivery slipped"
                disabled={isSaving}
              />
            </LabeledField>
            <LabeledField label="Days">
              <Input
                type="number"
                min={0}
                max={365}
                value={draft.delay_days}
                onChange={(event) => setDraft({ ...draft, delay_days: event.target.value })}
                className="h-9 min-w-0 tabular"
                disabled={isSaving}
              />
            </LabeledField>
            <LabeledField label="Source">
              <Select
                value={draft.source}
                onValueChange={(source) =>
                  setDraft({ ...draft, source: source as ScheduleDelayFragmentRow["source"] })
                }
                disabled={isSaving}
              >
                <SelectTrigger className="h-9 min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.keys(DELAY_FRAGMENT_SOURCE_LABEL) as ScheduleDelayFragmentRow["source"][]
                  ).map((source) => (
                    <SelectItem key={source} value={source}>
                      {DELAY_FRAGMENT_SOURCE_LABEL[source]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </LabeledField>
            <LabeledField label="Status">
              <Select
                value={draft.status}
                onValueChange={(status) =>
                  setDraft({ ...draft, status: status as ScheduleDelayFragmentRow["status"] })
                }
                disabled={isSaving}
              >
                <SelectTrigger className="h-9 min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.keys(DELAY_FRAGMENT_STATUS_LABEL) as ScheduleDelayFragmentRow["status"][]
                  ).map((status) => (
                    <SelectItem key={status} value={status}>
                      {DELAY_FRAGMENT_STATUS_LABEL[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </LabeledField>
            <LabeledField label="Identified">
              <Input
                type="date"
                value={draft.identified_on}
                onChange={(event) => setDraft({ ...draft, identified_on: event.target.value })}
                className="h-9 min-w-0"
                disabled={isSaving}
              />
            </LabeledField>
          </div>

          <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1fr)_220px_auto] lg:items-end">
            <LabeledField label="Reason / impact">
              <Textarea
                value={draft.reason}
                onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
                className="min-h-16 min-w-0 resize-y"
                placeholder="What happened, who owns it, and what path it affects."
                disabled={isSaving}
              />
            </LabeledField>
            <LabeledField label="Owner">
              <Input
                value={draft.owner}
                onChange={(event) => setDraft({ ...draft, owner: event.target.value })}
                className="h-9 min-w-0"
                placeholder="PM / trade / client"
                disabled={isSaving}
              />
            </LabeledField>
            <Button
              type="button"
              className="h-9 gap-2"
              disabled={!draft.title.trim() || isSaving}
              onClick={() => void addFragment()}
            >
              <Plus className="h-4 w-4" />
              Add delay
            </Button>
          </div>

          <div className="mt-3 grid gap-2">
            {linkedFragments.length === 0 ? (
              <div className="rounded border border-dashed border-hairline bg-surface/70 px-3 py-3 text-sm text-muted-foreground">
                No delay impacts tied to this activity.
              </div>
            ) : (
              linkedFragments.map((fragment) => (
                <DelayFragmentRow
                  key={fragment.id}
                  fragment={fragment}
                  isSaving={isSaving}
                  onPatchDelayFragment={onPatchDelayFragment}
                  onDeleteDelayFragment={onDeleteDelayFragment}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function DelayFragmentRow({
  fragment,
  isSaving,
  onPatchDelayFragment,
  onDeleteDelayFragment,
}: {
  fragment: ScheduleDelayFragmentRow;
  isSaving: boolean;
  onPatchDelayFragment: (id: string, patch: DelayFragmentPatchInput) => Promise<void>;
  onDeleteDelayFragment: (id: string) => Promise<void>;
}) {
  const updateStatus = (status: ScheduleDelayFragmentRow["status"]) => {
    void onPatchDelayFragment(fragment.id, {
      status,
      resolved_on: isOpenDelayStatus(status) ? null : (fragment.resolved_on ?? todayIsoDate()),
    });
  };
  return (
    <div className="grid min-w-0 gap-2 rounded border border-hairline bg-surface p-2 lg:grid-cols-[minmax(0,1fr)_88px_130px_138px_36px] lg:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{fragment.title}</span>
          <span className="rounded border border-hairline bg-card px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {DELAY_FRAGMENT_SOURCE_LABEL[fragment.source]}
          </span>
        </div>
        <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
          {fragment.reason || "No reason entered."}
        </div>
      </div>
      <div className="text-sm font-semibold tabular text-foreground">
        {fragment.delay_days} days
      </div>
      <div className="text-xs text-muted-foreground">
        {shortDate(fragment.identified_on)}
        {fragment.resolved_on ? ` to ${shortDate(fragment.resolved_on)}` : ""}
      </div>
      <Select value={fragment.status} onValueChange={updateStatus} disabled={isSaving}>
        <SelectTrigger className="h-9 min-w-0 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(DELAY_FRAGMENT_STATUS_LABEL) as ScheduleDelayFragmentRow["status"][]).map(
            (status) => (
              <SelectItem key={status} value={status}>
                {DELAY_FRAGMENT_STATUS_LABEL[status]}
              </SelectItem>
            ),
          )}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 justify-self-end text-muted-foreground hover:text-danger"
        disabled={isSaving}
        onClick={() => void onDeleteDelayFragment(fragment.id)}
        aria-label={`Delete ${fragment.title}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function emptyDelayFragmentDraft(activityName: string): DelayFragmentDraft {
  return {
    title: activityName ? `${activityName} delay` : "Schedule delay",
    reason: "",
    delay_days: "0",
    source: "field",
    status: "active",
    owner: "",
    identified_on: todayIsoDate(),
  };
}
