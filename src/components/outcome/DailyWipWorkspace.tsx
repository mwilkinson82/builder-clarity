// Workspace B — the daily WIP recording surface (BILLINGDESIGN P2). Pick any
// date, see that day's daily report alongside it, and record the work put in
// place: self-perform crew (crew × hours × blended rate), materials, and
// equipment, against a cost code. The day's totals fall out cents-safe, and a
// production rate comes for free when a quantity is logged.
//
// The dependency rule: this FEEDS billing; billing never waits on it. Recording
// here is optional and additive.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  HardHat,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { WorkspaceHeader } from "@/components/project/billing/billing-workspace-atoms";
import { fmtUSDCents as fmtUSD, formatBillingDate } from "@/lib/billing-format";
import {
  deleteDailyWipEntry,
  listDailyWipEntries,
  listScheduleActivitiesForWip,
  saveDailyWipEntry,
  type DailyWipEntryRow,
  type ScheduleActivityOption,
} from "@/lib/daily-wip.functions";
import { listDailyReports } from "@/lib/daily-reports.functions";
import { listSubcontractors } from "@/lib/subcontractors.functions";
import { listProjectSubcontracts } from "@/lib/subcontracts.functions";
import {
  costItemsForEdit,
  dailyWipTotals,
  laborCost,
  productionRate,
  rowWorkInPlace,
  sumLineItems,
  type CostLineItem,
} from "@/lib/daily-wip";

interface BucketOption {
  id: string;
  cost_code: string;
  bucket: string;
}

interface DailyWipWorkspaceProps {
  projectId: string;
  buckets: BucketOption[];
}

interface SaveWipInput {
  projectId: string;
  id?: string;
  cost_bucket_id: string | null;
  schedule_activity_id: string | null;
  subcontractor_id: string | null;
  entry_date: string;
  activity: string;
  crew_count: number;
  hours: number;
  labor_rate: number;
  material_cost: number;
  equipment_cost: number;
  material_items: CostLineItem[];
  equipment_items: CostLineItem[];
  quantity: number;
  unit: string;
  percent_complete: number;
  notes: string;
}

interface EntryDraft {
  cost_bucket_id: string;
  schedule_activity_id: string;
  subcontractor_id: string;
  activity: string;
  crew_count: number;
  hours: number;
  labor_rate: number;
  material_items: CostLineItem[];
  equipment_items: CostLineItem[];
  quantity: number;
  unit: string;
  percent_complete: number;
  notes: string;
}

const emptyDraft: EntryDraft = {
  cost_bucket_id: "",
  schedule_activity_id: "",
  subcontractor_id: "",
  activity: "",
  crew_count: 0,
  hours: 0,
  labor_rate: 0,
  material_items: [],
  equipment_items: [],
  quantity: 0,
  unit: "",
  percent_complete: 0,
  notes: "",
};

// "01-010 · Form north wall" — the human-readable label for a schedule activity.
function activityOptionLabel(a: ScheduleActivityOption): string {
  return [a.activity_id, a.name].filter(Boolean).join(" · ") || "Untitled activity";
}

