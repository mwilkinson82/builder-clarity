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
  useRef,
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
  FieldResourceEditor,
  type FieldResourceDraft,
} from "@/components/outcome/FieldResourceEditor";
import { PerformedByField } from "@/components/outcome/PerformedByField";
import {
  deleteDailyWipEntry,
  listDailyWipEntries,
  listScheduleActivitiesForWip,
  saveDailyWipEntry,
  type DailyWipEntryRow,
  type ScheduleActivityOption,
} from "@/lib/daily-wip.functions";
import { costItemsForEdit, crewPeople, type CostLineItem } from "@/lib/daily-wip";
import { listSubcontractors } from "@/lib/subcontractors.functions";
import { listProjectSubcontracts } from "@/lib/subcontracts.functions";

interface BucketOption {
  id: string;
  cost_code: string;
  bucket: string;
}

interface DailyLogWorkLinesProps {
  projectId: string;
  reportDate: string;
  buckets: BucketOption[];
  disabled?: boolean;
}

// One installed quantity/count on a work line (500 LF conduit, 24 junction boxes).
interface QuantityItem {
  clientId: string;
  quantity: number;
  unit: string;
  description: string;
}

let quantitySequence = 0;
let fieldResourceSequence = 0;

function createQuantityItem(item?: Partial<Omit<QuantityItem, "clientId">>): QuantityItem {
  quantitySequence += 1;
  return {
    clientId: `installed-quantity-${quantitySequence}`,
    quantity: item?.quantity ?? 0,
    unit: item?.unit ?? "",
    description: item?.description ?? "",
  };
}

function createFieldResourceDraft(item?: Partial<CostLineItem>): FieldResourceDraft {
  fieldResourceSequence += 1;
  return {
    clientId: `field-resource-${fieldResourceSequence}`,
    description: item?.description ?? "",
    quantity: item?.quantity ?? 0,
    unit: item?.unit ?? "",
    // Existing PM dollars travel through the field editor but are never shown
    // or changed here.
    amount: item?.amount ?? 0,
  };
}

// Only the fields the super owns — no money.
interface LineDraft {
  id?: string;
  cost_bucket_id: string;
  schedule_activity_id: string;
  subcontractor_id: string;
  unmatched_vendor_name: string;
  activity: string;
  crew_count: number;
  hours: number;
  quantity: number;
  unit: string;
  // Repeatable installed quantities/counts (the scalar quantity/unit above stays
  // the primary roll-up the server derives from the first item).
  quantity_items: QuantityItem[];
  // Physical materials/equipment used. Dollars remain hidden and preserved for
  // the PM; the field records only description, quantity, and unit.
  material_items: FieldResourceDraft[];
  equipment_items: FieldResourceDraft[];
  percent_complete: number;
  // Label only: is % complete measured against the SOV line or the CPM activity?
  percent_basis: "sov" | "cpm";
}

const createEmptyLine = (): LineDraft => ({
  cost_bucket_id: "",
  schedule_activity_id: "",
  subcontractor_id: "",
  unmatched_vendor_name: "",
  activity: "",
  crew_count: 0,
  hours: 0,
  quantity: 0,
  unit: "",
  quantity_items: [createQuantityItem()],
  material_items: [],
  equipment_items: [],
  percent_complete: 0,
  percent_basis: "sov",
});

function activityOptionLabel(a: ScheduleActivityOption): string {
  return [a.activity_id, a.name].filter(Boolean).join(" · ") || "Untitled activity";
}

// A quantity row is worth keeping when it carries a real measure, unit, or note.
function qtyRowHasContent(row: QuantityItem): boolean {
  return row.quantity > 0 || row.unit.trim() !== "" || row.description.trim() !== "";
}

