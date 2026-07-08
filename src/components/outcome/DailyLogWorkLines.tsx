// The superintendent's "work put in place" capture, living inside the daily log.
//
// Founder model: the super logs the PHYSICAL facts of each activity worked today
// — what activity, which SOV line, which CPM schedule activity, crew, hours,
// quantity placed. No dollars. These rows ARE the WIP entries (one source of
// truth in public.daily_wip_entries); the office/PM later opens them on the WIP
// tab and adds the money (rate, materials $, equipment $). "The whip extracts
// that information, and the PM adds dollar values."
//
// So this surface writes only the physical fields and, when editing a line the
// office has already costed, preserves the existing money fields untouched.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarClock, EyeOff, Pencil, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteDailyWipEntry,
  listDailyWipEntries,
  listScheduleActivitiesForWip,
  saveDailyWipEntry,
  type DailyWipEntryRow,
  type ScheduleActivityOption,
} from "@/lib/daily-wip.functions";

interface BucketOption {
  id: string;
  cost_code: string;
  bucket: string;
}

interface DailyLogWorkLinesProps {
  projectId: string;
  reportDate: string;
  buckets: BucketOption[];
}

// Only the fields the super owns — no money.
interface LineDraft {
  id?: string;
  cost_bucket_id: string;
  schedule_activity_id: string;
  activity: string;
  crew_count: number;
  hours: number;
  quantity: number;
  unit: string;
  percent_complete: number;
}

const emptyLine: LineDraft = {
  cost_bucket_id: "",
  schedule_activity_id: "",
  activity: "",
  crew_count: 0,
  hours: 0,
  quantity: 0,
  unit: "",
  percent_complete: 0,
};

function activityOptionLabel(a: ScheduleActivityOption): string {
  return [a.activity_id, a.name].filter(Boolean).join(" · ") || "Untitled activity";
}

function groupActivitiesByDivision(
  activities: ScheduleActivityOption[],
): { division: string; items: ScheduleActivityOption[] }[] {
  const groups: { division: string; items: ScheduleActivityOption[] }[] = [];
  const byDivision = new Map<string, ScheduleActivityOption[]>();
  for (const activity of activities) {
    const division = activity.division.trim() || "Schedule";
    let items = byDivision.get(division);
    if (!items) {
      items = [];
      byDivision.set(division, items);
      groups.push({ division, items });
    }
    items.push(activity);
  }
  return groups;
}

// Has the office already priced this line? (Then the super's edits must not wipe
// the money, and we flag it so the super knows it's been costed.)
function isCosted(entry: DailyWipEntryRow): boolean {
  return entry.labor_rate > 0 || entry.material_cost > 0 || entry.equipment_cost > 0;
}