// Group activities under their CPM division for the picker's <optgroup>s, keeping
// first-seen order (which the query already sorts by sort_order).
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

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function shiftDate(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function DailyWipWorkspace({ projectId, buckets }: DailyWipWorkspaceProps) {
  const queryClient = useQueryClient();
  const listEntries = useServerFn(listDailyWipEntries);
  const listReports = useServerFn(listDailyReports);
  const listActivities = useServerFn(listScheduleActivitiesForWip);
  const saveEntry = useServerFn(saveDailyWipEntry);
  const removeEntry = useServerFn(deleteDailyWipEntry);
  const listDirectory = useServerFn(listSubcontractors);
  const listProjectSubs = useServerFn(listProjectSubcontracts);

  const [selectedDate, setSelectedDate] = useState<string>(() => localToday());
  const [draft, setDraft] = useState<EntryDraft>(emptyDraft);
  // When set, the form is editing an existing logged line (the PM pricing it),
  // not creating a new one.
  const [editingId, setEditingId] = useState<string | null>(null);

  const entriesQuery = useQuery({
    queryKey: ["daily-wip-entries", projectId],
    queryFn: () => listEntries({ data: { projectId } }),
  });
  const reportsQuery = useQuery({
    queryKey: ["daily-reports", projectId],
    queryFn: () => listReports({ data: { projectId } }),
  });
  const activitiesQuery = useQuery({
    queryKey: ["daily-wip-activities", projectId],
    queryFn: () => listActivities({ data: { projectId } }),
  });
  // Subcontractors on this job, so a logged line can be tagged to whoever put the
  // work in place — self-perform crew or a specific sub. The directory gives the
  // company names; the project subcontracts tell us which subs are actually
  // bought out here. Both reads degrade to empty before the subcontractor tables
  // exist, so the picker simply offers "Self-perform" until a sub is bought out.
  const directoryQuery = useQuery({
    queryKey: ["subcontractors-directory"],
    queryFn: () => listDirectory(),
    staleTime: 30_000,
  });
  const projectSubsQuery = useQuery({
    queryKey: ["subcontracts", projectId],
    queryFn: () => listProjectSubs({ data: { projectId } }),
  });

  const entries = useMemo(
    () => (entriesQuery.data ?? []).filter((entry) => entry.entry_date === selectedDate),
    [entriesQuery.data, selectedDate],
  );
  const totals = useMemo(() => dailyWipTotals(entries), [entries]);
  const datesWithEntries = useMemo(() => {
    const set = new Set<string>();
    for (const entry of entriesQuery.data ?? []) set.add(entry.entry_date);
    return set;
  }, [entriesQuery.data]);
  const report = useMemo(
    () => (reportsQuery.data ?? []).find((r) => r.report_date === selectedDate) ?? null,
    [reportsQuery.data, selectedDate],
  );

  const bucketLabel = (id: string | null) => {
    if (!id) return "Uncoded";
    const bucket = buckets.find((b) => b.id === id);
    if (!bucket) return "Uncoded";
    return [bucket.cost_code, bucket.bucket].filter(Boolean).join(" · ") || "Uncoded";
  };

  const activities = useMemo(() => activitiesQuery.data ?? [], [activitiesQuery.data]);
  const activityGroups = useMemo(() => groupActivitiesByDivision(activities), [activities]);
  const activityLabel = (id: string | null) => {
    if (!id) return null;
    const found = activities.find((a) => a.id === id);
    return found ? activityOptionLabel(found) : null;
  };

  const subNameById = useMemo(
    () => new Map((directoryQuery.data ?? []).map((d) => [d.id, d.name] as const)),
    [directoryQuery.data],
  );
  // Subs bought out on this project, deduped by company — the WIP line's
  // subcontractor_id references the directory company, not a specific buyout, so
  // one entry per company (labelled with its first scope title as a hint).
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
  const subName = (id: string | null) => (id ? (subNameById.get(id) ?? "Subcontractor") : null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["daily-wip-entries", projectId] });

  const saveMutation = useMutation({
    mutationFn: (input: SaveWipInput) => saveEntry({ data: input }),
    onSuccess: () => {
      const wasEditing = editingId !== null;
      setDraft(emptyDraft);
      setEditingId(null);
      toast.success(wasEditing ? "Costs saved" : "Day's work recorded");
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not save the entry"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => removeEntry({ data: { id } }),
    onSuccess: () => invalidate(),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not remove the entry"),
  });

  const draftLabor = laborCost(draft);
  const draftMaterial = sumLineItems(draft.material_items);
  const draftEquipment = sumLineItems(draft.equipment_items);
  const draftHasWork =
    draftLabor > 0 || draftMaterial > 0 || draftEquipment > 0 || draft.activity.trim();

  // Drop lines that are entirely blank (no description and no amount) before
  // saving, so an empty "Add line" click never persists noise.
  const cleanItems = (items: CostLineItem[]): CostLineItem[] =>
    items
      .map((item) => ({ description: item.description.trim(), amount: item.amount }))
      .filter((item) => item.description !== "" || item.amount > 0);

  const handleSave = () => {
    if (!draftHasWork) {
      toast.error("Add crew, materials, equipment, or an activity before saving");
      return;
    }
    const material_items = cleanItems(draft.material_items);
    const equipment_items = cleanItems(draft.equipment_items);
    saveMutation.mutate({
      projectId,
      id: editingId ?? undefined,
      cost_bucket_id: draft.cost_bucket_id || null,
      schedule_activity_id: draft.schedule_activity_id || null,
      subcontractor_id: draft.subcontractor_id || null,
      entry_date: selectedDate,
      activity: draft.activity.trim(),
      crew_count: draft.crew_count,
      hours: draft.hours,
      labor_rate: draft.labor_rate,
      material_cost: sumLineItems(material_items),
      equipment_cost: sumLineItems(equipment_items),
      material_items,
      equipment_items,
      quantity: draft.quantity,
      unit: draft.unit.trim(),
      percent_complete: draft.percent_complete,
      notes: draft.notes.trim(),
    });
  };

  // Load a logged line into the form so the PM can price it (add rate, materials,
  // equipment) or adjust it. entry_date comes from selectedDate on save.
  const startEdit = (entry: DailyWipEntryRow) => {
    setEditingId(entry.id);
    setDraft({
      cost_bucket_id: entry.cost_bucket_id ?? "",
      schedule_activity_id: entry.schedule_activity_id ?? "",
      subcontractor_id: entry.subcontractor_id ?? "",
      activity: entry.activity,
      crew_count: entry.crew_count,
      hours: entry.hours,
      labor_rate: entry.labor_rate,
      // Surface any lump cost with no line items as a single editable line, so
      // editing this row never silently zeroes already-recorded material /
      // equipment dollars (save recomputes the cost from these items).
      material_items: costItemsForEdit(entry.material_items, entry.material_cost),
      equipment_items: costItemsForEdit(entry.equipment_items, entry.equipment_cost),
      quantity: entry.quantity,
      unit: entry.unit,
      percent_complete: entry.percent_complete,
      notes: entry.notes,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(emptyDraft);
  };

  const setDraftField = <K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="space-y-6">
      <WorkspaceHeader
        title="Daily WIP"
        subtitle="The costing view. The superintendent logs each day's work in the Daily Reports tab; here you price it — blended crew rate, materials, and equipment. It feeds your billing; billing never waits on it."
      />

      {/* Date navigator */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-surface p-3">
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8"
          aria-label="Previous day"
          onClick={() => setSelectedDate((d) => shiftDate(d, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Input
          type="date"
          value={selectedDate}
          onChange={(event) => setSelectedDate(event.target.value || localToday())}
          className="w-[170px]"
        />
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8"
          aria-label="Next day"
          onClick={() => setSelectedDate((d) => shiftDate(d, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSelectedDate(localToday())}>
          Today
        </Button>
        <div className="ml-auto text-sm font-medium text-foreground">
          {formatBillingDate(selectedDate)}
          {datesWithEntries.has(selectedDate) ? (
            <span className="ml-2 rounded-sm bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground">
              {entries.length} logged
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Left: the day's WIP entries + add form */}
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead className="border-b border-hairline bg-surface-elevated">
                <tr className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  <th className="px-3 py-2 text-left">Activity / cost code</th>
                  <th className="px-3 py-2 text-right">Crew</th>
                  <th className="px-3 py-2 text-right">Hours</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-3 py-2 text-right">Labor</th>
                  <th className="px-3 py-2 text-right">Materials</th>
                  <th className="px-3 py-2 text-right">Equipment</th>
                  <th className="px-3 py-2 text-right">Work in place</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {entriesQuery.isLoading ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                ) : entries.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                      No work logged for this day yet. The superintendent adds work lines in the
                      Daily Reports tab — they show here to cost. You can also add a line below.
                    </td>
                  </tr>
                ) : (
                  entries.map((entry) => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      label={bucketLabel(entry.cost_bucket_id)}
                      activityLabel={activityLabel(entry.schedule_activity_id)}
                      performedBy={subName(entry.subcontractor_id)}
                      editing={editingId === entry.id}
                      onEdit={() => startEdit(entry)}
                      onDelete={() => deleteMutation.mutate(entry.id)}
                      deleting={deleteMutation.isPending}
                    />
                  ))
                )}
              </tbody>
              {entries.length > 0 ? (
                <tfoot>
                  <tr className="border-t-2 border-hairline bg-surface-elevated font-semibold">
                    <td className="px-3 py-2.5 text-left text-foreground">
                      Day total
                      <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                        {totals.laborHours} labor-hours
                      </span>
                    </td>
                    <td colSpan={3} />
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtUSD(totals.labor)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fmtUSD(totals.material)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fmtUSD(totals.equipment)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtUSD(totals.total)}</td>
                    <td />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>

          {/* Add-entry form */}
          <div className="rounded-lg border border-hairline bg-card p-4 shadow-card">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {editingId ? "Add costs to this work line" : "Add a work line"}
              </div>
              {editingId ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-muted-foreground"
                  onClick={cancelEdit}
                >
                  <X className="h-3.5 w-3.5" />
                  Cancel
                </Button>
              ) : null}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {editingId
                ? "Add the blended crew rate, materials, and equipment to price the superintendent's logged work."
                : "The superintendent logs the day's work in the Daily Reports tab — pick a line above to add its costs, or add a line here."}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-xs text-muted-foreground">Cost code (SOV line)</span>
                <select
                  value={draft.cost_bucket_id}
                  onChange={(event) => setDraftField("cost_bucket_id", event.target.value)}
                  className="rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
                >
                  <option value="">Uncoded (assign later)</option>
                  {buckets.map((bucket) => (
                    <option key={bucket.id} value={bucket.id}>
                      {[bucket.cost_code, bucket.bucket].filter(Boolean).join(" · ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-xs text-muted-foreground">Schedule activity (CPM)</span>
                <select
                  value={draft.schedule_activity_id}
                  onChange={(event) => setDraftField("schedule_activity_id", event.target.value)}
                  disabled={activities.length === 0}
                  className="rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60"
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
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-xs text-muted-foreground">Performed by</span>
                <select
                  value={draft.subcontractor_id}
                  onChange={(event) => setDraftField("subcontractor_id", event.target.value)}
                  disabled={subOptions.length === 0}
                  className="rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60"
                >
                  <option value="">
                    {subOptions.length === 0
                      ? "Self-perform (no subs bought out yet)"
                      : "Self-perform (in-house)"}
                  </option>
                  {subOptions.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-xs text-muted-foreground">Activity / note</span>
                <Input
                  value={draft.activity}
                  onChange={(event) => setDraftField("activity", event.target.value)}
                  placeholder="e.g. Formwork north wall"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Crew</span>
                <Input
                  type="number"
                  min={0}
                  value={draft.crew_count || ""}
                  onChange={(event) => setDraftField("crew_count", Number(event.target.value) || 0)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Hours</span>
                <Input
                  type="number"
                  min={0}
                  step="0.25"
                  value={draft.hours || ""}
                  onChange={(event) => setDraftField("hours", Number(event.target.value) || 0)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Blended rate ($/hr)</span>
                <MoneyInput
                  value={draft.labor_rate}
                  onValueChange={(n) => setDraftField("labor_rate", n)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Labor (derived)</span>
                <div className="flex h-9 items-center rounded-md border border-hairline bg-muted/40 px-3 text-sm tabular-nums text-foreground">
                  {fmtUSD(draftLabor)}
                </div>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Quantity placed</span>
                <Input
                  type="number"
                  min={0}
                  value={draft.quantity || ""}
                  onChange={(event) => setDraftField("quantity", Number(event.target.value) || 0)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Unit</span>
                <Input
                  value={draft.unit}
                  onChange={(event) => setDraftField("unit", event.target.value)}
                  placeholder="SF, CY, LF…"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">% complete</span>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.percent_complete || ""}
                  placeholder="from the field — adjust if needed"
                  onChange={(event) =>
                    setDraftField(
                      "percent_complete",
                      Math.min(100, Math.max(0, Number(event.target.value) || 0)),
                    )
                  }
                />
              </label>
            </div>

            {/* Itemized materials + equipment: what it was, and how much it cost. */}
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <ItemizedCostEditor
                label="Materials"
                help="What you installed and its cost — e.g. rebar #5, $1,200"
                placeholder="What material? e.g. rebar #5"
                items={draft.material_items}
                onChange={(items) => setDraftField("material_items", items)}
              />
              <ItemizedCostEditor
                label="Equipment"
                help="What you ran and its cost — e.g. 20T excavator, $800"
                placeholder="What equipment? e.g. 20T excavator"
                items={draft.equipment_items}
                onChange={(items) => setDraftField("equipment_items", items)}
              />
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">
                Work in place ={" "}
                <span className="font-medium text-foreground">
                  {fmtUSD(
                    dailyWipTotals([
                      {
                        crew_count: draft.crew_count,
                        hours: draft.hours,
                        labor_rate: draft.labor_rate,
                        material_cost: draftMaterial,
                        equipment_cost: draftEquipment,
                        quantity: draft.quantity,
                      },
                    ]).total,
                  )}
                </span>
              </span>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={handleSave}
                disabled={saveMutation.isPending}
              >
                <Plus className="h-3.5 w-3.5" />
                {saveMutation.isPending ? "Saving…" : editingId ? "Save costs" : "Add to this day"}
              </Button>
            </div>
          </div>
        </div>

        {/* Right: the day's daily report, read-only reference */}
        <aside className="space-y-3">
          <div className="rounded-lg border border-hairline bg-surface p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Daily report · {formatBillingDate(selectedDate)}
            </div>
            {report ? (
              <div className="mt-2 space-y-2 text-sm">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                  {report.crew_count ? (
                    <span>
                      <span className="font-medium text-foreground">{report.crew_count}</span> crew
                    </span>
                  ) : null}
                  {report.weather ? <span>{report.weather}</span> : null}
                  {report.author ? <span>by {report.author}</span> : null}
                </div>
                {report.work_performed ? (
                  <p className="whitespace-pre-wrap text-foreground">{report.work_performed}</p>
                ) : (
                  <p className="text-muted-foreground">No work narrative recorded.</p>
                )}
                {report.delays ? (
                  <p className="text-warning">
                    <span className="font-medium">Delays:</span> {report.delays}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                No daily report filed for this day. Add one in the{" "}
                <span className="font-medium text-foreground">Daily Reports</span> tab — it'll show
                here next to the WIP.
              </p>
            )}
          </div>

          {entries.length > 0 ? (
            <div className="rounded-lg border border-hairline bg-surface p-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Production
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {entries
                  .map((entry) => ({ entry, rate: productionRate(entry) }))
                  .filter((row) => row.rate != null)
                  .map(({ entry, rate }) => (
                    <li key={entry.id} className="flex justify-between gap-2 text-muted-foreground">
                      <span className="truncate">
                        {entry.activity || bucketLabel(entry.cost_bucket_id)}
                      </span>
                      <span className="shrink-0 tabular-nums text-foreground">
                        {(rate as number).toFixed(2)} {entry.unit || "unit"}/hr
                      </span>
                    </li>
                  ))}
                {entries.every((entry) => productionRate(entry) == null) ? (
                  <li className="text-muted-foreground">
                    Log a quantity and hours to see production rates.
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

// A single Materials or Equipment line list: each row says what it was and how
// much it cost. The dollar box carries a visible $ so it reads as money, and the
// list rolls up to a cents-safe total shown beneath.
function ItemizedCostEditor({
  label,
  help,
  placeholder,
  items,
  onChange,
}: {
  label: string;
  help: string;
  placeholder: string;
  items: CostLineItem[];
  onChange: (items: CostLineItem[]) => void;
}) {
  const total = sumLineItems(items);
  const update = (index: number, patch: Partial<CostLineItem>) =>
    onChange(items.map((item, idx) => (idx === index ? { ...item, ...patch } : item)));
  const addLine = () => onChange([...items, { description: "", amount: 0 }]);
  const removeLine = (index: number) => onChange(items.filter((_, idx) => idx !== index));

  return (
    <div className="rounded-md border border-hairline bg-surface p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{label}</span>
        {total > 0 ? (
          <span className="text-xs font-medium tabular-nums text-foreground">{fmtUSD(total)}</span>
        ) : null}
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{help}</p>

      <div className="mt-2 space-y-2">
        {items.map((item, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              value={item.description}
              placeholder={placeholder}
              className="flex-1"
              onChange={(event) => update(index, { description: event.target.value })}
            />
            <div className="relative w-[130px] shrink-0">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                $
              </span>
              <MoneyInput
                value={item.amount}
                onValueChange={(n) => update(index, { amount: n })}
                align="right"
                className="pl-6"
              />
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-danger"
              aria-label={`Remove ${label.toLowerCase()} line`}
              onClick={() => removeLine(index)}
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
        className="mt-2 gap-1.5 text-muted-foreground"
        onClick={addLine}
      >
        <Plus className="h-3.5 w-3.5" />
        Add {label.toLowerCase()} line
      </Button>
    </div>
  );
}

// Human-readable breakdown for the table cell's hover title.
function itemsTooltip(items: CostLineItem[]): string | undefined {
  const lines = items
    .filter((item) => item.description.trim() || item.amount > 0)
    .map((item) => `${item.description.trim() || "—"}: ${fmtUSD(item.amount)}`);
  return lines.length ? lines.join("\n") : undefined;
}

function EntryRow({
  entry,
  label,
  activityLabel,
  performedBy,
  editing,
  onEdit,
  onDelete,
  deleting,
}: {
  entry: DailyWipEntryRow;
  label: string;
  activityLabel: string | null;
  performedBy: string | null;
  editing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const labor = laborCost(entry);
  const workInPlace = rowWorkInPlace(entry);
  const costed = entry.labor_rate > 0 || entry.material_cost > 0 || entry.equipment_cost > 0;
  return (
    <tr className={`border-b border-hairline/70 last:border-0 ${editing ? "bg-accent/10" : ""}`}>
      <td className="px-3 py-2.5 text-left">
        <div className="font-medium text-foreground">{entry.activity || label}</div>
        {entry.activity ? <div className="text-[11px] text-muted-foreground">{label}</div> : null}
        {activityLabel ? (
          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            <CalendarClock className="h-3 w-3 shrink-0 text-accent" />
            <span className="truncate">{activityLabel}</span>
          </div>
        ) : null}
        {performedBy ? (
          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            <HardHat className="h-3 w-3 shrink-0 text-accent" />
            <span className="truncate">{performedBy}</span>
          </div>
        ) : null}
        {entry.percent_complete ? (
          <div className="mt-0.5 text-[11px] font-medium text-foreground">
            {entry.percent_complete}% complete
          </div>
        ) : null}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">{entry.crew_count || "—"}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{entry.hours || "—"}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {entry.labor_rate ? fmtUSD(entry.labor_rate) : "—"}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">{labor ? fmtUSD(labor) : "—"}</td>
      <td
        className="px-3 py-2.5 text-right tabular-nums"
        title={itemsTooltip(entry.material_items)}
      >
        {entry.material_cost ? fmtUSD(entry.material_cost) : "—"}
        {entry.material_items.length > 1 ? (
          <div className="text-[10px] font-normal text-muted-foreground">
            {entry.material_items.length} items
          </div>
        ) : null}
      </td>
      <td
        className="px-3 py-2.5 text-right tabular-nums"
        title={itemsTooltip(entry.equipment_items)}
      >
        {entry.equipment_cost ? fmtUSD(entry.equipment_cost) : "—"}
        {entry.equipment_items.length > 1 ? (
          <div className="text-[10px] font-normal text-muted-foreground">
            {entry.equipment_items.length} items
          </div>
        ) : null}
      </td>
      <td className="px-3 py-2.5 text-right font-medium tabular-nums">
        {fmtUSD(workInPlace)}
        {!costed ? (
          <div className="text-[10px] font-normal uppercase tracking-wide text-warning">
            Needs costs
          </div>
        ) : null}
      </td>
      <td className="px-3 py-2.5 text-right">
        <div className="flex items-center justify-end gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-accent"
            aria-label={costed ? "Edit costs" : "Add costs"}
            onClick={onEdit}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-danger"
            aria-label="Remove entry"
            onClick={onDelete}
            disabled={deleting}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}
