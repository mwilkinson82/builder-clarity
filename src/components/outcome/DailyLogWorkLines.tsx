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
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
  type ForwardedRef,
} from "react";
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

// One installed quantity/count on a work line (500 LF conduit, 24 junction boxes).
interface QuantityItem {
  quantity: number;
  unit: string;
  description: string;
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
  // Repeatable installed quantities/counts (the scalar quantity/unit above stays
  // the primary roll-up the server derives from the first item).
  quantity_items: QuantityItem[];
  percent_complete: number;
  // Label only: is % complete measured against the SOV line or the CPM activity?
  percent_basis: "sov" | "cpm";
}

const emptyLine: LineDraft = {
  cost_bucket_id: "",
  schedule_activity_id: "",
  activity: "",
  crew_count: 0,
  hours: 0,
  quantity: 0,
  unit: "",
  quantity_items: [],
  percent_complete: 0,
  percent_basis: "sov",
};

function activityOptionLabel(a: ScheduleActivityOption): string {
  return [a.activity_id, a.name].filter(Boolean).join(" · ") || "Untitled activity";
}

// A quantity row is worth keeping when it carries a real measure, unit, or note.
function qtyRowHasContent(row: QuantityItem): boolean {
  return row.quantity > 0 || row.unit.trim() !== "" || row.description.trim() !== "";
}

