// Workspace B — the daily WIP recording surface (BILLINGDESIGN P2). Pick any
// date, see that day's daily report alongside it, and record the work put in
// place: self-perform crews (people per crew × hours × blended rate), materials, and
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
  BarChart3,
  ChevronLeft,
  ChevronRight,
  HardHat,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { SubcontractFinancialReadState } from "@/components/project/SubcontractFinancialReadState";
import { InstalledQuantities } from "@/components/outcome/InstalledQuantities";
import { ItemizedCostEditor } from "@/components/outcome/ItemizedCostEditor";
import { PerformedByField } from "@/components/outcome/PerformedByField";
import { SubcontractProductionBenchmarks } from "@/components/outcome/SubcontractProductionBenchmarks";
import { ProductionControlView } from "@/components/outcome/ProductionControlView";
import { createDraftCostItem, type DraftCostItem } from "@/components/outcome/daily-wip-drafts";
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
import { fmtUSDCents as fmtUSD, formatBillingDate } from "@/lib/billing-format";
import { centsToDollars, dollarsToCents } from "@/lib/payments-domain";
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
  laborHours,
  crewPeople,
  priorSubPercent,
  productionPace,
  productionRate,
  lineProfitToday,
  priorCodePercent,
  rowWorkInPlace,
  type DayProfitSummary,
  type LineProfitToday,
  subCommitmentKey,
  subEarnedValue,
  sumLineItems,
  type CostLineItem,
  type DailyWipRowLike,
} from "@/lib/daily-wip";
import {
  canonicalProductionUnit,
  productionScopeKey,
  type ProductionAnalyticsRow,
} from "@/lib/production-analytics";
import type { ProductionScopePlan } from "@/lib/production-forecast";

interface BucketOption {
  id: string;
  cost_code: string;
  bucket: string;
  // The SOV price of this line (what the owner pays) — the route's full bucket
  // rows carry it; the daily P&L prices each day's % movement with it.
  contract_value?: number;
  contract_quantity?: number;
  unit?: string;
  earned_percent_complete?: number;
}

interface DailyWipWorkspaceProps {
  projectId: string;
  buckets: BucketOption[];
  initialMode?: WipWorkspaceMode;
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
  unmatched_vendor_name: string;
  entry_date: string;
  activity: string;
  crew_count: number;
  people_per_crew: number;
  hours: number;
  labor_rate: number;
  material_cost: number;
  equipment_cost: number;
  material_items: CostLineItem[];
  equipment_items: CostLineItem[];
  quantity: number;
  unit: string;
  target_production_rate: number | null;
  // Preserved through the PM's costing save so they're never wiped (the super owns
  // them on the daily-log side). Label + display only; they drive no cost math.
  quantity_items: { quantity: number; unit: string; description: string }[];
  percent_basis: "sov" | "cpm";
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
  unmatched_vendor_name: string;
  activity: string;
  crew_count: number;
  people_per_crew: number;
  hours: number;
  labor_rate: number;
  material_items: DraftCostItem[];
  equipment_items: DraftCostItem[];
  quantity: number;
  unit: string;
  target_production_rate: number | null;
  // Round-tripped so a PM edit preserves the super's itemized quantities + basis.
  quantity_items: { quantity: number; unit: string; description: string }[];
  percent_basis: "sov" | "cpm";
  percent_complete: number;
  notes: string;
}

const emptyDraft: EntryDraft = {
  cost_bucket_id: "",
  schedule_activity_id: "",
  subcontractor_id: "",
  unmatched_vendor_name: "",
  activity: "",
  crew_count: 0,
  people_per_crew: 2,
  hours: 0,
  labor_rate: 0,
  material_items: [],
  equipment_items: [],
  quantity: 0,
  unit: "",
  target_production_rate: null,
  quantity_items: [],
  percent_basis: "sov",
  percent_complete: 0,
  notes: "",
};

// "01-010 · Form north wall" — the human-readable label for a schedule activity.
function activityOptionLabel(a: ScheduleActivityOption): string {
  return [a.activity_id, a.name].filter(Boolean).join(" · ") || "Untitled activity";
}

type ProductionQuantityItem = EntryDraft["quantity_items"][number];