export function DailyLogWorkLines({ projectId, reportDate, buckets }: DailyLogWorkLinesProps) {
  const queryClient = useQueryClient();
  const listEntries = useServerFn(listDailyWipEntries);
  const listActivities = useServerFn(listScheduleActivitiesForWip);
  const saveEntry = useServerFn(saveDailyWipEntry);
  const removeEntry = useServerFn(deleteDailyWipEntry);

  const [draft, setDraft] = useState<LineDraft>(emptyLine);
  // The row being edited — held so we can preserve its money fields on save.
  const [editing, setEditing] = useState<DailyWipEntryRow | null>(null);

  const entriesQuery = useQuery({
    queryKey: ["daily-wip-entries", projectId],
    queryFn: () => listEntries({ data: { projectId } }),
  });
  const activitiesQuery = useQuery({
    queryKey: ["daily-wip-activities", projectId],
    queryFn: () => listActivities({ data: { projectId } }),
  });

  const lines = useMemo(
    () => (entriesQuery.data ?? []).filter((entry) => entry.entry_date === reportDate),
    [entriesQuery.data, reportDate],
  );
  const activities = useMemo(() => activitiesQuery.data ?? [], [activitiesQuery.data]);
  const activityGroups = useMemo(() => groupActivitiesByDivision(activities), [activities]);

  const bucketLabel = (id: string | null) => {
    if (!id) return null;
    const bucket = buckets.find((b) => b.id === id);
    if (!bucket) return null;
    return [bucket.cost_code, bucket.bucket].filter(Boolean).join(" · ") || null;
  };
  const activityLabel = (id: string | null) => {
    if (!id) return null;
    const found = activities.find((a) => a.id === id);
    return found ? activityOptionLabel(found) : null;
  };

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["daily-wip-entries", projectId] });

  const setField = <K extends keyof LineDraft>(key: K, value: LineDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const resetForm = () => {
    setDraft(emptyLine);
    setEditing(null);
  };

  const saveMutation = useMutation({
    mutationFn: (input: NonNullable<Parameters<typeof saveEntry>[0]>["data"]) =>
      saveEntry({ data: input }),
    onSuccess: () => {
      const wasEditing = Boolean(editing);
      resetForm();
      toast.success(wasEditing ? "Work line updated" : "Work line added to the log");
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not save the work line"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => removeEntry({ data: { id } }),
    onSuccess: () => {
      toast.success("Work line removed");
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not remove the work line"),
  });

  const startEdit = (entry: DailyWipEntryRow) => {
    setEditing(entry);
    setDraft({
      id: entry.id,
      cost_bucket_id: entry.cost_bucket_id ?? "",
      schedule_activity_id: entry.schedule_activity_id ?? "",
      activity: entry.activity,
      crew_count: entry.crew_count,
      hours: entry.hours,
      quantity: entry.quantity,
      unit: entry.unit,
      percent_complete: entry.percent_complete,
    });
  };

  const draftHasContent =
    draft.activity.trim() !== "" ||
    draft.cost_bucket_id !== "" ||
    draft.schedule_activity_id !== "" ||
    draft.crew_count > 0 ||
    draft.hours > 0 ||
    draft.quantity > 0;

  const handleSave = () => {
    if (!draftHasContent) {
      toast.error("Add an activity, cost code, schedule activity, or crew/hours first");
      return;
    }
    // Preserve any money the office already added to this line; new lines start uncosted.
    const money = editing;
    saveMutation.mutate({
      projectId,
      id: draft.id,
      entry_date: reportDate,
      cost_bucket_id: draft.cost_bucket_id || null,
      schedule_activity_id: draft.schedule_activity_id || null,
      activity: draft.activity.trim(),
      crew_count: draft.crew_count,
      hours: draft.hours,
      quantity: draft.quantity,
      unit: draft.unit.trim(),
      percent_complete: draft.percent_complete,
      labor_rate: money?.labor_rate ?? 0,
      material_cost: money?.material_cost ?? 0,
      equipment_cost: money?.equipment_cost ?? 0,
      material_items: money?.material_items ?? [],
      equipment_items: money?.equipment_items ?? [],
      notes: money?.notes ?? "",
    });
  };

  const selectClass =
    "rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60";

  return (
    <div className="rounded-md border border-hairline bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <Label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Work put in place today
          </Label>
          <span className="inline-flex items-center gap-1 rounded-sm border border-hairline bg-card px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <EyeOff className="h-3 w-3" />
            Internal only
          </span>
        </div>
        {lines.length > 0 ? (
          <span className="text-[11px] text-muted-foreground">
            {lines.length} {lines.length === 1 ? "line" : "lines"}
          </span>
        ) : null}
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Log each activity you worked and what it progressed. The office adds the costs on the Daily
        WIP tab — each line saves on its own. This section is never shared with the client, even
        when the day is marked client-visible.
      </p>

      {/* Existing lines for this day */}
      {lines.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {lines.map((entry) => {
            const bucket = bucketLabel(entry.cost_bucket_id);
            const activity = activityLabel(entry.schedule_activity_id);
            return (
              <li
                key={entry.id}
                className="flex items-start justify-between gap-3 rounded-md border border-hairline bg-card px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-foreground">
                    <span className="font-medium">{entry.activity || bucket || "Work line"}</span>
                    {isCosted(entry) ? (
                      <span className="rounded-sm bg-success/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-success">
                        Costed
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    {bucket ? <span>{bucket}</span> : null}
                    {activity ? (
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="h-3 w-3 text-accent" />
                        {activity}
                      </span>
                    ) : null}
                    {entry.crew_count ? <span>{entry.crew_count} crew</span> : null}
                    {entry.hours ? <span>{entry.hours} hrs</span> : null}
                    {entry.quantity ? (
                      <span>
                        {entry.quantity} {entry.unit || "qty"}
                      </span>
                    ) : null}
                    {entry.percent_complete ? (
                      <span className="font-medium text-foreground">
                        {entry.percent_complete}% complete
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground"
                    aria-label="Edit work line"
                    onClick={() => startEdit(entry)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-danger"
                    aria-label="Remove work line"
                    onClick={() => deleteMutation.mutate(entry.id)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* Add / edit a line — physical fields only */}
      <div className="mt-3 rounded-md border border-dashed border-hairline p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-foreground">
            {editing ? "Edit work line" : "Add a work line"}
          </span>
          {editing ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 gap-1 text-muted-foreground"
              onClick={resetForm}
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </Button>
          ) : null}
        </div>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs text-muted-foreground">Activity</span>
            <Input
              value={draft.activity}
              placeholder="e.g. Formed and poured north footings"
              onChange={(event) => setField("activity", event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Cost code (SOV line)</span>
            <select
              value={draft.cost_bucket_id}
              onChange={(event) => setField("cost_bucket_id", event.target.value)}
              className={selectClass}
            >
              <option value="">Uncoded (assign later)</option>
              {buckets.map((bucket) => (
                <option key={bucket.id} value={bucket.id}>
                  {[bucket.cost_code, bucket.bucket].filter(Boolean).join(" · ")}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Schedule activity (CPM)</span>
            <select
              value={draft.schedule_activity_id}
              onChange={(event) => setField("schedule_activity_id", event.target.value)}
              disabled={activities.length === 0}
              className={selectClass}
            >
              <option value="">
                {activities.length === 0
                  ? "No schedule activities yet"
                  : "Not linked to the schedule"}
              </option>
              {activityGroups.map((group) => (
                <optgroup key={group.division} label={group.division}>
                  {group.items.map((activity) => (
                    <option key={activity.id} value={activity.id}>
                      {activityOptionLabel(activity)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Crew</span>
            <Input
              type="number"
              min={0}
              value={draft.crew_count || ""}
              onChange={(event) => setField("crew_count", Number(event.target.value) || 0)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Hours</span>
            <Input
              type="number"
              min={0}
              step="0.25"
              value={draft.hours || ""}
              onChange={(event) => setField("hours", Number(event.target.value) || 0)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Quantity placed</span>
            <Input
              type="number"
              min={0}
              value={draft.quantity || ""}
              onChange={(event) => setField("quantity", Number(event.target.value) || 0)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Unit</span>
            <Input
              value={draft.unit}
              placeholder="SF, CY, LF…"
              onChange={(event) => setField("unit", event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">% complete</span>
            <Input
              type="number"
              min={0}
              max={100}
              value={draft.percent_complete || ""}
              placeholder="0–100"
              onChange={(event) =>
                setField(
                  "percent_complete",
                  Math.min(100, Math.max(0, Number(event.target.value) || 0)),
                )
              }
            />
          </label>
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            onClick={handleSave}
            disabled={saveMutation.isPending}
          >
            <Plus className="h-3.5 w-3.5" />
            {saveMutation.isPending ? "Saving…" : editing ? "Save changes" : "Add line"}
          </Button>
        </div>
      </div>
    </div>
  );
}