// "500 LF conduit · 24 junction boxes" — the itemized quantities for a saved row,
// falling back to the scalar quantity/unit for rows predating the list.
function quantitiesSummary(entry: DailyWipEntryRow): string | null {
  if (entry.quantity_items.length) {
    return entry.quantity_items
      .map((q) => [`${q.quantity} ${q.unit || "qty"}`, q.description].filter(Boolean).join(" "))
      .join(" · ");
  }
  if (entry.quantity) return `${entry.quantity} ${entry.unit || "qty"}`;
  return null;
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

export interface DailyLogWorkLinesHandle {
  /** True when the compose form holds an un-added work line (a dirty draft). */
  hasPendingLine: () => boolean;
  /**
   * Persist any work line the super typed into the compose form but did not
   * press "Add line" on, so the parent Daily Report Save can never silently
   * drop it. No-op when the form is empty. AWAITS the save and rejects on
   * failure, so the caller only reports success once the line is durable.
   */
  flushPendingLine: () => Promise<void>;
}

function DailyLogWorkLinesImpl(
  { projectId, reportDate, buckets }: DailyLogWorkLinesProps,
  ref: ForwardedRef<DailyLogWorkLinesHandle>,
) {
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

  // The installed-quantities editor always shows at least one row; the first edit
  // materializes the list into the draft.
  const qtyRows: QuantityItem[] = draft.quantity_items.length
    ? draft.quantity_items
    : [{ quantity: 0, unit: "", description: "" }];
  const updateQtyRow = (index: number, patch: Partial<QuantityItem>) =>
    setField(
      "quantity_items",
      qtyRows.map((row, idx) => (idx === index ? { ...row, ...patch } : row)),
    );
  const addQtyRow = () =>
    setField("quantity_items", [...qtyRows, { quantity: 0, unit: "", description: "" }]);
  const removeQtyRow = (index: number) =>
    setField(
      "quantity_items",
      qtyRows.filter((_, idx) => idx !== index),
    );
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
      // Load the itemized quantities; for older rows with only a scalar, seed one
      // row from it so editing never silently drops the recorded quantity.
      quantity_items: entry.quantity_items.length
        ? entry.quantity_items.map((q) => ({
            quantity: q.quantity,
            unit: q.unit,
            description: q.description ?? "",
          }))
        : entry.quantity
          ? [{ quantity: entry.quantity, unit: entry.unit, description: "" }]
          : [],
      // The daily log is the super's surface — it edits the FIELD number, not the
      // PM's reviewed value (which the PM may have adjusted for billing in the WIP).
      percent_complete: entry.field_percent_complete,
      percent_basis: entry.percent_basis,
    });
  };

  const draftHasContent =
    draft.activity.trim() !== "" ||
    draft.cost_bucket_id !== "" ||
    draft.schedule_activity_id !== "" ||
    draft.crew_count > 0 ||
    draft.hours > 0 ||
    draft.quantity > 0 ||
    draft.quantity_items.some(qtyRowHasContent);

  // Build the save payload from the current compose draft. Shared by the "Add
  // line" button and the parent-triggered flush so both persist identical rows.
  const buildSavePayload = useCallback(() => {
    // Preserve any money the office already added to this line; new lines start uncosted.
    const money = editing;
    // Keep only rows that carry a real measure/count.
    const quantity_items = draft.quantity_items.filter(qtyRowHasContent).map((row) => ({
      quantity: row.quantity,
      unit: row.unit.trim(),
      description: row.description.trim(),
    }));
    return {
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
      quantity_items,
      // A CPM basis only holds when a schedule activity is actually linked.
      percent_basis: draft.schedule_activity_id ? draft.percent_basis : "sov",
      percent_complete: draft.percent_complete,
      labor_rate: money?.labor_rate ?? 0,
      material_cost: money?.material_cost ?? 0,
      equipment_cost: money?.equipment_cost ?? 0,
      material_items: money?.material_items ?? [],
      equipment_items: money?.equipment_items ?? [],
      notes: money?.notes ?? "",
    };
  }, [projectId, reportDate, draft, editing]);

  const handleSave = () => {
    if (!draftHasContent) {
      toast.error("Add an activity, cost code, schedule activity, or crew/hours first");
      return;
    }
    saveMutation.mutate(buildSavePayload());
  };

  // The parent Daily Report "Save" commits any un-added work line through here,
  // so a draft the super typed but never pressed "Add line" on is not lost when
  // the report saves and the editor closes. The flush AWAITS the same mutation
  // "Add line" uses (which resets the form, refreshes the WIP list, and rejects
  // on failure), so the report only reports success once the line is durable.
  useImperativeHandle(
    ref,
    () => ({
      hasPendingLine: () => draftHasContent,
      flushPendingLine: async () => {
        if (!draftHasContent) return;
        await saveMutation.mutateAsync(buildSavePayload());
      },
    }),
    [draftHasContent, saveMutation, buildSavePayload],
  );

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
                    {quantitiesSummary(entry) ? <span>{quantitiesSummary(entry)}</span> : null}
                    {entry.field_percent_complete ? (
                      <span className="inline-flex items-center gap-1 font-medium text-foreground">
                        {entry.field_percent_complete}% complete
                        <span className="rounded-sm border border-hairline px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                          {entry.percent_basis === "cpm" ? "% of CPM" : "% of SOV"}
                        </span>
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
              onChange={(event) => {
                const value = event.target.value;
                // Unlinking the CPM activity forces the % basis back to the SOV line.
                setDraft((prev) => ({
                  ...prev,
                  schedule_activity_id: value,
                  percent_basis: value ? prev.percent_basis : "sov",
                }));
              }}
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
          <div className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs text-muted-foreground">Installed quantities</span>
            <p className="text-[11px] text-muted-foreground">
              Add each measure or count — e.g. 500 LF conduit, 500 LF wire, 24 junction boxes.
            </p>
            <div className="mt-1 space-y-2">
              {qtyRows.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    value={row.quantity || ""}
                    placeholder="Qty"
                    className="w-20 shrink-0"
                    aria-label="Quantity"
                    onChange={(event) =>
                      updateQtyRow(index, { quantity: Number(event.target.value) || 0 })
                    }
                  />
                  <Input
                    value={row.unit}
                    placeholder="Unit — LF, EA, junction boxes…"
                    className="w-40 shrink-0"
                    aria-label="Unit"
                    onChange={(event) => updateQtyRow(index, { unit: event.target.value })}
                  />
                  <Input
                    value={row.description}
                    placeholder="Description (optional)"
                    className="flex-1"
                    aria-label="Description"
                    onChange={(event) => updateQtyRow(index, { description: event.target.value })}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-danger"
                    aria-label="Remove quantity"
                    disabled={qtyRows.length === 1}
                    onClick={() => removeQtyRow(index)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mt-1 gap-1.5 self-start text-muted-foreground"
              onClick={addQtyRow}
            >
              <Plus className="h-3.5 w-3.5" />
              Add quantity
            </Button>
          </div>
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
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">% is against</span>
            <select
              value={draft.percent_basis}
              onChange={(event) => setField("percent_basis", event.target.value as "sov" | "cpm")}
              className={selectClass}
            >
              <option value="sov">SOV line</option>
              <option value="cpm" disabled={!draft.schedule_activity_id}>
                CPM activity
              </option>
            </select>
            <span className="text-[11px] text-muted-foreground">
              Which item this % measures against (label only for now).
              {draft.schedule_activity_id ? null : " Link a schedule activity to use CPM."}
            </span>
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

export const DailyLogWorkLines = forwardRef(DailyLogWorkLinesImpl);