function productionMeasureLabel(item: ProductionQuantityItem): string {
  return [item.unit.trim(), item.description.trim()].filter(Boolean).join(" ") || "units";
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

// "Jul 9" — the verdict headline's short date (formatBillingDate keeps the year
// for the reference cards; the headline reads better without it).
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ONE test for "this row still needs a price" — the row's warn pill, the alert
// banner, and the headline clause all read this so they can never drift. A
// bought-out sub line is priced by its % complete (earned against its
// commitment); a self-perform line by rate / materials / equipment.
function entryNeedsPrice(
  entry: Pick<
    DailyWipEntryRow,
    "subcontractor_id" | "percent_complete" | "labor_rate" | "material_cost" | "equipment_cost"
  >,
  subCommitment: number | null,
): boolean {
  const isSubLine = Boolean(entry.subcontractor_id && subCommitment != null && subCommitment > 0);
  return isSubLine
    ? !(entry.percent_complete > 0)
    : !(entry.labor_rate > 0 || entry.material_cost > 0 || entry.equipment_cost > 0);
}

type StatScope = "day" | "week" | "month";
type WipWorkspaceMode = "daily" | "production";

export function DailyWipWorkspace({
  projectId,
  buckets,
  initialMode = "daily",
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
  // The dark stat panel's Day / Week / Month lens — presentation-only.
  const [statScope, setStatScope] = useState<StatScope>("day");
  const [workspaceMode, setWorkspaceMode] = useState<WipWorkspaceMode>(initialMode);
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
  const subName = useCallback(
    (id: string | null) => (id ? (subNameById.get(id) ?? "Subcontractor") : null),
    [subNameById],
  );
  const performedByName = useCallback(
    (row: Pick<DailyWipEntryRow, "subcontractor_id" | "unmatched_vendor_name">) =>
      (subName(row.subcontractor_id) ?? row.unmatched_vendor_name) || null,
    [subName],
  );
  const bucketById = useMemo(
    () => new Map(buckets.map((bucket) => [bucket.id, bucket])),
    [buckets],
  );

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
  const productionBenchmarkSettings = useMemo(() => {
    const subCompanyByBuyout = new Map(
      (projectSubsQuery.data?.subcontracts ?? []).map((sub) => [sub.id, sub.subcontractor_id]),
    );
    const map = new Map<
      string,
      { plannedQuantity: number; unit: string; benchmarkLaborRate: number }
    >();
    for (const allocation of projectSubsQuery.data?.allocations ?? []) {
      const companyId = subCompanyByBuyout.get(allocation.subcontract_id);
      const key = subCommitmentKey(companyId, allocation.cost_bucket_id);
      if (!key || allocation.planned_quantity <= 0 || !allocation.unit.trim()) continue;
      const next = {
        plannedQuantity: allocation.planned_quantity,
        unit: allocation.unit.trim(),
        benchmarkLaborRate: allocation.benchmark_labor_rate,
      };
      const prior = map.get(key);
      if (!prior) {
        map.set(key, next);
      } else if (
        prior.unit.toLowerCase() === next.unit.toLowerCase() &&
        prior.benchmarkLaborRate === next.benchmarkLaborRate
      ) {
        map.set(key, { ...prior, plannedQuantity: prior.plannedQuantity + next.plannedQuantity });
      } else {
        // Multiple buyouts by the same company/code need one consistent unit and
        // benchmark before OverWatch can combine them without inventing math.
        map.delete(key);
      }
    }
    return map;
  }, [projectSubsQuery.data]);
  const commitmentFor = useCallback(
    (row: Pick<DailyWipRowLike, "subcontractor_id" | "cost_bucket_id">): number | null => {
      const key = subCommitmentKey(row.subcontractor_id, row.cost_bucket_id);
      return key ? (commitmentLookup.get(key) ?? null) : null;
    },
    [commitmentLookup],
  );
  const benchmarkTargetFor = useCallback(
    (row: Pick<DailyWipRowLike, "subcontractor_id" | "cost_bucket_id">): number | null => {
      const key = subCommitmentKey(row.subcontractor_id, row.cost_bucket_id);
      if (!key) return null;
      const setting = productionBenchmarkSettings.get(key);
      const commitment = commitmentLookup.get(key) ?? 0;
      if (
        !setting ||
        setting.plannedQuantity <= 0 ||
        setting.benchmarkLaborRate <= 0 ||
        commitment <= 0
      ) {
        return null;
      }
      // planned quantity / (buyout dollars / GC benchmark dollars per labor-hour)
      return (setting.plannedQuantity * setting.benchmarkLaborRate) / commitment;
    },
    [commitmentLookup, productionBenchmarkSettings],
  );
  const effectiveProductionTargetFor = useCallback(
    (row: DailyWipRowLike): number | null =>
      benchmarkTargetFor(row) ?? row.target_production_rate ?? null,
    [benchmarkTargetFor],
  );
  // A sub line's %-complete is cumulative and logged fresh each day, so its work
  // put in place on a given day is the increment since the prior log — not its
  // whole to-date amount. This resolves that prior cumulative % from ALL entries
  // (the baseline came from an earlier day, not the day on screen).
  const priorPercentFor = useCallback(
    (row: DailyWipRowLike) =>
      priorSubPercent(
        {
          subcontractor_id: row.subcontractor_id ?? null,
          cost_bucket_id: row.cost_bucket_id ?? null,
          entry_date: row.entry_date ?? selectedDate,
          updated_at: row.updated_at,
          id: row.id,
          percent_complete: row.percent_complete ?? 0,
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

  // Rows still waiting on a price (the warn-pill rows). Their logged cost is
  // summed from the SAME per-line P&L map the table reads, floored per row at 0
  // so a sub line's downward correction never reads as negative "unpriced cost".
  const unpricedRows = useMemo(
    () => entries.filter((entry) => entryNeedsPrice(entry, commitmentFor(entry))),
    [entries, commitmentFor],
  );
  const unpricedCost = useMemo(
    () =>
      centsToDollars(
        unpricedRows.reduce(
          (cents, entry) =>
            cents + Math.max(0, dollarsToCents(profitByEntry.get(entry.id)?.costToday ?? 0)),
          0,
        ),
      ),
    [unpricedRows, profitByEntry],
  );

  // Week / Month rollups for the dark stat panel, derived from the SAME entries
  // query (listDailyWipEntries already returns every entry on the project) and
  // the SAME per-line math as the day view — no second fetch, no new math. The
  // ranges anchor on the date being viewed (week = Monday of its week → it;
  // month = the 1st → it) so Day/Week/Month stay one coherent story when
  // browsing history.
  const weekStart = useMemo(() => {
    const d = new Date(`${selectedDate}T00:00:00`);
    if (Number.isNaN(d.getTime())) return selectedDate;
    return shiftDate(selectedDate, -((d.getDay() + 6) % 7));
  }, [selectedDate]);
  const monthStart = `${selectedDate.slice(0, 7)}-01`;
  const summarizeRange = useCallback(
    (from: string, to: string): DayProfitSummary => {
      const all = entriesQuery.data ?? [];
      return dayProfitSummary(
        all
          .filter((entry) => entry.entry_date >= from && entry.entry_date <= to)
          .map((entry) =>
            lineProfitToday(
              contractValueFor(entry.cost_bucket_id),
              priorCodePercent(entry, all),
              entry.percent_complete,
              rowWorkInPlace(entry, commitmentFor(entry), priorPercentFor(entry)),
            ),
          ),
      );
    },
    [entriesQuery.data, contractValueFor, commitmentFor, priorPercentFor],
  );
  const weekProfit = useMemo(
    () => summarizeRange(weekStart, selectedDate),
    [summarizeRange, weekStart, selectedDate],
  );
  const monthProfit = useMemo(
    () => summarizeRange(monthStart, selectedDate),
    [summarizeRange, monthStart, selectedDate],
  );
  const scopeProfit =
    statScope === "week" ? weekProfit : statScope === "month" ? monthProfit : dayProfit;

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
  // The modal's warn dot: only when the row being priced still needs a price.
  const editingNeedsPrice =
    editingEntry != null && entryNeedsPrice(editingEntry, commitmentFor(editingEntry));

  const draftLabor = laborCost(draft);
  const draftMaterial = sumLineItems(draft.material_items);
  const draftEquipment = sumLineItems(draft.equipment_items);
  // A sub-tagged draft on a coded line is valued by its buyout commitment × %
  // complete; self-perform by crew/materials/equipment.
  const draftCommitment = commitmentFor({
    subcontractor_id: draft.subcontractor_id || null,
    cost_bucket_id: draft.cost_bucket_id || null,
  });
  const draftBenchmarkTarget = benchmarkTargetFor({
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
      percent_complete: draft.percent_complete,
    },
    entriesQuery.data ?? [],
  );
  const draftWorkInPlace = rowWorkInPlace(
    {
      crew_count: draft.crew_count,
      people_per_crew: draft.people_per_crew,
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
    draft.unmatched_vendor_name.trim() !== "" ||
    draft.activity.trim();

  // Drop lines that are entirely blank (no description and no amount) before
  // saving, so an empty "Add line" click never persists noise.
  const cleanItems = (items: DraftCostItem[]): CostLineItem[] =>
    items
      .map((item) => ({
        description: item.description.trim(),
        amount: item.amount,
        quantity: item.quantity ?? 0,
        unit: item.unit?.trim() ?? "",
      }))
      .filter(
        (item) =>
          item.description !== "" ||
          item.amount > 0 ||
          (item.quantity ?? 0) > 0 ||
          item.unit !== "",
      );

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
      unmatched_vendor_name: draft.unmatched_vendor_name.trim(),
      entry_date: selectedDate,
      activity: draft.activity.trim(),
      crew_count: draft.crew_count,
      people_per_crew: draft.people_per_crew,
      hours: draft.hours,
      labor_rate: draft.labor_rate,
      material_cost: sumLineItems(material_items),
      equipment_cost: sumLineItems(equipment_items),
      material_items,
      equipment_items,
      quantity: draft.quantity,
      unit: draft.unit.trim(),
      target_production_rate: draftBenchmarkTarget ?? draft.target_production_rate,
      // Preserve the super's itemized quantities + % basis through the costing save.
      quantity_items: draft.quantity_items,
      percent_basis: draft.percent_basis,
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
      unmatched_vendor_name: entry.unmatched_vendor_name,
      activity: entry.activity,
      crew_count: entry.crew_count,
      people_per_crew: entry.people_per_crew,
      hours: entry.hours,
      labor_rate: entry.labor_rate,
      // Surface any lump cost with no line items as a single editable line, so
      // editing this row never silently zeroes already-recorded material /
      // equipment dollars (save recomputes the cost from these items).
      material_items: costItemsForEdit(entry.material_items, entry.material_cost).map(
        createDraftCostItem,
      ),
      equipment_items: costItemsForEdit(entry.equipment_items, entry.equipment_cost).map(
        createDraftCostItem,
      ),
      quantity: entry.quantity,
      unit: entry.unit,
      target_production_rate: effectiveProductionTargetFor(entry),
      quantity_items: entry.quantity_items.map((q) => ({
        quantity: q.quantity,
        unit: q.unit,
        description: q.description ?? "",
      })),
      percent_basis: entry.percent_basis,
      percent_complete: entry.percent_complete,
      notes: entry.notes,
    });
    setFormOpen(true);
  };

  const setDraftField = <K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  // Daily Reports can capture several installed quantities on one work line.
  // Daily WIP compares one of them with labor-hours; keeping the chosen measure
  // first also preserves the existing API/storage contract for scalar production.
  const selectProductionMeasure = (selectedIndex: number) => {
    setDraft((prev) => {
      const selected = prev.quantity_items[selectedIndex];
      if (!selected) return prev;
      const quantityItems = [
        selected,
        ...prev.quantity_items.filter((_, index) => index !== selectedIndex),
      ];
      return {
        ...prev,
        quantity: selected.quantity,
        unit: selected.unit,
        quantity_items: quantityItems,
      };
    });
  };

  const draftProductionItem = draft.quantity_items[0] ?? null;
  const draftProductionMeasure = draftProductionItem
    ? productionMeasureLabel(draftProductionItem)
    : draft.unit.trim() || "units";
  const draftProductionUnit = draftProductionItem?.unit.trim() || draft.unit.trim() || "units";
  const draftLaborHours =
    crewPeople(draft.crew_count, draft.people_per_crew) * Math.max(0, draft.hours);
  const draftActualProductionRate = productionRate({
    ...draft,
    material_cost: draftMaterial,
    equipment_cost: draftEquipment,
  });

  const productionRows = useMemo<ProductionAnalyticsRow[]>(
    () =>
      (entriesQuery.data ?? []).map((entry) => {
        const bucket = entry.cost_bucket_id ? bucketById.get(entry.cost_bucket_id) : undefined;
        const performerName = performedByName(entry) ?? "Self-perform";
        const isExternal = Boolean(entry.subcontractor_id || entry.unmatched_vendor_name);
        const performerKey = entry.subcontractor_id
          ? `sub:${entry.subcontractor_id}`
          : entry.unmatched_vendor_name
            ? `vendor:${entry.unmatched_vendor_name.trim().toLowerCase()}`
            : "self-perform";
        return {
          id: entry.id,
          date: entry.entry_date,
          performerKey,
          performerName,
          performerType: isExternal ? "subcontractor" : "self-perform",
          costBucketId: entry.cost_bucket_id ?? "",
          costCode: bucket?.cost_code ?? "",
          scopeName: bucket?.bucket ?? "Uncoded scope",
          activity: entry.activity,
          quantity: entry.quantity,
          unit: entry.unit,
          laborHours: laborHours(entry),
          targetRate: effectiveProductionTargetFor(entry),
          fieldValue: rowWorkInPlace(entry, commitmentFor(entry), priorPercentFor(entry)),
        };
      }),
    [
      entriesQuery.data,
      bucketById,
      performedByName,
      effectiveProductionTargetFor,
      commitmentFor,
      priorPercentFor,
    ],
  );
  const productionPlans = useMemo<ProductionScopePlan[]>(() => {
    const map = new Map<string, ProductionScopePlan>();
    for (const row of productionRows) {
      let plannedQuantity = 0;
      let unit = "";
      if (row.performerKey.startsWith("sub:")) {
        const companyId = row.performerKey.slice(4);
        const commitmentKey = subCommitmentKey(companyId, row.costBucketId || null);
        const setting = commitmentKey ? productionBenchmarkSettings.get(commitmentKey) : undefined;
        plannedQuantity = setting?.plannedQuantity ?? 0;
        unit = setting?.unit ?? "";
      } else {
        const bucket = bucketById.get(row.costBucketId);
        plannedQuantity = bucket?.contract_quantity ?? 0;
        unit = bucket?.unit ?? "";
      }
      if (
        plannedQuantity <= 0 ||
        !unit.trim() ||
        canonicalProductionUnit(unit) !== canonicalProductionUnit(row.unit)
      ) {
        continue;
      }
      const plan = {
        performerKey: row.performerKey,
        costBucketId: row.costBucketId,
        plannedQuantity,
        unit,
      };
      map.set(productionScopeKey(row), plan);
    }
    return [...map.values()];
  }, [productionRows, productionBenchmarkSettings, bucketById]);

  if (projectSubsQuery.isLoading) {
    return <SubcontractFinancialReadState loading />;
  }
  if (projectSubsQuery.isError || !projectSubsQuery.data) {
    return (
      <SubcontractFinancialReadState
        error={projectSubsQuery.error}
        retrying={projectSubsQuery.isFetching}
        onRetry={() => {
          void projectSubsQuery.refetch();
        }}
      />
    );
  }

  if (workspaceMode === "production") {
    return (
      <ProductionControlView
        projectId={projectId}
        rows={productionRows}
        plans={productionPlans}
        buckets={buckets.map((bucket) => ({
          id: bucket.id,
          cost_code: bucket.cost_code,
          bucket: bucket.bucket,
          earned_percent_complete: bucket.earned_percent_complete ?? 0,
        }))}
        entries={entriesQuery.data ?? []}
        loading={entriesQuery.isLoading}
        onShowDaily={() => setWorkspaceMode("daily")}
      />
    );
  }

  const unpricedCount = unpricedRows.length;
  // Sign-aware headline coloring: earned reads success; the cost figure turns
  // danger only when the measured day actually lost money.
  const dayLost = dayProfit.measuredCount > 0 && dayProfit.profit < 0;
  const marginPct = (s: DayProfitSummary): string | null =>
    s.earned > 0 ? ((s.profit / s.earned) * 100).toFixed(1) : null;
  const netLabel = (s: DayProfitSummary, withMargin = false): string => {
    if (s.measuredCount === 0) return "—";
    const base = `${s.profit < 0 ? "−" : "+"}${fmtUSD(Math.abs(s.profit))}`;
    const margin = withMargin ? marginPct(s) : null;
    return margin ? `${base} · ${margin}%` : base;
  };
  const barMax = Math.max(scopeProfit.earned, scopeProfit.measuredCost);
  const barWidth = (value: number) => (barMax > 0 ? `${(value / barMax) * 100}%` : "0%");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-hairline bg-surface p-1">
          <Button type="button" size="sm" variant="secondary" className="h-8" aria-pressed="true">
            Daily WIP
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5"
            aria-pressed="false"
            onClick={() => setWorkspaceMode("production")}
          >
            <BarChart3 className="h-3.5 w-3.5" /> Production Control
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">Daily facts or production trends</span>
      </div>
      {/* Verdict header — the pill, the answer, then the date stepper. */}
      <div>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="rounded-md border border-hairline px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-clay">
            Work in place
          </span>
          <span className="text-xs text-muted-foreground">Internal · never client-visible</span>
        </div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h1 className="max-w-[34ch] font-serif text-[30px] font-normal leading-[1.15] text-foreground">
              {shortDate(selectedDate)} earned{" "}
              <span className="text-success">{fmtUSD(dayProfit.earned)}</span> and cost{" "}
              <span className={dayLost ? "text-danger" : "text-foreground"}>
                {fmtUSD(workInPlaceTotal)}
              </span>
              {unpricedCount > 0 ? (
                <>
                  {" "}
                  — but {unpricedCount} line{unpricedCount === 1 ? "" : "s"} still need
                  {unpricedCount === 1 ? "s" : ""} a price.
                </>
              ) : (
                "."
              )}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              The pencil on any line opens the pricing form.
            </p>
          </div>
          {/* Date navigator, restyled as the right-aligned stepper pill. */}
          <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-hairline bg-surface px-1.5 py-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 rounded-full"
              aria-label="Previous day"
              onClick={() => setSelectedDate((d) => shiftDate(d, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value || localToday())}
              className="h-7 w-[150px] border-0 bg-transparent px-1 text-sm font-medium shadow-none focus-visible:ring-0"
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 rounded-full"
              aria-label="Next day"
              onClick={() => setSelectedDate((d) => shiftDate(d, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 rounded-full px-2.5 text-xs"
              onClick={() => setSelectedDate(localToday())}
            >
              Today
            </Button>
          </div>
        </div>
      </div>

      {/* Needs-price alert — only when lines are waiting on a price. */}
      {unpricedCount > 0 ? (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-warning/30 bg-warning/10 px-4 py-2.5">
          <span className="h-2 w-2 shrink-0 rounded-full bg-warning" aria-hidden="true" />
          <span className="text-[13px] font-semibold text-foreground">
            {unpricedCount} line{unpricedCount === 1 ? " needs" : "s need"} a price
          </span>
          <span className="text-xs text-muted-foreground">
            {fmtUSD(unpricedCost)} of logged cost isn't earning yet.
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto h-7 px-2 text-xs font-semibold"
            onClick={() => startEdit(unpricedRows[0])}
          >
            Price the first →
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Left: the day's WIP ledger + the pricing modal */}
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Logged work
              </div>
              {datesWithEntries.has(selectedDate) ? (
                <span className="rounded-sm bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground">
                  {entries.length} logged
                </span>
              ) : null}
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
          <div className="overflow-x-auto rounded-xl border border-hairline bg-surface">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead className="border-b border-hairline">
                <tr className="font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  <th className="px-3 py-2.5 text-left">Activity / cost code</th>
                  <th className="px-3 py-2.5 text-right">Progress</th>
                  <th className="px-3 py-2.5 text-right text-success">Earned</th>
                  <th className="px-3 py-2.5 text-right">Cost</th>
                  <th className="px-3 py-2.5 text-right">Made</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {entriesQuery.isLoading ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                ) : entries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
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
                      performedBy={performedByName(entry)}
                      subCommitment={commitmentFor(entry)}
                      progressBasis={commitmentFor(entry) ?? contractValueFor(entry.cost_bucket_id)}
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
                  <tr className="border-t-2 border-foreground">
                    <td className="px-3 py-3 text-left font-semibold text-foreground">
                      Day total
                      <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                        {totals.laborHours} labor-hours
                      </span>
                    </td>
                    <td />
                    <td className="px-3 py-3 text-right font-serif text-[17px] text-success">
                      {fmtUSD(dayProfit.earned)}
                    </td>
                    <td className="px-3 py-3 text-right font-serif text-[17px] text-foreground">
                      {fmtUSD(workInPlaceTotal)}
                      <div className="font-sans text-[10px] text-muted-foreground">
                        L {fmtUSD(totals.labor)} · M {fmtUSD(totals.material)} · E{" "}
                        {fmtUSD(totals.equipment)}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-serif text-[19px]">
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
            <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-5xl overflow-y-auto">
              <DialogHeader>
                <div className="flex items-center gap-2">
                  {editingNeedsPrice ? (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-warning" aria-hidden="true" />
                  ) : null}
                  <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-clay">
                    {editingId ? "Price this work line" : "Add a work line"}
                  </span>
                </div>
                <DialogTitle className="font-serif text-[22px] font-normal leading-snug">
                  {editingId
                    ? draft.activity.trim() || bucketLabel(draft.cost_bucket_id || null)
                    : "New work line"}
                </DialogTitle>
                <div className="font-mono text-[10px] text-muted-foreground">
                  {[
                    bucketLabel(draft.cost_bucket_id || null),
                    (subName(draft.subcontractor_id || null) ?? draft.unmatched_vendor_name) ||
                      "Self-perform",
                    formatBillingDate(selectedDate),
                  ].join(" · ")}
                </div>
                <DialogDescription>
                  {editingId
                    ? "Add the blended crew rate, materials, and equipment to price the superintendent's logged work."
                    : `Adds a priced line directly to ${formatBillingDate(selectedDate)}. The superintendent usually logs the day's work in the Daily Reports tab.`}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                    Cost code (SOV line)
                  </span>
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
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                    Schedule activity (CPM)
                  </span>
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
                <div className="flex flex-col gap-1">
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
                    labelClassName="font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground"
                    flagUnmatched
                  />
                </div>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                    Activity / note
                  </span>
                  <Input
                    value={draft.activity}
                    onChange={(event) => setDraftField("activity", event.target.value)}
                    placeholder="e.g. Formwork north wall"
                  />
                </label>
              </div>
              <div className="mt-1 grid gap-3.5 sm:grid-cols-5">
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                    Crews
                  </span>
                  <Input
                    type="number"
                    min={0}
                    value={draft.crew_count || ""}
                    onChange={(event) =>
                      setDraftField("crew_count", Number(event.target.value) || 0)
                    }
                  />
                  <span className="text-[10px] text-muted-foreground">
                    {crewPeople(draft.crew_count, draft.people_per_crew)} people total
                  </span>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                    People per crew
                  </span>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={draft.people_per_crew || ""}
                    onChange={(event) =>
                      setDraftField("people_per_crew", Number(event.target.value) || 2)
                    }
                  />
                  <span className="text-[10px] text-muted-foreground">
                    Defaults to 2 for legacy lines
                  </span>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                    Hours per person
                  </span>
                  <Input
                    type="number"
                    min={0}
                    step="0.25"
                    value={draft.hours || ""}
                    onChange={(event) => setDraftField("hours", Number(event.target.value) || 0)}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                    Blended rate ($/person hr)
                  </span>
                  <MoneyInput
                    value={draft.labor_rate}
                    onValueChange={(n) => setDraftField("labor_rate", n)}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                    Labor (derived)
                  </span>
                  <div className="flex h-9 items-center rounded-md border border-hairline bg-muted/40 px-3 text-sm tabular-nums text-foreground">
                    {fmtUSD(draftLabor)}
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {draft.crew_count || 0} crews × {draft.people_per_crew || 2} people ×{" "}
                    {draft.hours || 0} hrs × {fmtUSD(draft.labor_rate)}
                  </span>
                </label>
              </div>
              <div className="mt-1 grid items-start gap-4 lg:grid-cols-5">
                {draft.quantity_items.length > 0 ? (
                  <div className="lg:col-span-2">
                    <InstalledQuantities items={draft.quantity_items} />
                  </div>
                ) : (
                  <>
                    <label className="flex flex-col gap-1">
                      <span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                        Quantity placed
                      </span>
                      <Input
                        type="number"
                        min={0}
                        value={draft.quantity || ""}
                        onChange={(event) =>
                          setDraftField("quantity", Number(event.target.value) || 0)
                        }
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                        Unit
                      </span>
                      <Input
                        value={draft.unit}
                        onChange={(event) => setDraftField("unit", event.target.value)}
                        placeholder="SF, CY, LF…"
                      />
                    </label>
                  </>
                )}
                <div className="grid items-start gap-3.5 rounded-xl border border-hairline bg-muted/20 p-4 sm:grid-cols-2 lg:col-span-3">
                  <div className="sm:col-span-2">
                    <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-clay">
                      Production rate setup
                    </div>
                    <p className="mt-1.5 max-w-[72ch] text-xs leading-relaxed text-muted-foreground">
                      Production rate means installed output divided by total labor-hours. Choose
                      the field quantity that best represents this scope — SF, LF, CY, EA, rooms,
                      fixtures, junction boxes, or any other unit captured in the Daily Report.
                      OverWatch then compares the actual rate with the target pace you set.
                    </p>
                  </div>
                  {draft.quantity_items.length > 1 ? (
                    <label className="flex flex-col gap-1 sm:col-span-2">
                      <span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                        Choose production measure
                      </span>
                      <select
                        value="0"
                        onChange={(event) => selectProductionMeasure(Number(event.target.value))}
                        className="h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        aria-label="Installed quantity used for the production rate"
                      >
                        {draft.quantity_items.map((item, index) => (
                          <option key={`${item.unit}-${item.description}-${index}`} value={index}>
                            {productionMeasureLabel(item)} · {item.quantity.toLocaleString("en-US")}{" "}
                            logged
                          </option>
                        ))}
                      </select>
                      <span className="text-[10px] leading-relaxed text-muted-foreground">
                        Select the output that should be divided by the crew's total labor-hours.
                      </span>
                    </label>
                  ) : null}
                  <label className="flex flex-col gap-1">
                    <span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                      Target pace
                    </span>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={draftBenchmarkTarget ?? draft.target_production_rate ?? ""}
                      placeholder="Enter target"
                      disabled={draftBenchmarkTarget != null}
                      onChange={(event) =>
                        setDraftField(
                          "target_production_rate",
                          event.target.value === "" ? null : Number(event.target.value) || null,
                        )
                      }
                    />
                    <span className="text-[10px] leading-relaxed text-muted-foreground">
                      {draftBenchmarkTarget != null
                        ? `Calculated benchmark for the selected ${draftProductionMeasure} measure.`
                        : `Target is output per labor-hour for whichever measure you choose above. Current measure: ${draftProductionMeasure} / labor hr.`}
                    </span>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                      Cumulative progress
                    </span>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={draft.percent_complete || ""}
                      placeholder="0–100"
                      onChange={(event) =>
                        setDraftField(
                          "percent_complete",
                          Math.min(100, Math.max(0, Number(event.target.value) || 0)),
                        )
                      }
                    />
                    <span className="text-[10px] leading-relaxed text-muted-foreground">
                      Percent of the full scope complete to date.
                    </span>
                  </label>
                  <div className="rounded-md border border-hairline bg-surface px-3 py-2 text-[11px] leading-relaxed text-muted-foreground sm:col-span-2">
                    <span className="font-semibold text-foreground">Current actual rate: </span>
                    {draftActualProductionRate != null ? (
                      <>
                        {draft.quantity.toLocaleString("en-US")} {draftProductionMeasure} ÷{" "}
                        {draftLaborHours.toLocaleString("en-US")} labor-hours ={" "}
                        <span className="font-semibold text-foreground">
                          {draftActualProductionRate.toFixed(2)} {draftProductionUnit}/labor hr
                        </span>
                      </>
                    ) : (
                      "Add both installed quantity and crew labor-hours to calculate the actual rate."
                    )}
                  </div>
                </div>
              </div>
              {draftIsSub || editingEntry ? (
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                  {draftIsSub ? (
                    <span className="text-muted-foreground">
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
                    <span className={pmAdjusting ? "text-warning" : "text-muted-foreground"}>
                      {pmAdjusting
                        ? `Field logged ${fieldPercent}% — you're showing ${draft.percent_complete}%. The change is recorded.`
                        : `Field logged ${fieldPercent}%.`}
                    </span>
                  ) : null}
                </div>
              ) : null}

              {/* Itemized materials + equipment: what it was, and how much it cost. */}
              <div className="mt-2 grid gap-4 sm:grid-cols-2">
                <ItemizedCostEditor
                  label="Materials"
                  help="Field quantities are preloaded when available — add the dollar value."
                  placeholder="What material? e.g. rebar #5"
                  items={draft.material_items}
                  onChange={(items) => setDraftField("material_items", items)}
                />
                <ItemizedCostEditor
                  label="Equipment"
                  help="Field equipment is preloaded when available — add the dollar value."
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

        {/* Right: the dark stat panel, then the day's daily report reference */}
        <aside className="space-y-3">
          <div className="rounded-xl bg-dark-panel p-5 text-dark-panel-foreground">
            <div className="flex gap-0.5 rounded-lg bg-white/10 p-0.5">
              {(
                [
                  ["day", "Day"],
                  ["week", "Week"],
                  ["month", "Month"],
                ] as const
              ).map(([scope, label]) => (
                <button
                  key={scope}
                  type="button"
                  aria-pressed={statScope === scope}
                  onClick={() => setStatScope(scope)}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors motion-reduce:transition-none ${
                    statScope === scope
                      ? "bg-dark-panel-foreground text-dark-panel"
                      : "text-dark-panel-foreground/60 hover:text-dark-panel-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-4 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-dark-panel-foreground/60">
              {statScope === "day"
                ? `Made ${shortDate(selectedDate)}`
                : statScope === "week"
                  ? "Made this week"
                  : "Made this month"}
            </div>
            {scopeProfit.measuredCount > 0 ? (
              <>
                <div
                  className={`mt-2 font-serif text-[40px] leading-none ${
                    scopeProfit.profit < 0 ? "text-[#E08A76]" : "text-[#7FB08A]"
                  }`}
                >
                  {scopeProfit.profit < 0 ? "−" : "+"}
                  {fmtUSD(Math.abs(scopeProfit.profit))}
                </div>
                {marginPct(scopeProfit) ? (
                  <div className="mt-1.5 text-xs text-dark-panel-foreground/60">
                    {marginPct(scopeProfit)}% margin
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className="mt-2 font-serif text-[40px] leading-none text-dark-panel-foreground/40">
                  —
                </div>
                <div className="mt-1.5 text-xs text-dark-panel-foreground/60">
                  Log % progress on lines to measure what was earned.
                </div>
              </>
            )}
            <div className="mt-5 space-y-3">
              <div>
                <div className="flex justify-between text-xs text-dark-panel-foreground/60">
                  <span>Earned (owner pays)</span>
                  <span className="font-semibold text-dark-panel-foreground">
                    {fmtUSD(scopeProfit.earned)}
                  </span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-[#7FB08A]/80"
                    style={{ width: barWidth(scopeProfit.earned) }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs text-dark-panel-foreground/60">
                  <span>Cost to produce</span>
                  <span className="font-semibold text-dark-panel-foreground">
                    {fmtUSD(scopeProfit.measuredCost)}
                  </span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-signal/80"
                    style={{ width: barWidth(scopeProfit.measuredCost) }}
                  />
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2 border-t border-white/15 pt-3.5 text-xs">
              <div className="flex justify-between gap-2 text-dark-panel-foreground/60">
                <span>Week to date</span>
                <span className="font-serif text-sm text-dark-panel-foreground">
                  {netLabel(weekProfit, true)}
                </span>
              </div>
              <div className="flex justify-between gap-2 text-dark-panel-foreground/60">
                <span>Month to date</span>
                <span className="font-serif text-sm text-dark-panel-foreground">
                  {netLabel(monthProfit)}
                </span>
              </div>
            </div>
            <div className="mt-3.5 font-mono text-[9.5px] leading-relaxed text-dark-panel-foreground/40">
              Day / Week / Month swaps the headline figure.
            </div>
          </div>

          <div className="rounded-xl border border-hairline bg-surface p-4">
            <div className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
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
            <div className="rounded-xl border border-hairline bg-surface p-4">
              <div className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Production
              </div>
              <ul className="mt-2 space-y-2 text-sm">
                {entries
                  .map((entry) => ({
                    entry,
                    rate: productionRate(entry),
                    pace: productionPace({
                      ...entry,
                      target_production_rate: effectiveProductionTargetFor(entry),
                    }),
                  }))
                  .filter((row) => row.rate != null)
                  .map(({ entry, rate, pace }) => (
                    <li key={entry.id} className="border-b border-hairline/60 pb-2 last:border-0">
                      <div className="flex justify-between gap-2 text-muted-foreground">
                        <span className="truncate">
                          {entry.activity || bucketLabel(entry.cost_bucket_id)}
                        </span>
                        <span className="shrink-0 tabular-nums text-foreground">
                          {(rate as number).toFixed(2)} {entry.unit || "unit"}/labor hr
                        </span>
                      </div>
                      {pace ? (
                        <div
                          className={`mt-0.5 text-right text-[11px] font-medium tabular-nums ${
                            pace.status === "ahead"
                              ? "text-success"
                              : pace.status === "behind"
                                ? "text-danger"
                                : "text-warning"
                          }`}
                        >
                          {pace.status === "on-pace" ? "On pace" : pace.status} · target{" "}
                          {pace.targetRate.toFixed(2)} {entry.unit || "unit"}/labor hr ·{" "}
                          {pace.variancePercent >= 0 ? "+" : ""}
                          {(pace.variancePercent * 100).toFixed(1)}%
                        </div>
                      ) : (
                        <div className="mt-0.5 text-right text-[11px] text-muted-foreground">
                          No target set
                        </div>
                      )}
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

      <SubcontractProductionBenchmarks
        entries={entriesQuery.data ?? []}
        buckets={buckets}
        commitments={commitmentLookup}
        subcontractorNames={subNameById}
        settings={productionBenchmarkSettings}
      />
    </div>
  );
}

// "500 LF conduit · 24 junction boxes" — the itemized installed quantities for a
// row, falling back to the scalar quantity/unit for rows predating the list.
function quantitiesSummary(entry: DailyWipEntryRow): string | null {
  if (entry.quantity_items.length) {
    return entry.quantity_items
      .map((q) => [`${q.quantity} ${q.unit || "qty"}`, q.description].filter(Boolean).join(" "))
      .join(" · ");
  }
  if (entry.quantity) return `${entry.quantity} ${entry.unit || "qty"}`;
  return null;
}

// Human-readable breakdown for the Cost cell's hover title.
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
  progressBasis,
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
  // What the % is a percent OF: a sub line's buyout commitment, else the cost
  // code's contract value; null when neither is known.
  progressBasis: number | null;
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
  const needsPrice = entryNeedsPrice(entry, subCommitment);
  const costed = !needsPrice;
  const hasBreakdown = labor > 0 || entry.material_cost > 0 || entry.equipment_cost > 0;
  const costTooltip =
    [itemsTooltip(entry.material_items), itemsTooltip(entry.equipment_items)]
      .filter(Boolean)
      .join("\n") || undefined;
  return (
    <tr
      className={`border-b border-hairline/70 last:border-0 ${
        needsPrice ? "bg-warning/5" : editing ? "bg-accent/10" : ""
      }`}
    >
      <td className="px-3 py-2.5 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-foreground">
            {entry.activity || label}
          </span>
          {needsPrice ? (
            <span className="whitespace-nowrap rounded-full border border-warning/40 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.06em] text-warning">
              Needs price
            </span>
          ) : null}
        </div>
        {entry.activity ? (
          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{label}</div>
        ) : null}
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
            {entry.unmatched_vendor_name ? (
              <span className="shrink-0 rounded-sm border border-warning/40 px-1 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wide text-warning">
                Match vendor
              </span>
            ) : null}
          </div>
        ) : null}
        {quantitiesSummary(entry) ? (
          <div className="mt-0.5 text-[11px] text-muted-foreground">{quantitiesSummary(entry)}</div>
        ) : null}
      </td>
      <td className="px-3 py-2.5 text-right">
        {entry.percent_complete > 0 ? (
          <>
            <div className="text-[13px] font-semibold tabular-nums text-foreground">
              {entry.percent_complete}%
            </div>
            {progressBasis != null && progressBasis > 0 ? (
              <div className="text-[10px] text-muted-foreground">of {fmtUSD(progressBasis)}</div>
            ) : null}
            <div className="text-[10px] text-muted-foreground">
              {entry.percent_basis === "cpm" ? "% of CPM" : "% of SOV"}
            </div>
            {isPercentOverridden(entry) ? (
              <div className="text-[10px] text-warning">
                field logged {entry.field_percent_complete}%
              </div>
            ) : null}
          </>
        ) : (
          <span className="text-xs text-warning">— set —</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right font-serif text-[15px]">
        {profit && profit.earnedToday !== null ? (
          <span className="text-success">{fmtUSD(profit.earnedToday)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td
        className="px-3 py-2.5 text-right font-serif text-[15px] text-foreground"
        title={costTooltip}
      >
        {fmtUSD(workInPlace)}
        {hasBreakdown ? (
          <div className="font-sans text-[10px] text-muted-foreground">
            L {fmtUSD(labor)} · M {fmtUSD(entry.material_cost)} · E {fmtUSD(entry.equipment_cost)}
          </div>
        ) : null}
        {isSubLine && costed ? (
          <div className="font-sans text-[10px] text-muted-foreground">
            {priorPercent > 0
              ? `+${entry.percent_complete - priorPercent}% (${priorPercent}→${entry.percent_complete}%)`
              : `${entry.percent_complete}% of ${fmtUSD(subCommitment ?? 0)}`}
          </div>
        ) : null}
      </td>
      <td className="px-3 py-2.5 text-right font-serif text-[15px]">
        {needsPrice ? (
          <span className="text-warning">?</span>
        ) : profit && profit.profitToday !== null ? (
          <ProfitAmount value={profit.profitToday} />
        ) : (
          <>
            <span className="text-muted-foreground">—</span>
            {profit?.reason ? (
              <div className="max-w-[110px] font-sans text-[10px] leading-snug text-muted-foreground">
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