function resourceRowHasContent(row: FieldResourceDraft): boolean {
  return (
    row.description.trim() !== "" || row.quantity > 0 || row.unit.trim() !== "" || row.amount > 0
  );
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

function resourcesSummary(items: DailyWipEntryRow["material_items"]): string | null {
  const summary = items
    .filter((item) => item.description.trim() || (item.quantity ?? 0) > 0 || item.unit?.trim())
    .map((item) =>
      [item.quantity ? `${item.quantity} ${item.unit || "qty"}` : item.unit, item.description]
        .filter(Boolean)
        .join(" "),
    )
    .filter(Boolean)
    .join(" · ");
  return summary || null;
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
  { projectId, reportDate, buckets, disabled = false }: DailyLogWorkLinesProps,
  ref: ForwardedRef<DailyLogWorkLinesHandle>,
) {
  const queryClient = useQueryClient();
  const listEntries = useServerFn(listDailyWipEntries);
  const listActivities = useServerFn(listScheduleActivitiesForWip);
  const listDirectory = useServerFn(listSubcontractors);
  const listProjectSubs = useServerFn(listProjectSubcontracts);
  const saveEntry = useServerFn(saveDailyWipEntry);
  const removeEntry = useServerFn(deleteDailyWipEntry);

  const [draft, setDraft] = useState<LineDraft>(createEmptyLine);
  // The row being edited — held so we can preserve its money fields on save.
  const [editing, setEditing] = useState<DailyWipEntryRow | null>(null);
  // "Add line" and the parent report Save can fire within the same render.
  // Both paths must await this one promise or the same draft can insert twice.
  const inFlightSaveRef = useRef<Promise<void> | null>(null);

  const entriesQuery = useQuery({
    queryKey: ["daily-wip-entries", projectId],
    queryFn: () => listEntries({ data: { projectId } }),
  });
  const activitiesQuery = useQuery({
    queryKey: ["daily-wip-activities", projectId],
    queryFn: () => listActivities({ data: { projectId } }),
  });
  const directoryQuery = useQuery({
    queryKey: ["subcontractors-directory"],
    queryFn: () => listDirectory(),
    staleTime: 30_000,
  });
  const projectSubsQuery = useQuery({
    queryKey: ["subcontracts", projectId],
    queryFn: () => listProjectSubs({ data: { projectId } }),
  });

  const lines = useMemo(
    () => (entriesQuery.data ?? []).filter((entry) => entry.entry_date === reportDate),
    [entriesQuery.data, reportDate],
  );
  const activities = useMemo(() => activitiesQuery.data ?? [], [activitiesQuery.data]);
  const activityGroups = useMemo(() => groupActivitiesByDivision(activities), [activities]);
  const subNameById = useMemo(
    () => new Map((directoryQuery.data ?? []).map((sub) => [sub.id, sub.name] as const)),
    [directoryQuery.data],
  );
  // Only offer companies already attached to this project through a buyout.
  // The project can contain more than one scope for the same company, but the
  // WIP row links to the company directory ID, so dedupe the picker by company.
  const subOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: { id: string; label: string }[] = [];
    for (const sub of projectSubsQuery.data?.subcontracts ?? []) {
      if (seen.has(sub.subcontractor_id)) continue;
      seen.add(sub.subcontractor_id);
      const name = subNameById.get(sub.subcontractor_id) ?? "Subcontractor";
      options.push({
        id: sub.subcontractor_id,
        label: sub.title ? `${name} — ${sub.title}` : name,
      });
    }
    return options;
  }, [projectSubsQuery.data, subNameById]);
  const performedByLabel = (entry: DailyWipEntryRow) =>
    entry.subcontractor_id
      ? (subNameById.get(entry.subcontractor_id) ?? "Subcontractor")
      : entry.unmatched_vendor_name || null;

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

  const qtyRows = draft.quantity_items;
  const updateQtyRow = (clientId: string, patch: Partial<QuantityItem>) =>
    setField(
      "quantity_items",
      qtyRows.map((row) => (row.clientId === clientId ? { ...row, ...patch } : row)),
    );
  const addQtyRow = () => setField("quantity_items", [...qtyRows, createQuantityItem()]);
  const removeQtyRow = (clientId: string) =>
    setField(
      "quantity_items",
      qtyRows.filter((row) => row.clientId !== clientId),
    );
  const resetForm = () => {
    setDraft(createEmptyLine());
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
      subcontractor_id: entry.subcontractor_id ?? "",
      unmatched_vendor_name: entry.unmatched_vendor_name,
      activity: entry.activity,
      crew_count: entry.crew_count,
      hours: entry.hours,
      quantity: entry.quantity,
      unit: entry.unit,
      // Load the itemized quantities; for older rows with only a scalar, seed one
      // row from it so editing never silently drops the recorded quantity.
      quantity_items: entry.quantity_items.length
        ? entry.quantity_items.map((q) =>
            createQuantityItem({
              quantity: q.quantity,
              unit: q.unit,
              description: q.description ?? "",
            }),
          )
        : entry.quantity
          ? [createQuantityItem({ quantity: entry.quantity, unit: entry.unit })]
          : [createQuantityItem()],
      material_items: costItemsForEdit(entry.material_items, entry.material_cost).map(
        createFieldResourceDraft,
      ),
      equipment_items: costItemsForEdit(entry.equipment_items, entry.equipment_cost).map(
        createFieldResourceDraft,
      ),
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
    draft.subcontractor_id !== "" ||
    draft.unmatched_vendor_name.trim() !== "" ||
    draft.crew_count > 0 ||
    draft.hours > 0 ||
    draft.quantity > 0 ||
    draft.quantity_items.some(qtyRowHasContent) ||
    draft.material_items.some(resourceRowHasContent) ||
    draft.equipment_items.some(resourceRowHasContent);

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
    const cleanResources = (items: FieldResourceDraft[]) =>
      items.filter(resourceRowHasContent).map(({ description, amount, quantity, unit }) => ({
        description: description.trim(),
        amount,
        quantity,
        unit: unit.trim(),
      }));
    return {
      projectId,
      id: draft.id,
      entry_date: reportDate,
      cost_bucket_id: draft.cost_bucket_id || null,
      schedule_activity_id: draft.schedule_activity_id || null,
      subcontractor_id: draft.subcontractor_id || null,
      unmatched_vendor_name: draft.unmatched_vendor_name.trim(),
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
      material_items: cleanResources(draft.material_items),
      equipment_items: cleanResources(draft.equipment_items),
      notes: money?.notes ?? "",
    };
  }, [projectId, reportDate, draft, editing]);

  const commitPendingLine = useCallback((): Promise<void> => {
    if (inFlightSaveRef.current) return inFlightSaveRef.current;
    if (!draftHasContent) return Promise.resolve();

    const inFlight = saveMutation.mutateAsync(buildSavePayload()).then(() => undefined);
    inFlightSaveRef.current = inFlight;
    return inFlight.finally(() => {
      if (inFlightSaveRef.current === inFlight) inFlightSaveRef.current = null;
    });
  }, [draftHasContent, saveMutation, buildSavePayload]);

  const handleSave = () => {
    if (!draftHasContent) {
      toast.error("Add an activity, cost code, schedule activity, or crew/hours first");
      return;
    }
    // The mutation owns user-facing error reporting. Catch here only to avoid
    // an unhandled rejected promise when this button is the caller.
    void commitPendingLine().catch(() => undefined);
  };

  // The parent Daily Report "Save" commits any un-added work line through here,
  // so a draft the super typed but never pressed "Add line" on is not lost when
  // the report saves and the editor closes. The flush AWAITS the same mutation
  // "Add line" uses (which resets the form, refreshes the WIP list, and rejects
  // on failure), so the report only reports success once the line is durable.
  useImperativeHandle(
    ref,
    () => ({
      hasPendingLine: () => draftHasContent || inFlightSaveRef.current !== null,
      flushPendingLine: commitPendingLine,
    }),
    [draftHasContent, commitPendingLine],
  );

  const selectClass =
    "rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60";

  return (
    <div
      className="rounded-md border border-hairline bg-surface p-4"
      aria-busy={disabled || saveMutation.isPending}
      aria-disabled={disabled || saveMutation.isPending}
      inert={disabled || saveMutation.isPending}
    >
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
            const performedBy = performedByLabel(entry);
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
                    {performedBy ? (
                      <span>
                        Performed by: {performedBy}
                        {entry.unmatched_vendor_name ? " (not in project buyout yet)" : ""}
                      </span>
                    ) : null}
                    {entry.crew_count ? (
                      <span>
                        {entry.crew_count} {entry.crew_count === 1 ? "crew" : "crews"} ·{" "}
                        {crewPeople(entry.crew_count)} people
                      </span>
                    ) : null}
                    {entry.hours ? <span>{entry.hours} hrs/person</span> : null}
                    {quantitiesSummary(entry) ? <span>{quantitiesSummary(entry)}</span> : null}
                    {resourcesSummary(entry.material_items) ? (
                      <span>Materials: {resourcesSummary(entry.material_items)}</span>
                    ) : null}
                    {resourcesSummary(entry.equipment_items) ? (
                      <span>Equipment: {resourcesSummary(entry.equipment_items)}</span>
                    ) : null}
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
          <div className="sm:col-span-2">
            <PerformedByField
              subcontractorId={draft.subcontractor_id}
              unmatchedVendorName={draft.unmatched_vendor_name}
              options={subOptions}
              onChange={({ subcontractorId, unmatchedVendorName }) =>
                setDraft((prev) => ({
                  ...prev,
                  subcontractor_id: subcontractorId,
                  unmatched_vendor_name: unmatchedVendorName,
                }))
              }
              helpText="Bought-out subcontractors appear above. A typed vendor stays flagged for the PM to match or buy out later."
            />
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Crews</span>
            <Input
              type="number"
              min={0}
              value={draft.crew_count || ""}
              onChange={(event) => setField("crew_count", Number(event.target.value) || 0)}
            />
            <span className="text-[11px] text-muted-foreground">
              1 crew = 2 people
              {draft.crew_count > 0 ? ` · ${crewPeople(draft.crew_count)} people` : ""}
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Hours per person</span>
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
              {qtyRows.map((row) => (
                <div
                  key={row.clientId}
                  className="grid grid-cols-[80px_minmax(0,1fr)_32px] items-center gap-2 sm:grid-cols-[80px_160px_minmax(0,1fr)_32px]"
                >
                  <Input
                    type="number"
                    min={0}
                    value={row.quantity || ""}
                    placeholder="Qty"
                    className="col-start-1 row-start-1"
                    aria-label="Quantity"
                    onChange={(event) =>
                      updateQtyRow(row.clientId, { quantity: Number(event.target.value) || 0 })
                    }
                  />
                  <Input
                    value={row.unit}
                    placeholder="Unit — LF, EA, junction boxes…"
                    className="col-start-2 row-start-1"
                    aria-label="Unit"
                    onChange={(event) => updateQtyRow(row.clientId, { unit: event.target.value })}
                  />
                  <Input
                    value={row.description}
                    placeholder="Description (optional)"
                    className="col-span-3 row-start-2 sm:col-span-1 sm:col-start-3 sm:row-start-1"
                    aria-label="Description"
                    onChange={(event) =>
                      updateQtyRow(row.clientId, { description: event.target.value })
                    }
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="col-start-3 row-start-1 h-8 w-8 text-muted-foreground hover:text-danger sm:col-start-4"
                    aria-label="Remove quantity"
                    disabled={qtyRows.length === 1}
                    onClick={() => removeQtyRow(row.clientId)}
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
          <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
            <FieldResourceEditor
              label="Materials used"
              help="Record what was used. The project manager adds the dollar values in Daily WIP."
              descriptionPlaceholder="e.g. EMT conduit"
              items={draft.material_items}
              onChange={(items) => setField("material_items", items)}
            />
            <FieldResourceEditor
              label="Equipment used"
              help="Record what ran on site. The project manager adds the dollar values in Daily WIP."
              descriptionPlaceholder="e.g. Man lift"
              items={draft.equipment_items}
              onChange={(items) => setField("equipment_items", items)}
            />
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
