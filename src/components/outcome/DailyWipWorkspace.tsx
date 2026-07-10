// Workspace B — the daily WIP recording surface (BILLINGDESIGN P2). Pick any
// date, see that day's daily report alongside it, and record the work put in
// place: self-perform crew (crew × hours × blended rate), materials, and
// equipment, against a cost code. The day's totals fall out cents-safe, and a
// production rate comes for free when a quantity is logged.
//
// The dependency rule: this FEEDS billing; billing never waits on it. Recording
// here is optional and additive.
import { useCallback, useEffect, useMemo, useState } from "react";
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
} from "lucide-react";

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
  commitmentBySubBucket,
  costItemsForEdit,
  dailyWipTotals,
  dayProfitSummary,
  dailyWipWorkInPlaceTotal,
  isPercentOverridden,
  laborCost,
  priorSubPercent,
  productionRate,
  lineProfitToday,
  priorCodePercent,
  rowWorkInPlace,
  type LineProfitToday,
  subCommitmentKey,
  subEarnedValue,
  sumLineItems,
  type CostLineItem,
  type DailyWipRowLike,
} from "@/lib/daily-wip";

interface BucketOption {
  id: string;
  cost_code: string;
  bucket: string;
  // The SOV price of this line (what the owner pays) — the route's full bucket
  // rows carry it; the daily P&L prices each day's % movement with it.
  contract_value?: number;
}

interface DailyWipWorkspaceProps {
  projectId: string;
  buckets: BucketOption[];
  // Drill-through landing (e.g. the Budget drawer's "from the daily log" rows):
  // when set, the workspace jumps to that day and reports back so the route can
  // clear it — the same handoff pattern as the risk register focus.
  focusDate?: string | null;
  onFocusDateHandled?: () => void;
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
  // The WIP is the PM's costing surface — a % saved here is a reviewed value, and
  // a change from the super's field number is tracked as an override.
  percent_source: "field" | "costing";
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

export function DailyWipWorkspace({
  projectId,
  buckets,
  focusDate,
  onFocusDateHandled,
}: DailyWipWorkspaceProps) {
  const queryClient = useQueryClient();
  const listEntries = useServerFn(listDailyWipEntries);
  const listReports = useServerFn(listDailyReports);
  const listActivities = useServerFn(listScheduleActivitiesForWip);
  const saveEntry = useServerFn(saveDailyWipEntry);
  const removeEntry = useServerFn(deleteDailyWipEntry);
  const listDirectory = useServerFn(listSubcontractors);
  const listProjectSubs = useServerFn(listProjectSubcontracts);

  const [selectedDate, setSelectedDate] = useState<string>(() => localToday());
  useEffect(() => {
    if (!focusDate) return;
    setSelectedDate(focusDate);
    onFocusDateHandled?.();
  }, [focusDate, onFocusDateHandled]);
  const [draft, setDraft] = useState<EntryDraft>(emptyDraft);
  // When set, the form is editing an existing logged line (the PM pricing it),
  // not creating a new one.
  const [editingId, setEditingId] = useState<string | null>(null);
  // The work-line editor is a modal (Marshall 2026-07-10 — the old in-place
  // form below the table was invisible below the fold). openAddForm / startEdit
  // open it; closeForm is the SINGLE reset every close path runs (footer Cancel,
  // the dialog X, a click-outside, and a successful save) so edit state can
  // never leak into the next open (the Radix-onOpenChange-skips-programmatic-
  // close trap from the cost dialog review).
  const [formOpen, setFormOpen] = useState(false);
  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setDraft(emptyDraft);
  };
  const openAddForm = () => {
    setEditingId(null);
    setDraft(emptyDraft);
    setFormOpen(true);
  };

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

  // Committed dollars per (sub company, cost code) from executed buyouts, so a
  // sub-tagged work line can be valued by earned value: commitment × % complete.
  const commitmentLookup = useMemo(
    () =>
      commitmentBySubBucket(
        projectSubsQuery.data?.subcontracts ?? [],
        projectSubsQuery.data?.allocations ?? [],
      ),
    [projectSubsQuery.data],
  );
  const commitmentFor = useCallback(
    (row: Pick<DailyWipRowLike, "subcontractor_id" | "cost_bucket_id">): number | null => {
      const key = subCommitmentKey(row.subcontractor_id, row.cost_bucket_id);
      return key ? (commitmentLookup.get(key) ?? null) : null;
    },
    [commitmentLookup],
  );
  // A sub line's %-complete is cumulative and logged fresh each day, so its work
  // put in place on a given day is the increment since the prior log — not its
  // whole to-date amount. This resolves that prior cumulative % from ALL entries
  // (the baseline came from an earlier day, not the day on screen).
  const priorPercentFor = useCallback(
    (row: {
      subcontractor_id: string | null;
      cost_bucket_id: string | null;
      entry_date?: string;
      updated_at?: string | null;
      id?: string | null;
    }) =>
      priorSubPercent(
        {
          subcontractor_id: row.subcontractor_id,
          cost_bucket_id: row.cost_bucket_id,
          entry_date: row.entry_date ?? selectedDate,
          updated_at: row.updated_at,
          id: row.id,
        },
        entriesQuery.data ?? [],
      ),
    [entriesQuery.data, selectedDate],
  );
  // Work-in-place total must include sub lines (valued by commitment × %), which
  // the labor/materials/equipment breakdown doesn't capture. Defined after
  // commitmentFor so it never reads it in the temporal dead zone.
  const workInPlaceTotal = useMemo(
    () => dailyWipWorkInPlaceTotal(entries, commitmentFor, priorPercentFor),
    [entries, commitmentFor, priorPercentFor],
  );

  // The daily P&L: each line's % movement priced at its cost code's contract
  // value (earned), against its work-in-place cost. Keyed by entry id for the
  // row cells; summarized for the day card. Lines that can't be measured say
  // why instead of faking a loss.
  const contractValueFor = useCallback(
    (costBucketId: string | null): number | null => {
      if (!costBucketId) return null;
      const bucket = buckets.find((b) => b.id === costBucketId);
      if (!bucket || bucket.contract_value == null) return null;
      return bucket.contract_value;
    },
    [buckets],
  );
  const profitByEntry = useMemo(() => {
    const map = new Map<string, LineProfitToday>();
    for (const entry of entries) {
      map.set(
        entry.id,
        lineProfitToday(
          contractValueFor(entry.cost_bucket_id),
          priorCodePercent(entry, entriesQuery.data ?? []),
          entry.percent_complete,
          rowWorkInPlace(entry, commitmentFor(entry), priorPercentFor(entry)),
        ),
      );
    }
    return map;
  }, [entries, entriesQuery.data, contractValueFor, commitmentFor, priorPercentFor]);
  const dayProfit = useMemo(() => dayProfitSummary([...profitByEntry.values()]), [profitByEntry]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["daily-wip-entries", projectId] });
    // The server folds this WIP into the project payload (ledger actuals, the
    // Budget drawer's "from the daily log" figure) — keep them in step.
    queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  };

  const saveMutation = useMutation({
    mutationFn: (input: SaveWipInput) => saveEntry({ data: input }),
    onSuccess: (_data, variables) => {
      // Label off the SAVED row, not live editingId (which a close would reset).
      closeForm();
      toast.success(variables.id ? "Costs saved" : "Day's work recorded");
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

  // The line being edited (if any) — the PM is reviewing the super's field %, so
  // surface what the field logged next to the value they're about to save.
  const editingEntry = editingId
    ? ((entriesQuery.data ?? []).find((e) => e.id === editingId) ?? null)
    : null;
  const fieldPercent = editingEntry?.field_percent_complete ?? 0;
  const pmAdjusting = editingEntry != null && draft.percent_complete !== fieldPercent;

  const draftLabor = laborCost(draft);
  const draftMaterial = sumLineItems(draft.material_items);
  const draftEquipment = sumLineItems(draft.equipment_items);
  // A sub-tagged draft on a coded line is valued by its buyout commitment × %
  // complete; self-perform by crew/materials/equipment.
  const draftCommitment = commitmentFor({
    subcontractor_id: draft.subcontractor_id || null,
    cost_bucket_id: draft.cost_bucket_id || null,
  });
  const draftIsSub = Boolean(
    draft.subcontractor_id && draftCommitment != null && draftCommitment > 0,
  );
  // The cumulative % already logged for this sub line before this draft, so the
  // preview values the draft at the increment it adds (20% → 30% earns 10%, not
  // 30% again). Exclude the entry being edited so it isn't its own predecessor;
  // the max-sentinel updated_at makes any same-day existing entry count as prior.
  const draftPrior = priorSubPercent(
    {
      subcontractor_id: draft.subcontractor_id || null,
      cost_bucket_id: draft.cost_bucket_id || null,
      entry_date: selectedDate,
      updated_at: "9999-12-31T23:59:59.999Z",
      id: editingId,
    },
    entriesQuery.data ?? [],
  );
  const draftWorkInPlace = rowWorkInPlace(
    {
      crew_count: draft.crew_count,
      hours: draft.hours,
      labor_rate: draft.labor_rate,
      material_cost: draftMaterial,
      equipment_cost: draftEquipment,
      quantity: draft.quantity,
      subcontractor_id: draft.subcontractor_id || null,
      cost_bucket_id: draft.cost_bucket_id || null,
      percent_complete: draft.percent_complete,
    },
    draftCommitment,
    draftPrior,
  );
  const draftHasWork =
    draftLabor > 0 ||
    draftMaterial > 0 ||
    draftEquipment > 0 ||
    (draftIsSub && draft.percent_complete > 0) ||
    draft.activity.trim();

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
      // Saving here is the PM reviewing/pricing — record it as a costing edit so a
      // change from the super's field number is tracked (the field % is preserved).
      percent_source: "costing",
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
    setFormOpen(true);
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
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Logged work
            </div>
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              onClick={openAddForm}
              disabled={saveMutation.isPending}
            >
              <Plus className="h-3.5 w-3.5" /> Add work line
            </Button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
            <table className="w-full min-w-[940px] border-collapse text-sm">
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
                  <th className="px-3 py-2 text-right">Made / lost today</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {entriesQuery.isLoading ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                ) : entries.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">
                      No work logged for this day yet. The superintendent adds work lines in the
                      Daily Reports tab — they show here to cost. You can also use "Add work line"
                      above.
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
                      subCommitment={commitmentFor(entry)}
                      priorPercent={priorPercentFor(entry)}
                      profit={profitByEntry.get(entry.id) ?? null}
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
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fmtUSD(workInPlaceTotal)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <ProfitAmount value={dayProfit.measuredCount > 0 ? dayProfit.profit : null} />
                    </td>
                    <td />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>

          {/* Work-line editor — a modal so it can't hide below the fold. */}
          <Dialog
            open={formOpen}
            onOpenChange={(next) => {
              // Ignore close requests (Esc / overlay / X) while saving — closing
              // mid-save and reopening would let the in-flight onSuccess wipe the
              // new form.
              if (!next && !saveMutation.isPending) closeForm();
            }}
          >
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingId ? "Price this work line" : "Add a work line"}</DialogTitle>
                <DialogDescription>
                  {editingId
                    ? "Add the blended crew rate, materials, and equipment to price the superintendent's logged work."
                    : `Adds a priced line directly to ${formatBillingDate(selectedDate)}. The superintendent usually logs the day's work in the Daily Reports tab.`}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
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
                    onChange={(event) =>
                      setDraftField("crew_count", Number(event.target.value) || 0)
                    }
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
                  {draftIsSub ? (
                    <span className="text-[10px] text-muted-foreground">
                      {draftPrior > 0 ? (
                        <>
                          Sub line — earns {fmtUSD(draftWorkInPlace)} this update ({draftPrior}% →{" "}
                          {draft.percent_complete || 0}%).{" "}
                          {fmtUSD(subEarnedValue(draftCommitment ?? 0, draft.percent_complete))} of
                          the {fmtUSD(draftCommitment ?? 0)} buyout earned to date.
                        </>
                      ) : (
                        <>
                          Sub line — earns {fmtUSD(draftWorkInPlace)} at{" "}
                          {draft.percent_complete || 0}% of the {fmtUSD(draftCommitment ?? 0)}{" "}
                          buyout.
                        </>
                      )}
                    </span>
                  ) : null}
                  {editingEntry ? (
                    <span
                      className={`text-[10px] ${pmAdjusting ? "text-warning" : "text-muted-foreground"}`}
                    >
                      {pmAdjusting
                        ? `Field logged ${fieldPercent}% — you're showing ${draft.percent_complete}%. The change is recorded.`
                        : `Field logged ${fieldPercent}%.`}
                    </span>
                  ) : null}
                </label>
              </div>

              {/* Itemized materials + equipment: what it was, and how much it cost. */}
              <div className="mt-2 grid gap-4">
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

              <DialogFooter className="mt-2 flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-[11px] text-muted-foreground">
                  Work in place ={" "}
                  <span className="font-medium text-foreground">{fmtUSD(draftWorkInPlace)}</span>
                  {draftIsSub ? (
                    <span className="ml-1">
                      {draftPrior > 0
                        ? `(+${(draft.percent_complete || 0) - draftPrior}% this update, ${draftPrior}→${draft.percent_complete || 0}% of the sub commitment)`
                        : `(${draft.percent_complete || 0}% of ${fmtUSD(draftCommitment ?? 0)} sub commitment)`}
                    </span>
                  ) : null}
                </span>
                <div className="flex items-center gap-2 sm:justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={closeForm}
                    disabled={saveMutation.isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={handleSave}
                    disabled={saveMutation.isPending}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {saveMutation.isPending
                      ? "Saving…"
                      : editingId
                        ? "Save costs"
                        : "Add to this day"}
                  </Button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Right: the day's daily report, read-only reference */}
        <aside className="space-y-3">
          {entries.length > 0 ? (
            <div className="rounded-lg border border-hairline bg-card p-4 shadow-card">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Made or lost today
              </div>
              {dayProfit.measuredCount > 0 ? (
                <>
                  <div
                    className={`mt-1.5 text-2xl font-semibold tabular-nums ${
                      dayProfit.profit < 0 ? "text-danger" : "text-success"
                    }`}
                  >
                    {dayProfit.profit < 0 ? "−" : "+"}
                    {fmtUSD(Math.abs(dayProfit.profit))}
                  </div>
                  <dl className="mt-2 space-y-1 text-sm">
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Earned today</dt>
                      <dd className="tabular-nums text-foreground">{fmtUSD(dayProfit.earned)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Cost of that work</dt>
                      <dd className="tabular-nums text-foreground">
                        {fmtUSD(dayProfit.measuredCost)}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                    Earned = each line's % progress today × its cost code's contract value (what the
                    owner pays). The gap against today's cost is your margin on the day.
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Log % progress on today's lines to see what the day earned against what it cost.
                </p>
              )}
              {dayProfit.unmeasuredCount > 0 && dayProfit.measuredCount > 0 ? (
                <p className="mt-2 text-[11px] leading-snug text-warning">
                  {dayProfit.unmeasuredCount} line{dayProfit.unmeasuredCount === 1 ? "" : "s"} with{" "}
                  {fmtUSD(dayProfit.unmeasuredCost)} of cost{" "}
                  {dayProfit.unmeasuredCount === 1 ? "isn't" : "aren't"} counted — no % progress or
                  contract value on {dayProfit.unmeasuredCount === 1 ? "it" : "them"} yet.
                </p>
              ) : null}
            </div>
          ) : null}
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

// Plain-English "why there's no number" labels — a missing % log must never
// read as a loss.
const PROFIT_REASON_LABEL: Record<NonNullable<LineProfitToday["reason"]>, string> = {
  "no-code": "No cost code",
  unpriced: "Needs contract value",
  "no-progress": "No % progress logged",
  uncosted: "Costs not priced yet",
};

// A made/lost dollar figure that reads itself: green +$ / red −$; null → dash.
function ProfitAmount({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const negative = value < 0;
  return (
    <span className={`font-medium tabular-nums ${negative ? "text-danger" : "text-success"}`}>
      {negative ? "−" : "+"}
      {fmtUSD(Math.abs(value))}
    </span>
  );
}

function EntryRow({
  entry,
  label,
  activityLabel,
  performedBy,
  subCommitment,
  priorPercent,
  profit,
  editing,
  onEdit,
  onDelete,
  deleting,
}: {
  entry: DailyWipEntryRow;
  label: string;
  activityLabel: string | null;
  performedBy: string | null;
  subCommitment: number | null;
  // Cumulative % logged for this sub line before this entry, so its work in place
  // is the increment since the prior log (not the whole to-date amount).
  priorPercent: number;
  // The line's P&L for the day (earned vs cost), or null while loading.
  profit: LineProfitToday | null;
  editing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const labor = laborCost(entry);
  const workInPlace = rowWorkInPlace(entry, subCommitment, priorPercent);
  // A bought-out sub line is "costed" once it has a percent complete to earn
  // against its commitment; a self-perform line once it has rate/materials/equipment.
  const isSubLine = Boolean(entry.subcontractor_id && subCommitment != null && subCommitment > 0);
  const costed = isSubLine
    ? entry.percent_complete > 0
    : entry.labor_rate > 0 || entry.material_cost > 0 || entry.equipment_cost > 0;
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
        {entry.percent_complete || entry.field_percent_complete ? (
          <div className="mt-0.5 text-[11px] font-medium text-foreground">
            {entry.percent_complete}% complete
            {isPercentOverridden(entry) ? (
              <span className="ml-1 font-normal text-warning">
                (field logged {entry.field_percent_complete}%)
              </span>
            ) : null}
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
        {isSubLine && costed ? (
          <div className="text-[10px] font-normal text-muted-foreground">
            {priorPercent > 0
              ? `+${entry.percent_complete - priorPercent}% (${priorPercent}→${entry.percent_complete}%)`
              : `${entry.percent_complete}% of ${fmtUSD(subCommitment ?? 0)}`}
          </div>
        ) : null}
        {!costed ? (
          <div className="text-[10px] font-normal uppercase tracking-wide text-warning">
            {isSubLine ? "Needs % complete" : "Needs costs"}
          </div>
        ) : null}
      </td>
      <td className="px-3 py-2.5 text-right">
        {profit && profit.profitToday !== null ? (
          <>
            <ProfitAmount value={profit.profitToday} />
            <div className="text-[10px] font-normal text-muted-foreground">
              earned {fmtUSD(profit.earnedToday ?? 0)}
            </div>
          </>
        ) : (
          <>
            <span className="text-muted-foreground">—</span>
            {profit?.reason ? (
              <div className="max-w-[110px] text-[10px] font-normal leading-snug text-muted-foreground">
                {PROFIT_REASON_LABEL[profit.reason]}
              </div>
            ) : null}
          </>
        )}
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
